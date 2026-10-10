// What the file converter is doing (shown in the Podcast and Mixer top bars).
import { create } from '../state/createStore';
export const useConvert = create<{ label: string | null; p: number }>(() => ({ label: null, p: 0 }));
