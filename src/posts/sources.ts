// Reads the latest posts of a profile from a pasted link: Truth Social, Telegram channels, YouTube, Bluesky,
// Mastodon, Reddit, any site with an RSS / Atom feed — and X, Facebook, Instagram, TikTok and Threads through
// a ScrapeCreators API key. Sites that don't allow the browser to read them directly are read through the
// site's small proxy (api/feed.js on Vercel).
import { usePosts, type Post, type Profile, type SourceType } from './store';

export type RawPost = Omit<Post, 'profileId' | 'seenAt'>;
export interface FetchResult { posts: RawPost[]; name?: string; avatar?: string | null; handle?: string; via?: string | null }

export const PRESETS: { id: string; name: string; tab: string; handle: string; type: SourceType; value: string; link: string; note: string }[] = [
  { id: 'trump', name: 'Donald J. Trump', tab: 'Trump', handle: '@realDonaldTrump', type: 'truth', value: 'realDonaldTrump', link: 'https://truthsocial.com/@realDonaldTrump', note: 'Truth Social, read straight from the profile (with the trumpstruth.org archive as a backup)' },
];

export type Platform = 'truth' | 'x' | 'facebook' | 'instagram' | 'tiktok' | 'threads' | 'telegram' | 'youtube' | 'bluesky' | 'mastodon' | 'reddit' | 'rss';
export const PLATFORM_NAMES: Record<Platform, string> = {
  truth: 'Truth Social', x: 'X (Twitter)', facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', threads: 'Threads',
  telegram: 'Telegram', youtube: 'YouTube', bluesky: 'Bluesky', mastodon: 'Mastodon', reddit: 'Reddit', rss: 'RSS / website',
};
export interface Detected { platform: Platform; type: SourceType; value: string; handle: string; needsKey: boolean }

/** works out the platform and the account from a pasted profile link (or @handle) */
export function detectLink(input: string): Detected | null {
  let s = input.trim();
  if (!s) return null;
  if (/^@?[\w.-]+@[\w.-]+\.\w+$/.test(s)) return { platform: 'mastodon', type: 'mastodon', value: s, handle: `@${s.replace(/^@/, '')}`, needsKey: false };
  if (/^[\w-]+\.bsky\.social$/i.test(s)) return { platform: 'bluesky', type: 'bluesky', value: s, handle: `@${s}`, needsKey: false };
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let u: URL; try { u = new URL(s); } catch { return null; }
  const host = u.hostname.replace(/^(www\.|m\.|mobile\.)/, '').toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);
  const first = decodeURIComponent(parts[0] ?? '');
  const at = first.replace(/^@/, '');
  const api = (platform: Platform, value: string, handle: string): Detected => ({ platform, type: 'api', value: `${platform}:${value}`, handle, needsKey: true });
  if (host === 'truthsocial.com' && at) return { platform: 'truth', type: 'truth', value: at, handle: `@${at}`, needsKey: false };
  if ((host === 'x.com' || host === 'twitter.com') && at && !['home', 'search', 'i'].includes(at)) return api('x', at, `@${at}`);
  if (host === 'instagram.com' && at) return api('instagram', at, `@${at}`);
  if (host === 'tiktok.com' && first.startsWith('@')) return api('tiktok', at, `@${at}`);
  if ((host === 'threads.net' || host === 'threads.com') && first.startsWith('@')) return api('threads', at, `@${at}`);
  if (host === 'facebook.com' || host === 'fb.com') return api('facebook', `https://www.facebook.com${u.pathname}${u.search}`, at && at !== 'profile.php' ? at : (u.searchParams.get('id') ?? 'Facebook'));
  if (host === 't.me' || host === 'telegram.me') { const ch = parts[0] === 's' ? parts[1] : parts[0]; if (ch) return { platform: 'telegram', type: 'telegram', value: ch, handle: `@${ch}`, needsKey: false }; }
  if (host === 'youtube.com' || host === 'youtu.be') return { platform: 'youtube', type: 'youtube', value: u.href, handle: first.startsWith('@') ? first : 'YouTube', needsKey: false };
  if (host === 'bsky.app' && parts[0] === 'profile' && parts[1]) return { platform: 'bluesky', type: 'bluesky', value: parts[1], handle: `@${parts[1]}`, needsKey: false };
  if (host === 'reddit.com' && parts.length >= 2 && ['r', 'u', 'user'].includes(parts[0])) {
    const kind = parts[0] === 'r' ? 'r' : 'user';
    return { platform: 'reddit', type: 'rss', value: `https://www.reddit.com/${kind}/${parts[1]}/.rss`, handle: `${kind === 'r' ? 'r' : 'u'}/${parts[1]}`, needsKey: false };
  }
  if (first.startsWith('@') && parts.length === 1) return { platform: 'mastodon', type: 'mastodon', value: u.href, handle: `@${at}@${u.hostname}`, needsKey: false };
  return { platform: 'rss', type: 'rss', value: u.href, handle: u.hostname.replace(/^www\./, ''), needsKey: false };
}

const proxyUrl = (url: string) => { const base = usePosts.getState().settings.proxy.trim() || '/api/feed'; return `${base}${base.includes('?') ? '&' : '?'}url=${encodeURIComponent(url)}`; };

export class SourceError extends Error {}
const NO_PROXY = 'The source could not be read from here. Open the site on Vercel (it has the feed reader), or set a feed proxy in Settings.';

async function viaProxy(url: string, headers?: Record<string, string>): Promise<string> {
  let r: Response;
  try { r = await fetch(proxyUrl(url), { cache: 'no-store', headers }); } catch { throw new SourceError('The source could not be reached. Check the internet connection, or the address.'); }
  if (r.status === 404 && !(r.headers.get('x-feed-status'))) throw new SourceError(NO_PROXY);
  const body = await r.text();
  // a static host answers with the app itself: there is no feed reader there
  if (/text\/html/i.test(r.headers.get('content-type') ?? '') && /SARWAR DESIGN|id="root"/.test(body.slice(0, 4000))) throw new SourceError(NO_PROXY);
  if (!r.ok) throw new SourceError(`The source answered with an error (${r.headers.get('x-feed-status') || r.status}).`);
  return body;
}
/** reads straight from the browser first (fastest, and from your own connection), then through the proxy */
async function getText(url: string, direct = true): Promise<string> {
  if (direct) {
    try { const r = await fetch(url, { cache: 'no-store' }); if (r.ok) return await r.text(); } catch { /* blocked by the browser (CORS): try the proxy */ }
  }
  return viaProxy(url);
}
async function getJson<T>(url: string, direct = true): Promise<T> {
  const t = await getText(url, direct);
  try { return JSON.parse(t) as T; } catch { throw new SourceError('The source did not answer with posts. Check the address.'); }
}

/** HTML → plain text with line breaks kept */
export function htmlToText(html: string): string {
  const withBreaks = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d|blockquote)>/gi, '\n\n');
  const doc = new DOMParser().parseFromString(`<body>${withBreaks}</body>`, 'text/html');
  return (doc.body.textContent ?? '').replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
const imgsFromHtml = (html: string) => [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1].replace(/&amp;/g, '&')).filter((u) => /^https?:/.test(u) && !/emoji|avatar/i.test(u));
const isImageUrl = (u: string, type?: string | null) => (type ? type.startsWith('image/') : /\.(jpe?g|png|webp|gif)(\?|$)/i.test(u));
const uniq = (a: string[]) => [...new Set(a.filter(Boolean))];

// ---------------- RSS / Atom ----------------
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
    const images = imgsFromHtml(html); const videos: string[] = [];
    for (const m of [...it.getElementsByTagName('*')]) {
      if ((m.localName === 'enclosure' || m.localName === 'content' || m.localName === 'thumbnail') && m.getAttribute('url')) {
        const u = m.getAttribute('url')!; const type = m.getAttribute('type') || (m.getAttribute('medium') === 'image' ? 'image/' : m.getAttribute('medium') === 'video' ? 'video/' : null);
        if (isImageUrl(u, type)) images.push(u); else if (type?.startsWith('video/') || /\.mp4(\?|$)/i.test(u)) videos.push(u);
      }
    }
    const dateStr = text(child(it, 'pubDate', 'published', 'updated', 'date'));
    const date = Date.parse(dateStr) || Date.now();
    const id = text(child(it, 'guid', 'id')) || link || `${date}:${body.slice(0, 40)}`;
    return { id, text: body, url: link, date, images: uniq(images).slice(0, 10), videos: uniq(videos) };
  }).filter((p) => p.text || p.images.length);
  return { posts, name: text(child(chan, 'title')) || undefined };
}
async function fetchFeed(url: string): Promise<FetchResult> {
  const body = await getText(url);
  if (/^\s*</.test(body) && /<html[\s>]/i.test(body.slice(0, 2000)) && !/<(rss|feed)[\s>]/i.test(body.slice(0, 2000))) {
    // a web page: look for the feed it announces
    const m = body.match(/<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/i);
    const href = m?.[0].match(/href=["']([^"']+)["']/i)?.[1];
    if (!href) throw new SourceError('This page has no feed. Paste the link of a profile (Truth Social, Telegram, YouTube, X…) or of an RSS feed.');
    return parseFeed(await getText(new URL(href.replace(/&amp;/g, '&'), url).href));
  }
  return parseFeed(body);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// ---------------- Mastodon-style servers (Mastodon, Truth Social) ----------------
function mastodonPosts(list: any[]): RawPost[] {
  return (Array.isArray(list) ? list : []).map((s) => {
    const src = s.reblog ?? s;
    const media: any[] = src.media_attachments ?? [];
    return {
      id: String(s.id || s.uri), text: htmlToText(String(src.content ?? '')), url: String(s.url || src.url || s.uri || ''), date: Date.parse(s.created_at) || Date.now(),
      images: uniq(media.filter((m) => m.type === 'image').map((m) => m.url || m.preview_url).concat(!media.length && src.card?.image ? [src.card.image] : [])),
      videos: uniq(media.filter((m) => m.type === 'video' || m.type === 'gifv').map((m) => m.url)),
    };
  }).filter((p) => p.text || p.images.length || p.videos.length);
}
async function fetchMastodonApi(host: string, user: string, knownId?: string): Promise<FetchResult> {
  const acc = knownId ? { id: knownId } as any : await getJson<any>(`https://${host}/api/v1/accounts/lookup?acct=${encodeURIComponent(user)}`);
  if (!acc?.id) throw new SourceError('The profile was not found on that server.');
  const list = await getJson<any[]>(`https://${host}/api/v1/accounts/${acc.id}/statuses?exclude_replies=true&limit=20`);
  if (!Array.isArray(list)) throw new SourceError('The source did not answer with posts. Check the address.');
  const a = list[0]?.account ?? acc;
  return { name: a.display_name || a.username, avatar: a.avatar ?? null, handle: a.acct ? `@${a.acct}` : undefined, posts: mastodonPosts(list) };
}
async function fetchMastodon(addr: string): Promise<FetchResult> {
  let user = '', host = '';
  const u = addr.trim().match(/^https?:\/\/([^/]+)\/@([^/?#]+)/);
  if (u) { host = u[1]; user = u[2]; } else { const m = addr.trim().replace(/^@/, '').split('@'); user = m[0]; host = m[1] ?? ''; }
  if (!user || !host) throw new SourceError('Write the address as @name@server, e.g. @user@mastodon.social');
  return fetchMastodonApi(host, user);
}

// ---------------- Truth Social ----------------
const TRUTH_IDS: Record<string, string> = { realdonaldtrump: '107780257626128497' };
async function fetchTruth(handle: string): Promise<FetchResult> {
  const user = handle.replace(/^@/, '').trim();
  if (!user) throw new SourceError('Paste the link of the Truth Social profile.');
  let first: unknown = null;
  try { return { ...(await fetchMastodonApi('truthsocial.com', user, TRUTH_IDS[user.toLowerCase()])), via: null }; } catch (e) { first = e; }
  if (usePosts.getState().settings.apiKey) { try { return { ...(await fetchApi(`truth:${user}`)), via: 'ScrapeCreators' }; } catch (e) { first = e; } }
  if (user.toLowerCase() === 'realdonaldtrump') {
    const r = await fetchFeed('https://www.trumpstruth.org/feed');
    return { ...r, name: 'Donald J. Trump', handle: '@realDonaldTrump', via: 'trumpstruth.org' };
  }
  throw first instanceof SourceError ? new SourceError(`Truth Social did not let the profile be read (${first.message}) Add a ScrapeCreators key in Settings to read it.`) : new SourceError('Truth Social did not let the profile be read. Add a ScrapeCreators key in Settings to read it.');
}

// ---------------- Bluesky ----------------
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
      return { id: p.uri, text: String(p.record?.text ?? ''), url: `https://bsky.app/profile/${p.author?.handle}/post/${rkey}`, date: Date.parse(p.record?.createdAt ?? p.indexedAt) || Date.now(), images: imgs, videos: [] };
    }),
  };
}

// ---------------- Telegram public channels (t.me/s/…) ----------------
async function fetchTelegram(channel: string): Promise<FetchResult> {
  const ch = channel.replace(/^@/, '').replace(/^https?:\/\/t\.me\/(s\/)?/, '').replace(/\/.*$/, '').trim();
  if (!ch) throw new SourceError('Paste the link of the Telegram channel, e.g. https://t.me/channel');
  const html = await getText(`https://t.me/s/${ch}`, false);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const msgs = [...doc.querySelectorAll('.tgme_widget_message[data-post]')];
  if (!msgs.length) throw new SourceError('This Telegram channel has no public posts (or it is private).');
  const bg = (el: Element) => (el.getAttribute('style') ?? '').match(/url\(['"]?([^'")]+)['"]?\)/)?.[1] ?? '';
  return {
    name: doc.querySelector('.tgme_channel_info_header_title')?.textContent?.trim() || ch,
    avatar: doc.querySelector('.tgme_page_photo_image img, .tgme_channel_info_header img')?.getAttribute('src') ?? null,
    handle: `@${ch}`,
    posts: msgs.map((m) => {
      const post = m.getAttribute('data-post')!;
      const t = m.querySelector('.tgme_widget_message_text');
      return {
        id: `tg:${post}`, text: t ? htmlToText(t.innerHTML) : '', url: `https://t.me/${post}`,
        date: Date.parse(m.querySelector('time[datetime]')?.getAttribute('datetime') ?? '') || Date.now(),
        images: uniq([...m.querySelectorAll('.tgme_widget_message_photo_wrap')].map(bg)),
        videos: uniq([...m.querySelectorAll('video[src]')].map((v) => v.getAttribute('src') ?? '')),
      };
    }).filter((p) => p.text || p.images.length || p.videos.length).reverse(),
  };
}

// ---------------- YouTube (official channel feed) ----------------
async function fetchYouTube(link: string): Promise<FetchResult> {
  let id = link.match(/channel\/(UC[\w-]{22})/)?.[1];
  if (!id) {
    const page = await getText(link, false);
    id = page.match(/"(?:channelId|externalId)":"(UC[\w-]{22})"/)?.[1] ?? page.match(/channel\/(UC[\w-]{22})/)?.[1];
  }
  if (!id) throw new SourceError('The YouTube channel was not found. Paste the link of the channel.');
  const r = await fetchFeed(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`);
  return { ...r, posts: r.posts.map((p) => ({ ...p, videos: [] })) };
}

// ---------------- X, Facebook, Instagram, TikTok, Threads (ScrapeCreators API) ----------------
const SC = 'https://api.scrapecreators.com';
const SC_PATHS: Record<string, (v: string) => string> = {
  x: (v) => `/v1/twitter/user/tweets?handle=${encodeURIComponent(v)}`,
  instagram: (v) => `/v2/instagram/user/posts?handle=${encodeURIComponent(v)}`,
  facebook: (v) => `/v1/facebook/profile/posts?url=${encodeURIComponent(v)}`,
  tiktok: (v) => `/v3/tiktok/profile/videos?handle=${encodeURIComponent(v)}`,
  threads: (v) => `/v1/threads/user/posts?handle=${encodeURIComponent(v)}`,
  truth: (v) => `/v1/truthsocial/user/posts?handle=${encodeURIComponent(v)}`,
};
const pick = (o: any, keys: string[]) => { for (const k of keys) { const v = k.split('.').reduce((a, p) => (a == null ? a : a[p]), o); if (v != null && v !== '') return v; } return undefined; };
const IMG = /^https?:\/\/[^\s"]+?(\.(jpe?g|png|webp)(\?|$)|pbs\.twimg\.com\/media|fbcdn\.net|cdninstagram\.com|scontent)/i;
function mediaIn(o: any, depth = 0, out = { images: [] as string[], videos: [] as string[] }, key = '') {
  if (o == null || depth > 6) return out;
  if (typeof o === 'string') {
    if (/profile|avatar|user_?pic|author|owner/i.test(key)) return out;
    if (/\.mp4(\?|$)/i.test(o) || /video_url|play_?addr/i.test(key)) { if (/^https?:/.test(o)) out.videos.push(o); }
    else if (IMG.test(o) && !/_normal\.|emoji|s150x150|p50x50/.test(o)) out.images.push(o);
    return out;
  }
  if (Array.isArray(o)) { o.slice(0, 12).forEach((x) => mediaIn(x, depth + 1, out, key)); return out; }
  if (typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (/^(user|author|owner|profile|account|core)$/i.test(k)) continue; mediaIn(v, depth + 1, out, k); }
  return out;
}
function normalizeApi(json: any): RawPost[] {
  // finds the longest list of posts in the answer, whatever its shape
  let best: any[] = [];
  const walk = (o: any, d: number) => {
    if (!o || typeof o !== 'object' || d > 5) return;
    if (Array.isArray(o)) { if (o.length > best.length && o.some((x) => x && typeof x === 'object')) best = o; o.slice(0, 3).forEach((x) => walk(x, d + 1)); return; }
    for (const v of Object.values(o)) walk(v, d + 1);
  };
  walk(json, 0);
  return best.map((raw) => {
    const it = raw?.node ?? raw?.tweet ?? raw?.post ?? raw;
    const lg = it?.legacy ? { ...it, ...it.legacy } : it;
    let text = pick(lg, ['full_text', 'text', 'caption.text', 'caption', 'message', 'content', 'desc', 'description', 'title', 'post_text']) ?? '';
    if (typeof text !== 'string') text = String(text?.text ?? '');
    if (/<[a-z][^>]*>/i.test(text)) text = htmlToText(text);
    const rawDate = pick(lg, ['created_at', 'createdAt', 'taken_at', 'create_time', 'creation_time', 'publish_time', 'timestamp', 'date']);
    const date = typeof rawDate === 'number' ? (rawDate < 1e12 ? rawDate * 1000 : rawDate) : Date.parse(String(rawDate ?? '')) || (Number(rawDate) ? Number(rawDate) * 1000 : Date.now());
    const id = String(pick(lg, ['id_str', 'rest_id', 'id', 'post_id', 'pk', 'aweme_id', 'code', 'shortcode']) ?? `${date}:${String(text).slice(0, 30)}`);
    const url = String(pick(lg, ['url', 'permalink', 'post_url', 'link', 'share_url']) ?? '');
    const media = mediaIn(lg);
    return { id, text: String(text).trim(), url: /^https?:/.test(url) ? url : '', date, images: uniq(media.images).slice(0, 10), videos: uniq(media.videos).slice(0, 4) };
  }).filter((p) => p.text || p.images.length || p.videos.length);
}
async function fetchApi(value: string): Promise<FetchResult> {
  const key = usePosts.getState().settings.apiKey.trim();
  const i = value.indexOf(':'); const platform = value.slice(0, i); const v = value.slice(i + 1);
  const path = SC_PATHS[platform];
  if (!path) throw new SourceError('This platform is not supported yet.');
  if (!key) throw new SourceError('X, Facebook, Instagram, TikTok and Threads don’t let websites read posts for free. Add a ScrapeCreators API key in Settings (⚙), or paste an RSS feed link of the profile (e.g. from RSS.app).');
  const body = await viaProxy(`${SC}${path(v)}`, { 'x-sc-key': key });
  let json: any; try { json = JSON.parse(body); } catch { throw new SourceError('The source did not answer with posts. Check the address.'); }
  if (json?.success === false || json?.error) throw new SourceError(String(json.message || json.error || 'The API answered with an error.'));
  const posts = normalizeApi(json);
  if (!posts.length) throw new SourceError('No posts were found for this profile.');
  return { posts, via: 'ScrapeCreators' };
}

export async function fetchSource(type: SourceType, value: string): Promise<FetchResult> {
  const v = value.trim();
  if (!v) throw new SourceError('Write the address of the source.');
  let r: FetchResult;
  switch (type) {
    case 'truth': r = await fetchTruth(v); break;
    case 'bluesky': r = await fetchBluesky(v); break;
    case 'mastodon': r = await fetchMastodon(v); break;
    case 'telegram': r = await fetchTelegram(v); break;
    case 'youtube': r = await fetchYouTube(v); break;
    case 'api': r = await fetchApi(v); break;
    default:
      if (!/^https?:\/\//i.test(v)) throw new SourceError('A feed address starts with https://');
      r = await fetchFeed(v);
  }
  r.posts.sort((a, b) => b.date - a.date);
  return r;
}
export const fetchProfile = (p: Profile) => fetchSource(p.source.type, p.source.value);

// ---------- pictures (as blobs, so designs can be saved and pictures downloaded) ----------
export async function fetchBlob(src: string): Promise<Blob | null> {
  let blob: Blob | null = null;
  try { const r = await fetch(src); if (r.ok) blob = await r.blob(); } catch { /* CORS: try the proxy */ }
  if (!blob || blob.type.startsWith('text/')) { try { const r = await fetch(proxyUrl(src)); if (r.ok) blob = await r.blob(); } catch { /* unreachable */ } }
  return blob && !blob.type.startsWith('text/') ? blob : null;
}
const imgCache = new Map<string, Promise<HTMLImageElement | null>>();
export function loadImage(src: string | null | undefined): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  let p = imgCache.get(src);
  if (!p) {
    p = (async () => {
      let url = src;
      if (/^https?:/.test(src)) {
        const blob = await fetchBlob(src);
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
