import { useEffect, useState } from 'react';

/** Current window size; updates on resize and on phone/tablet rotation. */
export function useWindowSize() {
  const get = () => ({ w: window.innerWidth, h: window.innerHeight });
  const [size, setSize] = useState(get);
  useEffect(() => {
    let raf = 0;
    const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setSize((s) => { const n = get(); return s.w === n.w && s.h === n.h ? s : n; })); };
    window.addEventListener('resize', on); window.addEventListener('orientationchange', on);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', on); window.removeEventListener('orientationchange', on); };
  }, []);
  return size;
}
