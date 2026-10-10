import { useConvert } from '../convertStatus';

/** "Converting file.avi… 42 %" while the file converter works */
export function ConvertStatus() {
  const { label, p } = useConvert();
  if (!label) return null;
  return (
    <div className="flex items-center gap-2 shrink-0 max-w-[340px]" role="status">
      <div className="w-[70px] h-1.5 rounded-full bg-[#1a1d21] overflow-hidden"><div className="h-full bg-[#f0b400]" style={{ width: `${Math.round(p * 100)}%` }} /></div>
      <span className="text-2xs text-muted truncate" translate="no">{label}</span>
    </div>
  );
}
