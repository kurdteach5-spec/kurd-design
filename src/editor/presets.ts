export interface Preset { id: string; name: string; width: number; height: number; dpi: number; group: 'Social' | 'Print' | 'Screen'; note?: string }

export const PRESETS: Preset[] = [
  { id: 'ig-post', name: 'Instagram Post', width: 1080, height: 1350, dpi: 72, group: 'Social', note: '4:5 portrait' },
  { id: 'ig-square', name: 'Instagram Square', width: 1080, height: 1080, dpi: 72, group: 'Social' },
  { id: 'ig-story', name: 'Instagram Story', width: 1080, height: 1920, dpi: 72, group: 'Social', note: 'Also Reels / TikTok' },
  { id: 'fb-post', name: 'Facebook Post', width: 1200, height: 630, dpi: 72, group: 'Social' },
  { id: 'yt-thumb', name: 'YouTube Thumbnail', width: 1280, height: 720, dpi: 72, group: 'Social' },
  { id: 'yt-banner', name: 'YouTube Banner', width: 2560, height: 1440, dpi: 72, group: 'Social' },
  { id: 'poster', name: 'Poster 18×24 in', width: 5400, height: 7200, dpi: 300, group: 'Print' },
  { id: 'a4', name: 'A4', width: 2480, height: 3508, dpi: 300, group: 'Print', note: '210 × 297 mm' },
  { id: 'a3', name: 'A3', width: 3508, height: 4961, dpi: 300, group: 'Print', note: '297 × 420 mm' },
  { id: 'hd', name: 'HD 720p', width: 1280, height: 720, dpi: 72, group: 'Screen' },
  { id: 'fhd', name: 'Full HD 1080p', width: 1920, height: 1080, dpi: 72, group: 'Screen' },
  { id: '4k', name: '4K UHD', width: 3840, height: 2160, dpi: 72, group: 'Screen' },
];
