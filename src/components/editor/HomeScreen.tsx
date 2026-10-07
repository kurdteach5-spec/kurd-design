import { useEffect, useState } from 'react';
import { LanguageSegments } from '../ui/LanguageMenu';
import { PRESETS, type Preset } from '../../editor/presets';
import { newDocument, openWithPicker, openProject } from '../../editor/fileActions';
import { openDialog, useUI } from '../../state/uiStore';
import { listProjects, type ProjectMeta } from '../../file-system/storage';
import { timeAgo } from '../../utils/id';
import { useDocuments } from '../../state/documentStore';
import { LuFolderOpen, LuPlus, LuImage } from 'react-icons/lu';

function Frame({ p, onClick }: { p: Preset; onClick: () => void }) {
  const box = 74; const k = box / Math.max(p.width, p.height);
  return (
    <button type="button" onClick={onClick} className="group flex flex-col items-center gap-2 p-2 rounded-[8px] hover:bg-raised transition-colors text-start w-[132px]" aria-label={`New ${p.name}, ${p.width} by ${p.height} pixels`}>
      <div className="h-[80px] flex items-end justify-center">
        <div className="border border-[#59616c] group-hover:border-accent bg-[#2a2f36] group-hover:bg-[#2c3a52] transition-colors rounded-[2px]" style={{ width: Math.max(8, p.width * k), height: Math.max(8, p.height * k) }} />
      </div>
      <div className="text-center leading-tight">
        <div className="text-ink-strong">{p.name}</div>
        <div className="text-faint num text-2xs">{p.width} × {p.height}{p.dpi !== 72 ? ` · ${p.dpi} ppi` : ''}</div>
      </div>
    </button>
  );
}

function Thumb({ blob }: { blob: Blob | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { if (!blob) return; const u = URL.createObjectURL(blob); setUrl(u); return () => URL.revokeObjectURL(u); }, [blob]);
  return url ? <img src={url} alt="" className="max-w-full max-h-full object-contain checker" /> : <LuImage size={28} className="text-faint" />;
}

export function HomeScreen() {
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const [storageError, setStorageError] = useState(false);
  const hasDocs = useDocuments((s) => s.order.length > 0);
  useEffect(() => { listProjects().then(setProjects).catch(() => { setProjects([]); setStorageError(true); }); }, []);
  const quick = (p: Preset) => newDocument({ name: p.name, width: p.width, height: p.height, dpi: p.dpi, colorMode: 'rgb', background: 'white' });

  return (
    <div className="absolute inset-0 z-20 bg-surround overflow-y-auto">
      <div className="max-w-[1080px] mx-auto px-8 py-10 flex flex-col gap-10">
        <header className="flex items-end justify-between gap-6 flex-wrap">
          <div>
            <h1 className="text-[28px] leading-tight font-semibold text-ink-strong tracking-[-0.01em]">Start something</h1>
            <p className="text-muted mt-1 text-sm">Pick a format, open an image or PSD, or drop files anywhere in this window.</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <LanguageSegments />
            {hasDocs && <button type="button" className="btn h-8" onClick={() => useUI.setState({ showHome: false })}>Back to editor</button>}
            <button type="button" className="btn h-8 inline-flex items-center gap-1.5" onClick={() => void openWithPicker()}><LuFolderOpen size={15} />Open file</button>
            <button type="button" className="btn btn-primary h-8 inline-flex items-center gap-1.5" onClick={() => openDialog({ type: 'new-document' })}><LuPlus size={15} />Custom size</button>
          </div>
        </header>

        {(['Social', 'Print', 'Screen'] as const).map((g) => (
          <section key={g} aria-labelledby={`preset-${g}`}>
            <h2 id={`preset-${g}`} className="text-ink-strong font-medium text-sm mb-2">{g}</h2>
            <div className="flex flex-wrap gap-1">{PRESETS.filter((p) => p.group === g).map((p) => <Frame key={p.id} p={p} onClick={() => quick(p)} />)}</div>
          </section>
        ))}

        <section aria-labelledby="recent">
          <div className="flex items-baseline justify-between mb-3">
            <h2 id="recent" className="text-ink-strong font-medium text-sm">Recent projects</h2>
            {!!projects?.length && <button type="button" className="text-accent hover:underline" onClick={() => openDialog({ type: 'projects' })}>Manage projects</button>}
          </div>
          {projects === null ? <div className="text-faint">Loading…</div>
            : storageError ? <div className="text-muted">Browser storage is unavailable, so projects can’t be listed here. Use File › Download Project to keep your work.</div>
            : !projects.length ? <div className="text-muted">Projects you save with Ctrl/Cmd+S appear here.</div>
            : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
                {projects.slice(0, 12).map((p) => (
                  <button type="button" key={p.id} className="group text-start rounded-[8px] border border-line-soft hover:border-accent bg-panel overflow-hidden transition-colors" onClick={() => void openProject(p.id)}>
                    <div className="h-[120px] flex items-center justify-center bg-[#1d2025] p-2"><Thumb blob={p.thumb} /></div>
                    <div className="px-3 py-2">
                      <div className="text-ink-strong truncate">{p.name}</div>
                      <div className="text-faint num text-2xs">{`${p.width} × ${p.height} · ${timeAgo(p.updatedAt)}`}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
        </section>
      </div>
    </div>
  );
}
