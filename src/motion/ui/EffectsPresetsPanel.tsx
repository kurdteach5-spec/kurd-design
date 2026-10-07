import { useState } from 'react';
import { EFFECT_CATEGORIES, EFFECT_DEFS } from '../render/effectDefs';
import { PRESETS, PRESET_CATEGORIES, applyPreset, applyUserPreset } from '../presets';
import { useMotion, mcommit } from '../store';
import * as A from '../actions';
import { openMotionDialog } from '../uiState';
import { LuChevronRight, LuSearch, LuSparkles, LuSlidersHorizontal, LuStar, LuTrash2 } from 'react-icons/lu';

export function EffectsPresetsPanel() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({ 'p:Text Animations': true });
  const user = useMotion((s) => s.project.userPresets);
  const selCount = useMotion((s) => s.selectedLayers.length);
  const match = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase());
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const Cat = ({ k, label, count, icon, children }: { k: string; label: string; count: number; icon: React.ReactNode; children: React.ReactNode }) => {
    if (!count) return null;
    const isOpen = !!q || !!open[k];
    return (
      <div>
        <button type="button" className="w-full flex items-center gap-1.5 h-[26px] px-2 text-xs text-ink hover:bg-[#282d33]" aria-expanded={isOpen} onClick={() => toggle(k)}>
          <LuChevronRight size={12} className={`transition-transform text-muted ${isOpen ? 'rotate-90' : ''}`} />{icon}<span className="flex-1 text-start">{label}</span><span className="text-faint text-2xs num">{count}</span>
        </button>
        {isOpen && <div className="pb-1">{children}</div>}
      </div>
    );
  };
  const Item = ({ label, tip, onApply }: { label: string; tip: string; onApply: () => void }) => (
    <button type="button" className="w-full text-start flex items-center h-[24px] ps-8 pe-2 text-xs text-muted hover:text-ink hover:bg-[#2b3037]" data-tip={tip} onClick={onApply}>{label}</button>
  );
  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="p-2 border-b border-line-soft">
        <div className="relative">
          <LuSearch size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-faint" />
          <input className="field w-full ps-7" placeholder="Search effects & presets" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} aria-label="Search effects and presets" />
        </div>
        <div className="text-2xs text-faint mt-1.5">{selCount ? (selCount === 1 ? 'Click to apply to the selected layer.' : `Click to apply to ${selCount} selected layers.`) : 'Select a layer, then click an effect or preset.'}</div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto py-1">
        <div className="px-2 pt-1 pb-0.5 text-2xs uppercase tracking-wide text-faint">Animation Presets</div>
        {PRESET_CATEGORIES.map((c) => {
          const list = PRESETS.filter((p) => p.category === c && (match(p.name) || match(c)));
          return <Cat key={c} k={`p:${c}`} label={c} count={list.length} icon={<LuSparkles size={12} className="text-amber" />}>{list.map((p) => <Item key={p.id} label={p.name} tip={p.description} onApply={() => applyPreset(p.id)} />)}</Cat>;
        })}
        <Cat k="p:user" label="My Presets" count={user.filter((u) => match(u.name)).length + 1} icon={<LuStar size={12} className="text-amber" />}>
          {user.filter((u) => match(u.name)).map((u) => (
            <div key={u.id} className="group flex items-center">
              <div className="flex-1"><Item label={u.name} tip="Your saved animation" onApply={() => applyUserPreset(u.id)} /></div>
              <button type="button" className="icon-btn !w-5 !h-5 me-2 opacity-0 group-hover:opacity-100" aria-label="Delete preset" onClick={() => mcommit((p) => ({ ...p, userPresets: p.userPresets.filter((x) => x.id !== u.id) }), 'Delete Preset')}><LuTrash2 size={11} /></button>
            </div>
          ))}
          <button type="button" className="ms-8 mt-0.5 text-2xs text-accent hover:underline" onClick={() => openMotionDialog({ type: 'save-preset' })}>Save selected layer’s animation…</button>
        </Cat>
        <div className="px-2 pt-3 pb-0.5 text-2xs uppercase tracking-wide text-faint">Effects</div>
        {EFFECT_CATEGORIES.map((c) => {
          const list = EFFECT_DEFS.filter((d) => d.category === c && (match(d.name) || match(c)));
          return <Cat key={c} k={`e:${c}`} label={c} count={list.length} icon={<LuSlidersHorizontal size={12} className="text-accent" />}>{list.map((d) => <Item key={d.id} label={d.name} tip={`${d.category} · every setting can be keyframed`} onApply={() => A.addEffect(d.id)} />)}</Cat>;
        })}
      </div>
    </div>
  );
}
