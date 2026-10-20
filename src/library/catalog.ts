// The built-in catalogue of the Sound Library. Every track and effect here is original: its audio is
// composed and synthesised in the browser by the library's sound engine from the recipe below, so it is
// free to use (no third-party rights). Uploaded tracks (admin) carry their own licence.
export type Kind = 'music' | 'sfx';
export type License = 'original' | 'royalty-free' | 'public-domain' | 'cc0' | 'cc-by' | 'cc-by-sa' | 'cc-by-nd' | 'cc-by-nc' | 'cc-by-nc-sa' | 'cc-by-nc-nd' | 'sampling' | 'licensed';

export const LICENSES: { id: License; label: string; free: boolean; note: string }[] = [
  { id: 'original', label: 'Original · free to use', free: true, note: 'Made by SARWAR DESIGN’s sound engine. Free for personal and commercial use; no attribution needed.' },
  { id: 'royalty-free', label: 'Royalty-free', free: true, note: 'Use without paying royalties, within the terms given by the owner.' },
  { id: 'public-domain', label: 'Public domain', free: true, note: 'No copyright restrictions.' },
  { id: 'cc-by', label: 'CC BY 4.0', free: true, note: 'Free to use with attribution to the author.' },
  { id: 'cc-by-sa', label: 'CC BY-SA 4.0', free: true, note: 'Free to use with attribution; adaptations must use the same licence.' },
  { id: 'cc0', label: 'CC0 · public domain', free: true, note: 'No rights reserved: use for anything, no attribution needed.' },
  { id: 'cc-by-nd', label: 'CC BY-ND', free: true, note: 'Free to use with attribution, but you may not share edited versions.' },
  { id: 'cc-by-nc', label: 'CC BY-NC 4.0', free: false, note: 'Attribution required; not for commercial use.' },
  { id: 'cc-by-nc-sa', label: 'CC BY-NC-SA', free: false, note: 'Attribution required, not for commercial use, edits must use the same licence.' },
  { id: 'cc-by-nc-nd', label: 'CC BY-NC-ND', free: false, note: 'Attribution required, not for commercial use, no edited versions.' },
  { id: 'sampling', label: 'CC Sampling+', free: false, note: 'Sampling and remixing allowed with attribution; check the licence for other uses.' },
  { id: 'licensed', label: 'Licensed / paid', free: false, note: 'Use needs a licence from the owner.' },
];
export const licenseOf = (id: License) => LICENSES.find((l) => l.id === id) ?? LICENSES[0];

export type Drums = 'none' | 'four' | 'rock' | 'hiphop' | 'trap' | 'cinema' | 'darbuka' | 'lofi' | 'broadcast' | 'soft' | 'march' | 'dnb';
export type Layer = 'pad' | 'strings' | 'piano' | 'pluck' | 'arp' | 'bass' | 'sub' | 'lead' | 'bells' | 'brass' | 'choir' | 'guitar' | 'oud' | 'ney' | 'synth' | 'risers' | 'booms' | 'vinyl' | 'clock' | 'drone' | 'organ' | 'santur';
export type ScaleName = 'major' | 'minor' | 'dorian' | 'phrygian' | 'hijaz' | 'lydian' | 'harmonicMinor' | 'mixolydian';

export interface Recipe {
  genre: string; moods: string[]; bpm: [number, number]; scales: ScaleName[]; progs: number[][]; drums: Drums; layers: Layer[];
  dur: [number, number]; instruments: string[]; reverb: number; bright: number; purpose: string;
}
const R = (r: Partial<Recipe> & Pick<Recipe, 'genre' | 'moods' | 'layers'>): Recipe => ({
  bpm: [90, 110], scales: ['minor'], progs: [[0, 5, 3, 4]], drums: 'none', dur: [45, 70], instruments: [], reverb: 0.3, bright: 0.5, purpose: '', ...r,
});

export interface MusicCategory { id: string; name: string; recipe: Recipe; titles: string[] }
export const MUSIC: MusicCategory[] = [
  { id: 'cinematic', name: 'Cinematic', titles: ['Northern Light', 'Long Horizon', 'Glass Valley'], recipe: R({ genre: 'Orchestral', moods: ['epic', 'emotional', 'hopeful'], bpm: [70, 90], scales: ['minor', 'lydian'], progs: [[0, 5, 2, 6], [0, 3, 5, 4]], drums: 'cinema', layers: ['strings', 'pad', 'piano', 'booms', 'risers', 'sub', 'choir'], instruments: ['strings', 'piano', 'choir', 'percussion'], reverb: 0.55, purpose: 'film trailer documentary' }) },
  { id: 'epic', name: 'Epic & Trailer', titles: ['Iron Crown', 'Last Stand', 'Rise of Giants'], recipe: R({ genre: 'Trailer', moods: ['epic', 'powerful', 'heroic'], bpm: [80, 100], scales: ['minor', 'harmonicMinor'], progs: [[0, 5, 6, 4], [0, 6, 5, 4]], drums: 'cinema', layers: ['strings', 'brass', 'choir', 'booms', 'risers', 'sub', 'bass'], instruments: ['brass', 'choir', 'taiko', 'strings'], reverb: 0.55, bright: 0.6, dur: [50, 70], purpose: 'trailer game action' }) },
  { id: 'emotional', name: 'Emotional', titles: ['Letters Home', 'Quiet Courage', 'Paper Boats'], recipe: R({ genre: 'Piano & Strings', moods: ['emotional', 'tender', 'warm'], bpm: [64, 80], scales: ['major', 'minor'], progs: [[0, 4, 5, 3], [5, 3, 0, 4]], layers: ['piano', 'strings', 'pad', 'bells'], instruments: ['piano', 'strings', 'celesta'], reverb: 0.5, bright: 0.4, purpose: 'wedding memorial story' }) },
  { id: 'sad', name: 'Sad & Dramatic', titles: ['Grey Window', 'What Remains', 'Rain on Stone'], recipe: R({ genre: 'Drama', moods: ['sad', 'dramatic', 'melancholic'], bpm: [58, 72], scales: ['minor', 'harmonicMinor'], progs: [[0, 5, 3, 4], [0, 3, 6, 4]], layers: ['strings', 'piano', 'pad', 'drone'], instruments: ['cello', 'piano', 'strings'], reverb: 0.6, bright: 0.3, purpose: 'drama loss tragedy' }) },
  { id: 'happy', name: 'Happy & Positive', titles: ['Sunny Errands', 'Bright Side', 'Good Morning Walk'], recipe: R({ genre: 'Acoustic Pop', moods: ['happy', 'positive', 'playful'], bpm: [110, 128], scales: ['major', 'mixolydian'], progs: [[0, 4, 5, 3], [0, 3, 4, 3]], drums: 'soft', layers: ['guitar', 'pluck', 'bass', 'bells', 'piano'], instruments: ['ukulele', 'guitar', 'glockenspiel', 'claps'], reverb: 0.25, bright: 0.7, purpose: 'vlog kids commercial' }) },
  { id: 'corporate', name: 'Corporate & Business', titles: ['Clear Goals', 'Next Quarter', 'Forward Motion'], recipe: R({ genre: 'Corporate', moods: ['confident', 'positive', 'clean'], bpm: [100, 118], scales: ['major'], progs: [[0, 4, 5, 3], [5, 3, 0, 4]], drums: 'soft', layers: ['piano', 'pluck', 'pad', 'bass', 'arp'], instruments: ['piano', 'synth pluck', 'pad'], reverb: 0.3, bright: 0.6, purpose: 'presentation business explainer' }) },
  { id: 'news', name: 'News & Broadcast', titles: ['Top of the Hour', 'Breaking Desk', 'Evening Bulletin'], recipe: R({ genre: 'Broadcast', moods: ['urgent', 'serious', 'driving'], bpm: [118, 128], scales: ['minor'], progs: [[0, 5, 6, 4], [0, 6, 5, 6]], drums: 'broadcast', layers: ['strings', 'brass', 'synth', 'sub', 'booms', 'clock'], instruments: ['staccato strings', 'timpani', 'synth'], reverb: 0.35, bright: 0.6, dur: [35, 50], purpose: 'news tv broadcast' }) },
  { id: 'documentary', name: 'Documentary', titles: ['Field Notes', 'Under the Surface', 'Old Maps'], recipe: R({ genre: 'Ambient Orchestral', moods: ['curious', 'thoughtful', 'calm'], bpm: [80, 96], scales: ['dorian', 'minor'], progs: [[0, 3, 4, 3], [0, 6, 3, 4]], drums: 'soft', layers: ['pluck', 'pad', 'strings', 'bass', 'bells'], instruments: ['pizzicato', 'pad', 'marimba'], reverb: 0.4, purpose: 'documentary nature history' }) },
  { id: 'action', name: 'Action & Adventure', titles: ['Rooftop Chase', 'Wild Pass', 'Counterstrike'], recipe: R({ genre: 'Action', moods: ['energetic', 'tense', 'heroic'], bpm: [130, 150], scales: ['minor', 'phrygian'], progs: [[0, 6, 5, 6], [0, 5, 6, 4]], drums: 'rock', layers: ['strings', 'brass', 'bass', 'synth', 'booms', 'risers'], instruments: ['staccato strings', 'drums', 'brass'], reverb: 0.35, bright: 0.65, purpose: 'action sport game chase' }) },
  { id: 'suspense', name: 'Suspense & Tension', titles: ['Something Moved', 'Locked Room', 'Low Signal'], recipe: R({ genre: 'Thriller', moods: ['tense', 'dark', 'mysterious'], bpm: [80, 100], scales: ['phrygian', 'harmonicMinor'], progs: [[0, 1, 0, 6], [0, 0, 1, 0]], drums: 'none', layers: ['drone', 'clock', 'strings', 'sub', 'pluck', 'risers'], instruments: ['drone', 'ticking', 'low strings'], reverb: 0.5, bright: 0.3, purpose: 'thriller crime investigation' }) },
  { id: 'horror', name: 'Horror & Dark', titles: ['Basement Hum', 'The Visitor', 'Hollow Choir'], recipe: R({ genre: 'Horror', moods: ['scary', 'dark', 'eerie'], bpm: [60, 76], scales: ['phrygian', 'harmonicMinor'], progs: [[0, 1, 0, 1], [0, 6, 1, 0]], layers: ['drone', 'choir', 'sub', 'booms', 'bells'], instruments: ['drone', 'choir', 'music box'], reverb: 0.7, bright: 0.25, purpose: 'horror halloween dark' }) },
  { id: 'ambient', name: 'Ambient & Atmospheric', titles: ['Slow Tide', 'Cloud Room', 'Distant Shore'], recipe: R({ genre: 'Ambient', moods: ['calm', 'dreamy', 'spacious'], bpm: [60, 80], scales: ['lydian', 'major'], progs: [[0, 4, 3, 0], [0, 1, 4, 3]], layers: ['pad', 'drone', 'bells', 'arp'], instruments: ['pads', 'textures', 'bells'], reverb: 0.7, bright: 0.4, dur: [55, 80], purpose: 'background meditation space' }) },
  { id: 'inspirational', name: 'Inspirational', titles: ['Higher Ground', 'First Light', 'New Chapter'], recipe: R({ genre: 'Uplifting', moods: ['inspiring', 'hopeful', 'uplifting'], bpm: [90, 110], scales: ['major'], progs: [[0, 4, 5, 3], [3, 4, 0, 5]], drums: 'soft', layers: ['piano', 'strings', 'pad', 'bass', 'bells', 'arp'], instruments: ['piano', 'strings', 'bells'], reverb: 0.45, bright: 0.6, purpose: 'charity success story' }) },
  { id: 'motivational', name: 'Motivational', titles: ['No Limits', 'Push Forward', 'Game Day'], recipe: R({ genre: 'Pop Rock', moods: ['motivational', 'energetic', 'positive'], bpm: [120, 132], scales: ['major', 'mixolydian'], progs: [[0, 4, 5, 3], [5, 3, 0, 4]], drums: 'rock', layers: ['guitar', 'bass', 'piano', 'synth', 'risers'], instruments: ['electric guitar', 'drums', 'piano'], reverb: 0.3, bright: 0.7, purpose: 'sport fitness promo' }) },
  { id: 'relaxing', name: 'Relaxing & Meditation', titles: ['Breathing Room', 'Soft Garden', 'Still Water'], recipe: R({ genre: 'Meditation', moods: ['relaxing', 'peaceful', 'calm'], bpm: [56, 70], scales: ['major', 'lydian'], progs: [[0, 3, 0, 4], [0, 5, 3, 4]], layers: ['pad', 'bells', 'drone', 'santur'], instruments: ['singing bowls', 'pad', 'harp'], reverb: 0.75, bright: 0.35, dur: [60, 80], purpose: 'yoga spa sleep meditation' }) },
  { id: 'lofi', name: 'Lo-Fi & Chill', titles: ['Late Tea', 'Window Seat', 'Sunday Notes'], recipe: R({ genre: 'Lo-Fi Hip-Hop', moods: ['chill', 'relaxed', 'nostalgic'], bpm: [72, 86], scales: ['dorian', 'major'], progs: [[1, 4, 0, 5], [3, 2, 1, 4]], drums: 'lofi', layers: ['piano', 'bass', 'vinyl', 'pad', 'guitar'], instruments: ['rhodes', 'vinyl', 'boom bap drums'], reverb: 0.35, bright: 0.3, purpose: 'study vlog chill' }) },
  { id: 'electronic', name: 'Electronic', titles: ['Neon District', 'Pulse Driver', 'Circuit Bloom'], recipe: R({ genre: 'Electronic', moods: ['energetic', 'modern', 'driving'], bpm: [120, 128], scales: ['minor'], progs: [[0, 5, 2, 6], [0, 3, 6, 5]], drums: 'four', layers: ['synth', 'arp', 'bass', 'pad', 'risers'], instruments: ['synth', 'arpeggiator', '909 drums'], reverb: 0.3, bright: 0.7, purpose: 'club tech promo' }) },
  { id: 'hiphop', name: 'Hip-Hop & Beats', titles: ['Block Party', 'Gold Chain Theory', 'Night Shift'], recipe: R({ genre: 'Hip-Hop', moods: ['confident', 'urban', 'cool'], bpm: [84, 96], scales: ['minor', 'dorian'], progs: [[0, 5, 3, 4], [0, 0, 5, 6]], drums: 'trap', layers: ['bass', 'sub', 'bells', 'pad', 'piano'], instruments: ['808', 'hi-hats', 'keys'], reverb: 0.25, purpose: 'urban street fashion' }) },
  { id: 'poprock', name: 'Pop & Rock', titles: ['Open Road', 'Summer Static', 'Loud Hearts'], recipe: R({ genre: 'Pop Rock', moods: ['energetic', 'happy', 'driving'], bpm: [118, 136], scales: ['major', 'mixolydian'], progs: [[0, 4, 5, 3], [0, 6, 3, 4]], drums: 'rock', layers: ['guitar', 'bass', 'lead', 'organ'], instruments: ['electric guitar', 'bass', 'drums'], reverb: 0.25, bright: 0.7, purpose: 'commercial travel youth' }) },
  { id: 'classical', name: 'Classical & Orchestral', titles: ['Little Waltz', 'Court Dance', 'Morning Prelude'], recipe: R({ genre: 'Classical', moods: ['elegant', 'graceful', 'classic'], bpm: [84, 104], scales: ['major', 'harmonicMinor'], progs: [[0, 3, 4, 0], [0, 5, 1, 4]], layers: ['strings', 'piano', 'bells', 'bass'], instruments: ['strings', 'piano', 'harpsichord'], reverb: 0.5, purpose: 'period drama elegant' }) },
  { id: 'kurdish', name: 'Kurdish & Traditional', titles: ['Zagros Morning', 'Dilan Steps', 'Mountain Wedding'], recipe: R({ genre: 'Kurdish Traditional', moods: ['proud', 'joyful', 'nostalgic'], bpm: [96, 120], scales: ['phrygian', 'hijaz'], progs: [[0, 1, 0, 6], [0, 6, 5, 6]], drums: 'darbuka', layers: ['oud', 'ney', 'santur', 'drone', 'bass'], instruments: ['tembûr', 'blûr (ney)', 'santur', 'daf', 'darbuka'], reverb: 0.35, bright: 0.55, purpose: 'kurdish wedding dilan culture' }) },
  { id: 'arabic', name: 'Arabic & Middle Eastern', titles: ['Desert Caravan', 'Old Souq', 'Moonlit Courtyard'], recipe: R({ genre: 'Middle Eastern', moods: ['mystical', 'warm', 'exotic'], bpm: [90, 110], scales: ['hijaz', 'harmonicMinor'], progs: [[0, 1, 0, 6], [0, 3, 1, 0]], drums: 'darbuka', layers: ['oud', 'ney', 'strings', 'drone', 'bass'], instruments: ['oud', 'ney', 'qanun', 'darbuka'], reverb: 0.4, purpose: 'travel culture ramadan' }) },
  { id: 'sports', name: 'Sports & Competition', titles: ['Final Whistle', 'Stadium Lights', 'Overtime'], recipe: R({ genre: 'Sport Rock', moods: ['energetic', 'competitive', 'powerful'], bpm: [130, 145], scales: ['minor', 'mixolydian'], progs: [[0, 6, 5, 6], [0, 5, 6, 4]], drums: 'rock', layers: ['guitar', 'bass', 'brass', 'synth', 'booms'], instruments: ['guitar', 'stomps', 'brass'], reverb: 0.3, bright: 0.7, purpose: 'sport highlights match' }) },
  { id: 'podcast', name: 'Podcast & Interview', titles: ['Talk Easy', 'Studio Couch', 'Open Mic Bed'], recipe: R({ genre: 'Soft Background', moods: ['calm', 'friendly', 'neutral'], bpm: [86, 100], scales: ['major', 'dorian'], progs: [[0, 4, 5, 3], [1, 4, 0, 5]], drums: 'soft', layers: ['piano', 'pad', 'bass', 'pluck'], instruments: ['keys', 'soft drums', 'bass'], reverb: 0.3, bright: 0.4, purpose: 'podcast interview talk background' }) },
  { id: 'intro', name: 'Intro & Outro', titles: ['Channel Open', 'Signing Off', 'Episode Start'], recipe: R({ genre: 'Intro', moods: ['bright', 'catchy', 'energetic'], bpm: [110, 125], scales: ['major'], progs: [[0, 4, 5, 3]], drums: 'four', layers: ['synth', 'bells', 'bass', 'risers', 'booms'], instruments: ['synth', 'bells', 'drums'], reverb: 0.35, bright: 0.7, dur: [9, 15], purpose: 'youtube intro outro opener' }) },
  { id: 'logo', name: 'Logo Reveal & Stingers', titles: ['Logo Shine', 'Brand Hit', 'Glass Logo'], recipe: R({ genre: 'Stinger', moods: ['impactful', 'clean', 'modern'], bpm: [100, 120], scales: ['major', 'lydian'], progs: [[0, 4]], layers: ['risers', 'booms', 'bells', 'pad', 'brass'], instruments: ['riser', 'impact', 'shimmer'], reverb: 0.6, bright: 0.7, dur: [4, 7], purpose: 'logo reveal sting brand' }) },
  { id: 'transitions', name: 'Short Transitions', titles: ['Quick Cut', 'Scene Turn', 'Swipe Over'], recipe: R({ genre: 'Transition', moods: ['quick', 'clean', 'energetic'], bpm: [110, 130], scales: ['major', 'minor'], progs: [[0, 4]], layers: ['risers', 'booms', 'arp', 'bells'], instruments: ['riser', 'hit', 'arp'], reverb: 0.4, dur: [2, 4], purpose: 'transition scene change' }) },
  { id: 'tech', name: 'Technology & Futuristic', titles: ['Data Stream', 'Quantum Glass', 'Orbit Station'], recipe: R({ genre: 'Future Tech', moods: ['futuristic', 'modern', 'clean'], bpm: [110, 124], scales: ['lydian', 'minor'], progs: [[0, 5, 2, 6], [0, 1, 4, 3]], drums: 'dnb', layers: ['arp', 'synth', 'pad', 'sub', 'bells', 'risers'], instruments: ['synth', 'arpeggiator', 'glitch'], reverb: 0.4, bright: 0.65, purpose: 'technology ai science startup' }) },
];

// ---------------- sound effects ----------------
export type SfxGen =
  | 'whoosh' | 'swish' | 'impact' | 'boom' | 'riser' | 'drop' | 'explosion' | 'crash' | 'fire' | 'wind' | 'rain' | 'thunder'
  | 'birds' | 'crickets' | 'stream' | 'frog' | 'traffic' | 'horn' | 'siren' | 'steps' | 'cloth' | 'click' | 'pop' | 'notify' | 'error' | 'success' | 'typing'
  | 'laser' | 'warp' | 'scan' | 'powerup' | 'heartbeat' | 'creak' | 'drone' | 'stab' | 'crowd' | 'applause' | 'cheer' | 'whistle' | 'bounce' | 'buzzer' | 'kick'
  | 'newsStinger' | 'newsSweep' | 'timpani' | 'shutter' | 'flash' | 'tally' | 'glitch' | 'bitcrush' | 'static' | 'knock' | 'door' | 'paper' | 'drip' | 'glass' | 'keys' | 'pour';
export interface SfxItem { title: string; gen: SfxGen; p?: Record<string, number>; dur: number; moods: string[] }
export interface SfxCategory { id: string; name: string; purpose: string; items: SfxItem[] }
const S = (title: string, gen: SfxGen, dur: number, moods: string[], p?: Record<string, number>): SfxItem => ({ title, gen, dur, moods, p });
export const SFX: SfxCategory[] = [
  { id: 'whoosh', name: 'Whooshes & Transitions', purpose: 'transition swipe swoosh', items: [S('Fast Whoosh', 'whoosh', 1.2, ['fast'], { len: 0.6 }), S('Slow Air Pass', 'whoosh', 2.4, ['smooth'], { len: 1.8 }), S('Swish Left to Right', 'swish', 1, ['quick'], { dir: 1 }), S('Double Swish', 'swish', 1.4, ['quick'], { twice: 1 }), S('Deep Transition Whoosh', 'whoosh', 2.2, ['deep'], { len: 1.4, low: 1 })] },
  { id: 'impacts', name: 'Cinematic Impacts', purpose: 'hit trailer impact boom', items: [S('Trailer Hit', 'impact', 3.5, ['epic']), S('Deep Boom', 'boom', 4.5, ['dark']), S('Metal Impact', 'impact', 3, ['hard'], { metal: 1 }), S('Sub Drop Hit', 'boom', 3.5, ['heavy'], { drop: 1 }), S('Braam Hit', 'impact', 4.5, ['epic'], { braam: 1 })] },
  { id: 'risers', name: 'Risers & Drops', purpose: 'build up riser drop tension', items: [S('Noise Riser 4s', 'riser', 4.5, ['tension'], { len: 4 }), S('Synth Riser 8s', 'riser', 8.5, ['build'], { len: 8, tone: 1 }), S('Short Riser', 'riser', 2.2, ['quick'], { len: 2 }), S('Down Drop', 'drop', 2.5, ['release']), S('Reverse Swell', 'riser', 3.2, ['cinematic'], { len: 3, rev: 1 })] },
  { id: 'explosions', name: 'Explosions & Crashes', purpose: 'explosion blast crash destruction', items: [S('Big Explosion', 'explosion', 5, ['loud']), S('Distant Blast', 'explosion', 5, ['far'], { far: 1 }), S('Glass Crash', 'crash', 3, ['sharp'], { glass: 1 }), S('Metal Crash', 'crash', 3.5, ['heavy']), S('Debris Fall', 'crash', 4, ['rubble'], { debris: 1 })] },
  { id: 'weather', name: 'Fire, Wind, Rain & Thunder', purpose: 'weather nature fire storm', items: [S('Campfire Crackle', 'fire', 12, ['warm']), S('Strong Wind', 'wind', 12, ['cold']), S('Light Wind', 'wind', 12, ['calm'], { soft: 1 }), S('Steady Rain', 'rain', 12, ['calm']), S('Thunder Roll', 'thunder', 7, ['storm'])] },
  { id: 'nature', name: 'Nature & Animals', purpose: 'nature forest animals outdoor', items: [S('Morning Birds', 'birds', 12, ['peaceful']), S('Night Crickets', 'crickets', 12, ['night']), S('Forest Stream', 'stream', 12, ['fresh']), S('Pond Frogs', 'frog', 10, ['night']), S('Single Bird Call', 'birds', 4, ['bright'], { one: 1 })] },
  { id: 'city', name: 'City & Traffic Ambience', purpose: 'city street traffic urban', items: [S('City Street Ambience', 'traffic', 14, ['busy']), S('Car Horn', 'horn', 2, ['short']), S('Two Car Horns', 'horn', 3, ['busy'], { two: 1 }), S('Police Siren Pass', 'siren', 8, ['urgent']), S('Distant Traffic Hum', 'traffic', 14, ['calm'], { far: 1 })] },
  { id: 'footsteps', name: 'Footsteps & Movement', purpose: 'footsteps walking movement foley', items: [S('Footsteps on Wood', 'steps', 6, ['indoor'], { wood: 1 }), S('Footsteps on Gravel', 'steps', 6, ['outdoor'], { gravel: 1 }), S('Running Steps', 'steps', 5, ['fast'], { run: 1 }), S('Heels on Tile', 'steps', 6, ['indoor'], { heels: 1 }), S('Cloth Movement', 'cloth', 3, ['soft'])] },
  { id: 'ui', name: 'UI & Notification Sounds', purpose: 'interface app button notification', items: [S('Soft Click', 'click', 0.4, ['minimal']), S('Bubble Pop', 'pop', 0.5, ['playful']), S('Message Notification', 'notify', 1.4, ['friendly']), S('Error Beep', 'error', 0.9, ['alert']), S('Success Chime', 'success', 1.6, ['positive']), S('Keyboard Typing', 'typing', 4, ['work'])] },
  { id: 'scifi', name: 'Sci-Fi & Futuristic', purpose: 'sci-fi laser space robot', items: [S('Laser Shot', 'laser', 1, ['sharp']), S('Warp Jump', 'warp', 3, ['space']), S('Scanner Beam', 'scan', 3, ['tech']), S('Power Up', 'powerup', 2, ['energy']), S('Robot Movement', 'scan', 2.5, ['mechanical'], { robot: 1 })] },
  { id: 'horror', name: 'Horror & Suspense', purpose: 'horror scary suspense', items: [S('Heartbeat', 'heartbeat', 8, ['tense']), S('Creaking Door', 'creak', 4, ['scary']), S('Dark Drone', 'drone', 12, ['eerie']), S('Horror Stab', 'stab', 3, ['shock']), S('Ghost Whisper Wind', 'wind', 8, ['eerie'], { ghost: 1 })] },
  { id: 'crowd', name: 'Crowd, Applause & Cheering', purpose: 'crowd audience applause cheer', items: [S('Applause Medium', 'applause', 8, ['warm']), S('Big Applause', 'applause', 10, ['big'], { big: 1 }), S('Stadium Cheer', 'cheer', 8, ['excited']), S('Crowd Murmur', 'crowd', 12, ['busy']), S('Short Clap Burst', 'applause', 3, ['quick'], { short: 1 })] },
  { id: 'sports', name: 'Sports Effects', purpose: 'sport game match', items: [S('Referee Whistle', 'whistle', 1.5, ['sharp']), S('Ball Bounce', 'bounce', 3, ['play']), S('Final Buzzer', 'buzzer', 2, ['loud']), S('Ball Kick', 'kick', 1.2, ['punchy']), S('Long Whistle', 'whistle', 2.5, ['end'], { long: 1 })] },
  { id: 'news', name: 'News Broadcast Stingers', purpose: 'news tv stinger bumper', items: [S('Breaking News Stinger', 'newsStinger', 4, ['urgent']), S('Headline Sweep', 'newsSweep', 2.5, ['quick']), S('Timpani Roll Hit', 'timpani', 4, ['dramatic']), S('Countdown Ticks', 'newsStinger', 5, ['tense'], { ticks: 1 }), S('Bulletin Bumper', 'newsStinger', 3, ['clean'], { short: 1 })] },
  { id: 'camera', name: 'Camera & Studio Sounds', purpose: 'camera photo studio', items: [S('Camera Shutter', 'shutter', 0.8, ['crisp']), S('Burst Shutter', 'shutter', 1.6, ['fast'], { burst: 1 }), S('Flash Charge', 'flash', 2.2, ['electronic']), S('On Air Tally Beep', 'tally', 1.2, ['studio']), S('Film Projector', 'shutter', 6, ['vintage'], { projector: 1 })] },
  { id: 'glitch', name: 'Glitches & Digital', purpose: 'glitch digital error data', items: [S('Data Glitch', 'glitch', 1.5, ['digital']), S('Bitcrush Burst', 'bitcrush', 1.5, ['harsh']), S('TV Static', 'static', 5, ['noisy']), S('Stutter Glitch', 'glitch', 2, ['rhythmic'], { stutter: 1 }), S('Digital Zap', 'laser', 0.8, ['quick'], { zap: 1 })] },
  { id: 'foley', name: 'Everyday Foley', purpose: 'foley everyday household', items: [S('Door Knock', 'knock', 2, ['indoor']), S('Door Close', 'door', 2.5, ['indoor']), S('Paper Rustle', 'paper', 3, ['soft']), S('Water Drip', 'drip', 6, ['calm']), S('Glass Clink', 'glass', 2, ['bright']), S('Keys Jingle', 'keys', 2.5, ['metal']), S('Pouring Water', 'pour', 5, ['liquid'])] },
];

// ---------------- the tracks ----------------
export interface Track {
  id: string; kind: Kind; title: string; category: string; categoryName: string; moods: string[]; genre: string;
  instruments: string[]; tags: string[]; bpm: number | null; duration: number; format: string; license: License; attribution?: string;
  description?: string; addedAt: number; builtin: boolean; seed: number;
  /** built-in sound recipes */
  music?: { recipe: Recipe; scale: ScaleName; prog: number[]; root: number; variant: number };
  sfx?: SfxItem;
  /** uploaded: blobs live in IndexedDB */
  cover?: string | null;
  /** found online (Openverse): played and downloaded from the original host */
  remote?: { url: string; landing: string; creator: string; creatorUrl: string | null; licenseUrl: string; provider: string; waveform: string | null };
}
function rnd(seed: number) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
export const RELEASED = Date.UTC(2026, 9, 20);
export const BUILTIN: Track[] = (() => {
  const out: Track[] = [];
  MUSIC.forEach((c, ci) => c.titles.forEach((title, v) => {
    const seed = (ci + 1) * 1009 + v * 7919;
    const r = rnd(seed); const rc = c.recipe;
    const bpm = Math.round(rc.bpm[0] + (rc.bpm[1] - rc.bpm[0]) * r());
    const duration = Math.round((rc.dur[0] + (rc.dur[1] - rc.dur[0]) * r()) * 10) / 10;
    const scale = rc.scales[v % rc.scales.length]; const prog = rc.progs[v % rc.progs.length];
    const root = 45 + Math.floor(r() * 8);
    out.push({
      id: `m-${c.id}-${v + 1}`, kind: 'music', title, category: c.id, categoryName: c.name, moods: rc.moods, genre: rc.genre, instruments: rc.instruments,
      tags: [...rc.purpose.split(' '), ...rc.moods], bpm, duration, format: 'WAV · MP3', license: 'original', addedAt: RELEASED - (ci * 3 + v) * 3600_000, builtin: true, seed,
      music: { recipe: rc, scale, prog, root, variant: v },
    });
  }));
  SFX.forEach((c, ci) => c.items.forEach((it, v) => {
    out.push({
      id: `s-${c.id}-${v + 1}`, kind: 'sfx', title: it.title, category: c.id, categoryName: c.name, moods: it.moods, genre: 'Sound effect', instruments: [],
      tags: [...c.purpose.split(' '), it.gen], bpm: null, duration: it.dur, format: 'WAV · MP3', license: 'original', addedAt: RELEASED - (ci * 5 + v) * 3600_000 - 86_400_000, builtin: true,
      seed: (ci + 101) * 2003 + v * 6151, sfx: it,
    });
  }));
  return out;
})();
export const ALL_MOODS = [...new Set([...MUSIC.flatMap((c) => c.recipe.moods), ...SFX.flatMap((c) => c.items.flatMap((i) => i.moods))])].sort();
export const ALL_GENRES = [...new Set(MUSIC.map((c) => c.recipe.genre))].sort();
