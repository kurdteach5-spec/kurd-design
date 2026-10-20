// Start page of SARWAR DESIGN: a dark landing page with soft violet / blue glows, glass cards and a pill
// navigation. It introduces the four sections (Design, Motion, Podcast, Mixer) and opens each one with a
// click or the keys 1–4. A thin kilim band keeps a Kurdish woven motif in the hero badge.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useWorkspace, setWorkspace, launcherOnStart, setLauncherOnStart, type Workspace } from '../../state/workspace';
import { useUI } from '../../state/uiStore';
import { LanguageMenu } from '../ui/LanguageMenu';
import { useLang } from '../../i18n';
import { Logo } from '../dialogs/EditDialogs';
import { pause as pauseMotion } from '../../motion/media/playback';
import { stopAll as stopPodcast } from '../../podcast/player';
import { LuImage, LuClapperboard, LuPodcast, LuSlidersVertical, LuLanguages, LuShieldCheck, LuWand, LuSmartphone, LuFilm, LuKeyboard, LuPlus, LuMinus, LuSparkles, LuUpload, LuScissors, LuSend } from 'react-icons/lu';

const BG = '#07070d';
const INK = '#f4f4f8';
const SUB = '#a1a1b5';
const GLASS = 'rgba(255,255,255,0.035)';
const EDGE = 'rgba(255,255,255,0.09)';
const GRAD = 'linear-gradient(135deg, #a78bfa 0%, #7c5cff 40%, #4f8cff 100%)';
const DISPLAY = '"Manrope", "Noto Kufi Arabic", Inter, sans-serif';

interface Section { id: Workspace; name: string; color: string; icon: ReactNode; line: string; points: string[]; art: ReactNode }

const ArtDesign = (
  <svg viewBox="0 0 240 132" className="w-full h-full" aria-hidden>
    <rect x="34" y="20" width="118" height="84" rx="4" fill="#2a3150" />
    <rect x="58" y="36" width="118" height="84" rx="4" fill="#323b60" opacity=".9" />
    <circle cx="150" cy="62" r="20" fill="#f2b233" />
    <path d="M70 108 C95 70 120 120 160 84" stroke="#efe8dc" strokeWidth="5" fill="none" strokeLinecap="round" />
    <rect x="128" y="40" width="44" height="44" fill="none" stroke="#f2b233" strokeWidth="1.5" strokeDasharray="4 3" />
    {[[128, 40], [172, 40], [128, 84], [172, 84]].map(([x, y]) => <rect key={`${x}${y}`} x={x - 3} y={y - 3} width="6" height="6" fill="#fff" />)}
    <text x="188" y="118" fill="#efe8dc" fontSize="22" fontWeight="700" fontFamily="Unbounded, Inter, sans-serif">Aa</text>
  </svg>
);
const ArtMotion = (
  <svg viewBox="0 0 240 132" className="w-full h-full" aria-hidden>
    <path d="M24 80 C64 20, 104 20, 136 60 S 200 104, 220 40" stroke="#2fae9c" strokeWidth="3" fill="none" />
    {[[24, 80], [92, 30], [136, 60], [220, 40]].map(([x, y]) => <rect key={x} x={x - 5} y={y - 5} width="10" height="10" transform={`rotate(45 ${x} ${y})`} fill="#efe8dc" />)}
    {[0, 1, 2].map((i) => <rect key={i} x="24" y={96 + i * 11} width="196" height="6" rx="3" fill="#262e48" />)}
    {[[60, 0], [110, 1], [170, 2], [84, 2]].map(([x, r]) => <rect key={`${x}${r}`} x={x - 3} y={96 + r * 11 - 1} width="7" height="7" transform={`rotate(45 ${x} ${96 + r * 11 + 2.5})`} fill="#2fae9c" />)}
    <rect x="140" y="88" width="2" height="40" fill="#d4573f" />
  </svg>
);
const ArtPodcast = (
  <svg viewBox="0 0 240 132" className="w-full h-full" aria-hidden>
    {[0, 1, 2].map((i) => (
      <g key={i} transform={`translate(${22 + i * 68} 14)`}>
        <rect width="60" height="40" rx="4" fill={['#3a2a3a', '#2a3346', '#26352f'][i]} stroke={i === 1 ? '#d4573f' : 'none'} strokeWidth="2.5" />
        <circle cx="30" cy="18" r="9" fill="#e7c4a0" />
        <rect x="18" y="28" width="24" height="12" rx="3" fill="#7a6a5c" />
      </g>
    ))}
    {Array.from({ length: 48 }, (_, i) => { const h = 4 + Math.abs(Math.sin(i * 0.9) * 14 + Math.sin(i * 0.37) * 8); return <rect key={i} x={22 + i * 4.2} y={86 - h / 2} width="2.4" height={h} rx="1" fill="#efe8dc" opacity=".75" />; })}
    {[[22, 50, '#6c8cff'], [72, 40, '#d4573f'], [112, 64, '#f2b233'], [176, 42, '#d4573f']].map(([x, w, c]) => <rect key={String(x)} x={Number(x)} y="108" width={Number(w)} height="12" rx="2" fill={String(c)} />)}
  </svg>
);
const ArtMixer = (
  <svg viewBox="0 0 240 132" className="w-full h-full" aria-hidden>
    {[0, 1, 2, 3].map((i) => <rect key={`p${i}`} x={22 + i * 40} y="26" width="34" height="24" rx="4" fill={i === 1 ? '#e5483b' : '#cfd3da'} />)}
    {[0, 1, 2, 3].map((i) => <rect key={`v${i}`} x={22 + i * 40} y="58" width="34" height="24" rx="4" fill={i === 2 ? '#2fbf6a' : '#cfd3da'} />)}
    <rect x="22" y="94" width="74" height="26" rx="5" fill="#f4f6f8" />
    <rect x="102" y="94" width="74" height="26" rx="5" fill="#cfd3da" />
    <text x="59" y="112" textAnchor="middle" fontSize="11" fontWeight="700" fill="#2a2b2d" fontFamily="Inter, sans-serif">CUT</text>
    <text x="139" y="112" textAnchor="middle" fontSize="11" fontWeight="700" fill="#2a2b2d" fontFamily="Inter, sans-serif">AUTO</text>
    <rect x="196" y="22" width="22" height="98" rx="4" fill="#0f1322" stroke="#3a4466" />
    <rect x="193" y="58" width="28" height="12" rx="3" fill="#cfd3da" />
  </svg>
);

const SECTIONS: Section[] = [
  { id: 'design', name: 'Design', color: '#f2b233', icon: <LuImage size={18} />, line: 'Photo editing and graphic design with layers.', points: ['Layers, masks, text and shapes', 'Filters and colour adjustments', 'Opens and saves PSD, PNG, JPG, PDF'], art: ArtDesign },
  { id: 'motion', name: 'Motion', color: '#2fae9c', icon: <LuClapperboard size={18} />, line: 'Animation and motion graphics on a timeline.', points: ['Keyframes with easing curves', 'Text, shapes, video and sound layers', 'Renders video and GIF'], art: ArtMotion },
  { id: 'podcast', name: 'Podcast', color: '#d4573f', icon: <LuPodcast size={18} />, line: 'Edits multicam podcasts and interviews for you.', points: ['Syncs every camera by sound', 'Cuts to whoever is speaking', 'Exports to Premiere and DaVinci'], art: ArtPodcast },
  { id: 'mixer', name: 'Mixer', color: '#7d9aff', icon: <LuSlidersVertical size={18} />, line: 'A live vision mixer for your cameras.', points: ['Program and preview, CUT and AUTO', 'Split screens, picture in picture, logos', 'Reels sizes and your own multiview'], art: ArtMixer },
];


/** a strip of kilim diamonds, the Kurdish woven motif */
function Kilim({ w = 84 }: { w?: number }) {
  const cols = ['#f2b233', '#2fae9c', '#d4573f', '#7d9aff'];
  return (
    <svg width={w} height="10" viewBox={`0 0 ${w} 10`} aria-hidden>
      {Array.from({ length: Math.floor(w / 10) }, (_, i) => <path key={i} d={`M${i * 10 + 5} 0 L${i * 10 + 10} 5 L${i * 10 + 5} 10 L${i * 10} 5 Z`} fill={cols[i % 4]} />)}
    </svg>
  );
}

function Glow({ className, color }: { className: string; color: string }) {
  return <div aria-hidden className={`absolute rounded-full pointer-events-none ${className}`} style={{ background: `radial-gradient(closest-side, ${color}, transparent)`, filter: 'blur(20px)' }} />;
}

function Pill({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center gap-2 h-8 px-3.5 rounded-full text-[12.5px] border" style={{ background: GLASS, borderColor: EDGE, color: '#d6d6e4', backdropFilter: 'blur(8px)' }}>{children}</span>;
}

function SectionHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="text-center max-w-[640px] mx-auto mb-10 sm:mb-14">
      <h2 className="m-0 text-[28px] sm:text-[40px] font-bold leading-[1.15] tracking-[-0.02em]" style={{ color: INK, fontFamily: DISPLAY }}>{title}</h2>
      <p className="mt-4 mb-0 text-[15px] leading-relaxed" style={{ color: SUB }}>{sub}</p>
    </div>
  );
}

const FORMATS = ['PSD', 'PNG', 'JPG', 'SVG', 'PDF', 'MP4', 'MOV', 'WebM', 'GIF', 'MP3', 'WAV', 'Premiere Pro', 'DaVinci Resolve', 'Final Cut XML', 'Reels', 'TikTok', 'YouTube Shorts', 'Instagram'];

const FEATURES: { icon: ReactNode; title: string; text: string }[] = [
  { icon: <LuLanguages size={20} />, title: 'Kurdish, Arabic and English', text: 'The whole app speaks Sorani Kurdish, Arabic and English — switch at any time.' },
  { icon: <LuShieldCheck size={20} />, title: 'Your files stay with you', text: 'Everything runs in your browser. Nothing is uploaded to a server.' },
  { icon: <LuWand size={20} />, title: 'An edit that listens', text: 'The podcast editor finds who speaks when and cuts to them, like a professional editor.' },
  { icon: <LuSmartphone size={20} />, title: 'Reels in one click', text: '9:16, 4:5, 1:1 and every other size, with the person kept in the centre.' },
  { icon: <LuFilm size={20} />, title: 'Ready for your editor', text: 'Send the edit to Premiere Pro or DaVinci Resolve, or render MP4, MOV, GIF and more.' },
  { icon: <LuKeyboard size={20} />, title: 'Fast on the keyboard', text: 'Every tool has a shortcut you can change, on any keyboard layout.' },
];

const STEPS: { icon: ReactNode; title: string; text: string }[] = [
  { icon: <LuUpload size={20} />, title: 'Add your files', text: 'Drop photos, videos, camera recordings or sound files into the section you opened.' },
  { icon: <LuScissors size={20} />, title: 'Design, edit or switch', text: 'Work with layers, animate on the timeline, let the podcast edit itself, or switch cameras live.' },
  { icon: <LuSend size={20} />, title: 'Export and share', text: 'Save a picture or render a video in the size of the platform you post on.' },
];

const FAQ: { q: string; a: string }[] = [
  { q: 'Is SARWAR DESIGN free?', a: 'Yes. Open it in the browser and start — there is nothing to install.' },
  { q: 'Do my photos and videos get uploaded?', a: 'No. Your files are opened and processed on your own computer, inside the browser.' },
  { q: 'Which browser works best?', a: 'Chrome or Edge on a computer. Video rendering uses the browser, so keep the tab open while it renders.' },
  { q: 'Can I continue my work in Premiere or DaVinci?', a: 'Yes. The Podcast and Mixer sections export an edit (XML and EDL) with the cuts, transitions and split screens.' },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-[16px] border" style={{ background: GLASS, borderColor: EDGE }}>
      <button type="button" className="w-full flex items-center gap-4 px-5 sm:px-6 py-5 text-start" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="flex-1 text-[15.5px] font-semibold" style={{ color: INK }}>{q}</span>
        <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 border" style={{ borderColor: EDGE, color: INK }}>{open ? <LuMinus size={15} /> : <LuPlus size={15} />}</span>
      </button>
      {open && <p className="m-0 px-5 sm:px-6 pb-5 text-[14px] leading-relaxed" style={{ color: SUB }}>{a}</p>}
    </div>
  );
}

export function Launcher() {
  const mode = useWorkspace((s) => s.mode);
  const [visited] = useState(() => { try { return !!localStorage.getItem('kurd-design-workspace'); } catch { return false; } });
  const last = visited ? mode : null;
  const [onStart, setOnStart] = useState(launcherOnStart());
  const rtl = useLang((s) => s.lang) !== 'en';
  const scroller = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const open = (id: Workspace) => {
    if (id !== 'motion') pauseMotion();
    if (id !== 'podcast' && id !== 'mixer') stopPodcast();
    if (id === 'design') useUI.setState({ showHome: true });
    setWorkspace(id);
  };
  // clicking a section spins its card in 3D, then the section opens
  const [spin, setSpin] = useState<Workspace | null>(null);
  const launch = (id: Workspace) => {
    if (spin) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { open(id); return; }
    setSpin(id);
    window.setTimeout(() => open(id), 950);
  };
  const tilt = (e: React.MouseEvent<HTMLElement>) => {
    if (spin) return;
    const el = e.currentTarget; const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty('--ry', `${(x * 14).toFixed(2)}deg`); el.style.setProperty('--rx', `${(-y * 12).toFixed(2)}deg`);
  };
  const untilt = (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.setProperty('--ry', '0deg'); e.currentTarget.style.setProperty('--rx', '0deg'); };
  const go = (anchor: string) => document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const launchRef = useRef(launch); launchRef.current = launch;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('[role="dialog"]')) return;
      const n = /^Digit[1-4]$/.test(e.code) ? Number(e.code.slice(-1)) : 0;
      if (n) { e.preventDefault(); launchRef.current(SECTIONS[n - 1].id); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  return (
    <div ref={scroller} dir={rtl ? 'rtl' : 'ltr'} className="kd-landing h-full overflow-y-auto overflow-x-hidden relative" style={{ background: BG, color: INK }} onScroll={() => setScrolled((scroller.current?.scrollTop ?? 0) > 12)}>
      {spin && <div aria-hidden className="kd-burst fixed inset-0 z-50 pointer-events-auto" style={{ background: `radial-gradient(circle at 50% 50%, ${SECTIONS.find((x) => x.id === spin)?.color}40, #07070d 65%)` }} />}
      {/* navigation */}
      <div className="sticky top-0 z-30 px-3 sm:px-6 pt-3">
        <nav className="max-w-[1180px] mx-auto h-14 rounded-full flex items-center gap-2 sm:gap-4 ps-4 pe-2 border transition-[background] duration-300"
          style={{ background: scrolled ? 'rgba(14,14,24,0.82)' : 'rgba(255,255,255,0.03)', borderColor: EDGE, backdropFilter: 'blur(14px)' }} aria-label="Start page">
          <Logo size={26} />
          <span className="font-extrabold tracking-[0.04em] text-[15px] whitespace-nowrap" style={{ fontFamily: DISPLAY }}>SARWAR DESIGN</span>
          <div className="flex-1" />
          <div className="hidden md:flex items-center gap-1 text-[13.5px]" style={{ color: SUB }}>
            {([['sections', 'Sections'], ['how', 'How it works'], ['features', 'Features'], ['faq', 'FAQ']] as const).map(([a, l]) => (
              <button key={a} type="button" className="h-9 px-3 rounded-full hover:text-white hover:bg-white/5" onClick={() => go(a)}>{l}</button>
            ))}
          </div>
          <div className="h-9 rounded-full overflow-hidden"><LanguageMenu /></div>
          <button type="button" className="h-10 px-4 sm:px-5 rounded-full text-[13.5px] font-semibold whitespace-nowrap" style={{ background: GRAD, color: '#fff', boxShadow: '0 8px 30px -8px rgba(124,92,255,.7)' }} onClick={() => go('sections')}>Get started</button>
        </nav>
      </div>

      {/* hero */}
      <section className="relative -mt-[68px] pt-[150px] sm:pt-[170px] pb-16 px-5 overflow-hidden">
        <div aria-hidden className="absolute inset-0 pointer-events-none" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px)', backgroundSize: '64px 64px', maskImage: 'radial-gradient(ellipse at 50% 30%, #000 20%, transparent 70%)', WebkitMaskImage: 'radial-gradient(ellipse at 50% 30%, #000 20%, transparent 70%)' }} />
        <Glow className="w-[720px] h-[520px] -top-[160px] left-1/2 -translate-x-1/2" color="rgba(124,92,255,0.45)" />
        <Glow className="w-[460px] h-[380px] top-[220px] -left-[120px]" color="rgba(79,140,255,0.28)" />
        <Glow className="w-[420px] h-[360px] top-[260px] -right-[120px]" color="rgba(212,87,63,0.18)" />
        <div className="relative max-w-[980px] mx-auto text-center kd-rise" dir={rtl ? 'rtl' : 'ltr'}>
          <Pill><Kilim w={44} /><span>A Kurdish creative studio in your browser</span></Pill>
          <h1 className="mt-7 mb-0 font-extrabold leading-[1.05] tracking-[-0.035em] text-[40px] sm:text-[64px] lg:text-[76px]" style={{ fontFamily: DISPLAY, backgroundImage: 'linear-gradient(180deg, #ffffff 30%, #b9b3d9 100%)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>
            Design, animate, edit and go live.
          </h1>
          <p className="mt-6 mb-0 mx-auto max-w-[620px] text-[16px] sm:text-[18px] leading-relaxed" style={{ color: SUB }}>Four studios in one place: photo design, motion graphics, an automatic podcast editor and a live vision mixer — in Kurdish, Arabic and English.</p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <button type="button" className="h-12 px-7 rounded-full text-[15px] font-semibold" style={{ background: GRAD, color: '#fff', boxShadow: '0 12px 40px -10px rgba(124,92,255,.8)' }} onClick={() => go('sections')}>Choose a section</button>
            {last && <button type="button" className="h-12 px-7 rounded-full text-[15px] font-semibold border hover:bg-white/5" style={{ borderColor: 'rgba(255,255,255,.18)', color: INK }} onClick={() => launch(last)}>{`Continue in ${SECTIONS.find((x) => x.id === last)?.name ?? ''}`}</button>}
          </div>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-2.5">
            {SECTIONS.map((s) => <Pill key={s.id}><span style={{ color: s.color }}>{s.icon}</span><span>{s.name}</span></Pill>)}
          </div>
        </div>
        {/* floating interface cards */}
        <div className="relative max-w-[1180px] mx-auto mt-14 sm:mt-16 grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5" style={{ perspective: '1200px' }}>
          {SECTIONS.map((s, i) => (
            <div key={s.id} style={{ transform: `rotateX(8deg) translateY(${i % 2 ? 18 : 0}px)`, transformStyle: 'preserve-3d' }}>
              <button type="button" aria-label={`Open ${s.name}`} onClick={() => launch(s.id)} onMouseMove={tilt} onMouseLeave={untilt}
                className={`block w-full rounded-[20px] p-[1px] kd-tilt ${spin === s.id ? 'kd-spin3d' : spin ? 'kd-dim' : 'kd-float'}`}
                style={{ background: `linear-gradient(160deg, ${s.color}66, rgba(255,255,255,.06) 40%, rgba(255,255,255,.03))`, animationDelay: spin ? '0s' : `${i * 0.6}s`, ['--glow' as string]: s.color }}>
                <div className="rounded-[19px] h-[130px] sm:h-[150px] px-2 pt-2" style={{ background: 'linear-gradient(180deg, #14142a, #0c0c18)' }}>{s.art}</div>
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* format marquee */}
      <section className="py-10 border-y" style={{ borderColor: 'rgba(255,255,255,.06)' }} aria-label="Formats and platforms">
        <p className="text-center text-[13px] mb-6 mt-0" style={{ color: SUB }}>Works with the formats and platforms you already use</p>
        <div className="relative overflow-hidden" style={{ maskImage: 'linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)', WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)' }} dir="ltr">
          <div className="kd-marquee flex gap-10 w-max">
            {[...FORMATS, ...FORMATS].map((f, i) => <span key={i} className="text-[18px] font-bold whitespace-nowrap" style={{ color: 'rgba(255,255,255,.42)', fontFamily: DISPLAY }} translate="no">{f}</span>)}
          </div>
        </div>
      </section>

      <div dir={rtl ? 'rtl' : 'ltr'}>
        {/* sections */}
        <section id="sections" className="relative py-20 sm:py-28 px-5 scroll-mt-20">
          <Glow className="w-[620px] h-[420px] top-[120px] left-1/2 -translate-x-1/2" color="rgba(124,92,255,0.16)" />
          <SectionHead title="Choose where to start" sub="Every section is a full studio. Switch between them at any time from the top bar — the logo brings you back here." />
          <div className="relative max-w-[1180px] mx-auto grid gap-5 grid-cols-1 sm:grid-cols-2" style={{ perspective: '1600px' }}>
            {SECTIONS.map((s, i) => (
              <button key={s.id} type="button" onClick={() => launch(s.id)} aria-label={`Open ${s.name}`} onMouseMove={tilt} onMouseLeave={untilt}
                className={`group relative text-start rounded-[22px] border overflow-hidden flex flex-col sm:flex-row kd-tilt ${spin === s.id ? 'kd-spin3d' : spin ? 'kd-dim' : ''}`}
                style={{ background: GLASS, borderColor: last === s.id || spin === s.id ? `${s.color}aa` : EDGE, ['--glow' as string]: s.color }}>
                <div aria-hidden className="absolute -top-24 -end-24 w-72 h-72 rounded-full opacity-40 group-hover:opacity-70 transition-opacity duration-300" style={{ background: `radial-gradient(closest-side, ${s.color}55, transparent)` }} />
                <div className="relative sm:w-[46%] h-[170px] sm:h-auto p-3 sm:p-4 shrink-0" dir="ltr"><div className="h-full rounded-[14px] border" style={{ borderColor: EDGE, background: 'linear-gradient(180deg, #14142a, #0c0c18)' }}>{s.art}</div></div>
                <div className="relative flex-1 flex flex-col gap-3 p-6 sm:ps-2">
                  <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-[12px] flex items-center justify-center border" style={{ background: `${s.color}1f`, borderColor: `${s.color}55`, color: s.color }}>{s.icon}</span>
                    <span className="text-[22px] font-bold" style={{ fontFamily: DISPLAY }}>{s.name}</span>
                    {last === s.id && <span className="text-[11.5px] font-semibold px-2.5 py-[3px] rounded-full" style={{ background: `${s.color}26`, color: s.color }}>Continue</span>}
                    <kbd className="ms-auto text-[12px] w-7 h-7 rounded-[8px] border flex items-center justify-center num" style={{ borderColor: EDGE, color: SUB }} aria-hidden>{i + 1}</kbd>
                  </div>
                  <p className="m-0 text-[14.5px] leading-snug" style={{ color: '#d6d6e4' }}>{s.line}</p>
                  <ul className="m-0 p-0 list-none flex flex-col gap-2">
                    {s.points.map((pt) => <li key={pt} className="flex items-start gap-2.5 text-[13.5px] leading-snug" style={{ color: SUB }}><span className="mt-[6px] w-[7px] h-[7px] rotate-45 shrink-0" style={{ background: s.color }} aria-hidden />{pt}</li>)}
                  </ul>
                  <span className="mt-auto pt-2 inline-flex">
                    <span className="inline-flex items-center justify-center h-10 px-5 rounded-full text-[13.5px] font-semibold transition-[filter] group-hover:brightness-110" style={{ background: s.color, color: '#0b0b14' }}>{`Open ${s.name}`}</span>
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* how it works: a real sequence */}
        <section id="how" className="py-20 sm:py-24 px-5 scroll-mt-20">
          <SectionHead title="From your files to a finished video in three steps" sub="The same simple path in every section." />
          <ol className="max-w-[1180px] mx-auto m-0 p-0 list-none grid gap-5 grid-cols-1 md:grid-cols-3">
            {STEPS.map((st, i) => (
              <li key={st.title} className="relative rounded-[22px] border p-7" style={{ background: GLASS, borderColor: EDGE }}>
                <div className="flex items-center gap-3 mb-5">
                  <span className="w-11 h-11 rounded-full flex items-center justify-center text-[15px] font-bold num" style={{ background: GRAD, color: '#fff' }}>{i + 1}</span>
                  <span className="w-11 h-11 rounded-[12px] flex items-center justify-center border" style={{ borderColor: EDGE, color: '#c4b5fd' }}>{st.icon}</span>
                </div>
                <h3 className="m-0 text-[19px] font-bold" style={{ fontFamily: DISPLAY }}>{st.title}</h3>
                <p className="mt-2.5 mb-0 text-[14px] leading-relaxed" style={{ color: SUB }}>{st.text}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* features */}
        <section id="features" className="relative py-20 sm:py-24 px-5 scroll-mt-20">
          <Glow className="w-[560px] h-[400px] top-[160px] -left-[160px]" color="rgba(79,140,255,0.14)" />
          <SectionHead title="Made for creators who work in Kurdish" sub="Professional tools, built to be simple." />
          <div className="relative max-w-[1180px] mx-auto grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-[22px] border p-7" style={{ background: GLASS, borderColor: EDGE }}>
                <span className="w-11 h-11 rounded-[12px] flex items-center justify-center border mb-5" style={{ borderColor: 'rgba(167,139,250,.35)', background: 'rgba(124,92,255,.12)', color: '#c4b5fd' }}>{f.icon}</span>
                <h3 className="m-0 text-[17.5px] font-bold" style={{ fontFamily: DISPLAY }}>{f.title}</h3>
                <p className="mt-2.5 mb-0 text-[14px] leading-relaxed" style={{ color: SUB }}>{f.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* questions */}
        <section id="faq" className="py-20 sm:py-24 px-5 scroll-mt-20">
          <SectionHead title="Questions" sub="Short answers to what people ask first." />
          <div className="max-w-[820px] mx-auto flex flex-col gap-3">{FAQ.map((f) => <FaqItem key={f.q} q={f.q} a={f.a} />)}</div>
        </section>

        {/* closing call */}
        <section className="px-5 pb-20">
          <div className="relative max-w-[1180px] mx-auto rounded-[28px] border overflow-hidden text-center px-6 py-16 sm:py-20" style={{ borderColor: 'rgba(167,139,250,.25)', background: 'linear-gradient(180deg, rgba(124,92,255,.16), rgba(79,140,255,.05))' }}>
            <Glow className="w-[620px] h-[360px] -top-[120px] left-1/2 -translate-x-1/2" color="rgba(124,92,255,0.45)" />
            <div className="relative">
              <LuSparkles size={28} className="mx-auto" style={{ color: '#c4b5fd' }} />
              <h2 className="mt-5 mb-0 text-[28px] sm:text-[44px] font-extrabold tracking-[-0.03em] leading-[1.1]" style={{ fontFamily: DISPLAY }}>Start your next project now.</h2>
              <p className="mt-4 mb-0 text-[15.5px]" style={{ color: SUB }}>Nothing to install, no account needed.</p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                {SECTIONS.map((s) => (
                  <button key={s.id} type="button" className="h-11 px-5 rounded-full text-[14px] font-semibold inline-flex items-center gap-2 border hover:bg-white/10" style={{ borderColor: 'rgba(255,255,255,.16)', color: INK, background: 'rgba(255,255,255,.04)' }} onClick={() => launch(s.id)}>
                    <span style={{ color: s.color }}>{s.icon}</span>{s.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* footer */}
        <footer className="border-t px-5 py-10" style={{ borderColor: 'rgba(255,255,255,.06)' }}>
          <div className="max-w-[1180px] mx-auto flex flex-wrap items-center gap-x-8 gap-y-4 text-[13px]" style={{ color: SUB }}>
            <div className="flex items-center gap-2.5"><Logo size={22} /><span className="font-bold" style={{ color: INK, fontFamily: DISPLAY }}>SARWAR DESIGN</span><Kilim w={44} /></div>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 accent-[#7c5cff]" checked={onStart} onChange={(e) => { setOnStart(e.target.checked); setLauncherOnStart(e.target.checked); }} />
              <span>Show this page when the site opens</span>
            </label>
            <span>Press 1, 2, 3 or 4 to open a section.</span>
            <span className="ms-auto">Your files stay on your computer: everything runs in the browser.</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
