// One render at a time, started from the Mixer (Render button, RENDER) or the Podcast export — progress
// shared by all of them. The browser records MP4 or WebM; other formats are converted afterwards.
import { create } from '../state/createStore';
import { usePod } from './store';
import { renderProgram } from './render';
import { convertRender, RENDER_FORMATS, type RenderFormat } from './ffmpeg';
import { saveBlob } from '../file-system/exporters';
import { toast, toastError } from '../state/uiStore';

export const useRenderJob = create<{ p: number | null; stage: string; cancel: (() => void) | null; last: { blob: Blob; name: string } | null }>(() => ({ p: null, stage: '', cancel: null, last: null }));

export async function startRender(format: RenderFormat = usePod.getState().renderFormat) {
  if (useRenderJob.getState().p !== null) return;
  if (!usePod.getState().segments.length) { toastError('Add cameras first.'); return; }
  const signal = { cancelled: false };
  useRenderJob.setState({ p: 0, stage: 'Rendering', cancel: () => { signal.cancelled = true; } });
  try {
    const r = await renderProgram((p) => useRenderJob.setState({ p: format === 'mp4' || format === 'webm' ? p : p * 0.7 }), signal);
    if (r) {
      let { blob, name } = r;
      const from = name.endsWith('.webm') ? 'webm' : 'mp4';
      if (format !== from && !signal.cancelled) {
        useRenderJob.setState({ stage: `Converting to ${format.toUpperCase()}`, p: 0.7 });
        try {
          blob = await convertRender(blob, from, format, (p) => useRenderJob.setState({ p: 0.7 + p * 0.3 }), (n) => useRenderJob.setState({ stage: n }));
          name = name.replace(/\.[^.]+$/, `.${format}`);
        } catch (e) {
          // no converter (offline, blocked): keep the video the browser recorded
          toastError(`${(e as Error).message} The video is saved as ${from.toUpperCase()} instead.`);
        }
      }
      useRenderJob.setState({ last: { blob, name } });
      await saveBlob(blob, name);
      toast(`Video rendered (${RENDER_FORMATS.find((f) => f.id === format)?.label ?? format})`);
    }
  } catch (e) { toastError((e as Error).message); }
  useRenderJob.setState({ p: null, stage: '', cancel: null });
}
export const cancelRender = () => useRenderJob.getState().cancel?.();
export async function downloadLastRender() { const l = useRenderJob.getState().last; if (l) await saveBlob(l.blob, l.name); }
