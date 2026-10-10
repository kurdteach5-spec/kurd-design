// File-format converter (FFmpeg compiled to WebAssembly), loaded from a CDN the first time it is needed
// (about 31 MB, then cached by the browser). It runs in its own worker so the page keeps working.
// Used for camera / microphone files the browser can't play (AVI, WMV, MKV with HEVC, MXF, WMA, AC3…)
// and for rendering to formats the browser can't record (MOV, MKV, AVI, GIF, MP3, WAV, M4A).

const CORE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd';

// a tiny classic worker around ffmpeg-core (the same calls the official @ffmpeg/ffmpeg worker makes)
const WORKER = `
let ff = null;
self.onmessage = async (e) => {
  const { id, type, data } = e.data;
  try {
    if (type === 'load') {
      importScripts(data.coreURL);
      ff = await self.createFFmpegCore({ mainScriptUrlOrBlob: data.coreURL + '#' + btoa(JSON.stringify({ wasmURL: data.wasmURL })) });
      ff.setLogger((m) => self.postMessage({ type: 'log', data: m.message }));
      ff.setProgress((p) => self.postMessage({ type: 'progress', data: p.progress }));
      self.postMessage({ id, type: 'ok' });
    } else if (type === 'write') { ff.FS.writeFile(data.name, new Uint8Array(data.buf)); self.postMessage({ id, type: 'ok' }); }
    else if (type === 'exec') { ff.setTimeout(-1); ff.exec(...data.args); const ret = ff.ret; ff.reset(); self.postMessage({ id, type: 'ok', data: ret }); }
    else if (type === 'read') { const d = ff.FS.readFile(data.name); self.postMessage({ id, type: 'ok', data: d }, [d.buffer]); }
    else if (type === 'unlink') { try { ff.FS.unlink(data.name); } catch {} self.postMessage({ id, type: 'ok' }); }
  } catch (err) { self.postMessage({ id, type: 'error', data: String(err && err.message || err) }); }
};`;

type Msg = { id?: number; type: string; data?: unknown };
let worker: Worker | null = null;
let ready: Promise<void> | null = null;
let seq = 0;
const waiting = new Map<number, { res: (v: unknown) => void; rej: (e: Error) => void }>();
let onProgress: ((p: number) => void) | null = null;
const logTail: string[] = [];

async function blobURL(url: string, type: string, note: (s: string) => void) {
  note(`Downloading the converter… (${url.endsWith('.wasm') ? '31 MB, only the first time' : 'script'})`);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Could not download the converter (${r.status}).`);
  return URL.createObjectURL(new Blob([await r.arrayBuffer()], { type }));
}
function call<T = unknown>(type: string, data?: unknown, transfer: Transferable[] = []): Promise<T> {
  const id = ++seq;
  return new Promise<T>((res, rej) => { waiting.set(id, { res: res as (v: unknown) => void, rej }); worker!.postMessage({ id, type, data }, transfer); });
}

/** loads the converter once */
export function loadConverter(note: (s: string) => void = () => {}): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    const base = (window as unknown as { __ffmpegCoreBase?: string }).__ffmpegCoreBase ?? CORE;
    const [coreURL, wasmURL] = [await blobURL(`${base}/ffmpeg-core.js`, 'text/javascript', note), await blobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm', note)];
    worker = new Worker(URL.createObjectURL(new Blob([WORKER], { type: 'text/javascript' })));
    worker.onmessage = (e: MessageEvent<Msg>) => {
      const m = e.data;
      if (m.type === 'log') { logTail.push(String(m.data)); if (logTail.length > 30) logTail.shift(); return; }
      if (m.type === 'progress') { onProgress?.(Math.max(0, Math.min(1, Number(m.data) || 0))); return; }
      const w = m.id !== undefined ? waiting.get(m.id) : undefined; if (!w) return;
      waiting.delete(m.id!);
      if (m.type === 'error') w.rej(new Error(String(m.data))); else w.res(m.data);
    };
    note('Starting the converter…');
    await call('load', { coreURL, wasmURL });
  })().catch((e) => { ready = null; worker?.terminate(); worker = null; throw new Error(`The file converter could not start: ${(e as Error).message}`); });
  return ready;
}

/** runs ffmpeg on one input file and returns the output file */
export async function convert(input: Blob, inName: string, args: string[], outName: string, progress?: (p: number) => void, note?: (s: string) => void): Promise<Uint8Array> {
  await loadConverter(note);
  const buf = await input.arrayBuffer();
  await call('write', { name: inName, buf }, [buf]);
  onProgress = progress ?? null;
  note?.('Converting…');
  const ret = await call<number>('exec', { args: ['-hide_banner', '-y', '-i', inName, ...args, outName] });
  onProgress = null;
  await call('unlink', { name: inName });
  if (ret !== 0) { await call('unlink', { name: outName }); throw new Error(`Conversion failed: ${logTail.slice(-3).join(' · ')}`); }
  const out = await call<Uint8Array>('read', { name: outName });
  await call('unlink', { name: outName });
  return out;
}

export const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi|mts|m2ts|ts|wmv|flv|3gp|3g2|mxf|mpg|mpeg|vob|ogv|dv|f4v|asf|hevc|h264|y4m)$/i;
export const AUDIO_EXT = /\.(wav|mp3|m4a|aac|ogg|oga|opus|flac|weba|wma|ac3|eac3|amr|aif|aiff|caf|ape|mka|dts|au|mp2)$/i;
export const IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg|avif|bmp|ico)$/i;

/** makes a file the browser can play: video → MP4 (H.264 + AAC), sound → M4A (AAC) */
export async function toPlayable(file: File, kind: 'video' | 'audio', progress?: (p: number) => void, note?: (s: string) => void): Promise<File> {
  const ext = (file.name.match(/\.[^.]+$/)?.[0] ?? '.bin').toLowerCase();
  const base = file.name.replace(/\.[^.]+$/, '');
  if (kind === 'video') {
    const out = await convert(file, `in${ext}`, ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'], 'out.mp4', progress, note);
    return new File([out as BlobPart], `${base}.mp4`, { type: 'video/mp4' });
  }
  const out = await convert(file, `in${ext}`, ['-vn', '-c:a', 'aac', '-b:a', '192k'], 'out.m4a', progress, note);
  return new File([out as BlobPart], `${base}.m4a`, { type: 'audio/mp4' });
}

export type RenderFormat = 'mp4' | 'webm' | 'mov' | 'mkv' | 'avi' | 'gif' | 'mp3' | 'wav' | 'm4a';
export const RENDER_FORMATS: { id: RenderFormat; label: string; mime: string }[] = [
  { id: 'mp4', label: 'MP4 (H.264)', mime: 'video/mp4' }, { id: 'mov', label: 'MOV (QuickTime)', mime: 'video/quicktime' },
  { id: 'webm', label: 'WebM', mime: 'video/webm' }, { id: 'mkv', label: 'MKV', mime: 'video/x-matroska' },
  { id: 'avi', label: 'AVI', mime: 'video/x-msvideo' }, { id: 'gif', label: 'GIF (no sound)', mime: 'image/gif' },
  { id: 'mp3', label: 'MP3 (sound only)', mime: 'audio/mpeg' }, { id: 'wav', label: 'WAV (sound only)', mime: 'audio/wav' },
  { id: 'm4a', label: 'M4A (sound only)', mime: 'audio/mp4' },
];

/** converts a rendered MP4 / WebM into another format */
export async function convertRender(blob: Blob, from: 'mp4' | 'webm', to: RenderFormat, progress?: (p: number) => void, note?: (s: string) => void): Promise<Blob> {
  if (to === from) return blob;
  const mime = RENDER_FORMATS.find((f) => f.id === to)!.mime;
  const h264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k'];
  const args: Record<RenderFormat, string[]> = {
    mp4: [...h264, '-movflags', '+faststart'],
    mov: from === 'mp4' ? ['-c', 'copy'] : h264,
    mkv: ['-c', 'copy'],
    webm: ['-c:v', 'libvpx', '-b:v', '6M', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libopus', '-b:a', '160k'],
    avi: ['-c:v', 'mpeg4', '-q:v', '3', '-c:a', 'libmp3lame', '-b:a', '192k'],
    gif: ['-vf', 'fps=12,scale=480:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4', '-an'],
    mp3: ['-vn', '-c:a', 'libmp3lame', '-b:a', '192k'],
    wav: ['-vn', '-c:a', 'pcm_s16le'],
    m4a: from === 'mp4' ? ['-vn', '-c:a', 'copy'] : ['-vn', '-c:a', 'aac', '-b:a', '192k'],
  };
  const out = await convert(blob, `render.${from}`, args[to], `out.${to}`, progress, note);
  return new Blob([out as BlobPart], { type: mime });
}
