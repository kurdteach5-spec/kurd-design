import { useEffect } from 'react';
import { MenuBar } from './components/editor/MenuBar';
import { OptionsBar } from './components/editor/OptionsBar';
import { Toolbox } from './components/editor/Toolbox';
import { Viewport } from './components/editor/Viewport';
import { Sidebar } from './components/editor/Sidebar';
import { DocumentTabs, StatusBar, Toasts, ErrorBoundary, SmartContentsBar } from './components/editor/Chrome';
import { HomeScreen } from './components/editor/HomeScreen';
import { DialogHost } from './components/dialogs/DialogHost';
import { Logo } from './components/dialogs/EditDialogs';
import { TooltipHost } from './components/ui/controls';
import { LanguageMenu } from './components/ui/LanguageMenu';
import { useWorkspace, isMotion, isPodcast, isDesign, isMixer, openLauncher } from './state/workspace';
import { Launcher } from './components/launcher/Launcher';
import { PodcastWorkspace } from './podcast/ui/PodcastWorkspace';
import { MixerWorkspace } from './podcast/ui/mixer/MixerWorkspace';
import { ShortcutsDialog } from './podcast/ui/ShortcutsDialog';
import { addMedia } from './podcast/mixer';
import { addPodcastFiles } from './podcast/store';
import { stopAll as stopPodcast } from './podcast/player';
import { MotionWorkspace } from './motion/ui/MotionWorkspace';
import { MotionMenuBar } from './motion/ui/MotionMenuBar';
import { importFiles as importMotionFiles } from './motion/actions';
import { pause as pauseMotion } from './motion/media/playback';
import { LuImage, LuClapperboard, LuPodcast, LuSlidersVertical, LuLayoutGrid, LuAudioLines, LuNewspaper } from 'react-icons/lu';
import { PostsWorkspace } from './posts/ui/PostsWorkspace';
import { startPolling } from './posts/poller';
import { LibraryWorkspace } from './library/ui/LibraryWorkspace';
import { stopLibrary } from './library/audio';
import { useUI } from './state/uiStore';
import { useDocuments } from './state/documentStore';
import { installKeyboard } from './shortcuts/keyboard';
import { handlePasteEvent } from './editor/editActions';
import { startAutosave, checkRecovery, importAsLayers, openFiles } from './editor/fileActions';
import { initFonts } from './utils/fonts';
import { isEditable } from './shortcuts/keyboard';

const WORKSPACES = [
  { id: 'design', label: 'Design', short: 'Design', color: '#f2b233', Icon: LuImage, tip: 'Photo editing & graphic design' },
  { id: 'motion', label: 'Motion', short: 'Motion', color: '#2fae9c', Icon: LuClapperboard, tip: 'Motion graphics, animation & video' },
  { id: 'podcast', label: 'Podcast', short: 'Podcast', color: '#e2674f', Icon: LuPodcast, tip: 'Multicam podcast & interview editing' },
  { id: 'mixer', label: 'Vision Mixer', short: 'Mixer', color: '#7d9aff', Icon: LuSlidersVertical, tip: 'Live vision mixer (switcher) for the podcast cameras' },
  { id: 'library', label: 'Sound Library', short: 'Sounds', color: '#ff8a1f', Icon: LuAudioLines, tip: 'Background music and sound effects' },
  { id: 'posts', label: 'Auto Posts', short: 'Posts', color: '#ff4d6d', Icon: LuNewspaper, tip: 'Turns the posts of profiles you follow into your designs' },
] as const;

export function App() {
  const showHome = useUI((s) => s.showHome);
  const hasDocs = useDocuments((s) => s.order.length > 0);
  const home = showHome || !hasDocs;
  const mode = useWorkspace((s) => s.mode);
  const launcher = useWorkspace((s) => s.launcher);

  useEffect(() => {
    initFonts();
    const offKeys = installKeyboard();
    const paste = (e: ClipboardEvent) => { if (!isDesign() || isEditable(e.target) || useUI.getState().dialog) return; void handlePasteEvent(e); };
    window.addEventListener('paste', paste);
    // dropping files on the home screen / anywhere outside the canvas
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); if (!useUI.getState().dropActive) useUI.setState({ dropActive: true }); } };
    const drop = (e: DragEvent) => {
      if (e.defaultPrevented) return; // already handled by the canvas
      e.preventDefault(); useUI.setState({ dropActive: false });
      const files = [...(e.dataTransfer?.files ?? [])]; if (!files.length) return;
      if (isMotion()) { void importMotionFiles(files); return; }
      if (isPodcast()) { void addPodcastFiles(files); return; }
      if (isMixer()) { const img = files.filter((f) => f.type.startsWith('image/')); if (img.length) void addMedia(img); const rest = files.filter((f) => !f.type.startsWith('image/')); if (rest.length) void addPodcastFiles(rest); return; }
      if (useUI.getState().showHome || !useDocuments.getState().order.length) void openFiles(files); else void importAsLayers(files);
    };
    const leave = (e: DragEvent) => { if (!e.relatedTarget) useUI.setState({ dropActive: false }); };
    window.addEventListener('dragover', over); window.addEventListener('drop', drop); window.addEventListener('dragleave', leave);
    startAutosave();
    void startPolling();
    void checkRecovery();
    const onResize = () => { if (window.innerWidth < 1100 && useUI.getState().sidebarMode === 'docked') useUI.setState({ sidebarMode: 'rail' }); };
    window.addEventListener('resize', onResize);
    const ctx = (e: MouseEvent) => { if (!isEditable(e.target)) e.preventDefault(); };
    window.addEventListener('contextmenu', ctx);
    return () => { offKeys(); window.removeEventListener('paste', paste); window.removeEventListener('dragover', over); window.removeEventListener('drop', drop); window.removeEventListener('dragleave', leave); window.removeEventListener('resize', onResize); window.removeEventListener('contextmenu', ctx); };
  }, []);

  if (launcher) {
    return (
      <div className="h-full">
        <Launcher />
        <DialogHost />
        <Toasts />
        <TooltipHost />
      </div>
    );
  }
  return (
    <div className="h-full grid" style={{ gridTemplateRows: '34px 36px minmax(0, 1fr) 24px', gridTemplateColumns: 'minmax(0, 1fr)' }}>
      <header className="flex items-center gap-1 sm:gap-2 px-1.5 sm:px-2 bg-panel border-b border-line min-w-0 overflow-hidden">
        <button type="button" className="flex items-center gap-2 pe-1 xl:pe-2 shrink-0" onClick={() => { pauseMotion(); stopPodcast(); stopLibrary(); openLauncher(); }} aria-label="SARWAR DESIGN start screen" data-tip="Start screen: all sections">
          <Logo size={20} /><span className="font-bold text-ink-strong hidden xl:inline tracking-[0.06em] whitespace-nowrap">SARWAR <span className="text-accent">DESIGN</span></span>
        </button>
        {(() => { const w = WORKSPACES.find((x) => x.id === mode)!; return (
          <>
            <button type="button" className="h-[24px] px-2.5 rounded-full text-xs inline-flex items-center gap-1.5 shrink-0 border border-line text-muted hover:text-ink hover:bg-hover"
              onClick={() => { pauseMotion(); stopPodcast(); stopLibrary(); openLauncher(); }} data-tip="Back to the start page to open another section" aria-label="All sections">
              <LuLayoutGrid size={13} /><span className="hidden sm:inline">All sections</span>
            </button>
            <span className="h-[24px] px-2.5 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 mx-1" style={{ background: `${w.color}22`, color: w.color, boxShadow: `inset 0 0 0 1px ${w.color}55` }} aria-label={`Section: ${w.label}`}>
              <w.Icon size={13} /><span>{w.label}</span>
            </span>
          </>
        ); })()}
        <div className="h-full py-[3px] min-w-0 flex-1 overflow-x-auto overflow-y-hidden no-scrollbar">{mode === 'motion' ? <MotionMenuBar /> : mode === 'podcast' ? <div className="h-full hidden md:flex items-center px-2 text-xs text-muted whitespace-nowrap">Multicam podcast editor · automatic cuts</div> : mode === 'mixer' ? <div className="h-full hidden md:flex items-center px-2 text-xs text-muted whitespace-nowrap">Vision mixer · live switching, keys, SuperSource, multiview</div> : mode === 'library' ? <div className="h-full hidden md:flex items-center px-2 text-xs text-muted whitespace-nowrap">Background music & sound effects · preview, search, download</div> : mode === 'posts' ? <div className="h-full hidden md:flex items-center px-2 text-xs text-muted whitespace-nowrap">Follow profiles · every new post becomes your design</div> : <MenuBar />}</div>
        <div className="h-full shrink-0"><LanguageMenu /></div>
      </header>
      {mode === 'posts' ? <div className="min-h-0 min-w-0" style={{ gridRow: '2 / 5' }}><ErrorBoundary label="auto posts"><PostsWorkspace /></ErrorBoundary></div> : mode === 'library' ? <div className="min-h-0 min-w-0" style={{ gridRow: '2 / 5' }}><ErrorBoundary label="sound library"><LibraryWorkspace /></ErrorBoundary></div> : mode === 'podcast' ? <div className="min-h-0 min-w-0" style={{ gridRow: '2 / 5' }}><PodcastWorkspace /></div> : mode === 'mixer' ? <div className="min-h-0 min-w-0" style={{ gridRow: '2 / 5' }}><MixerWorkspace /></div> : mode === 'motion' ? <div className="min-h-0 min-w-0" style={{ gridRow: '2 / 5' }}><MotionWorkspace /></div> : <>
      <div className="bg-panel border-b border-line min-w-0 overflow-x-auto overflow-y-hidden no-scrollbar">
        {home ? <div className="h-full flex items-center px-3 text-muted">Create or open a document to start editing.</div> : <ErrorBoundary label="options bar"><OptionsBar /></ErrorBoundary>}
      </div>
      <main className="flex min-h-0 min-w-0">
        <div className="w-[42px] shrink-0 bg-panel border-e border-line min-h-0"><Toolbox /></div>
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="h-[30px] shrink-0 bg-panel border-b border-line px-1 flex items-end"><DocumentTabs /></div>
          {!home && <SmartContentsBar />}
          <div className="relative flex-1 min-h-0">
            <ErrorBoundary label="canvas"><Viewport /></ErrorBoundary>
            {home && <HomeScreen />}
          </div>
        </div>
        <ErrorBoundary label="panels"><Sidebar /></ErrorBoundary>
      </main>
      <footer className="bg-panel border-t border-line min-w-0 overflow-hidden"><StatusBar /></footer>
      </>}
      <DialogHost />
      <ShortcutsDialog />
      <Toasts />
      <TooltipHost />
    </div>
  );
}
