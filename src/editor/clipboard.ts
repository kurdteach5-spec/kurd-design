import type { Layer } from '../types/document';

/** Internal clipboard keeps full-fidelity layers/pixels; the system clipboard receives a PNG. */
export type ClipboardData =
  | { kind: 'pixels'; canvas: HTMLCanvasElement; x: number; y: number; time: number }
  | { kind: 'layers'; layers: Layer[]; time: number };

let data: ClipboardData | null = null;
let lastBlur = 0;
if (typeof window !== 'undefined') window.addEventListener('blur', () => { lastBlur = Date.now(); });

export const setClipboard = (d: ClipboardData) => { data = d; };
export const getClipboard = () => data;
/** True when our internal clipboard is newer than anything the user could have copied elsewhere. */
export const internalIsFresh = () => !!data && data.time > lastBlur;

export async function writeSystemClipboard(canvas: HTMLCanvasElement) {
  try {
    const nav = navigator as Navigator & { clipboard?: { write?: (items: unknown[]) => Promise<void> } };
    const CI = (window as unknown as { ClipboardItem?: new (d: Record<string, Promise<Blob>>) => unknown }).ClipboardItem;
    if (!nav.clipboard?.write || !CI) return;
    const blob = new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), 'image/png'));
    await nav.clipboard.write([new CI({ 'image/png': blob })]);
  } catch { /* permission denied or unsupported: internal clipboard still works */ }
}

export async function readSystemClipboardImages(): Promise<File[]> {
  try {
    const nav = navigator as Navigator & { clipboard?: { read?: () => Promise<{ types: string[]; getType: (t: string) => Promise<Blob> }[]> } };
    if (!nav.clipboard?.read) return [];
    const items = await nav.clipboard.read();
    const files: File[] = [];
    for (const it of items) {
      const t = it.types.find((x) => x.startsWith('image/'));
      if (t) files.push(new File([await it.getType(t)], `Pasted.${t.split('/')[1]}`, { type: t }));
    }
    return files;
  } catch { return []; }
}
