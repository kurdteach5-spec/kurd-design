import type { DocState, Layer } from '../types/document';
import { blobToCanvas, canvasToBlob } from '../utils/canvas';

/** Serialized project: plain JSON where pixel canvases are replaced by image references. */
export interface ProjectFile {
  format: 'designpro-studio';
  version: 1;
  name: string;
  state: Omit<DocState, 'layers' | 'selection'> & { layers: unknown[] };
  /** PNG images as data URLs (file format) or indices into a Blob array (IndexedDB). */
  images: string[];
}

type Ref = { __img: number };
const isRef = (v: unknown): v is Ref => !!v && typeof v === 'object' && '__img' in (v as object);

function stripLayers(layers: Layer[], canvases: HTMLCanvasElement[]): unknown[] {
  const ref = (c: HTMLCanvasElement): Ref => { let i = canvases.indexOf(c); if (i < 0) { i = canvases.length; canvases.push(c); } return { __img: i }; };
  return layers.map((l) => {
    const base: Record<string, unknown> = { ...l };
    if (l.mask) base.mask = { ...l.mask, canvas: ref(l.mask.canvas) };
    if (l.type === 'raster') base.canvas = ref(l.canvas);
    if (l.type === 'group') base.children = stripLayers(l.children, canvases);
    return base;
  });
}

function restoreLayers(layers: unknown[], images: HTMLCanvasElement[]): Layer[] {
  return layers.map((raw) => {
    const l = { ...(raw as Record<string, unknown>) };
    if (l.mask && isRef((l.mask as Record<string, unknown>).canvas)) l.mask = { ...(l.mask as object), canvas: images[((l.mask as Record<string, unknown>).canvas as Ref).__img] };
    if (isRef(l.canvas)) l.canvas = images[l.canvas.__img];
    if (Array.isArray(l.children)) l.children = restoreLayers(l.children, images);
    if (l.type === 'raster' && !(l.canvas instanceof HTMLCanvasElement)) throw new Error('Corrupted project: missing layer pixels.');
    return l as unknown as Layer;
  });
}

export function splitState(state: DocState) {
  const canvases: HTMLCanvasElement[] = [];
  const layers = stripLayers(state.layers, canvases);
  const { selection: _s, layers: _l, ...rest } = state;
  return { meta: { ...rest, layers }, canvases };
}

/** Project as a self-contained JSON file (.dps). */
export async function serializeProject(name: string, state: DocState): Promise<ProjectFile> {
  const { meta, canvases } = splitState(state);
  const images: string[] = [];
  for (const c of canvases) {
    const blob = await canvasToBlob(c, 'image/png');
    images.push(await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => rej(fr.error); fr.readAsDataURL(blob); }));
  }
  return { format: 'designpro-studio', version: 1, name, state: meta, images };
}

export async function deserializeProject(p: ProjectFile): Promise<DocState> {
  if (!p || p.format !== 'designpro-studio' || !p.state) throw new Error('This is not a KURD DESIGN project file.');
  const images: HTMLCanvasElement[] = [];
  for (const src of p.images) images.push(await blobToCanvas(await (await fetch(src)).blob()));
  return restoreFromParts(p.state, images);
}

export function restoreFromParts(meta: ProjectFile['state'], images: HTMLCanvasElement[]): DocState {
  const layers = restoreLayers(meta.layers, images);
  return { ...(meta as unknown as DocState), layers, selection: null, selectedLayerIds: meta.selectedLayerIds ?? [], guides: meta.guides ?? [], editTarget: meta.editTarget ?? 'content' };
}

/** Blob-based parts for IndexedDB (faster than data URLs). */
export async function toStorageParts(state: DocState) {
  const { meta, canvases } = splitState(state);
  const blobs: Blob[] = [];
  for (const c of canvases) blobs.push(await canvasToBlob(c, 'image/png'));
  return { meta, blobs };
}
export async function fromStorageParts(meta: ProjectFile['state'], blobs: Blob[]) {
  const images: HTMLCanvasElement[] = [];
  for (const b of blobs) images.push(await blobToCanvas(b));
  return restoreFromParts(meta, images);
}
