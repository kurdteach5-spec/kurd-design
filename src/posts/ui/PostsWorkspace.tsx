// Auto Posts section: a tab for every followed profile (e.g. "Trump"). Each new post appears as a finished
// design in the profile's own style — download it, copy it, change the wording or open it in Design.
import { useEffect, useMemo, useRef, useState, type ReactNode, type FormEvent, type ClipboardEvent } from 'react';
import {
  usePosts, addProfile, updateProfile, removeProfile, updateTemplate, setActive, setSettings, updatePost, removePost, markSeen,
  defaultTemplate, SIZES, sizeOf, useStyles, loadStyles, saveStyle, deleteStyle, type Area, type Profile, type Post, type Template, type SourceType, type Layout, type SizeKey,
} from '../store';
import { fetchSource, PRESETS, detectLink, PLATFORM_NAMES, type Platform } from '../sources';
import { renderPost, canvasBlob, fileName, formatDate, postText } from '../render';
import { checkProfile, startPolling, askNotifications, downloadPictures } from '../poller';
import { FONTS } from '../../utils/fonts';
import { saveBlob } from '../../file-system/exporters';
import { openFiles } from '../../editor/fileActions';
import { setWorkspace } from '../../state/workspace';
import { useUI, toast, toastError } from '../../state/uiStore';
import { tr } from '../../i18n';
import { useWindowSize } from '../../utils/useWindowSize';
import {
  LuPlus, LuRefreshCw, LuSettings, LuDownload, LuCopy, LuPencil, LuImage, LuExternalLink, LuX, LuTrash2, LuLoaderCircle, LuRss,
  LuBell, LuCircleAlert, LuCheck, LuLanguages, LuUpload, LuSparkles, LuPalette, LuLayoutGrid, LuImages, LuVideo, LuType, LuChevronDown, LuLink, LuSave,
} from 'react-icons/lu';

const C = { bg: '#0b0b14', panel: '#0f0f1a', raised: '#1a1a2a', hover: '#24243a', line: '#27273d', ink: '#e4e4f0', sub: '#9b9bb4', faint: '#62627e', accent: '#7c5cff', rose: '#ff4d6d', ok: '#3ecf8e' };
const inputStyle = { height: 32, padding: '0 10px', background: C.raised, border: `1px solid ${C.line}`, borderRadius: 8, color: C.ink, fontSize: 13, width: '100%', minWidth: 0 } as const;

const ago = (ms: number) => {
  if (!ms) return tr('never');
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return tr('just now');
  if (s < 3600) return tr('{0} min ago', Math.round(s / 60));
  if (s < 86400) return tr('{0} h ago', Math.round(s / 3600));
  return new Date(ms).toLocaleDateString();
};

// ---------- small render queue so a long list doesn't draw everything at once ----------
const thumbs = new Map<string, string>();
let chain: Promise<unknown> = Promise.resolve();
const queue = <T,>(fn: () => Promise<T>) => { const p = chain.then(fn, fn); chain = p.catch(() => undefined); return p; };
const keyOf = (post: Pick<Post, 'text' | 'textOverride' | 'date' | 'images' | 'mode'>, prof: Pick<Profile, 'name' | 'handle' | 'avatar' | 'avatarAuto'>, tpl: Template) =>
  JSON.stringify([post.text, post.textOverride, post.date, post.images[0], post.mode, prof.name, prof.handle, prof.avatar?.length, prof.avatar?.slice(-40), prof.avatarAuto, tpl]);

function useThumb(post: Pick<Post, 'text' | 'textOverride' | 'date' | 'images' | 'mode'>, prof: Profile, width: number, immediate = false) {
  const key = keyOf(post, prof, prof.template) + width;
  const [url, setUrl] = useState(() => thumbs.get(key) ?? '');
  useEffect(() => {
    const have = thumbs.get(key); if (have) { setUrl(have); return; }
    let live = true;
    const run = async () => { const cv = await renderPost({ post, profile: prof, tpl: prof.template }, width / sizeOf(prof.template).w); return cv.toDataURL('image/jpeg', 0.86); };
    const h = window.setTimeout(() => { void (immediate ? run() : queue(run)).then((u) => { thumbs.set(key, u); if (thumbs.size > 300) thumbs.delete(thumbs.keys().next().value!); if (live) setUrl(u); }).catch(() => undefined); }, immediate ? 60 : 0);
    return () => { live = false; clearTimeout(h); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return url;
}

async function exportPost(prof: Profile, post: Post, format?: 'png' | 'jpg', mode?: Post['mode']) {
  const f = format ?? usePosts.getState().settings.format;
  if (mode) post = { ...post, mode };
  try { const cv = await renderPost({ post, profile: prof, tpl: prof.template }); const name = fileName(prof, post, f); await saveBlob(await canvasBlob(cv, f), mode === 'text' ? name.replace(/\.(\w+)$/, '_text.$1') : name); }
  catch (e) { toastError(tr((e as Error).message || 'The design could not be saved.')); }
}
async function copyPost(prof: Profile, post: Post) {
  try {
    const cv = await renderPost({ post, profile: prof, tpl: prof.template });
    const blob = await canvasBlob(cv, 'png');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast(tr('The design was copied — paste it anywhere.'), 'success');
  } catch { toastError(tr('Copying pictures is not allowed here. Download the design instead.')); }
}
async function openInDesign(prof: Profile, post: Post) {
  try {
    const cv = await renderPost({ post, profile: prof, tpl: prof.template });
    const blob = await canvasBlob(cv, 'png');
    const file = new File([blob], fileName(prof, post, 'png'), { type: 'image/png' });
    setWorkspace('design'); useUI.setState({ showHome: false });
    await openFiles([file]);
  } catch (e) { toastError(tr((e as Error).message || 'The design could not be opened.')); }
}

// ======================================================================
export function PostsWorkspace() {
  const st = usePosts();
  const { w } = useWindowSize();
  useEffect(() => { void startPolling(); }, []);
  const [dialog, setDialog] = useState<{ edit: Profile | null; preset?: string; link?: string } | null>(null);
  const active = st.profiles.find((p) => p.id === st.active) ?? null;
  // opening a tab clears its counter; leaving it clears the NEW badges
  useEffect(() => { if (!active) return; if (active.unread) updateProfile(active.id, { unread: 0 }); const id = active.id; return () => markSeen(id); }, [active?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (active?.unread && document.visibilityState === 'visible') updateProfile(active.id, { unread: 0 }); }, [active?.unread]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="h-full flex flex-col min-h-0" style={{ background: C.bg, color: C.ink }} data-section="posts">
      <TopBar onAdd={() => setDialog({ edit: null })} onEdit={(p) => setDialog({ edit: p })} />
      {!st.loaded ? <div className="flex-1 flex items-center justify-center" style={{ color: C.sub }}><LuLoaderCircle className="animate-spin" size={22} /></div>
        : !active ? <Empty onAdd={(preset, link) => setDialog({ edit: null, preset, link })} />
        : <ProfileView key={active.id} prof={active} narrow={w < 980} onEdit={() => setDialog({ edit: active })} />}
      {dialog && <ProfileDialog edit={dialog.edit} preset={dialog.preset} link={dialog.link} onClose={() => setDialog(null)} />}
    </div>
  );
}

function Avatar({ prof, size }: { prof: Pick<Profile, 'name' | 'avatar' | 'avatarAuto' | 'template'>; size: number }) {
  const src = prof.avatar || prof.avatarAuto;
  const [bad, setBad] = useState(false);
  const ini = prof.name.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase() || '?';
  return src && !bad
    ? <img src={src} alt="" width={size} height={size} onError={() => setBad(true)} className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} />
    : <span className="rounded-full shrink-0 inline-flex items-center justify-center font-bold text-white" style={{ width: size, height: size, background: prof.template.accent, fontSize: size * 0.4 }}>{ini}</span>;
}

function TopBar({ onAdd, onEdit }: { onAdd: () => void; onEdit: (p: Profile) => void }) {
  const st = usePosts();
  const [menu, setMenu] = useState(false);
  return (
    <div className="shrink-0 flex items-center gap-1.5 px-2 sm:px-3 h-[52px] border-b" style={{ borderColor: C.line, background: C.panel }}>
      <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto no-scrollbar" role="tablist" aria-label="Profiles">
        {st.profiles.map((p) => {
          const on = p.id === st.active;
          return (
            <button key={p.id} type="button" role="tab" aria-selected={on} onClick={() => setActive(p.id)} onDoubleClick={() => onEdit(p)}
              className="h-9 ps-1.5 pe-3 rounded-full inline-flex items-center gap-2 shrink-0 border text-[13px] font-semibold transition-colors"
              style={{ background: on ? `${p.template.accent}26` : 'transparent', borderColor: on ? `${p.template.accent}88` : C.line, color: on ? '#fff' : C.sub }}
              data-tip={`${p.name} · ${p.handle}`}>
              <Avatar prof={p} size={26} />
              <span translate="no" className="max-w-[140px] truncate">{p.tab || p.name}</span>
              {st.checking[p.id] && <LuLoaderCircle size={13} className="animate-spin" />}
              {!st.checking[p.id] && p.lastError && <LuCircleAlert size={13} style={{ color: C.rose }} aria-label="Problem reading the source" />}
              {p.unread > 0 && <span className="min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold inline-flex items-center justify-center text-white" style={{ background: C.rose }}>{p.unread > 99 ? '99+' : p.unread}</span>}
            </button>
          );
        })}
        <button type="button" onClick={onAdd} className="h-9 px-3 rounded-full inline-flex items-center gap-1.5 shrink-0 text-[13px] font-semibold border border-dashed hover:bg-white/5" style={{ borderColor: C.line, color: C.ink }}>
          <LuPlus size={15} /><span>Add profile</span>
        </button>
      </div>
      <div className="relative shrink-0">
        <button type="button" onClick={() => setMenu(!menu)} className="w-9 h-9 rounded-full inline-flex items-center justify-center hover:bg-white/5 border" style={{ borderColor: C.line, color: C.sub }} aria-label="Settings" data-tip="Settings: notifications, downloads, feed proxy"><LuSettings size={16} /></button>
        {menu && <SettingsMenu onClose={() => setMenu(false)} />}
      </div>
    </div>
  );
}

function SettingsMenu({ onClose }: { onClose: () => void }) {
  const s = usePosts((x) => x.settings);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: PointerEvent) => { if (ref.current && !ref.current.parentElement!.contains(e.target as Node)) onClose(); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', h); window.addEventListener('keydown', k);
    return () => { window.removeEventListener('pointerdown', h); window.removeEventListener('keydown', k); };
  }, [onClose]);
  const perm = 'Notification' in window ? Notification.permission : 'denied';
  return (
    <div ref={ref} className="absolute end-0 top-11 z-40 w-[330px] max-h-[calc(100vh-110px)] overflow-y-auto rounded-xl border p-3.5 flex flex-col gap-3 text-[13px] shadow-2xl" style={{ background: C.raised, borderColor: C.line }}>
      <div className="font-semibold text-white">Settings</div>
      <label className="flex items-start gap-2 cursor-pointer">
        <input type="checkbox" className="mt-0.5 accent-[#7c5cff]" checked={s.notify} onChange={async (e) => { const on = e.target.checked; setSettings({ notify: on }); if (on) await askNotifications(); }} />
        <span><span className="block">Notify me about new posts</span><span className="block text-[11.5px]" style={{ color: C.faint }}>{perm === 'granted' ? 'Notifications are allowed in this browser.' : perm === 'denied' ? 'Notifications are blocked in this browser.' : 'The browser will ask to allow notifications.'}</span></span>
      </label>
      <label className="flex items-start gap-2 cursor-pointer">
        <input type="checkbox" className="mt-0.5 accent-[#7c5cff]" checked={s.sound} onChange={(e) => setSettings({ sound: e.target.checked })} />
        <span className="block">Play a sound for a new post</span>
      </label>
      <label className="flex items-start gap-2 cursor-pointer">
        <input type="checkbox" className="mt-0.5 accent-[#7c5cff]" checked={s.autoDownload} onChange={(e) => setSettings({ autoDownload: e.target.checked })} />
        <span><span className="block">Download every new design automatically</span><span className="block text-[11.5px]" style={{ color: C.faint }}>Saved to your downloads folder as soon as the post arrives.</span></span>
      </label>
      <label className="flex items-start gap-2 cursor-pointer">
        <input type="checkbox" className="mt-0.5 accent-[#7c5cff]" checked={s.autoPictures} onChange={(e) => setSettings({ autoPictures: e.target.checked })} />
        <span><span className="block">Also download the post’s own pictures and videos</span><span className="block text-[11.5px]" style={{ color: C.faint }}>The original files, without the design.</span></span>
      </label>
      <div className="flex items-center gap-2"><span className="flex-1">File type</span>
        {(['png', 'jpg'] as const).map((f) => <button key={f} type="button" onClick={() => setSettings({ format: f })} className="h-7 px-3 rounded-md border text-[12px] font-semibold" style={{ borderColor: s.format === f ? C.accent : C.line, background: s.format === f ? `${C.accent}33` : 'transparent', color: '#fff' }}>{f.toUpperCase()}</button>)}
      </div>
      <label className="flex flex-col gap-1">
        <span>ScrapeCreators API key</span>
        <input style={inputStyle} type="password" value={s.apiKey} onChange={(e) => setSettings({ apiKey: e.target.value.trim() })} placeholder="X, Facebook, Instagram, TikTok, Threads" dir="ltr" translate="no" autoComplete="off" />
        <span className="text-[11.5px] leading-relaxed" style={{ color: C.faint }}>Needed for X, Facebook, Instagram, TikTok and Threads (they don’t let websites read posts for free). Every check uses a credit. <a href="https://scrapecreators.com" target="_blank" rel="noopener noreferrer" className="underline">Get a key</a></span>
      </label>
      <label className="flex flex-col gap-1">
        <span>Feed proxy</span>
        <input style={inputStyle} value={s.proxy} onChange={(e) => setSettings({ proxy: e.target.value })} placeholder="/api/feed" dir="ltr" translate="no" />
        <span className="text-[11.5px]" style={{ color: C.faint }}>Reads sites that don't allow the browser to read them directly. The site on Vercel has one at /api/feed.</span>
      </label>
      <div className="text-[11.5px] leading-relaxed rounded-lg p-2.5" style={{ background: '#ffffff08', color: C.sub }}>Profiles are checked while this site is open in a tab (any section), as often as you chose for each profile. Keep a tab open to get new posts as they come.</div>
    </div>
  );
}

function Empty({ onAdd }: { onAdd: (preset?: string, link?: string) => void }) {
  const [link, setLink] = useState('');
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-[760px] mx-auto px-5 py-12 sm:py-16 text-center">
        <div className="mx-auto w-16 h-16 rounded-2xl flex items-center justify-center mb-6" style={{ background: `linear-gradient(135deg, ${C.rose}, ${C.accent})` }}><LuSparkles size={30} color="#fff" /></div>
        <h1 className="m-0 text-[26px] sm:text-[32px] font-bold text-white leading-tight">Turn someone’s posts into your designs, automatically</h1>
        <p className="mt-4 mb-0 text-[15px] leading-relaxed" style={{ color: C.sub }}>Add a profile and set your style once. Every time they post, the post is brought here and made into a design in your style — ready to download and share.</p>
        <form className="mt-8 mx-auto max-w-[560px] flex gap-2 p-1.5 rounded-full border" style={{ borderColor: C.line, background: C.panel }} onSubmit={(e: FormEvent) => { e.preventDefault(); if (link.trim()) onAdd(undefined, link.trim()); }}>
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a profile link, e.g. https://truthsocial.com/@realDonaldTrump" dir="ltr" aria-label="Profile link"
            className="flex-1 min-w-0 h-11 px-4 bg-transparent outline-none text-[14px]" style={{ color: C.ink }} />
          <button type="submit" className="h-11 px-5 rounded-full text-[14px] font-semibold text-white shrink-0" style={{ background: C.accent }}>Follow</button>
        </form>
        <div className="mt-3 flex flex-wrap justify-center gap-1.5 text-[11.5px]" style={{ color: C.faint }}>
          {['Truth Social', 'Telegram', 'YouTube', 'X', 'Facebook', 'Instagram', 'TikTok', 'Threads', 'Bluesky', 'Mastodon', 'Reddit', 'RSS'].map((n) => <span key={n} className="px-2 h-6 inline-flex items-center rounded-full border" style={{ borderColor: C.line }} translate="no">{n}</span>)}
        </div>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" onClick={() => onAdd(p.id)} className="h-12 px-5 rounded-full inline-flex items-center gap-2.5 text-[14.5px] font-semibold text-white" style={{ background: `linear-gradient(135deg, ${C.rose}, #c2185b)` }}>
              <LuRss size={17} /><span>{tr('Add {0}', p.name)}</span><span className="text-[12px] font-medium opacity-80">Truth Social</span>
            </button>
          ))}
          <button type="button" onClick={() => onAdd()} className="h-12 px-5 rounded-full inline-flex items-center gap-2 text-[14.5px] font-semibold border hover:bg-white/5" style={{ borderColor: C.line, color: C.ink }}><LuPlus size={17} /><span>Another profile</span></button>
        </div>
        <ol className="mt-12 grid sm:grid-cols-3 gap-3 text-start list-none p-0 m-0">
          {[
            { i: <LuRss size={18} />, t: 'Paste a profile link', d: 'Truth Social, Telegram, YouTube, X, Facebook, Instagram, TikTok, Bluesky or any RSS feed.' },
            { i: <LuPalette size={18} />, t: 'Set your style', d: 'Layout, size, colours, background picture, font, your logo.' },
            { i: <LuBell size={18} />, t: 'Get the design', d: 'Each new post becomes a design with a notification.' },
          ].map((x, k) => (
            <li key={k} className="rounded-xl border p-4" style={{ borderColor: C.line, background: C.panel }}>
              <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-3" style={{ background: `${C.accent}26`, color: '#c4b5fd' }}>{x.i}</div>
              <div className="font-semibold text-white text-[14px]">{x.t}</div>
              <div className="mt-1 text-[12.5px] leading-relaxed" style={{ color: C.sub }}>{x.d}</div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

// ======================================================================
function ProfileView({ prof, narrow, onEdit }: { prof: Profile; narrow: boolean; onEdit: () => void }) {
  const posts = usePosts((s) => s.posts[prof.id] ?? []);
  const checking = usePosts((s) => !!s.checking[prof.id]);
  const [pane, setPane] = useState<'posts' | 'style'>('posts');
  const [view, setView] = useState<Post | null>(null);
  const [, tick] = useState(0);
  useEffect(() => { const h = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(h); }, []);
  const feed = (
    <div className="flex-1 min-w-0 min-h-0 overflow-y-auto">
      <div className="px-3 sm:px-5 pt-4 pb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Avatar prof={prof} size={44} />
        <div className="min-w-0 flex-1">
          <div className="text-[17px] font-bold text-white truncate" translate="no">{prof.name}</div>
          <div className="text-[12.5px] truncate" style={{ color: C.sub }}>
            <span translate="no">{prof.handle}</span>{' · '}<span>{tr('Checked {0}', ago(prof.lastChecked))}</span>{' · '}<span>{tr('every {0}', everyLabel(prof.interval))}</span>{prof.via && <>{' · '}<span>{tr('via {0}', prof.via)}</span></>}
          </div>
        </div>
        <button type="button" onClick={() => void checkProfile(prof.id, true)} disabled={checking} className="h-9 px-3.5 rounded-full inline-flex items-center gap-2 text-[13px] font-semibold text-white disabled:opacity-60" style={{ background: C.accent }}>
          <LuRefreshCw size={14} className={checking ? 'animate-spin' : ''} /><span>Check now</span>
        </button>
        <button type="button" onClick={onEdit} className="h-9 px-3.5 rounded-full inline-flex items-center gap-2 text-[13px] font-semibold border hover:bg-white/5" style={{ borderColor: C.line, color: C.ink }}><LuPencil size={14} /><span>Profile</span></button>
      </div>
      {prof.lastError && (
        <div className="mx-3 sm:mx-5 mb-3 rounded-xl border px-3.5 py-2.5 text-[12.5px] flex gap-2.5 items-start" style={{ borderColor: `${C.rose}66`, background: `${C.rose}14`, color: '#ffc2cd' }}>
          <LuCircleAlert size={16} className="shrink-0 mt-px" /><span>{tr(prof.lastError)}</span>
        </div>
      )}
      {!posts.length ? (
        <div className="px-5 py-16 text-center" style={{ color: C.sub }}>
          {checking ? <><LuLoaderCircle className="animate-spin mx-auto mb-3" size={24} /><div>Reading the latest posts…</div></>
            : <><div className="text-white font-semibold mb-1">No posts yet</div><div className="text-[13px]">Press “Check now”, or wait — new posts come here by themselves.</div></>}
        </div>
      ) : (
        <div className="px-3 sm:px-5 pb-8 grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 250px), 1fr))' }}>
          {posts.map((p) => <PostCard key={p.id} prof={prof} post={p} onOpen={() => setView(p)} />)}
        </div>
      )}
    </div>
  );
  const style = <StylePanel prof={prof} sample={posts[0]} />;
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {narrow && (
        <div className="shrink-0 flex gap-1 p-2 border-b" style={{ borderColor: C.line }}>
          {([['posts', 'Designs', <LuLayoutGrid key="a" size={14} />], ['style', 'Style', <LuPalette key="b" size={14} />]] as const).map(([k, l, i]) => (
            <button key={k} type="button" onClick={() => setPane(k)} className="flex-1 h-8 rounded-lg inline-flex items-center justify-center gap-1.5 text-[13px] font-semibold" style={{ background: pane === k ? `${C.accent}33` : 'transparent', color: pane === k ? '#fff' : C.sub }}>{i}<span>{l}</span></button>
          ))}
        </div>
      )}
      <div className="flex-1 min-h-0 flex">
        {(!narrow || pane === 'posts') && feed}
        {(!narrow || pane === 'style') && <aside className={`${narrow ? 'flex-1' : 'w-[360px] border-s'} shrink-0 min-h-0 overflow-y-auto`} style={{ borderColor: C.line, background: C.panel }} aria-label="Design style">{style}</aside>}
      </div>
      {view && <Lightbox prof={prof} post={posts.find((p) => p.id === view.id) ?? view} onClose={() => setView(null)} />}
    </div>
  );
}

function PostCard({ prof, post, onOpen }: { prof: Profile; post: Post; onOpen: () => void }) {
  const url = useThumb(post, prof, 420);
  const [edit, setEdit] = useState(false);
  const size = sizeOf(prof.template);
  const hasPic = post.images.length > 0 || (post.videos?.length ?? 0) > 0;
  return (
    <article className="rounded-2xl border flex flex-col" style={{ borderColor: post.isNew ? `${C.rose}aa` : C.line, background: C.panel }}>
      <button type="button" onClick={onOpen} className="relative block w-full rounded-t-2xl overflow-hidden" style={{ aspectRatio: `${size.w} / ${size.h}`, background: '#ffffff08' }} aria-label="Open the design">
        {url ? <img src={url} alt="" className="absolute inset-0 w-full h-full object-cover" /> : <span className="absolute inset-0 flex items-center justify-center" style={{ color: C.faint }}><LuLoaderCircle className="animate-spin" size={20} /></span>}
        {post.isNew && <span className="absolute top-2 start-2 h-6 px-2.5 rounded-full text-[11px] font-bold text-white inline-flex items-center" style={{ background: C.rose }}>NEW</span>}
        {hasPic && <span className="absolute bottom-2 end-2 h-6 px-2 rounded-full text-[11px] font-semibold text-white inline-flex items-center gap-1" style={{ background: '#000b' }} aria-label="Pictures in the post">{post.videos?.length ? <LuVideo size={12} /> : <LuImages size={12} />}<span>{post.images.length + (post.videos?.length ?? 0)}</span></span>}
        {post.textOverride && <span className="absolute top-2 end-2 h-6 px-2 rounded-full text-[11px] font-semibold text-white inline-flex items-center gap-1" style={{ background: '#000a' }}><LuPencil size={11} /><span>Edited</span></span>}
      </button>
      <div className="px-3 pt-2.5 pb-2 flex items-center gap-2 text-[12px]" style={{ color: C.sub }}>
        <span className="flex-1 truncate">{formatDate(post.date)}</span>
        {post.url && <a href={post.url} target="_blank" rel="noopener noreferrer" className="hover:text-white" aria-label="Original post" data-tip="Original post"><LuExternalLink size={14} /></a>}
      </div>
      {hasPic && <ModeSwitch post={post} prof={prof} />}
      <div className="px-2 pb-2.5 flex flex-wrap gap-1">
        <DownloadMenu prof={prof} post={post} />
        <IconBtn label="Copy the picture" onClick={() => void copyPost(prof, post)}><LuCopy size={14} /></IconBtn>
        <IconBtn label="Change the wording (e.g. translate it)" onClick={() => setEdit(!edit)} on={edit}><LuPencil size={14} /></IconBtn>
        <IconBtn label="Open in Design to edit it more" onClick={() => void openInDesign(prof, post)}><LuImage size={14} /></IconBtn>
        <IconBtn label="Remove" onClick={() => removePost(prof.id, post.id)}><LuTrash2 size={14} /></IconBtn>
      </div>
      {edit && <TextEditor prof={prof} post={post} onDone={() => setEdit(false)} />}
    </article>
  );
}

function IconBtn({ children, label, onClick, primary, on }: { children: ReactNode; label: string; onClick: () => void; primary?: boolean; on?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} data-tip={label}
      className={`h-8 ${primary ? 'px-3 flex-1' : 'w-8'} rounded-lg inline-flex items-center justify-center gap-1.5 text-[12.5px] font-semibold border hover:bg-white/5`}
      style={{ borderColor: on ? C.accent : C.line, background: primary ? `${C.accent}2a` : on ? `${C.accent}22` : 'transparent', color: primary ? '#fff' : C.ink }}>{children}</button>
  );
}

export const everyLabel = (min: number) => (min < 1 ? tr('{0} s', Math.round(min * 60)) : tr('{0} min', min));

/** per post: the design with the post's picture, or with the text only */
function ModeSwitch({ prof, post }: { prof: Profile; post: Post }) {
  const cur = post.mode ?? (prof.template.showImage || !postText(post) ? 'image' : 'text');
  return (
    <div className="px-2 pb-2 flex gap-1" role="radiogroup" aria-label="Kind of design">
      {([['image', 'Picture + text', <LuImages key="i" size={13} />], ['text', 'Text only', <LuType key="t" size={13} />]] as const).map(([k, l, i]) => (
        <button key={k} type="button" role="radio" aria-checked={cur === k} onClick={() => updatePost(prof.id, post.id, { mode: k })}
          className="flex-1 h-7 rounded-lg text-[11.5px] font-semibold inline-flex items-center justify-center gap-1.5 border"
          style={{ borderColor: cur === k ? C.accent : C.line, background: cur === k ? `${C.accent}26` : 'transparent', color: cur === k ? '#fff' : C.sub }}>{i}<span>{l}</span></button>
      ))}
    </div>
  );
}

function DownloadMenu({ prof, post, big }: { prof: Profile; post: Post; big?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', h); return () => window.removeEventListener('pointerdown', h);
  }, [open]);
  const pics = post.images.length, vids = post.videos?.length ?? 0;
  const item = (label: string, icon: ReactNode, run: () => unknown) => (
    <button type="button" role="menuitem" className="w-full h-9 px-3 flex items-center gap-2.5 text-[12.5px] text-start hover:bg-white/5 rounded-md" style={{ color: C.ink }} onClick={() => { setOpen(false); void run(); }}>{icon}<span className="flex-1">{label}</span></button>
  );
  return (
    <div ref={ref} className={`relative ${big ? '' : 'flex-1'}`}>
      <button type="button" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} aria-label="Download"
        className={`${big ? 'h-10 px-4 rounded-full text-[13.5px]' : 'h-8 px-3 w-full rounded-lg text-[12.5px]'} inline-flex items-center justify-center gap-1.5 font-semibold border text-white`}
        style={{ borderColor: big ? 'transparent' : C.line, background: big ? C.accent : `${C.accent}2a` }}>
        <LuDownload size={14} /><span>Download</span><LuChevronDown size={13} />
      </button>
      {open && (
        <div role="menu" className={`absolute ${big ? 'bottom-12' : 'top-9'} start-0 z-40 w-[250px] rounded-xl border p-1 shadow-2xl`} style={{ background: C.raised, borderColor: C.line }}>
          {(pics > 0 || vids > 0) && postText(post) ? <>
            {item(tr('Design with the picture'), <LuImages size={15} />, () => exportPost(prof, post, undefined, 'image'))}
            {item(tr('Design, text only'), <LuType size={15} />, () => exportPost(prof, post, undefined, 'text'))}
          </> : item(tr('Design'), <LuImage size={15} />, () => exportPost(prof, post))}
          {item(tr('Design as JPG'), <LuImage size={15} />, () => exportPost(prof, post, 'jpg'))}
          {pics > 0 && item(pics === 1 ? tr('The post’s picture') : tr('The post’s {0} pictures', pics), <LuDownload size={15} />, async () => { const n = await downloadPictures(prof, { ...post, videos: [] }); if (!n) toast(tr('The picture opened in a new tab — save it from there.'), 'info', 6000); })}
          {vids > 0 && item(vids === 1 ? tr('The post’s video') : tr('The post’s {0} videos', vids), <LuVideo size={15} />, async () => { const n = await downloadPictures(prof, { ...post, images: [] }); if (!n) toast(tr('The video opened in a new tab — save it from there.'), 'info', 6000); })}
          {post.url && item(tr('Copy the link of the post'), <LuLink size={15} />, async () => { try { await navigator.clipboard.writeText(post.url); toast(tr('Link copied'), 'success'); } catch { /* blocked */ } })}
        </div>
      )}
    </div>
  );
}

function TextEditor({ prof, post, onDone }: { prof: Profile; post: Post; onDone: () => void }) {
  const [v, setV] = useState(postText(post));
  const rtl = /[؀-ۿ]/.test(v.slice(0, 40));
  return (
    <div className="px-2.5 pb-3 flex flex-col gap-2 border-t pt-2.5" style={{ borderColor: C.line }}>
      <textarea value={v} onChange={(e) => setV(e.target.value)} rows={5} dir={rtl ? 'rtl' : 'ltr'} aria-label="Text in the design"
        className="w-full rounded-lg p-2.5 text-[13px] leading-relaxed resize-y" style={{ background: C.raised, border: `1px solid ${C.line}`, color: C.ink }} />
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className="h-8 px-3 rounded-lg text-[12.5px] font-semibold text-white inline-flex items-center gap-1.5" style={{ background: C.accent }}
          onClick={() => { updatePost(prof.id, post.id, { textOverride: v.trim() && v.trim() !== post.text.trim() ? v : undefined }); onDone(); }}><LuCheck size={14} /><span>Use this text</span></button>
        <a className="h-8 px-3 rounded-lg text-[12.5px] font-semibold border inline-flex items-center gap-1.5 hover:bg-white/5" style={{ borderColor: C.line, color: C.ink }}
          href={`https://translate.google.com/?sl=auto&tl=ckb&op=translate&text=${encodeURIComponent(post.text.slice(0, 4500))}`} target="_blank" rel="noopener noreferrer"><LuLanguages size={14} /><span>Translate to Kurdish</span></a>
        {post.textOverride && <button type="button" className="h-8 px-3 rounded-lg text-[12.5px] border hover:bg-white/5" style={{ borderColor: C.line, color: C.sub }} onClick={() => { updatePost(prof.id, post.id, { textOverride: undefined }); setV(post.text); onDone(); }}>Original text</button>}
      </div>
    </div>
  );
}

function Lightbox({ prof, post, onClose }: { prof: Profile; post: Post; onClose: () => void }) {
  const url = useThumb(post, prof, 1080, true);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label="Design" className="fixed inset-0 z-50 flex flex-col items-center justify-center p-3 sm:p-6 gap-3" style={{ background: 'rgba(5,5,12,0.88)', backdropFilter: 'blur(6px)' }} onClick={onClose}>
      <div className="min-h-0 flex-1 w-full flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
        {url ? <img src={url} alt="" className="max-w-full max-h-full rounded-xl shadow-2xl" /> : <LuLoaderCircle className="animate-spin" size={28} color="#fff" />}
      </div>
      <div className="flex flex-wrap justify-center gap-2" onClick={(e) => e.stopPropagation()}>
        {(post.images.length > 0) && postText(post) && <div className="w-[240px]"><ModeSwitch prof={prof} post={post} /></div>}
        <DownloadMenu prof={prof} post={post} big />
        <button type="button" className="h-10 px-4 rounded-full text-[13.5px] font-semibold text-white inline-flex items-center gap-2 border" style={{ borderColor: '#ffffff33' }} onClick={() => void copyPost(prof, post)}><LuCopy size={15} /><span>Copy</span></button>
        <button type="button" className="h-10 px-4 rounded-full text-[13.5px] font-semibold text-white inline-flex items-center gap-2 border" style={{ borderColor: '#ffffff33' }} onClick={() => void openInDesign(prof, post)}><LuImage size={15} /><span>Open in Design</span></button>
        <button type="button" className="h-10 w-10 rounded-full text-white inline-flex items-center justify-center border" style={{ borderColor: '#ffffff33' }} onClick={onClose} aria-label="Close"><LuX size={17} /></button>
      </div>
    </div>
  );
}

// ======================================================================
const readImage = (file: File, max: number, keepAlpha: boolean) => new Promise<string>((res, rej) => {
  const url = URL.createObjectURL(file); const im = new Image();
  im.onload = () => {
    const s = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
    const cv = document.createElement('canvas'); cv.width = Math.round(im.naturalWidth * s); cv.height = Math.round(im.naturalHeight * s);
    cv.getContext('2d')!.drawImage(im, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
    res(keepAlpha ? cv.toDataURL('image/png') : cv.toDataURL('image/jpeg', 0.88));
  };
  im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('The picture could not be opened.')); };
  im.src = url;
});
function pickImage(max: number, keepAlpha: boolean, done: (d: string) => void) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = () => { const f = inp.files?.[0]; if (f) readImage(f, max, keepAlpha).then(done).catch((e) => toastError(tr((e as Error).message))); };
  inp.click();
}

const SAMPLE = (): Post => ({ id: 'sample', profileId: '', text: 'This is how a new post will look. Change the style on the right and every design follows it.', url: '', date: Date.now(), images: [], seenAt: 0 });

function Group({ title, children }: { title: string; children: ReactNode }) {
  return <section className="px-4 py-3.5 border-b flex flex-col gap-2.5" style={{ borderColor: C.line }}><h3 className="m-0 text-[11.5px] font-bold uppercase tracking-[0.08em]" style={{ color: C.faint }}>{title}</h3>{children}</section>;
}
function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex items-center gap-2 text-[12.5px] min-h-[30px]"><span className="flex-1 min-w-0" style={{ color: C.sub }}>{label}</span>{children}</div>;
}
function Color({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="inline-flex items-center gap-1.5 h-[30px] ps-1 pe-2 rounded-lg border cursor-pointer" style={{ borderColor: C.line, background: C.raised }} data-tip={label}>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className="w-6 h-6 rounded border-0 p-0 bg-transparent cursor-pointer" />
      <span className="text-[11.5px] font-mono uppercase" style={{ color: C.sub }} translate="no">{value}</span>
    </label>
  );
}
function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className="w-10 h-[22px] rounded-full relative shrink-0 transition-colors" style={{ background: on ? C.accent : '#3a3a55' }}>
      <span className="absolute top-[3px] w-4 h-4 rounded-full bg-white transition-all" style={{ insetInlineStart: on ? 21 : 3 }} />
    </button>
  );
}
function Range({ value, min, max, step = 1, onChange, label, unit = '' }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; label: string; unit?: string }) {
  return (
    <div className="flex items-center gap-2 w-[170px]">
      <input type="range" dir="ltr" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} className="flex-1 accent-[#7c5cff]" />
      <span className="w-10 text-end text-[11.5px] tabular-nums" style={{ color: C.sub }}>{step < 1 ? Math.round(value * 100) + '%' : value + unit}</span>
    </div>
  );
}
function Chips<T extends string>({ value, options, onChange }: { value: T; options: { v: T; l: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => <button key={o.v} type="button" onClick={() => onChange(o.v)} aria-pressed={value === o.v} className="h-8 px-3 rounded-lg text-[12.5px] font-semibold border" style={{ borderColor: value === o.v ? C.accent : C.line, background: value === o.v ? `${C.accent}2e` : 'transparent', color: value === o.v ? '#fff' : C.sub }}>{o.l}</button>)}
    </div>
  );
}

const THEMES: { name: string; t: Partial<Template> }[] = [
  { name: 'Night', t: { bgType: 'gradient', bg1: '#1e1846', bg2: '#0b0a1f', cardOn: true, cardColor: '#ffffff', cardOpacity: 1, textColor: '#0f1419', nameColor: '#0f1419', subColor: '#536471', accent: '#7c5cff', footerColor: '#ffffff' } },
  { name: 'Red news', t: { bgType: 'gradient', bg1: '#b3122e', bg2: '#3b0612', cardOn: false, textColor: '#ffffff', nameColor: '#ffffff', subColor: '#ffd0d8', accent: '#ffcc00', footerColor: '#ffffff' } },
  { name: 'White', t: { bgType: 'solid', bg1: '#f1f3f6', bg2: '#f1f3f6', cardOn: true, cardColor: '#ffffff', cardOpacity: 1, textColor: '#0f1419', nameColor: '#0f1419', subColor: '#536471', accent: '#1d9bf0', footerColor: '#536471' } },
  { name: 'Black', t: { bgType: 'solid', bg1: '#000000', bg2: '#000000', cardOn: false, textColor: '#e7e9ea', nameColor: '#e7e9ea', subColor: '#71767b', accent: '#1d9bf0', footerColor: '#71767b' } },
  { name: 'Gold', t: { bgType: 'gradient', bg1: '#141414', bg2: '#2b2110', cardOn: false, textColor: '#fff6e0', nameColor: '#f5c451', subColor: '#bfa77a', accent: '#f5c451', footerColor: '#f5c451' } },
  { name: 'Ocean', t: { bgType: 'gradient', bg1: '#0ea5e9', bg2: '#1e3a8a', cardOn: true, cardColor: '#0b1220', cardOpacity: 0.72, textColor: '#ffffff', nameColor: '#ffffff', subColor: '#a5c8ff', accent: '#22d3ee', footerColor: '#ffffff' } },
];

const clampArea = (a: Area): Area => {
  const w = Math.min(1, Math.max(0.05, a.w)), h = Math.min(1, Math.max(0.05, a.h));
  return { w, h, x: Math.min(1 - w, Math.max(0, a.x)), y: Math.min(1 - h, Math.max(0, a.y)) };
};
/** the dashed box on the preview: drag it, or drag a corner to resize */
function AreaBox({ area, onChange }: { area: Area; onChange: (a: Area) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const start = (e: React.PointerEvent, mode: 'move' | 'tl' | 'tr' | 'bl' | 'br') => {
    e.preventDefault(); e.stopPropagation();
    const box = ref.current!.parentElement!.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY, a0 = { ...area };
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / box.width, dy = (ev.clientY - sy) / box.height;
      const a = { ...a0 };
      if (mode === 'move') { a.x += dx; a.y += dy; }
      if (mode === 'tl' || mode === 'bl') { a.x += dx; a.w -= dx; }
      if (mode === 'tr' || mode === 'br') a.w += dx;
      if (mode === 'tl' || mode === 'tr') { a.y += dy; a.h -= dy; }
      if (mode === 'bl' || mode === 'br') a.h += dy;
      if (mode !== 'move') { if (a.x < 0) { a.w += a.x; a.x = 0; } if (a.y < 0) { a.h += a.y; a.y = 0; } a.w = Math.min(a.w, 1 - a.x); a.h = Math.min(a.h, 1 - a.y); }
      onChange(clampArea(a));
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const corner = (k: 'tl' | 'tr' | 'bl' | 'br') => (
    <span onPointerDown={(e) => start(e, k)} className="absolute w-3.5 h-3.5 rounded-sm bg-white border-2" style={{ borderColor: C.accent, cursor: k === 'tl' || k === 'br' ? 'nwse-resize' : 'nesw-resize', [k[0] === 't' ? 'top' : 'bottom']: -7, [k[1] === 'l' ? 'left' : 'right']: -7 }} />
  );
  return (
    <div ref={ref} onPointerDown={(e) => start(e, 'move')} aria-label="Post area" className="absolute cursor-move touch-none"
      style={{ left: `${area.x * 100}%`, top: `${area.y * 100}%`, width: `${area.w * 100}%`, height: `${area.h * 100}%`, border: `2px dashed ${C.accent}`, background: `${C.accent}14`, boxShadow: '0 0 0 9999px rgba(0,0,0,0.25)' }}>
      <span className="absolute -top-6 start-0 h-5 px-1.5 rounded text-[10.5px] font-semibold text-white inline-flex items-center whitespace-nowrap" style={{ background: C.accent }}>Post area</span>
      {corner('tl')}{corner('tr')}{corner('bl')}{corner('br')}
    </div>
  );
}

function StylePanel({ prof, sample }: { prof: Profile; sample?: Post }) {
  const t = prof.template;
  const set = (p: Partial<Template>) => updateTemplate(prof.id, p);
  const profiles = usePosts((s) => s.profiles);
  const post = sample ?? SAMPLE();
  const url = useThumb(post, prof, 640, true);
  const size = sizeOf(t);
  const styles = useStyles((x) => x.list);
  useEffect(() => { void loadStyles(); }, []);
  const [styleName, setStyleName] = useState('');
  const fonts = useMemo(() => FONTS.map((f) => ({ v: f.family, l: f.family + (f.arabic ? ' · عربي/کوردی' : '') })), []);
  return (
    <div className="pb-10">
      <div className="p-4 border-b" style={{ borderColor: C.line }}>
        <div className="flex items-center gap-2 mb-2.5"><LuPalette size={15} style={{ color: '#c4b5fd' }} /><span className="font-semibold text-white text-[14px]">Design style</span><span className="text-[11.5px] ms-auto" style={{ color: C.faint }}>{tr('for {0}', prof.tab || prof.name)}</span></div>
        <div className="rounded-xl overflow-hidden border relative" style={{ aspectRatio: `${size.w} / ${size.h}`, width: `min(100%, ${Math.round((440 * size.w) / size.h)}px)`, marginInline: 'auto', borderColor: C.line, background: '#ffffff06' }}>
          {url ? <img src={url} alt="Preview" className="absolute inset-0 w-full h-full object-contain" /> : <span className="absolute inset-0 flex items-center justify-center" style={{ color: C.faint }}><LuLoaderCircle className="animate-spin" size={20} /></span>}
          {t.area && <AreaBox area={t.area} onChange={(a) => set({ area: a })} />}
        </div>
        <div className="mt-1.5 text-center text-[11.5px] tabular-nums" style={{ color: C.faint }} translate="no">{size.w} × {size.h}</div>
        <div className="mt-2 text-[11.5px]" style={{ color: C.faint }}>{sample ? 'Preview with the latest post.' : 'Preview with a sample text.'}</div>
      </div>
      <Group title="My styles">
        <div className="flex gap-1.5">
          <input value={styleName} onChange={(e) => setStyleName(e.target.value)} placeholder={tr('Name of this style')} style={inputStyle} aria-label="Name of this style" />
          <button type="button" className="h-8 px-3 rounded-lg text-[12.5px] font-semibold text-white shrink-0 inline-flex items-center gap-1.5" style={{ background: C.accent }} onClick={() => { saveStyle(styleName || `${prof.tab || prof.name} ${styles.length + 1}`, t); setStyleName(''); toast(tr('Your style was saved — use it for any profile.'), 'success'); }}><LuSave size={14} /><span>Save style</span></button>
        </div>
        {styles.length ? (
          <div className="flex flex-col gap-1">
            {styles.map((st) => (
              <div key={st.id} className="flex items-center gap-2 h-10 ps-1 pe-1 rounded-lg border" style={{ borderColor: C.line }}>
                <span className="w-8 h-8 rounded-md shrink-0 border" style={{ borderColor: C.line, background: st.tpl.bgType === 'image' && st.tpl.bgImage ? `center/cover url(${st.tpl.bgImage})` : st.tpl.bgType === 'solid' ? st.tpl.bg1 : `linear-gradient(135deg, ${st.tpl.bg1}, ${st.tpl.bg2})` }} />
                <span className="flex-1 min-w-0 truncate text-[12.5px]" translate="no">{st.name}</span>
                <span className="text-[10.5px] tabular-nums" style={{ color: C.faint }} translate="no">{sizeOf(st.tpl).w}×{sizeOf(st.tpl).h}</span>
                <button type="button" className="h-7 px-2.5 rounded-md text-[12px] font-semibold border hover:bg-white/5" style={{ borderColor: C.line }} onClick={() => set({ ...defaultTemplate(), ...st.tpl })}>Use</button>
                <button type="button" className="w-7 h-7 rounded-md inline-flex items-center justify-center hover:bg-white/5" style={{ color: C.faint }} onClick={() => deleteStyle(st.id)} aria-label="Delete the style"><LuTrash2 size={13} /></button>
              </div>
            ))}
          </div>
        ) : <div className="text-[11.5px] leading-relaxed" style={{ color: C.faint }}>Make a style below (size, box, background, colours, logo) and save it here to use it again.</div>}
      </Group>
      <Group title="Ready styles">
        <div className="grid grid-cols-3 gap-1.5">
          {THEMES.map((th) => (
            <button key={th.name} type="button" onClick={() => set(th.t)} className="h-14 rounded-lg border relative overflow-hidden text-[11.5px] font-semibold" style={{ borderColor: C.line, background: th.t.bgType === 'solid' ? th.t.bg1 : `linear-gradient(135deg, ${th.t.bg1}, ${th.t.bg2})`, color: th.t.cardOn ? th.t.textColor : th.t.textColor }}>
              {th.t.cardOn && <span className="absolute inset-x-2.5 inset-y-2.5 rounded" style={{ background: th.t.cardColor, opacity: th.t.cardOpacity }} />}
              <span className="relative" style={{ color: th.t.cardOn ? th.t.textColor : th.t.nameColor }}>{th.name}</span>
            </button>
          ))}
        </div>
      </Group>
      <Group title="Layout">
        <Chips<Layout> value={t.layout} onChange={(v) => set({ layout: v })} options={[{ v: 'card', l: 'Post card' }, { v: 'quote', l: 'Quote' }, { v: 'headline', l: 'News headline' }]} />
        {t.layout === 'headline' && <Row label="Label"><input style={{ ...inputStyle, width: 170 }} value={t.label} onChange={(e) => set({ label: e.target.value })} placeholder="BREAKING" /></Row>}
      </Group>
      <Group title="Size">
        <Chips<SizeKey> value={t.size} onChange={(v) => set({ size: v })} options={(Object.keys(SIZES) as SizeKey[]).map((k) => ({ v: k, l: SIZES[k].label }))} />
        {t.size === 'custom' && <>
          <div className="flex items-center gap-2 text-[12.5px]">
            <span style={{ color: C.sub }}>Width</span><input type="number" min={200} max={4000} value={t.customW} onChange={(e) => set({ customW: Number(e.target.value) || 1080 })} style={{ ...inputStyle, width: 82 }} aria-label="Width" dir="ltr" />
            <span style={{ color: C.faint }}>×</span>
            <span style={{ color: C.sub }}>Height</span><input type="number" min={200} max={4000} value={t.customH} onChange={(e) => set({ customH: Number(e.target.value) || 1920 })} style={{ ...inputStyle, width: 82 }} aria-label="Height" dir="ltr" />
            <span style={{ color: C.faint }}>px</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[[1080, 1920], [1920, 1080], [1080, 1350], [1080, 1080], [1200, 630], [1500, 500]].map(([w, h]) => <button key={`${w}x${h}`} type="button" onClick={() => set({ customW: w, customH: h })} className="h-7 px-2.5 rounded-md border text-[11.5px] tabular-nums" style={{ borderColor: t.customW === w && t.customH === h ? C.accent : C.line, color: C.sub }} translate="no">{w}×{h}</button>)}
          </div>
        </>}
        {t.bgType === 'image' && t.bgImage && <button type="button" className="h-8 rounded-lg border text-[12px] hover:bg-white/5" style={{ borderColor: C.line, color: C.sub }} onClick={() => { const im = new Image(); im.onload = () => set({ size: 'custom', customW: im.naturalWidth, customH: im.naturalHeight }); im.src = t.bgImage!; }}>Use the size of the background picture</button>}
      </Group>
      <Group title="Post area">
        <Row label="Keep the post inside a box"><Toggle on={!!t.area} onChange={(v) => set({ area: v ? { x: 0.08, y: 0.25, w: 0.84, h: 0.5 } : null })} label="Keep the post inside a box" /></Row>
        {t.area ? <>
          <div className="text-[11.5px] leading-relaxed" style={{ color: C.faint }}>Drag the dashed box on the preview (or its corners). The post — text, picture and name — never goes outside it; long posts get smaller.</div>
          <div className="flex flex-wrap gap-1.5">
            {([['Whole', { x: 0.05, y: 0.05, w: 0.9, h: 0.9 }], ['Middle', { x: 0.08, y: 0.25, w: 0.84, h: 0.5 }], ['Top half', { x: 0.06, y: 0.06, w: 0.88, h: 0.44 }], ['Bottom half', { x: 0.06, y: 0.5, w: 0.88, h: 0.44 }]] as const).map(([l, a]) => <button key={l} type="button" onClick={() => set({ area: { ...a } })} className="h-7 px-2.5 rounded-md border text-[11.5px]" style={{ borderColor: C.line, color: C.sub }}>{l}</button>)}
          </div>
          <div className="grid grid-cols-2 gap-2 text-[12px]">
            {(['x', 'y', 'w', 'h'] as const).map((k) => {
              const full = k === 'x' || k === 'w' ? size.w : size.h;
              return (
                <label key={k} className="flex items-center gap-1.5"><span className="w-12 shrink-0" style={{ color: C.sub }}>{k === 'x' ? 'Left' : k === 'y' ? 'Top' : k === 'w' ? 'Width' : 'Height'}</span>
                  <input type="number" dir="ltr" value={Math.round(t.area![k] * full)} onChange={(e) => { const v = Math.max(0, Number(e.target.value) || 0) / full; set({ area: clampArea({ ...t.area!, [k]: v }) }); }} style={{ ...inputStyle, height: 28 }} aria-label={k} />
                  <span style={{ color: C.faint }}>px</span></label>
              );
            })}
          </div>
          <Row label="Inside the box"><Chips value={t.vAlign} onChange={(v) => set({ vAlign: v })} options={[{ v: 'top', l: 'Top' }, { v: 'center', l: 'Middle' }, { v: 'bottom', l: 'Bottom' }]} /></Row>
        </> : <div className="text-[11.5px] leading-relaxed" style={{ color: C.faint }}>Turn it on to choose exactly where on the design the post goes — e.g. the empty space of your own frame.</div>}
      </Group>
      <Group title="Background">
        <Chips value={t.bgType} onChange={(v) => set({ bgType: v })} options={[{ v: 'solid', l: 'Colour' }, { v: 'gradient', l: 'Gradient' }, { v: 'image', l: 'Picture' }]} />
        {t.bgType !== 'image' && <Row label={t.bgType === 'solid' ? 'Colour' : 'Colours'}><Color value={t.bg1} onChange={(v) => set({ bg1: v })} label="Background colour" />{t.bgType === 'gradient' && <Color value={t.bg2} onChange={(v) => set({ bg2: v })} label="Second colour" />}</Row>}
        {t.bgType === 'gradient' && <Row label="Angle"><Range value={t.bgAngle} min={0} max={360} onChange={(v) => set({ bgAngle: v })} label="Angle" unit="°" /></Row>}
        {t.bgType === 'image' && <>
          <div className="flex gap-1.5">
            <button type="button" className="h-9 flex-1 rounded-lg border text-[12.5px] font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-white/5" style={{ borderColor: C.line }} onClick={() => pickImage(2000, false, (d) => set({ bgImage: d }))}><LuUpload size={14} /><span>{t.bgImage ? 'Change picture' : 'Choose a picture'}</span></button>
            {t.bgImage && <button type="button" className="h-9 w-9 rounded-lg border inline-flex items-center justify-center hover:bg-white/5" style={{ borderColor: C.line }} onClick={() => set({ bgImage: null })} aria-label="Remove the picture"><LuX size={14} /></button>}
          </div>
          <div className="text-[11.5px] leading-relaxed" style={{ color: C.faint }}>Tip: make your frame in the Design section, export it as PNG and choose it here.</div>
          <Row label="Darken"><Range value={t.bgDim} min={0} max={0.85} step={0.05} onChange={(v) => set({ bgDim: v })} label="Darken" /></Row>
        </>}
      </Group>
      <Group title="Card">
        <Row label="Card behind the text"><Toggle on={t.cardOn} onChange={(v) => set({ cardOn: v })} label="Card behind the text" /></Row>
        {t.cardOn && <>
          <Row label="Card colour"><Color value={t.cardColor} onChange={(v) => set({ cardColor: v })} label="Card colour" /></Row>
          <Row label="Opacity"><Range value={t.cardOpacity} min={0.1} max={1} step={0.05} onChange={(v) => set({ cardOpacity: v })} label="Opacity" /></Row>
          <Row label="Corners"><Range value={t.radius} min={0} max={80} onChange={(v) => set({ radius: v })} label="Corners" unit="px" /></Row>
        </>}
      </Group>
      <Group title="Text">
        <Row label="Font"><select value={t.font} onChange={(e) => set({ font: e.target.value })} style={{ ...inputStyle, width: 170 }} aria-label="Font" translate="no">{fonts.map((f) => <option key={f.v} value={f.v}>{f.l}</option>)}</select></Row>
        <Row label="Size"><Range value={t.textSize} min={28} max={96} onChange={(v) => set({ textSize: v })} label="Text size" unit="px" /></Row>
        <Row label="Colour"><Color value={t.textColor} onChange={(v) => set({ textColor: v })} label="Text colour" /></Row>
        <Row label="Bold"><Toggle on={t.bold} onChange={(v) => set({ bold: v })} label="Bold" /></Row>
        <Row label="Alignment"><Chips value={t.align} onChange={(v) => set({ align: v })} options={[{ v: 'start', l: 'Start' }, { v: 'center', l: 'Centre' }]} /></Row>
        <div className="text-[11.5px]" style={{ color: C.faint }}>Long posts get smaller automatically so they always fit.</div>
      </Group>
      <Group title="Name and photo">
        <Row label="Profile photo"><Toggle on={t.showAvatar} onChange={(v) => set({ showAvatar: v })} label="Profile photo" /></Row>
        <Row label="Verified badge"><Toggle on={t.verified} onChange={(v) => set({ verified: v })} label="Verified badge" /></Row>
        <Row label="Handle"><Toggle on={t.showHandle} onChange={(v) => set({ showHandle: v })} label="Handle" /></Row>
        <Row label="Date and time"><Toggle on={t.showDate} onChange={(v) => set({ showDate: v })} label="Date and time" /></Row>
        <Row label="Picture of the post"><Toggle on={t.showImage} onChange={(v) => set({ showImage: v })} label="Picture of the post" /></Row>
        <Row label="Name colour"><Color value={t.nameColor} onChange={(v) => set({ nameColor: v })} label="Name colour" /></Row>
        <Row label="Small text colour"><Color value={t.subColor} onChange={(v) => set({ subColor: v })} label="Small text colour" /></Row>
        <Row label="Accent colour"><Color value={t.accent} onChange={(v) => set({ accent: v })} label="Accent colour" /></Row>
      </Group>
      <Group title="Your logo and name">
        <div className="flex gap-1.5">
          <button type="button" className="h-9 flex-1 rounded-lg border text-[12.5px] font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-white/5" style={{ borderColor: C.line }} onClick={() => pickImage(600, true, (d) => set({ logo: d }))}><LuUpload size={14} /><span>{t.logo ? 'Change logo' : 'Add your logo'}</span></button>
          {t.logo && <button type="button" className="h-9 w-9 rounded-lg border inline-flex items-center justify-center hover:bg-white/5" style={{ borderColor: C.line }} onClick={() => set({ logo: null })} aria-label="Remove the logo"><LuX size={14} /></button>}
        </div>
        {t.logo && <>
          <Row label="Place"><Chips value={t.logoPos} onChange={(v) => set({ logoPos: v })} options={[{ v: 'tl', l: '↖' }, { v: 'tr', l: '↗' }, { v: 'bl', l: '↙' }, { v: 'br', l: '↘' }]} /></Row>
          <Row label="Logo size"><Range value={t.logoSize} min={30} max={180} onChange={(v) => set({ logoSize: v })} label="Logo size" unit="px" /></Row>
        </>}
        <Row label="Your page name"><input style={{ ...inputStyle, width: 170 }} value={t.footer} onChange={(e) => set({ footer: e.target.value })} placeholder="@yourpage" /></Row>
        {t.footer && <Row label="Its colour"><Color value={t.footerColor} onChange={(v) => set({ footerColor: v })} label="Page name colour" /></Row>}
      </Group>
      <Group title="More">
        {profiles.length > 1 && (
          <Row label="Copy the style of">
            <select style={{ ...inputStyle, width: 170 }} value="" onChange={(e) => { const from = profiles.find((p) => p.id === e.target.value); if (from) set({ ...from.template }); }} aria-label="Copy the style of">
              <option value="">—</option>{profiles.filter((p) => p.id !== prof.id).map((p) => <option key={p.id} value={p.id}>{p.tab || p.name}</option>)}
            </select>
          </Row>
        )}
        <button type="button" className="h-9 rounded-lg border text-[12.5px] hover:bg-white/5" style={{ borderColor: C.line, color: C.sub }} onClick={() => set(defaultTemplate())}>Reset the style</button>
      </Group>
    </div>
  );
}

// ======================================================================
const INTERVALS = [0.25, 0.5, 1, 2, 5, 10, 30, 60];

function ProfileDialog({ edit, preset, link: startLink, onClose }: { edit: Profile | null; preset?: string; link?: string; onClose: () => void }) {
  const pre = PRESETS.find((p) => p.id === preset);
  const apiKey = usePosts((s) => s.settings.apiKey);
  const [link, setLink] = useState(startLink ?? pre?.link ?? '');
  const [name, setName] = useState(edit?.name ?? pre?.name ?? '');
  const [tab, setTab] = useState(edit?.tab ?? pre?.tab ?? '');
  const [handle, setHandle] = useState(edit?.handle ?? pre?.handle ?? '');
  const [type, setType] = useState<SourceType>(edit?.source.type ?? pre?.type ?? 'rss');
  const [value, setValue] = useState(edit?.source.value ?? pre?.value ?? '');
  const [platform, setPlatform] = useState<Platform | null>(pre ? 'truth' : null);
  const [avatar, setAvatar] = useState<string | null>(edit?.avatar ?? null);
  const [avatarAuto, setAvatarAuto] = useState<string | null>(edit?.avatarAuto ?? null);
  const [interval, setIntervalMin] = useState(edit?.interval ?? 0.5);
  const [test, setTest] = useState<{ busy: boolean; msg: string; ok: boolean } | null>(null);
  const [advanced, setAdvanced] = useState(!!edit && !['truth', 'telegram', 'youtube', 'api'].includes(edit.source.type));
  const [confirmDel, setConfirmDel] = useState(false);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const runTest = async (t = type, v = value) => {
    setTest({ busy: true, msg: '', ok: false });
    try {
      const r = await fetchSource(t, v);
      if (r.name) setName((n) => n || r.name!);
      if (r.handle) setHandle((h) => h || r.handle!);
      if (r.avatar) setAvatarAuto(r.avatar);
      const latest = r.posts[0];
      const via = r.via ? ` ${tr('(read via {0})', r.via)}` : '';
      setTest({ busy: false, ok: true, msg: (latest ? tr('Found {0} posts. Latest: “{1}”', r.posts.length, latest.text.slice(0, 90) + (latest.text.length > 90 ? '…' : '')) : tr('The source works, but it has no posts yet.')) + via });
    } catch (e) { setTest({ busy: false, ok: false, msg: tr((e as Error).message || 'The source could not be read.') }); }
  };
  // reading the pasted link fills everything in
  const applyLink = (raw: string, run = true) => {
    const d = detectLink(raw);
    if (!d) { setPlatform(null); return; }
    setPlatform(d.platform); setType(d.type); setValue(d.value);
    setHandle(d.handle);
    const base = d.handle.replace(/^@/, '').replace(/@.*$/, '');
    if (!edit) { setTab(d.platform === 'truth' && /^realdonaldtrump$/i.test(base) ? 'Trump' : base); if (d.platform === 'truth' && /^realdonaldtrump$/i.test(base)) setName('Donald J. Trump'); }
    setTest(null);
    if (run && !(d.needsKey && !apiKey)) void runTest(d.type, d.value);
  };
  useEffect(() => { if (startLink || pre) applyLink(startLink ?? pre!.link); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => {
    if (!value.trim()) { setTest({ busy: false, ok: false, msg: tr('Paste the link of the profile.') }); return; }
    const nm = name.trim() || handle.trim() || tr('Profile');
    const base = { name: nm, tab: tab.trim() || nm.split(/\s+/).slice(-1)[0], handle: handle.trim(), source: { type, value: value.trim() }, avatar, avatarAuto, interval };
    if (edit) {
      const changed = edit.source.type !== type || edit.source.value.trim() !== value.trim();
      updateProfile(edit.id, { ...base, ...(changed ? { checkedOnce: false, lastChecked: 0, lastError: null } : {}) });
      if (changed) void checkProfile(edit.id);
    } else {
      const trump = /trump/i.test(nm) || /realdonaldtrump/i.test(value);
      const p = addProfile({ ...base, template: { ...defaultTemplate(), ...(trump ? { bg1: '#14213d', bg2: '#0a0f1f', accent: '#1d9bf0' } : {}) } });
      void checkProfile(p.id, true);
    }
    onClose();
  };
  const needsKey = type === 'api' && !apiKey;
  const placeholder = type === 'rss' ? 'https://example.com/feed' : type === 'bluesky' ? 'name.bsky.social' : type === 'mastodon' ? '@name@mastodon.social' : '';
  const field = (label: string, el: ReactNode, hint?: ReactNode) => <label className="flex flex-col gap-1.5"><span className="text-[12.5px] font-semibold" style={{ color: C.ink }}>{label}</span>{el}{hint && <span className="text-[11.5px] leading-relaxed" style={{ color: C.faint }}>{hint}</span>}</label>;
  return (
    <div role="dialog" aria-modal="true" aria-label={edit ? 'Edit profile' : 'Add a profile'} className="fixed inset-0 z-50 flex items-center justify-center p-3" style={{ background: 'rgba(5,5,12,0.75)', backdropFilter: 'blur(4px)' }} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-[540px] max-h-full overflow-y-auto rounded-2xl border shadow-2xl" style={{ background: C.panel, borderColor: C.line }}>
        <div className="flex items-center px-5 h-14 border-b" style={{ borderColor: C.line }}>
          <h2 className="m-0 text-[16px] font-bold text-white flex-1">{edit ? 'Edit profile' : 'Add a profile'}</h2>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-full inline-flex items-center justify-center hover:bg-white/5" aria-label="Close"><LuX size={16} /></button>
        </div>
        <div className="p-5 flex flex-col gap-4">
          {field('Profile link',
            <div className="flex gap-2">
              <input style={{ ...inputStyle, height: 40, fontSize: 14 }} value={link} autoFocus={!edit} onChange={(e) => { setLink(e.target.value); applyLink(e.target.value, false); }}
                onPaste={(e: ClipboardEvent<HTMLInputElement>) => { const t = e.clipboardData.getData('text'); if (t) { e.preventDefault(); setLink(t.trim()); applyLink(t.trim()); } }}
                onKeyDown={(e) => { if (e.key === 'Enter') applyLink(link); }} placeholder="https://truthsocial.com/@realDonaldTrump" dir="ltr" translate="no" />
              <button type="button" onClick={() => applyLink(link)} disabled={test?.busy || !link.trim()} className="h-10 px-4 rounded-lg text-[13px] font-semibold text-white shrink-0 inline-flex items-center gap-1.5 disabled:opacity-50" style={{ background: C.accent }}>{test?.busy ? <LuLoaderCircle size={14} className="animate-spin" /> : <LuCheck size={14} />}<span>Read</span></button>
            </div>,
            platform ? <span className="inline-flex items-center gap-1.5"><span className="h-5 px-2 rounded-full inline-flex items-center text-[11px] font-semibold text-white" style={{ background: needsKey ? C.rose : C.accent }} translate="no">{PLATFORM_NAMES[platform]}</span><span translate="no">{handle}</span></span>
              : 'Truth Social, Telegram, YouTube, X, Facebook, Instagram, TikTok, Threads, Bluesky, Mastodon, Reddit or any site with an RSS feed.')}
          {needsKey && (
            <div className="rounded-lg px-3 py-2.5 text-[12.5px] leading-relaxed" style={{ background: `${C.rose}1a`, color: '#ffc2cd' }}>
              {tr('{0} doesn’t let websites read posts for free. Add a ScrapeCreators API key in Settings (⚙) — or paste an RSS feed link of this profile (e.g. from RSS.app).', platform ? PLATFORM_NAMES[platform] : '')}
            </div>
          )}
          {test && !test.busy && <div className="rounded-lg px-3 py-2.5 text-[12.5px] leading-relaxed flex gap-2" style={{ background: test.ok ? `${C.ok}1a` : `${C.rose}1a`, color: test.ok ? '#b8f5d6' : '#ffc2cd' }}>{test.ok ? <LuCheck size={15} className="shrink-0 mt-px" /> : <LuCircleAlert size={15} className="shrink-0 mt-px" />}<span>{test.msg}</span></div>}
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => pickImage(512, false, setAvatar)} className="relative shrink-0 rounded-full" aria-label="Choose the profile photo" data-tip="Choose the profile photo">
              <Avatar prof={{ name: name || '?', avatar, avatarAuto, template: { ...defaultTemplate(), accent: C.accent } }} size={56} />
              <span className="absolute -bottom-0.5 -end-0.5 w-6 h-6 rounded-full flex items-center justify-center text-white border-2" style={{ background: C.accent, borderColor: C.panel }}><LuUpload size={11} /></span>
            </button>
            <div className="grid grid-cols-2 gap-3 flex-1 min-w-0">
              {field('Name', <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Donald J. Trump" />)}
              {field('Tab name', <input style={inputStyle} value={tab} onChange={(e) => setTab(e.target.value)} placeholder="Trump" />)}
            </div>
          </div>
          {avatar ? <button type="button" className="self-start text-[12px] underline" style={{ color: C.sub }} onClick={() => setAvatar(null)}>Remove the photo</button> : null}
          {field('Check every', <Chips value={String(interval)} onChange={(v) => setIntervalMin(Number(v))} options={INTERVALS.map((n) => ({ v: String(n), l: everyLabel(n) }))} />,
            type === 'api' ? 'Every check uses a ScrapeCreators credit: 30 s ≈ 2,880 checks a day.' : 'Every 15–30 seconds the design comes almost as soon as the post is published.')}
          <button type="button" onClick={() => setAdvanced(!advanced)} className="self-start text-[12.5px] inline-flex items-center gap-1" style={{ color: C.sub }}><LuChevronDown size={14} style={{ transform: advanced ? 'rotate(180deg)' : undefined }} /><span>More options</span></button>
          {advanced && <>
            {field('Handle', <input style={inputStyle} value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@realDonaldTrump" dir="ltr" />)}
            {field('Where the posts come from', <Chips value={type} onChange={(v) => { setType(v); setTest(null); }} options={[{ v: 'truth', l: 'Truth Social' }, { v: 'telegram', l: 'Telegram' }, { v: 'youtube', l: 'YouTube' }, { v: 'api', l: 'X / Facebook / Instagram (API)' }, { v: 'rss', l: 'RSS / Atom feed' }, { v: 'bluesky', l: 'Bluesky' }, { v: 'mastodon', l: 'Mastodon' }]} />)}
            {field('Address', <div className="flex gap-2"><input style={inputStyle} value={value} onChange={(e) => { setValue(e.target.value); setTest(null); }} placeholder={placeholder} dir="ltr" translate="no" />
              <button type="button" onClick={() => void runTest()} disabled={test?.busy} className="h-8 px-3.5 rounded-lg text-[12.5px] font-semibold border shrink-0 inline-flex items-center gap-1.5 hover:bg-white/5 disabled:opacity-60" style={{ borderColor: C.line }}>{test?.busy ? <LuLoaderCircle size={14} className="animate-spin" /> : <LuCheck size={14} />}<span>Test</span></button></div>)}
          </>}
        </div>
        <div className="px-5 py-4 border-t flex items-center gap-2" style={{ borderColor: C.line }}>
          {edit && (confirmDel
            ? <button type="button" onClick={() => { removeProfile(edit.id); onClose(); }} className="h-10 px-4 rounded-full text-[13px] font-semibold text-white" style={{ background: C.rose }}>Delete with its designs</button>
            : <button type="button" onClick={() => setConfirmDel(true)} className="h-10 px-3 rounded-full text-[13px] inline-flex items-center gap-1.5 hover:bg-white/5" style={{ color: C.rose }}><LuTrash2 size={14} /><span>Delete</span></button>)}
          <span className="flex-1" />
          <button type="button" onClick={onClose} className="h-10 px-4 rounded-full text-[13px] font-semibold border hover:bg-white/5" style={{ borderColor: C.line }}>Cancel</button>
          <button type="button" onClick={save} className="h-10 px-5 rounded-full text-[13px] font-semibold text-white" style={{ background: C.accent }}>{edit ? 'Save' : 'Follow and start'}</button>
        </div>
      </div>
    </div>
  );
}
