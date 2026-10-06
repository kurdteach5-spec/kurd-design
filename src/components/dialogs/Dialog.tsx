import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { LuX } from 'react-icons/lu';

export function Dialog({ title, children, onClose, onSubmit, footer, width = 440, nonModal }: {
  title: string; children: ReactNode; onClose: () => void; onSubmit?: () => void; footer?: ReactNode; width?: number; nonModal?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<Element | null>(null);
  useEffect(() => {
    prevFocus.current = document.activeElement;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('[data-autofocus], input:not([type=checkbox]):not([type=range]), select, textarea, button.btn-primary');
    (first ?? el)?.focus();
    if (first instanceof HTMLInputElement) first.select();
    return () => { (prevFocus.current as HTMLElement | null)?.focus?.(); };
  }, []);
  return createPortal(
    <div className={`fixed inset-0 z-[800] flex items-center justify-center ${nonModal ? 'pointer-events-none' : 'bg-black/45'}`}
      onPointerDown={(e) => { if (e.target === e.currentTarget && !nonModal) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal={!nonModal} aria-label={title} tabIndex={-1}
        className="pointer-events-auto bg-panel border border-[#434a54] rounded-[8px] shadow-[0_24px_64px_rgba(0,0,0,.55)] flex flex-col max-h-[90vh] max-w-[96vw]"
        style={{ width, animation: 'menu-in 120ms ease-out' }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') { e.preventDefault(); onClose(); }
          if (e.key === 'Enter' && onSubmit && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); onSubmit(); }
          if (e.key === 'Tab') {
            const f = [...(ref.current?.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex="0"]') ?? [])].filter((x) => !x.hasAttribute('disabled'));
            if (!f.length) return;
            const i = f.indexOf(document.activeElement as HTMLElement);
            if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
          }
        }}>
        <div className="flex items-center h-11 px-4 border-b border-line shrink-0">
          <h2 className="flex-1 text-sm font-semibold text-ink-strong">{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close dialog" onClick={onClose}><LuX size={15} /></button>
        </div>
        <div className="p-4 overflow-y-auto min-h-0 flex flex-col gap-3">{children}</div>
        {footer !== null && (
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-line shrink-0">
            {footer ?? (<>
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              {onSubmit && <button type="button" className="btn btn-primary" onClick={onSubmit}>OK</button>}
            </>)}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="grid grid-cols-[110px_1fr] items-center gap-3"><span className="text-muted">{label}</span><div className="flex items-center gap-2 min-w-0">{children}</div></label>
);
