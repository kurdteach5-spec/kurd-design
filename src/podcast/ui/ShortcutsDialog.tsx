// Keyboard shortcuts: every tool of the Podcast and Mixer workspaces, each key can be changed.
import { useEffect, useState } from 'react';
import { ACTIONS, keysOf, setKeys, resetAll, comboOf, keyLabel, useShortcuts, useShortcutsDialog, type Scope } from './shortcuts';
import { isMixer } from '../../state/workspace';
import { LuKeyboard, LuX, LuRotateCcw } from 'react-icons/lu';

function Key({ k }: { k: string }) {
  return <kbd className="inline-flex items-center h-[20px] px-1.5 rounded-[4px] border border-[#4a515c] bg-[#2a2e34] text-[11px] font-semibold num" style={{ color: '#e8eaed' }} dir="ltr">{keyLabel(k)}</kbd>;
}

export function ShortcutsDialog() {
  const open = useShortcutsDialog((s) => s.open);
  const user = useShortcuts((s) => s.user);
  const [scope, setScope] = useState<Scope>(isMixer() ? 'mixer' : 'podcast');
  const [capture, setCapture] = useState<string | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => { if (open) setScope(isMixer() ? 'mixer' : 'podcast'); }, [open]);
  useEffect(() => {
    if (!capture) return;
    const h = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { setCapture(null); return; }
      const c = comboOf(e); if (!c) return;
      // a key belongs to one action per workspace: take it away from the other one
      const a = ACTIONS.find((x) => x.id === capture)!;
      for (const o of ACTIONS) if (o.id !== a.id && o.scopes.some((sc) => a.scopes.includes(sc)) && keysOf(o).includes(c)) setKeys(o.id, keysOf(o).filter((k) => k !== c));
      setKeys(capture, [c]); setCapture(null);
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [capture]);
  if (!open) return null;
  const list = ACTIONS.filter((a) => a.scopes.includes(scope) && (!q || a.label.toLowerCase().includes(q.toLowerCase())));
  const groups = [...new Set(list.map((a) => a.group))];
  const close = () => { setCapture(null); useShortcutsDialog.setState({ open: false }); };
  void user;
  return (
    <div className="fixed inset-0 z-[80] bg-black/55 flex items-center justify-center p-3" onClick={close}>
      <div role="dialog" aria-label="Keyboard shortcuts" className="w-[min(720px,100%)] max-h-[88vh] flex flex-col bg-panel border border-line rounded-[10px] shadow-[0_24px_60px_rgba(0,0,0,.6)]" onClick={(e) => e.stopPropagation()}>
        <div className="h-11 shrink-0 flex items-center gap-2 px-3 border-b border-line">
          <LuKeyboard size={16} /><span className="font-semibold text-ink-strong flex-1">Keyboard shortcuts</span>
          <div className="flex rounded-[6px] border border-line overflow-hidden">
            {(['mixer', 'podcast'] as const).map((sc) => <button key={sc} type="button" className={`h-[26px] px-2.5 text-xs ${scope === sc ? 'bg-accent text-white' : 'text-muted hover:text-ink'}`} onClick={() => setScope(sc)}>{sc === 'mixer' ? 'Mixer' : 'Podcast'}</button>)}
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={close}><LuX size={15} /></button>
        </div>
        <div className="px-3 py-2 flex items-center gap-2 border-b border-line-soft">
          <input className="field h-[26px] text-xs flex-1" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} aria-label="Search shortcuts" />
          <button type="button" className="btn h-[26px] text-xs inline-flex items-center gap-1" onClick={() => { if (window.confirm('Put every shortcut back to the default key?')) resetAll(); }}><LuRotateCcw size={12} />Reset all</button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
          {groups.map((g) => (
            <div key={g} className="mb-3">
              <div className="text-2xs font-semibold uppercase tracking-[0.06em] text-faint mb-1">{g}</div>
              {list.filter((a) => a.group === g).map((a) => {
                const keys = keysOf(a); const changed = !!useShortcuts.getState().user[a.id];
                return (
                  <div key={a.id} className="flex items-center gap-2 py-[3px] border-b border-line-soft/50">
                    <span className="text-xs text-ink flex-1 min-w-0">{a.label}</span>
                    {capture === a.id ? <span className="text-xs text-[#f0b400] animate-pulse">Press a key… (Esc: cancel)</span> : (
                      <span className="flex gap-1 flex-wrap justify-end">{keys.length ? keys.map((k) => <Key key={k} k={k} />) : <span className="text-2xs text-faint">—</span>}</span>
                    )}
                    <button type="button" className="btn h-[22px] px-2 text-2xs shrink-0" aria-label={`Change the key of ${a.label}`} onClick={() => setCapture(a.id)}>Change</button>
                    <button type="button" className="icon-btn !w-5 !h-5 shrink-0" aria-label={`Default key for ${a.label}`} data-tip="Default key" disabled={!changed} onClick={() => setKeys(a.id, null)}><LuRotateCcw size={11} /></button>
                    <button type="button" className="icon-btn !w-5 !h-5 shrink-0" aria-label={`No key for ${a.label}`} data-tip="No key" onClick={() => setKeys(a.id, [])}><LuX size={11} /></button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="px-3 py-2 border-t border-line text-2xs text-faint">Keys follow the position on the keyboard, so they work with Kurdish, Arabic and English layouts. Shift + / opens this list.</div>
      </div>
    </div>
  );
}

export function ShortcutsButton() {
  return (
    <button type="button" className="icon-btn shrink-0" aria-label="Keyboard shortcuts" data-tip="Keyboard shortcuts (Shift + /)" onClick={() => useShortcutsDialog.setState({ open: true })}><LuKeyboard size={15} /></button>
  );
}
