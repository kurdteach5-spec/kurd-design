// Library manager: upload music and sound effects with title, description, tags, category, mood, BPM,
// cover image and licence. Uploads are kept in this browser and appear in their category at once.
import { useEffect, useState } from 'react';
import { MUSIC, SFX, LICENSES, type Kind, type License } from '../catalog';
import { useLib, saveUpload, deleteUpload, getUpload, type UploadRecord } from '../store';
import { computePeaks } from '../audio';
import { toPlayable } from '../../podcast/ffmpeg';
import { Dialog } from '../../components/dialogs/Dialog';
import { toast, toastError } from '../../state/uiStore';
import { LuUpload, LuTrash2, LuPencil, LuImage, LuMusic } from 'react-icons/lu';

const close = () => useLib.setState({ admin: { open: false, editId: null } });
interface Form { id: string | null; kind: Kind; title: string; description: string; category: string; moods: string; genre: string; tags: string; instruments: string; bpm: string; license: License; attribution: string; file: File | null; cover: File | null }
const empty = (): Form => ({ id: null, kind: 'music', title: '', description: '', category: MUSIC[0].id, moods: '', genre: '', tags: '', instruments: '', bpm: '', license: 'royalty-free', attribution: '', file: null, cover: null });
const list = (s: string) => s.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

async function decode(file: Blob): Promise<AudioBuffer> {
  const ctx = new AudioContext();
  try { return await ctx.decodeAudioData(await file.arrayBuffer()); } finally { void ctx.close(); }
}

export function LibraryManager() {
  const uploads = useLib((s) => s.uploads);
  const [f, setF] = useState<Form>(empty());
  const [busy, setBusy] = useState<string | null>(null);
  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }));
  const editId = useLib((s) => s.admin.editId);
  useEffect(() => { if (editId) void edit(editId); }, [editId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function edit(id: string) {
    const u = await getUpload(id); if (!u) return;
    setF({ id, kind: u.kind, title: u.title, description: u.description ?? '', category: u.category, moods: u.moods.join(', '), genre: u.genre === 'Sound effect' ? '' : u.genre, tags: u.tags.join(', '), instruments: u.instruments.join(', '), bpm: u.bpm ? String(u.bpm) : '', license: u.license, attribution: u.attribution ?? '', file: null, cover: null });
  }
  const cats = f.kind === 'sfx' ? SFX : MUSIC;
  const lic = LICENSES.find((l) => l.id === f.license)!;
  const needsAttr = f.license === 'cc-by' || f.license === 'cc-by-sa' || f.license === 'cc-by-nc';
  async function save() {
    if (!f.title.trim()) { toastError('Give the sound a title.'); return; }
    if (!f.id && !f.file) { toastError('Choose an audio file (MP3, WAV, M4A, OGG, FLAC…).'); return; }
    if (needsAttr && !f.attribution.trim()) { toastError('This licence needs an attribution line (author, title, source).'); return; }
    setBusy('Reading the audio…');
    try {
      const prev = f.id ? await getUpload(f.id) : undefined;
      let audio: Blob = prev?.audio ?? new Blob(); let fileName = prev?.fileName ?? ''; let duration = prev?.duration ?? 0; let peaks = prev?.peaks;
      if (f.file) {
        let file = f.file; let buf: AudioBuffer | null = null;
        try { buf = await decode(file); } catch {
          setBusy('Converting the file so the browser can play it…');
          file = await toPlayable(f.file, 'audio'); buf = await decode(file);
        }
        audio = file; fileName = f.file.name; duration = buf.duration; peaks = Array.from(computePeaks(buf));
      }
      const cat = cats.find((c) => c.id === f.category) ?? cats[0];
      const ext = (fileName.match(/\.([^.]+)$/)?.[1] ?? 'audio').toUpperCase();
      const rec: UploadRecord = {
        id: f.id ?? `u-${Date.now().toString(36)}`, kind: f.kind, title: f.title.trim(), description: f.description.trim(), category: cat.id, categoryName: cat.name,
        moods: list(f.moods), genre: f.kind === 'sfx' ? 'Sound effect' : f.genre.trim() || 'Other', instruments: list(f.instruments), tags: list(f.tags),
        bpm: f.bpm ? Math.max(20, Math.min(300, Math.round(Number(f.bpm)))) || null : null, duration: Math.round(duration * 10) / 10, format: ext,
        license: f.license, attribution: f.attribution.trim() || undefined, addedAt: prev?.addedAt ?? Date.now(), builtin: false, seed: 0,
        audio, fileName, coverBlob: f.cover ?? prev?.coverBlob ?? null, peaks,
      };
      await saveUpload(rec);
      toast(f.id ? 'Saved' : `“${rec.title}” is now in ${cat.name}`, 'success');
      setF({ ...empty(), kind: f.kind, category: f.category, license: f.license });
      useLib.setState({ admin: { open: true, editId: null } });
    } catch (e) { toastError((e as Error).message || 'This file could not be read.'); }
    finally { setBusy(null); }
  }
  const inp = 'field w-full h-[30px]';
  return (
    <Dialog title="Upload & manage the library" onClose={close} width={760} footer={null}>
      <div className="flex flex-col md:flex-row gap-5 max-h-[72vh] overflow-y-auto">
        <div className="flex-1 min-w-0 flex flex-col gap-2.5 text-xs">
          <div className="text-ink-strong text-sm font-semibold">{f.id ? 'Edit sound' : 'Add a sound'}</div>
          <label className="flex flex-col gap-1">Audio file{f.id ? ' (leave empty to keep the current one)' : ''}
            <input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.oga,.opus,.flac,.aif,.aiff,.wma,.caf" className="text-xs" aria-label="Audio file" onChange={(e) => { const file = e.target.files?.[0] ?? null; set({ file, title: f.title || (file ? file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ') : '') }); }} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">Type
              <select className={inp} value={f.kind} onChange={(e) => { const kind = e.target.value as Kind; set({ kind, category: (kind === 'sfx' ? SFX : MUSIC)[0].id }); }}><option value="music">Background music</option><option value="sfx">Sound effect</option></select>
            </label>
            <label className="flex flex-col gap-1">Category
              <select className={inp} value={f.category} onChange={(e) => set({ category: e.target.value })}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            </label>
          </div>
          <label className="flex flex-col gap-1">Title<input className={inp} value={f.title} onChange={(e) => set({ title: e.target.value })} onKeyDown={(e) => e.stopPropagation()} /></label>
          <label className="flex flex-col gap-1">Description<textarea className="field w-full !h-auto min-h-[54px] py-1" value={f.description} onChange={(e) => set({ description: e.target.value })} onKeyDown={(e) => e.stopPropagation()} /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">Moods (comma separated)<input className={inp} placeholder="calm, hopeful" value={f.moods} onChange={(e) => set({ moods: e.target.value })} onKeyDown={(e) => e.stopPropagation()} /></label>
            <label className="flex flex-col gap-1">Tags / purpose<input className={inp} placeholder="wedding, vlog" value={f.tags} onChange={(e) => set({ tags: e.target.value })} onKeyDown={(e) => e.stopPropagation()} /></label>
            {f.kind === 'music' && <label className="flex flex-col gap-1">Genre<input className={inp} value={f.genre} onChange={(e) => set({ genre: e.target.value })} onKeyDown={(e) => e.stopPropagation()} /></label>}
            {f.kind === 'music' && <label className="flex flex-col gap-1">BPM<input className={inp} type="number" min={20} max={300} value={f.bpm} onChange={(e) => set({ bpm: e.target.value })} onKeyDown={(e) => e.stopPropagation()} /></label>}
            <label className="flex flex-col gap-1 col-span-2">Instruments<input className={inp} placeholder="piano, strings" value={f.instruments} onChange={(e) => set({ instruments: e.target.value })} onKeyDown={(e) => e.stopPropagation()} /></label>
          </div>
          <label className="flex flex-col gap-1">License
            <select className={inp} value={f.license} onChange={(e) => set({ license: e.target.value as License })}>{LICENSES.filter((l) => l.id !== 'original').map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select>
            <span className="text-2xs text-faint">{lic.note} Only choose a free licence when you own the sound or its licence allows it.</span>
          </label>
          <label className="flex flex-col gap-1">Attribution{needsAttr ? ' (required)' : ' (optional)'}<input className={inp} placeholder="“Title” by Author — source, licence" value={f.attribution} onChange={(e) => set({ attribution: e.target.value })} onKeyDown={(e) => e.stopPropagation()} /></label>
          <label className="flex items-center gap-2"><LuImage size={14} className="text-muted" />Cover image (optional)<input type="file" accept="image/*" className="text-xs flex-1 min-w-0" aria-label="Cover image" onChange={(e) => set({ cover: e.target.files?.[0] ?? null })} /></label>
          <div className="flex gap-2 justify-end pt-1">
            {f.id && <button type="button" className="btn" onClick={() => setF(empty())}>New sound</button>}
            <button type="button" className="btn btn-primary inline-flex items-center gap-1.5" disabled={!!busy} onClick={() => void save()}><LuUpload size={14} />{busy ?? (f.id ? 'Save changes' : 'Add to the library')}</button>
          </div>
          <div className="text-2xs text-faint">Uploads are saved in this browser on this device (this site has no server account yet). They show up in their category, in search and under “Uploaded” right away.</div>
        </div>
        <div className="md:w-[260px] shrink-0 flex flex-col gap-1.5 text-xs">
          <div className="text-ink-strong text-sm font-semibold">{`Uploaded (${uploads.length})`}</div>
          {!uploads.length && <div className="text-faint">Nothing uploaded yet.</div>}
          {uploads.map((u) => (
            <div key={u.id} className="flex items-center gap-2 p-1.5 rounded-[6px] border border-line-soft">
              {u.cover ? <img src={u.cover} alt="" className="w-8 h-8 rounded object-cover" /> : <span className="w-8 h-8 rounded bg-raised flex items-center justify-center text-muted"><LuMusic size={14} /></span>}
              <div className="flex-1 min-w-0"><div className="truncate text-ink" translate="no">{u.title}</div><div className="truncate text-faint">{u.categoryName}</div></div>
              <button type="button" className="icon-btn !w-6 !h-6" aria-label={`Edit ${u.title}`} onClick={() => void edit(u.id)}><LuPencil size={12} /></button>
              <button type="button" className="icon-btn !w-6 !h-6" aria-label={`Delete ${u.title}`} onClick={() => { if (confirm(`Delete “${u.title}” from the library?`)) void deleteUpload(u.id); }}><LuTrash2 size={12} /></button>
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
