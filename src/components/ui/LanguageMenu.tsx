import { useEffect, useRef, useState } from 'react';
import { LuLanguages, LuCheck } from 'react-icons/lu';
import { LANGUAGES, setLang, useLang } from '../../i18n';

/** Compact language picker for the header. Language names are shown in their own script. */
export function LanguageMenu() {
  const lang = useLang((s) => s.lang);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    window.addEventListener('pointerdown', down, true); window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key, true); };
  }, [open]);
  const current = LANGUAGES.find((l) => l.id === lang)!;
  return (
    <div ref={ref} className="relative h-full flex items-center">
      <button type="button" className="h-[26px] px-2 rounded-[4px] inline-flex items-center gap-1.5 text-ink hover:bg-hover" aria-haspopup="menu" aria-expanded={open}
        aria-label="Language" data-tip="Language" onClick={() => setOpen((o) => !o)}>
        <LuLanguages size={15} /><span translate="no" className="text-xs">{current.label}</span>
      </button>
      {open && (
        <div role="menu" className="menu absolute end-0 top-full mt-0.5 z-50 min-w-[150px]">
          {LANGUAGES.map((l) => (
            <div key={l.id} role="menuitemradio" aria-checked={l.id === lang} tabIndex={0} className="menu-item hover:bg-hover"
              onClick={() => { setLang(l.id); setOpen(false); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setLang(l.id); setOpen(false); } }}>
              <span className="w-3.5 inline-flex">{l.id === lang && <LuCheck size={13} />}</span>
              <span className="flex-1" translate="no" lang={l.id}>{l.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Larger segmented picker for the home screen. */
export function LanguageSegments() {
  const lang = useLang((s) => s.lang);
  return (
    <div className="inline-flex rounded-[6px] border border-line overflow-hidden" role="radiogroup" aria-label="Language">
      {LANGUAGES.map((l) => (
        <button key={l.id} type="button" role="radio" aria-checked={l.id === lang} translate="no" lang={l.id}
          className={`h-8 px-3 text-sm ${l.id === lang ? 'bg-accent text-white' : 'text-ink hover:bg-hover'}`}
          onClick={() => setLang(l.id)}>{l.label}</button>
      ))}
    </div>
  );
}
