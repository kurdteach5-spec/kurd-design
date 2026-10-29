// Reads the latest posts of a profile. RSS / Atom feeds (e.g. the trumpstruth.org archive of Truth Social),
// Bluesky (public API) and Mastodon-style servers. Sites that don't allow the browser to read them directly
// are read through the site's small proxy (api/feed.js on Vercel).
import { usePosts, type Post, type Profile, type SourceType } from './store';

export type RawPost = Omit<Post, 'profileId' | 'seenAt'>;
export interface FetchResult { posts: RawPost[]; name?: string; avatar?: string | null; handle?: string }

export const PRESETS: { id: string; name: string; tab: string; handle: string; type: SourceType; value: string; note: string }[] = [
  { id: 'trump', name: 'Donald J. Trump', tab: 'Trump', handle: '@realDonaldTrump', type: 'rss', value: 'https://www.trumpstruth.org/feed', note: 'Truth Social posts, from the trumpstruth.org archive (RSS)' },
];

const proxyUrl = (url: string) => { const base = usePosts.getState().settings.proxy.trim() || '/api/feed'; return `${base}${base.includes('?') ? '&' : '?'}url=${encodeURIComponent(url)}`; };

class SourceError extends Error {}

async function getText(url: string): Promise<string> {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (r.ok) return await r.text();
  } catch { /* blocked by the browser (CORS): try the proxy */ }
  let r: Response;
  try { r = await fetch(proxyUrl(url), { cache: 'no-store' }); } catch { throw new SourceError('The source could not be reached. Check the internet connection, or the address.'); }
  if (r.status === 404) throw new SourceError('The source could not be read from here. Open the site on Vercel (it has the feed reader), or set a feed proxy in Settings.');
  if (!r.ok) throw new SourceError(`The source answered with an error (${r.status}).`);
  const body = await r.text();
  // a static host answers with the app itself: there is no feed reader there
  if (/text\/html/i.test(r.headers.get('content-type') ?? '') && /SARWAR DESIGN|id="root"/.test(body.slice(0, 4000))) throw new SourceError('The source could not be read from here. Open the site on Vercel (it has the feed reader), or set a feed proxy in Settings.');
  return body;
}
async function getJson<T>(url: string): Promise<T> {
  const t = await getText(url);
  try { return JSON.parse(t) as T; } catch { throw new SourceError('The source did not answer with posts. Check the address.'); }
}

/** HTML → plain text with line breaks kept */
export function htmlToText(html: string): string {
  const withBreaks = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d|blockquote)>/gi, '\n\n');
  const doc = new DOMParser().parseFromString(`<body>${withBreaks}</body>`, 'text/html');
  return (doc.body.textContent ?? '').replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
const imgsFromHtml = (html: string) => [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]).filter((u) => /^https?:/.test(u) && !/emoji|avatar/i.test(u));
const isImageUrl = (u: string, type?: string | null) => (type ? type.startsWith('image/') : /\.(jpe?g|png|webp|gif)(\?|$)/i.test(u));

function parseFeed(xml: string): FetchResult {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new SourceError('The address is not an RSS or Atom feed.');
  const text = (el: Element | null | undefined) => el?.textContent?.trim() ?? '';
  const child = (el: Element, ...names: string[]) => { for (const n of names) { const c = [...el.children].find((x) => x.localName === n || x.nodeName === n); if (c) return c; } return null; };
  const items = [...doc.getElementsByTagName('item')];
  const entries = items.length ? items : [...doc.getElementsByTagName('entry')];
  if (!entries.length && !doc.querySelector('rss, feed, channel')) throw new SourceError('The address is not an RSS or Atom feed.');
  const chan = doc.querySelector('channel') ?? doc.documentElement;
  const posts: RawPost[] = entries.map((it) => {
    const linkEl = child(it, 'link');
    const link = linkEl?.getAttribute('href') || text(linkEl);
    const html = text(child(it, 'encoded', 'content:encoded')) || text(child(it, 'description', 'content', 'summary'));
    const title = text(child(it, 'title'));
    let body = htmlToText(html);
    const plainTitle = htmlToText(title);
    if (!body && plainTitle && !/^\[no title\]/i.test(plainTitle)) body = plainTitle;
    // archives often repeat the post as the title: keep the full body only
    const images = imgsFromHtml(html);
    for (const m of [...it.getElementsByTagName('*')]) {
      if ((m.localName === 'enclosure' || m.localName === 'content' || m.localName === 'thumbnail') && m.getAttribute('url')) {
        const u = m.getAttribute('url')!; if (isImageUrl(u, m.getAttribute('type') || (m.getAttribute('medium') === 'image' ? 'image/' : null))) images.push(u);
      }
    }
    const dateStr = text(child(it, 'pubDate', 'published', 'updated', 'date'));
    const date = Date.parse(dateStr) || Date.now();
    const id = text(child(it, 'guid', 'id')) || link || `${date}:${body.slice(0, 40)}`;
    return { id, text: body, url: link, date, images: [...new Set(images)].slice(0, 4) };
  }).filter((p) => p.text || p.images.length);
  return { posts, name: text(child(chan, 'title')) || undefined };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function fetchBluesky(handle: string): Promise<FetchResult> {
  const actor = handle.replace(/^@/, '').replace(/^https?:\/\/bsky\.app\/profile\//, '').replace(/\/.*$/, '').trim();
  if (!actor) throw new SourceError('Write the Bluesky handle, e.g. name.bsky.social');
  const d = await getJson<any>(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(actor)}&limit=30&filter=posts_no_replies`);
  if (d.error) throw new SourceError(d.message || 'The Bluesky profile was not found.');
  const feed: any[] = d.feed ?? [];
  const mine = feed.filter((f) => !f.reason && f.post);
  const first = mine[0]?.post?.author ?? feed[0]?.post?.author;
  return {
    name: first?.displayName, avatar: first?.avatar ?? null, handle: first?.handle ? `@${first.handle}` : undefined,
    posts: mine.map((f) => {
      const p = f.post; const rkey = String(p.uri).split('/').pop();
      const imgs: string[] = (p.embed?.images ?? p.embed?.media?.images ?? []).map((i: any) => i.fullsize).filter(Boolean);
      return { id: p.uri, text: String(p.record?.text ?? ''), url: `https://bsky.app/profile/${p.author?.handle}/post/${rkey}`, date: Date.parse(p.record?.createdAt ?? p.indexedAt) || Date.now(), images: imgs };
    }),
  };
}

async function fetchMastodon(addr: string): Promise<FetchResult> {
  // accepts @user@server, user@server or https://server/@user
  let user = '', host = '';
  const u = addr.trim().match(/^https?:\/\/([^/]+)\/@([^/?#]+)/);
  if (u) { host = u[1]; user = u[2]; } else { const m = addr.trim().replace(/^@/, '').split('@'); user = m[0]; host = m[1] ?? ''; }
  if (!user || !host) throw new SourceError('Write the address as @name@server, e.g. @user@mastodon.social');
  const acc = await getJson<any>(`https://${host}/api/v1/accounts/lookup?acct=${encodeURIComponent(user)}`);
  if (!acc?.id) throw new SourceError('The profile was not found on that server.');
  const list = await getJson<any[]>(`https://${host}/api/v1/accounts/${acc.id}/statuses?exclude_replies=true&exclude_reblogs=true&limit=30`);
  return {
    name: acc.display_name || acc.username, avatar: acc.avatar ?? null, handle: `@${acc.acct}`,
    posts: (Array.isArray(list) ? list : []).map((s) => ({
      id: String(s.uri || s.id), text: htmlToText(String(s.content ?? '')), url: String(s.url || s.uri || ''), date: Date.parse(s.created_at) || Date.now(),
      images: (s.media_attachments ?? []).filter((m: any) => m.type === 'image').map((m: any) => m.url).filter(Boolean),
    })).filter((p) => p.text || p.images.length),
  };
}

export async function fetchSource(type: SourceType, value: string): Promise<FetchResult> {
  const v = value.trim();
  if (!v) throw new SourceError('Write the address of the source.');
  if (type === 'bluesky') return fetchBluesky(v);
  if (type === 'mastodon') return fetchMastodon(v);
  if (!/^https?:\/\//i.test(v)) throw new SourceError('A feed address starts with https://');
  return parseFeed(await getText(v));
}
export const fetchProfile = (p: Profile) => fetchSource(p.source.type, p.source.value);

// ---------- pictures for the canvas (read as blobs so the design can be saved) ----------
const imgCache = new Map<string, Promise<HTMLImageElement | null>>();
export function loadImage(src: string | null | undefined): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  let p = imgCache.get(src);
  if (!p) {
    p = (async () => {
      let url = src;
      if (/^https?:/.test(src)) {
        let blob: Blob | null = null;
        try { const r = await fetch(src); if (r.ok) blob = await r.blob(); } catch { /* CORS: try the proxy */ }
        if (!blob) { try { const r = await fetch(proxyUrl(src)); if (r.ok) blob = await r.blob(); } catch { /* unreachable */ } }
        if (!blob || !blob.type.startsWith('image/')) return null;
        url = URL.createObjectURL(blob);
      }
      return await new Promise<HTMLImageElement | null>((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = url; });
    })();
    imgCache.set(src, p);
    if (imgCache.size > 120) imgCache.delete(imgCache.keys().next().value!);
  }
  return p;
}
