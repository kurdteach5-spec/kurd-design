// Sound Library section: a dark, Audition-style browser for background music and sound effects —
// search, filters, waveform rows, one preview at a time, favourites, downloads and a library manager.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MUSIC, SFX, ALL_GENRES, licenseOf, type Track } from '../catalog';
import { useLib, setFilters, defaultFilters, filterTracks, toggleFavorite, refreshUploads, peaksOf, allTracks, trackById, type Filters } from '../store';
import { playTrack, togglePlay, seek, setVolume, setLoop, requestPeaks, downloadTrack } from '../audio';
import { Popover } from '../../components/ui/controls';
import { useWindowSize } from '../../utils/useWindowSize';
import { LibraryManager } from './LibraryManager';
import { useOnline, searchOnline, keepOnline, onlineQueryFor } from '../online';
import {
  LuSearch, LuPlay, LuPause, LuHeart, LuDownload, LuRepeat, LuVolume2, LuVolumeX, LuSkipBack, LuSkipForward, LuMusic, LuAudioWaveform,
  LuUpload, LuX, LuLoaderCircle, LuShieldCheck, LuListMusic, LuFilter, LuGlobe, LuExternalLink, LuCopy, LuRefreshCw,
} from 'react-icons/lu';

const C = { bg: '#0c0d10', panel: '#14161b', raised: '#1b1e25', line: '#252831', ink: '#e8eaf0', sub: '#9298a6', faint: '#5d6372', blue: '#2f8cff', orange: '#ff8a1f' };
const CAT_COLORS = ['#2f8cff', '#ff8a1f', '#22c3a6', '#e5484d', '#a78bfa', '#f2c94c', '#4cc9f0', '#f06ba8'];
const catColor = (id: string) => { let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0; return CAT_COLORS[Math.abs(h) % CAT_COLORS.length]; };
const fmt = (s: number) => { const m = Math.floor(s / 60), x = Math.floor(s % 60); return `${m}:${String(x).padStart(2, '0')}`; };

export function LibraryWorkspace() {
  const st = useLib();
  const { w } = useWindowSize();
  const narrow = w < 900;
  useEffect(() => { void refreshUploads(); }, []);
  const on = useOnline();
  const list = useMemo(() => filterTracks(st), [st.filters, st.uploads, st.favorites, st.plays, on.results, on.saved]); // eslint-disable-line react-hooks/exhaustive-deps
  // online search follows the search box and filters (after a short pause in typing)
  const f = st.filters;
  useEffect(() => {
    if (!f.online || f.favorites) return;
    const q = f.q.trim() || (f.category !== 'all' ? onlineQueryFor(f.kind === 'sfx' ? 'sfx' : 'music', f.category) : '');
    const h = setTimeout(() => void searchOnline({ q, kind: f.kind, commercial: f.license === 'free', length: f.duration }), f.q ? 600 : 0);
    return () => clearTimeout(h);
  }, [f.online, f.favorites, f.q, f.kind, f.category, f.license, f.duration]);
  const [drawer, setDrawer] = useState(false);
  return (
    <div className="h-full flex flex-col min-h-0" style={{ background: C.bg, color: C.ink }} data-section="library">
      <div className="flex-1 min-h-0 flex">
        {!narrow && <aside className="w-[250px] shrink-0 border-e overflow-y-auto" style={{ borderColor: C.line, background: C.panel }} aria-label="Library"><Sidebar /></aside>}
        {narrow && drawer && (
          <>
            <div className="fixed inset-0 z-30 bg-black/50" onClick={() => setDrawer(false)} aria-hidden />
            <aside className="fixed top-0 bottom-0 start-0 z-40 w-[280px] overflow-y-auto border-e" style={{ borderColor: C.line, background: C.panel }} aria-label="Library"><Sidebar onPick={() => setDrawer(false)} /></aside>
          </>
        )}
        <main className="flex-1 min-w-0 flex flex-col min-h-0">
          <Header count={f.online && !f.favorites ? on.total : list.length} narrow={narrow} onMenu={() => setDrawer(true)} />
          <div className="flex-1 min-h-0 overflow-y-auto" role="list" aria-label="Tracks">
            {f.online && !f.favorites && <OnlineNotice />}
            {list.length === 0 ? (f.online && !f.favorites ? <OnlineEmpty /> : <Empty />) : list.map((t, i) => <Row key={t.id} t={t} index={i} narrow={narrow} />)}
            {f.online && !f.favorites && list.length > 0 && <OnlineMore />}
            <div className="h-6" />
          </div>
        </main>
      </div>
      <PlayerBar list={list} narrow={narrow} />
      {st.admin.open && <LibraryManager />}
    </div>
  );
}

function SideItem({ on, label, count, icon, onClick, color }: { on: boolean; label: string; count?: number; icon?: ReactNode; onClick: () => void; color?: string }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className="w-full h-[30px] px-3 rounded-[6px] flex items-center gap-2 text-[13px] text-start transition-colors"
      style={{ background: on ? 'rgba(47,140,255,0.16)' : 'transparent', color: on ? '#fff' : C.sub, boxShadow: on ? `inset 2px 0 0 ${C.blue}` : undefined }}>
      {color ? <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} aria-hidden /> : icon}
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && <span className="text-[11px] num" style={{ color: C.faint }}>{count}</span>}
    </button>
  );
}

function Sidebar({ onPick }: { onPick?: () => void }) {
  const f = useLib((s) => s.filters);
  const uploads = useLib((s) => s.uploads);
  const favs = useLib((s) => s.favorites);
  const all = allTracks();
  const n = (kind: string, cat?: string) => all.filter((t) => !t.remote && t.kind === kind && (!cat || t.category === cat)).length;
  const pick = (p: Partial<Filters>) => { setFilters({ category: 'all', favorites: false, uploads: false, online: false, ...p }); onPick?.(); };
  const cats = f.kind === 'sfx' ? SFX.map((c) => ({ id: c.id, name: c.name })) : MUSIC.map((c) => ({ id: c.id, name: c.name }));
  return (
    <div className="p-2.5 flex flex-col gap-0.5">
      <div className="px-3 pt-2 pb-1.5 text-[11px] font-semibold tracking-[0.12em] uppercase" style={{ color: C.faint }}>Library</div>
      <SideItem on={!f.online && f.kind === 'music' && !f.favorites && !f.uploads && f.category === 'all'} label="Background Music" count={n('music')} icon={<LuMusic size={14} />} onClick={() => pick({ kind: 'music' })} />
      <SideItem on={!f.online && f.kind === 'sfx' && !f.favorites && !f.uploads && f.category === 'all'} label="Sound Effects" count={n('sfx')} icon={<LuAudioWaveform size={14} />} onClick={() => pick({ kind: 'sfx' })} />
      <SideItem on={f.favorites} label="Favorites" count={favs.length} icon={<LuHeart size={14} />} onClick={() => pick({ favorites: true })} />
      <SideItem on={f.uploads} label="Uploaded" count={uploads.length} icon={<LuUpload size={14} />} onClick={() => pick({ uploads: true })} />
      <div className="px-3 pt-4 pb-1.5 text-[11px] font-semibold tracking-[0.12em] uppercase" style={{ color: C.faint }}>Free online sounds</div>
      <SideItem on={f.online && f.kind === 'music' && !f.favorites && f.category === 'all'} label="Online music (CC)" icon={<LuGlobe size={14} />} onClick={() => pick({ online: true, kind: 'music' })} />
      <SideItem on={f.online && f.kind === 'sfx' && !f.favorites && f.category === 'all'} label="Online sound effects (CC)" icon={<LuGlobe size={14} />} onClick={() => pick({ online: true, kind: 'sfx' })} />
      <a className="w-full h-[30px] px-3 rounded-[6px] flex items-center gap-2 text-[13px] hover:bg-white/5" style={{ color: C.sub }} target="_blank" rel="noopener noreferrer"
        href={`https://pixabay.com/${f.kind === 'music' ? 'music' : 'sound-effects'}/search/${encodeURIComponent(f.q || '')}`} data-tip="Opens Pixabay in a new tab: download a sound there, then add it with Upload & manage">
        <LuExternalLink size={14} /><span className="flex-1 truncate">Find on Pixabay</span></a>
      <button type="button" className="mt-2 mx-1 h-[32px] rounded-[8px] text-[13px] font-semibold inline-flex items-center justify-center gap-2" style={{ background: 'linear-gradient(135deg,#2f8cff,#1f6fe0)', color: '#fff' }}
        onClick={() => useLib.setState({ admin: { open: true, editId: null } })}><LuUpload size={14} />Upload & manage</button>
      <div className="px-3 pt-4 pb-1.5 text-[11px] font-semibold tracking-[0.12em] uppercase" style={{ color: C.faint }}>{f.online ? (f.kind === 'sfx' ? 'Search online: sound effects' : 'Search online: music') : f.kind === 'sfx' ? 'Sound effect categories' : 'Music categories'}</div>
      {cats.map((c) => <SideItem key={c.id} on={f.category === c.id && !f.favorites && !f.uploads} label={c.name} count={f.online ? undefined : n(f.kind === 'sfx' ? 'sfx' : 'music', c.id)} color={catColor(c.id)} onClick={() => pick({ category: c.id, kind: f.kind === 'sfx' ? 'sfx' : 'music', online: f.online, q: '' })} />)}
    </div>
  );
}

function Sel<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-[12px] shrink-0" style={{ color: C.sub }}>
      <span className="hidden lg:inline">{label}</span>
      <select className="h-[28px] rounded-[7px] px-2 text-[12px] border outline-none focus:border-[#2f8cff]" style={{ background: C.raised, borderColor: C.line, color: C.ink }} value={value} aria-label={label} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function Header({ count, narrow, onMenu }: { count: number; narrow: boolean; onMenu: () => void }) {
  const f = useLib((s) => s.filters);
  const moods = useMemo(() => [...new Set(allTracks().filter((t) => f.kind === 'all' || t.kind === f.kind).flatMap((t) => t.moods))].sort(), [f.kind]);
  const cats = f.kind === 'sfx' ? SFX : MUSIC;
  const changed = JSON.stringify({ ...f, q: '', kind: 'music', sort: 'recent', online: false }) !== JSON.stringify({ ...defaultFilters(), q: '' });
  return (
    <div className="shrink-0 border-b px-4 sm:px-6 pt-4 pb-3 flex flex-col gap-3" style={{ borderColor: C.line, background: 'linear-gradient(180deg,#121418,#0c0d10)' }}>
      <div className="flex items-center gap-3">
        {narrow && <button type="button" className="h-11 w-11 rounded-[10px] border flex items-center justify-center shrink-0" style={{ borderColor: C.line, background: C.raised }} aria-label="Library and categories" onClick={onMenu}><LuListMusic size={18} /></button>}
        <div className="relative flex-1 min-w-0">
          <LuSearch size={18} className="absolute start-4 top-1/2 -translate-y-1/2" style={{ color: C.faint }} />
          <input className="w-full h-11 rounded-[12px] border text-[15px] outline-none focus:border-[#2f8cff]" style={{ background: C.raised, borderColor: C.line, color: C.ink, paddingInlineStart: 44, paddingInlineEnd: 36 }}
            placeholder={f.online ? 'Search free sounds online (English words find the most)' : 'Search music and sound effects — name, mood, genre, instrument or purpose'} aria-label="Search the library" value={f.q}
            onChange={(e) => setFilters({ q: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
          {f.q && <button type="button" className="absolute end-3 top-1/2 -translate-y-1/2" style={{ color: C.sub }} aria-label="Clear search" onClick={() => setFilters({ q: '' })}><LuX size={16} /></button>}
        </div>
        <div className="hidden md:flex rounded-[10px] p-1 border shrink-0" style={{ borderColor: C.line, background: C.raised }} role="radiogroup" aria-label="Type">
          {([['music', 'Music'], ['sfx', 'Sound Effects'], ['all', 'All']] as const).map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={f.kind === k && !f.favorites && !f.uploads} className="h-8 px-3 rounded-[7px] text-[13px]"
              style={{ background: f.kind === k && !f.favorites && !f.uploads ? C.blue : 'transparent', color: f.kind === k && !f.favorites && !f.uploads ? '#fff' : C.sub }}
              onClick={() => setFilters({ kind: k, category: 'all', favorites: false, uploads: false, online: f.online, genre: k === 'sfx' ? 'all' : f.genre, bpm: k === 'sfx' ? 'all' : f.bpm })}>{l}</button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2.5 overflow-x-auto no-scrollbar">
        <LuFilter size={14} style={{ color: C.faint }} className="shrink-0" />
        {narrow && <Sel label="Category" value={f.category} options={[{ value: 'all', label: 'All categories' }, ...cats.map((c) => ({ value: c.id, label: c.name }))]} onChange={(v) => setFilters({ category: v })} />}
        {f.online && <span className="inline-flex items-center gap-1.5 h-[28px] px-2.5 rounded-[7px] text-[12px] shrink-0" style={{ background: 'rgba(47,140,255,0.14)', color: '#7db7ff' }}><LuGlobe size={13} />Openverse · Creative Commons</span>}
        {!f.online && <Sel label="Mood" value={f.mood} options={[{ value: 'all', label: 'Any mood' }, ...moods.map((m) => ({ value: m, label: m[0].toUpperCase() + m.slice(1) }))]} onChange={(v) => setFilters({ mood: v })} />}
        {f.kind !== 'sfx' && !f.online && <Sel label="Genre" value={f.genre} options={[{ value: 'all', label: 'Any genre' }, ...ALL_GENRES.map((g) => ({ value: g, label: g }))]} onChange={(v) => setFilters({ genre: v })} />}
        <Sel label="Duration" value={f.duration} options={[{ value: 'all', label: 'Any length' }, { value: 'xs', label: 'Under 10 s' }, { value: 's', label: '10–30 s' }, { value: 'm', label: '30–60 s' }, { value: 'l', label: 'Over 1 min' }]} onChange={(v) => setFilters({ duration: v })} />
        {f.kind !== 'sfx' && !f.online && <Sel label="BPM" value={f.bpm} options={[{ value: 'all', label: 'Any BPM' }, { value: 'slow', label: 'Slow (< 90)' }, { value: 'mid', label: 'Medium (90–120)' }, { value: 'fast', label: 'Fast (> 120)' }]} onChange={(v) => setFilters({ bpm: v })} />}
        <Sel label="License" value={f.license} options={f.online ? [{ value: 'all', label: 'Any Creative Commons licence' }, { value: 'free', label: 'Commercial use allowed' }] : [{ value: 'all', label: 'Any license' }, { value: 'free', label: 'Free downloads' }, { value: 'licensed', label: 'Licensed / restricted' }]} onChange={(v) => setFilters({ license: v })} />
        {!f.online && <Sel label="Sort" value={f.sort} options={[{ value: 'recent', label: 'Recently added' }, { value: 'popular', label: 'Most played (this device)' }, { value: 'title', label: 'Title' }, { value: 'duration', label: 'Duration' }, { value: 'bpm', label: 'BPM' }]} onChange={(v) => setFilters({ sort: v })} />}
        {changed && <button type="button" className="h-[28px] px-2.5 rounded-[7px] text-[12px] shrink-0" style={{ color: C.blue }} onClick={() => setFilters({ ...defaultFilters(), kind: f.kind, q: f.q, online: f.online })}>Clear filters</button>}
        <span className="ms-auto text-[12px] num shrink-0 ps-2" style={{ color: C.faint }}>{`${count} ${count === 1 ? 'result' : 'results'}`}</span>
      </div>
    </div>
  );
}

function Empty() {
  const f = useLib((s) => s.filters);
  return (
    <div className="h-full min-h-[260px] flex flex-col items-center justify-center gap-3 text-center p-8" style={{ color: C.sub }}>
      <LuAudioWaveform size={36} style={{ color: C.faint }} />
      <div className="text-[15px]" style={{ color: C.ink }}>{f.favorites ? 'No favorites yet' : f.uploads ? 'Nothing uploaded yet' : 'No sounds match'}</div>
      <div className="text-[13px] max-w-[420px]">{f.favorites ? 'Tap the heart on any track to keep it here.' : f.uploads ? 'Use “Upload & manage” to add your own music and sound effects.' : 'Try fewer words or clear the filters.'}</div>
      {!f.favorites && !f.uploads && <button type="button" className="h-9 px-4 rounded-[8px] text-[13px]" style={{ background: C.raised, color: C.ink }} onClick={() => setFilters({ ...defaultFilters(), kind: f.kind })}>Clear search and filters</button>}
    </div>
  );
}

/** waveform from the real samples; the played part is orange, click to seek */
export function Wave({ t, height = 34, progress = 0, onSeek, bars = 90 }: { t: Track; height?: number; progress?: number; onSeek?: (f: number) => void; bars?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const has = useLib((s) => !!s.peaks[t.id]);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const draw = () => {
      const p = peaksOf(t.id); const W = cv.clientWidth || 200, H = height; const dpr = window.devicePixelRatio || 1;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); const x = cv.getContext('2d')!; x.scale(dpr, dpr); x.clearRect(0, 0, W, H);
      const n = Math.max(12, Math.min(bars, Math.floor(W / 3)));
      for (let i = 0; i < n; i++) {
        const v = p ? p[Math.floor((i / n) * p.length)] / 255 : 0.12 + 0.08 * Math.sin(i * 0.7);
        const h = Math.max(2, v * (H - 2)); const bx = (i / n) * W; const bw = Math.max(1, W / n - 1);
        x.fillStyle = !p ? '#2a2e38' : i / n < progress ? C.orange : '#3d7fd6';
        x.globalAlpha = !p ? 1 : i / n < progress ? 1 : 0.85;
        x.fillRect(bx, (H - h) / 2, bw, h);
      }
    };
    draw();
    const ro = new ResizeObserver(draw); ro.observe(cv); return () => ro.disconnect();
  }, [t.id, has, progress, height, bars]);
  return <canvas ref={ref} className={`w-full block ${onSeek ? 'cursor-pointer' : ''}`} style={{ height }} aria-label={`Waveform of ${t.title}`}
    onClick={onSeek ? (e) => { const r = e.currentTarget.getBoundingClientRect(); onSeek((e.clientX - r.left) / r.width); } : undefined} />;
}

function Cover({ t, size = 40 }: { t: Track; size?: number }) {
  const c = catColor(t.category);
  if (t.cover) return <img src={t.cover} alt="" className="rounded-[8px] object-cover shrink-0" style={{ width: size, height: size }} />;
  return (
    <span className="rounded-[8px] shrink-0 flex items-center justify-center" style={{ width: size, height: size, background: `linear-gradient(135deg, ${c}40, ${c}12)`, boxShadow: `inset 0 0 0 1px ${c}55`, color: c }} aria-hidden>
      {t.kind === 'sfx' ? <LuAudioWaveform size={size * 0.45} /> : <LuMusic size={size * 0.42} />}
    </span>
  );
}

function LicenseBadge({ t }: { t: Track }) {
  const l = licenseOf(t.license);
  return (
    <span className="inline-flex items-center gap-1 h-[20px] px-2 rounded-full text-[11px] whitespace-nowrap" title={`${l.note}${t.attribution ? `\nAttribution: ${t.attribution}` : ''}`}
      style={{ background: l.free ? 'rgba(34,195,166,0.12)' : 'rgba(255,138,31,0.14)', color: l.free ? '#3ddbb9' : C.orange }} data-tip={`${l.note}${t.attribution ? ` · Attribution: ${t.attribution}` : ''}`}>
      <LuShieldCheck size={11} />{l.label}
    </span>
  );
}

function DownloadButton({ t, big }: { t: Track; big?: boolean }) {
  const [a, setA] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async (f: 'wav' | 'mp3' | 'original') => { setA(null); setBusy(true); await downloadTrack(t, f); setBusy(false); };
  return (
    <>
      <button type="button" className={`${big ? 'h-9 w-9' : 'h-8 w-8'} rounded-[8px] flex items-center justify-center shrink-0 hover:bg-white/5`} style={{ color: C.sub }} aria-label={`Download ${t.title}`} data-tip="Download" onClick={(e) => setA(e.currentTarget)}>
        {busy ? <LuLoaderCircle size={16} className="animate-spin" /> : <LuDownload size={16} />}
      </button>
      {a && (
        <Popover anchor={a} onClose={() => setA(null)} placement="bottom-end">
          <div className="menu w-[250px]" role="menu">
            {!t.builtin && <button type="button" role="menuitem" className="menu-item w-full" onClick={() => void go('original')}><span className="flex-1">{`Original file (${t.format})`}</span></button>}
            {t.remote && <a role="menuitem" className="menu-item w-full" href={t.remote.landing} target="_blank" rel="noopener noreferrer"><LuExternalLink size={13} /><span className="flex-1">{`Source page (${t.remote.provider})`}</span></a>}
            {t.attribution && t.license !== 'original' && <button type="button" role="menuitem" className="menu-item w-full" onClick={() => { void navigator.clipboard?.writeText(t.attribution!).catch(() => {}); setA(null); }}><LuCopy size={13} /><span className="flex-1">Copy attribution</span></button>}
            <button type="button" role="menuitem" className="menu-item w-full" onClick={() => void go('wav')}><span className="flex-1">WAV · 44.1 kHz 16-bit</span></button>
            <button type="button" role="menuitem" className="menu-item w-full" onClick={() => void go('mp3')}><span className="flex-1">MP3 · 256 kbps</span></button>
            <div className="px-2 py-1.5 text-[11px] text-faint leading-snug">{licenseOf(t.license).note}{t.attribution ? ` Attribution: ${t.attribution}` : ''}</div>
          </div>
        </Popover>
      )}
    </>
  );
}

function Row({ t, index, narrow }: { t: Track; index: number; narrow: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const current = useLib((s) => s.current === t.id);
  const playing = useLib((s) => s.current === t.id && s.playing);
  const loading = useLib((s) => s.loading === t.id);
  const time = useLib((s) => (s.current === t.id ? s.time : 0));
  const fav = useLib((s) => s.favorites.includes(t.id));
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { requestPeaks(t.id); io.disconnect(); } }, { rootMargin: '200px' });
    io.observe(el); return () => io.disconnect();
  }, [t.id]);
  const progress = current && t.duration ? time / t.duration : 0;
  return (
    <div ref={ref} role="listitem" aria-label={t.title} className="group flex items-center gap-2 sm:gap-3 px-3 sm:px-6 h-[64px] border-b transition-colors min-w-0"
      style={{ borderColor: '#191b21', background: current ? 'rgba(47,140,255,0.07)' : index % 2 ? '#0e0f13' : 'transparent' }}>
      <button type="button" className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-transform hover:scale-105"
        style={{ background: current ? C.orange : C.raised, color: current ? '#111' : C.ink, boxShadow: current ? '0 0 0 4px rgba(255,138,31,0.15)' : `inset 0 0 0 1px ${C.line}` }}
        aria-label={playing ? `Pause ${t.title}` : `Play ${t.title}`} onClick={() => void playTrack(t.id)}>
        {loading ? <LuLoaderCircle size={16} className="animate-spin" /> : playing ? <LuPause size={16} /> : <LuPlay size={16} className="ms-0.5" />}
      </button>
      <span className="hidden sm:inline-flex shrink-0"><Cover t={t} /></span>
      <div className="min-w-0 flex-1 sm:flex-none sm:w-[26%] lg:w-[22%] sm:shrink-0">
        <div className="text-[14px] font-semibold truncate" style={{ color: current ? '#fff' : C.ink }} translate="no">{t.title}</div>
        <div className="text-[12px] truncate" style={{ color: C.sub }}>{t.remote ? <><span translate="no">{t.categoryName}</span><span style={{ color: C.faint }} translate="no">{t.remote.creator ? ` · ${t.remote.creator}` : ''}</span></> : <>{t.categoryName}<span style={{ color: C.faint }}>{` · ${t.moods.slice(0, 2).join(', ')}`}</span></>}</div>
        <div className="sm:hidden mt-1" dir="ltr"><Wave t={t} height={12} bars={60} progress={progress} onSeek={(f) => void playTrack(t.id, f)} /></div>
      </div>
      <div className="hidden sm:block flex-1 min-w-[60px]" dir="ltr"><Wave t={t} progress={progress} onSeek={(f) => void playTrack(t.id, f)} /></div>
      <span className="text-[12px] num w-[42px] text-end shrink-0" style={{ color: C.sub }}>{t.duration ? fmt(t.duration) : '—'}</span>
      {!narrow && <span className="text-[12px] num w-[58px] shrink-0" style={{ color: C.faint }}>{t.bpm ? `${t.bpm} BPM` : '—'}</span>}
      {!narrow && <span className="text-[11px] w-[70px] shrink-0 hidden xl:inline" style={{ color: C.faint }}>{t.format}</span>}
      {!narrow && <span className="w-[150px] shrink-0 hidden lg:flex"><LicenseBadge t={t} /></span>}
      <button type="button" className="h-8 w-8 rounded-[8px] flex items-center justify-center shrink-0 hover:bg-white/5" aria-pressed={fav} aria-label={fav ? `Remove ${t.title} from favorites` : `Add ${t.title} to favorites`} data-tip={fav ? 'Remove from favorites' : 'Add to favorites'}
        style={{ color: fav ? '#ff5a7a' : C.sub }} onClick={() => { if (t.remote) keepOnline(t, !fav); toggleFavorite(t.id); }}><LuHeart size={16} fill={fav ? 'currentColor' : 'none'} /></button>
      <DownloadButton t={t} />
    </div>
  );
}

function PlayerBar({ list, narrow }: { list: Track[]; narrow: boolean }) {
  const s = useLib();
  const t = trackById(s.current);
  const step = (d: number) => { if (!t) { if (list[0]) void playTrack(list[0].id); return; } const i = list.findIndex((x) => x.id === t.id); const n = list[(i + d + list.length) % list.length]; if (n) void playTrack(n.id); };
  const fav = t ? s.favorites.includes(t.id) : false;
  const dur = s.duration || t?.duration || 0;
  return (
    <div className={`shrink-0 border-t px-3 sm:px-5 py-2.5 flex items-center gap-3 sm:gap-5 ${narrow ? 'flex-wrap gap-y-1.5' : ''}`} style={{ borderColor: C.line, background: 'linear-gradient(180deg,#16181e,#101115)', minHeight: 76 }} role="region" aria-label="Player">
      <div className="flex items-center gap-3 min-w-0" style={{ width: narrow ? 'auto' : 260 }}>
        {t ? <Cover t={t} size={46} /> : <span className="w-[46px] h-[46px] rounded-[8px] shrink-0" style={{ background: C.raised }} />}
        {!narrow && <div className="min-w-0">
          <div className="text-[14px] font-semibold truncate" translate={t ? 'no' : undefined}>{t ? t.title : 'Nothing playing'}</div>
          <div className="text-[12px] truncate" style={{ color: C.sub }}>{t ? `${t.categoryName}${t.bpm ? ` · ${t.bpm} BPM` : ''}` : 'Pick a track to preview it'}</div>
        </div>}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button type="button" className="h-9 w-9 rounded-full flex items-center justify-center hover:bg-white/5" style={{ color: C.sub }} aria-label="Previous" onClick={() => step(-1)}><LuSkipBack size={17} /></button>
        <button type="button" className="h-11 w-11 rounded-full flex items-center justify-center" style={{ background: C.orange, color: '#111', boxShadow: '0 6px 20px -6px rgba(255,138,31,.7)' }}
          aria-label={s.playing ? 'Pause' : 'Play'} onClick={() => (t ? togglePlay() : step(0))}>{s.loading ? <LuLoaderCircle size={19} className="animate-spin" /> : s.playing ? <LuPause size={19} /> : <LuPlay size={19} className="ms-0.5" />}</button>
        <button type="button" className="h-9 w-9 rounded-full flex items-center justify-center hover:bg-white/5" style={{ color: C.sub }} aria-label="Next" onClick={() => step(1)}><LuSkipForward size={17} /></button>
      </div>
      <div className={`flex-1 min-w-0 flex items-center gap-2.5 ${narrow ? 'order-first basis-full' : ''}`} dir="ltr">
        <span className="text-[12px] num w-[38px] text-end shrink-0" style={{ color: C.sub }}>{fmt(s.time)}</span>
        <div className="flex-1 min-w-0">{t ? <Wave t={t} height={narrow ? 28 : 40} bars={narrow ? 90 : 200} progress={dur ? s.time / dur : 0} onSeek={(f) => seek(f)} /> : <div className="h-[40px] rounded-[6px]" style={{ background: '#15171c' }} />}</div>
        <span className="text-[12px] num w-[38px] shrink-0" style={{ color: C.sub }}>{fmt(dur)}</span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button type="button" className="h-9 w-9 rounded-[8px] flex items-center justify-center hover:bg-white/5" aria-pressed={s.loop} aria-label="Loop" data-tip="Loop playback" style={{ color: s.loop ? C.blue : C.sub }} onClick={() => setLoop(!s.loop)}><LuRepeat size={16} /></button>
        <button type="button" className="h-9 w-9 rounded-[8px] flex items-center justify-center hover:bg-white/5" style={{ color: C.sub }} aria-label={s.volume ? 'Mute' : 'Unmute'} onClick={() => setVolume(s.volume ? 0 : 0.85)}>{s.volume ? <LuVolume2 size={16} /> : <LuVolumeX size={16} />}</button>
        {!narrow && <>
          <input type="range" className="slider w-[90px]" min={0} max={100} value={Math.round(s.volume * 100)} aria-label="Volume" style={{ ['--p' as string]: `${Math.round(s.volume * 100)}%` }} onChange={(e) => setVolume(Number(e.target.value) / 100)} />
        </>}
        {t && <button type="button" className="h-9 w-9 rounded-[8px] flex items-center justify-center hover:bg-white/5" aria-pressed={fav} aria-label="Favorite" style={{ color: fav ? '#ff5a7a' : C.sub }} onClick={() => toggleFavorite(t.id)}><LuHeart size={16} fill={fav ? 'currentColor' : 'none'} /></button>}
        {t && <DownloadButton t={t} big />}
      </div>
    </div>
  );
}

function OnlineNotice() {
  return (
    <div className="mx-4 sm:mx-6 my-3 px-3.5 py-2.5 rounded-[10px] text-[12px] leading-relaxed flex items-start gap-2.5" style={{ background: 'rgba(47,140,255,0.08)', color: C.sub, boxShadow: 'inset 0 0 0 1px rgba(47,140,255,0.25)' }}>
      <LuGlobe size={15} className="shrink-0 mt-0.5" style={{ color: '#7db7ff' }} />
      <span>Free sounds from Freesound, Jamendo, Wikimedia Commons and other open collections, found through Openverse. Each sound keeps its own licence: check the badge, credit the author when the licence asks for it (the attribution is copied when you download), and choose “Commercial use allowed” for paid work.</span>
    </div>
  );
}
function OnlineEmpty() {
  const o = useOnline();
  const f = useLib((s) => s.filters);
  if (o.loading) return <div className="h-[260px] flex items-center justify-center gap-2" style={{ color: C.sub }}><LuLoaderCircle size={18} className="animate-spin" />Searching online…</div>;
  return (
    <div className="min-h-[260px] flex flex-col items-center justify-center gap-3 text-center p-8" style={{ color: C.sub }}>
      <LuGlobe size={34} style={{ color: C.faint }} />
      <div className="text-[15px]" style={{ color: C.ink }}>{o.error ? 'The online search did not work' : 'No online sounds found'}</div>
      <div className="text-[13px] max-w-[460px]">{o.error ?? 'Try other (English) words, or another category.'}</div>
      {o.error && o.query && <button type="button" className="h-9 px-4 rounded-[8px] text-[13px] inline-flex items-center gap-2" style={{ background: C.raised, color: C.ink }} onClick={() => void searchOnline(o.query!)}><LuRefreshCw size={14} />Try again</button>}
      <a className="text-[13px] inline-flex items-center gap-1.5" style={{ color: '#7db7ff' }} target="_blank" rel="noopener noreferrer" href={`https://pixabay.com/${f.kind === 'music' ? 'music' : 'sound-effects'}/search/${encodeURIComponent(f.q || '')}`}><LuExternalLink size={13} />Look on Pixabay instead</a>
    </div>
  );
}
function OnlineMore() {
  const o = useOnline();
  if (!o.query) return null;
  if (o.loading) return <div className="h-14 flex items-center justify-center gap-2 text-[13px]" style={{ color: C.sub }}><LuLoaderCircle size={16} className="animate-spin" />Loading…</div>;
  if (o.error) return <div className="h-14 flex items-center justify-center gap-3 text-[13px]" style={{ color: C.sub }}>{o.error}<button type="button" className="underline" onClick={() => void searchOnline(o.query!, o.page + 1)}>Try again</button></div>;
  if (o.page >= o.pages) return <div className="h-12 flex items-center justify-center text-[12px]" style={{ color: C.faint }}>{`${o.results.length} of ${o.total} shown`}</div>;
  return <div className="h-16 flex items-center justify-center"><button type="button" className="h-9 px-5 rounded-[8px] text-[13px] font-semibold" style={{ background: C.raised, color: C.ink, boxShadow: `inset 0 0 0 1px ${C.line}` }} onClick={() => void searchOnline(o.query!, o.page + 1)}>Load more</button></div>;
}
