import { usePod } from '../store';
import { camParts } from '../labels';

/** a person's name as typed (never translated), or the translated default "Speaker n" */
export function SpeakerLabel({ id, className }: { id: string; className?: string }) {
  const name = usePod((s) => s.speakers.find((x) => x.id === id)?.name.trim() ?? '');
  const n = usePod((s) => s.speakers.findIndex((x) => x.id === id) + 1);
  return name ? <span className={className} translate="no">{name}</span> : <span className={className}>{`Speaker ${n}`}</span>;
}

/** a camera's / B-roll clip's name: translated role word + untranslated user part (name, file) + angle number */
export function CamLabel({ id, className, short }: { id: string; className?: string; short?: boolean }) {
  usePod((s) => s.speakers); usePod((s) => s.cameras);
  const p = camParts(id);
  return (
    <span className={className}>
      {p.role && <span>{p.role}</span>}
      {p.user && (!short || p.role !== 'B-roll') && <span translate="no">{p.role ? ` · ${p.user}` : p.user}</span>}
      {p.n && <span translate="no">{` ${p.n}`}</span>}
    </span>
  );
}
