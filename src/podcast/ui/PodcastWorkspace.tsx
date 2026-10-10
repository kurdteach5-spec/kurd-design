import { useEffect } from 'react';
import { SetupPanel } from './SetupPanel';
import { installShortcuts } from './shortcuts';
import { ConvertStatus } from './ConvertStatus';
import { Monitors, Transport } from './Monitors';
import { PodTimeline } from './PodTimeline';
import { usePod } from '../store';
import { setWorkspace } from '../../state/workspace';
import { ShortcutsButton } from './ShortcutsDialog';
import { ErrorBoundary } from '../../components/editor/Chrome';
import { useWindowSize } from '../../utils/useWindowSize';
import { create } from '../../state/createStore';
import { LuSettings2, LuX, LuSlidersVertical } from 'react-icons/lu';

const useDrawer = create<{ open: boolean }>(() => ({ open: false }));

/**
 * Podcast workspace: setup on the left (docked on wide screens, a drawer on small ones), program and camera
 * monitors in the middle, the multicam timeline at the bottom.
 */
export function PodcastWorkspace() {
  const { w, h } = useWindowSize();
  const drawer = useDrawer((s) => s.open);
  useEffect(() => { installShortcuts(); }, []);
  const dock = w >= 1100;
  const vertical = w < 900;
  const voices = usePod((s) => s.analysis?.speakers.length ?? s.speakers.length);
  const tlH = Math.max(150, Math.min(36 + 22 + 44 + 38 + 22 + voices * 28 + 18, h - 32 - 240));
  const panelW = w >= 1500 ? 340 : 310;
  return (
    <div className="h-full flex flex-col min-h-0 min-w-0">
      <div className="flex-1 min-h-0 flex relative">
        {dock && <aside className="shrink-0 bg-panel border-e border-line overflow-y-auto overflow-x-hidden" style={{ width: panelW }} aria-label="Podcast setup"><ErrorBoundary label="setup"><SetupPanel /></ErrorBoundary></aside>}
        <main className="flex-1 min-w-0 flex flex-col min-h-0">
          <div className="h-9 shrink-0 flex items-center gap-2 px-2 bg-panel border-b border-line overflow-x-auto no-scrollbar">
            {!dock && (
              <button type="button" className={`h-[28px] px-2.5 rounded-[5px] inline-flex items-center gap-1.5 text-xs shrink-0 ${drawer ? 'bg-accent text-white' : 'text-ink hover:bg-hover border border-line'}`} aria-pressed={drawer} onClick={() => useDrawer.setState({ open: !drawer })}>
                <LuSettings2 size={14} /><span>Setup & export</span>
              </button>
            )}
            <button type="button" className="h-[28px] px-2.5 rounded-[5px] inline-flex items-center gap-1.5 text-xs shrink-0 text-ink hover:bg-hover border border-line" onClick={() => setWorkspace('mixer')} data-tip="Open the vision mixer (live switching with the same cameras)">
              <LuSlidersVertical size={14} /><span>Vision mixer</span>
            </button>
            <div className="flex-1" />
            <ConvertStatus />
            <ShortcutsButton />
          </div>
          <div className="flex-1 min-h-0"><ErrorBoundary label="monitors"><Monitors vertical={vertical} /></ErrorBoundary></div>
          <Transport />
        </main>
        {!dock && drawer && (
          <>
            <div className="absolute inset-0 z-30 bg-black/40" onClick={() => useDrawer.setState({ open: false })} aria-hidden />
            <aside className="absolute top-0 bottom-0 start-0 z-40 bg-panel border-e border-line flex flex-col shadow-[0_16px_40px_rgba(0,0,0,.55)]" style={{ width: Math.min(360, w - 40) }} aria-label="Podcast setup">
              <div className="h-[30px] shrink-0 flex items-center px-3 border-b border-line-soft bg-[#202328]"><span className="flex-1 text-xs font-medium text-ink-strong">Setup & export</span><button type="button" className="icon-btn" aria-label="Close panel" onClick={() => useDrawer.setState({ open: false })}><LuX size={14} /></button></div>
              <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden"><ErrorBoundary label="setup"><SetupPanel /></ErrorBoundary></div>
            </aside>
          </>
        )}
      </div>
      <div className="shrink-0 border-t border-line" style={{ height: tlH }}><ErrorBoundary label="timeline"><PodTimeline /></ErrorBoundary></div>
    </div>
  );
}
