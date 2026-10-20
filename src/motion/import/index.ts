// Opening After Effects work in Motion: .aep / .aepx projects and Lottie (Bodymovin) JSON animations.
// Media files chosen together with the project are linked to its footage by file name.
import { useMotion, mcommit } from '../store';
import { openComp } from '../actions';
import { openMotionDialog } from '../uiState';
import { toast, toastError } from '../../state/uiStore';
import { importLottie, isLottie, type ImportReport } from './lottie';
import { importAep, parseAepx, parseRifx } from './aep';

export const AE_EXT = /\.(aep|aepx|json|lottie\.json)$/i;
export const isAeFile = (f: File) => AE_EXT.test(f.name);

/** Imports After Effects files; returns the media files that were not used by them. */
export async function importAfterEffects(files: File[]): Promise<File[]> {
  const projects = files.filter(isAeFile);
  const media = files.filter((f) => !isAeFile(f));
  const used = new Set<File>();
  for (const f of projects) {
    try {
      toast(`Opening ${f.name}…`, 'info', 2500);
      let r: Awaited<ReturnType<typeof importLottie>>;
      if (/\.json$/i.test(f.name)) {
        let j: unknown;
        try { j = JSON.parse(await f.text()); } catch { throw new Error(`${f.name} is not valid JSON.`); }
        if (!isLottie(j)) throw new Error(`${f.name} is not a Lottie / Bodymovin animation.`);
        r = await importLottie(j, media);
      } else if (/\.aepx$/i.test(f.name)) r = await importAep(parseAepx(await f.text()), media);
      else r = await importAep(parseRifx(await f.arrayBuffer()), media);
      const lower = new Set(Object.values(r.assets).map((a) => a.name.toLowerCase()));
      for (const m of media) if (lower.has(m.name.toLowerCase())) used.add(m);
      mcommit((p) => ({
        ...p,
        comps: { ...p.comps, ...r.comps }, compOrder: [...p.compOrder, ...r.compOrder],
        assets: { ...p.assets, ...r.assets }, assetOrder: [...p.assetOrder, ...r.assetOrder],
      }), `Import ${f.name}`);
      openComp(r.mainId);
      useMotion.setState({ selectedProjectItem: r.mainId });
      showReport(f.name, r.report);
    } catch (e) { toastError((e as Error).message || `Unable to open ${f.name}`); }
  }
  return media.filter((m) => !used.has(m));
}

function showReport(name: string, r: ImportReport) {
  const summary = `${name}: ${r.comps} ${r.comps === 1 ? 'composition' : 'compositions'}, ${r.layers} layers${r.keyframes ? `, ${r.keyframes} keyframes` : ''}${r.expressions ? `, ${r.expressions} expressions` : ''}`;
  if (!r.missing.length && !r.skipped.length) { toast(summary, 'success', 4000); return; }
  openMotionDialog({ type: 'import-report', name, summary, missing: r.missing, skipped: r.skipped });
}
