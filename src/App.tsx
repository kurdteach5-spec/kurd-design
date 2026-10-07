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
import { useWorkspace, setWorkspace, isMotion } from './state/workspace';
import { MotionWorkspace } from './motion/ui/MotionWorkspace';
import { MotionMenuBar } from './motion/ui/MotionMenuBar';
import { importFiles as importMotionFiles } from './motion/actions';
import { pause as pauseMotion } from './motion/media/playback';
import { LuImage, LuClapperboard } from 'react-icons/lu';
import { useUI } from './state/uiStore';
import { useDocuments } from './state/documentStore';
import { installKeyboard } from './shortcuts/keyboard';
import { handlePasteEvent } from './editor/editActions';
import { startAutosave, checkRecovery, importAsLayers, openFiles } from './editor/fileActions';
import { initFonts } from './utils/fonts';
import { isEditable } from './shortcuts/keyboard';

export function App() {
  const showHome = useUI((s) => s.showHome);
  const hasDocs = useDocuments((s) => s.order.length > 0);
  const home = showHome || !hasDocs;
  const mode = useWorkspace((s) => s.mode);

  useEffect(() => {
    initFonts();
    const offKeys = installKeyboard();
    const paste = (e: ClipboardEvent) => { if (isMotion() || isEditable(e.target) || useUI.getState().dialog) return; void handlePasteEvent(e); };
    window.addEventListener('paste', paste);
    // dropping files on the home screen / anywhere outside the canvas
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); if (!useUI.getState().dropActive) useUI.setState({ dropActive: true }); } };
    const drop = (e: DragEvent) => {
      if (e.defaultPrevented) return; // already handled by the canvas
      e.preventDefault(); useUI.setState({ dropActive: false });
      const files = [...(e.dataTransfer?.files ?? [])]; if (!files.length) return;
      if (isMotion()) { void importMotionFiles(files); return; }
      if (useUI.getState().showHome || !useDocuments.getState().order.length) void openFiles(files); else void importAsLayers(files);
    };
    const leave = (e: DragEvent) => { if (!e.relatedTarget) useUI.setState({ dropActive: false }); };
    window.addEventListener('dragover', over); window.addEventListener('drop', drop); window.addEventListener('dragleave', leave);
    startAutosave();
    void checkRecovery();
    const onResize = () => { if (window.innerWidth < 1100 && useUI.getState().sidebarMode === 'docked') useUI.setState({ sidebarMode: 'rail' }); };
    window.addEventListener('resize', onResize);
    const ctx = (e: MouseEvent) => { if (!isEditable(e.target)) e.preventDefault(); };
    window.addEventListener('contextmenu', ctx);
    return () => { offKeys(); window.removeEventListener('paste', paste); window.removeEventListener('dragover', over); window.removeEventListener('drop', drop); window.removeEventListener('dragleave', leave); window.removeEventListener('resize', onResize); window.removeEventListener('contextmenu', ctx); };
  }, []);

  return (
    <div className="h-full grid" style={{ gridTemplateRows: '32px 36px 1fr 24px' }}>
      <header className="flex items-center gap-2 px-2 bg-panel border-b border-line">
        <button type="button" className="flex items-center gap-2 pe-2 shrink-0" onClick={() => useUI.setState({ showHome: true })} aria-label="KURD DESIGN home" data-tip="Home">
          <Logo size={20} /><span className="font-bold text-ink-strong hidden sm:inline tracking-[0.06em]">KURD <span className="text-accent">DESIGN</span></span>
        </button>
        <div className="flex items-center rounded-[6px] border border-line overflow-hidden shrink-0 mx-1" role="radiogroup" aria-label="Workspace">
          <button type="button" role="radio" aria-checked={mode === 'design'} className={`h-[24px] px-2.5 text-xs inline-flex items-center gap-1.5 ${mode === 'design' ? 'bg-accent text-white' : 'text-muted hover:text-ink hover:bg-hover'}`} onClick={() => { pauseMotion(); setWorkspace('design'); }} data-tip="Photo editing & graphic design"><LuImage size={13} />Design</button>
          <button type="button" role="radio" aria-checked={mode === 'motion'} className={`h-[24px] px-2.5 text-xs inline-flex items-center gap-1.5 ${mode === 'motion' ? 'bg-accent text-white' : 'text-muted hover:text-ink hover:bg-hover'}`} onClick={() => setWorkspace('motion')} data-tip="Motion graphics, animation & video"><LuClapperboard size={13} />Motion</button>
        </div>
        <div className="h-full py-[3px] min-w-0">{mode === 'motion' ? <MotionMenuBar /> : <MenuBar />}</div>
        <div className="ms-auto h-full shrink-0"><LanguageMenu /></div>
      </header>
      {mode === 'motion' ? <div className="min-h-0 min-w-0" style={{ gridRow: '2 / 5' }}><MotionWorkspace /></div> : <>
      <div className="bg-panel border-b border-line min-w-0">
        {home ? <div className="h-full flex items-center px-3 text-muted">Create or open a document to start editing.</div> : <ErrorBoundary label="options bar"><OptionsBar /></ErrorBoundary>}
      </div>
      <main className="flex min-h-0 min-w-0">
        <div className="w-[42px] shrink-0 bg-panel border-e border-line"><Toolbox /></div>
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
      <footer className="bg-panel border-t border-line min-w-0"><StatusBar /></footer>
      </>}
      <DialogHost />
      <Toasts />
      <TooltipHost />
    </div>
  );
}
