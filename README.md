# KURD DESIGN

A layered image editor and graphic design tool that runs entirely in the browser. Photos, social graphics, posters, logos, thumbnails and print layouts — with non‑destructive adjustment layers, masks, editable text and vector shapes, PSD import/export, and local projects with crash recovery.

## Run it

```bash
npm install
npm run dev        # Vite dev server
npm run build      # production build in dist/
npm run typecheck  # strict TypeScript check
```

No network access needed at runtime. Google Fonts are loaded on demand for the text tool; offline, text falls back to system fonts.

Offline build without Vite (uses only `esbuild` + `tailwindcss`):

```bash
npm run build:offline   # dist/index.html + dist/kurd-design.html (single self-contained file)
npm run dev:offline     # rebuild on change, served at http://localhost:5173
```

## Languages

The interface is available in **English**, **کوردی (Kurdish Sorani)** and **العربية (Arabic)** — pick one from the language button in the top bar or on the start screen. Only the language changes: the layout stays exactly the same, and Kurdish/Arabic labels read right-to-left in place. The choice is remembered in the browser.

Text layers support Kurdish and Arabic writing (right-to-left lines, joined letters), and the font list includes Arabic-script fonts with the Sorani letters: Noto Sans Arabic, Vazirmatn, Noto Kufi Arabic, Noto Naskh Arabic, Cairo, Tajawal, Amiri, Reem Kufi and Lalezar.

Translations live in `src/i18n/ckb.ts` and `src/i18n/ar.ts` (English text → translation). See `src/i18n/index.ts` for how they are applied.

## Works on any screen

The layout adapts to the window's width and height: on laptops and desktops all panels are docked; on tablets and phones the side panels open as drawers (the Panels / Project / Properties buttons), menus and toolbars scroll sideways, and the timeline height follows the screen height (drag its top edge to resize).

## Editable text and smart objects

- **Edit text any time**: double-click a text layer on the canvas (Move or Type tool) or its thumbnail in the Layers panel, use Layer › Edit Text, or change the words in the **Text** box in the Properties panel.
- **Convert to Smart Object** (Layer › Smart Objects, or right-click a layer): wraps one or more layers — text, shapes, photos — into one layer you can scale and rotate without losing quality.
- **Smart filters**: filters and Image › Adjustments applied to a smart object stay editable. They are listed under the layer; double-click one to change it, click the eye to hide it, or delete it.
- **Edit Contents**: double-click a smart object to open its layers in their own tab. Change anything (e.g. the text), then press Save (Ctrl/Cmd+S) or **Done** to update the smart object.

## MOTION (animation & video)

Click **Motion** at the top to switch from photo editing to the motion-graphics workspace (click **Design** to go back; both keep their work).

- **Compositions**: presets 1920×1080, 1080×1920, 1080×1350, 1080×1080, 3840×2160 or custom; 24/25/30/50/60 fps; duration, background color, motion-blur shutter. Several compositions in tabs; nest one in another (pre-compose, double-click to enter).
- **Layers**: video (MP4/MOV/WebM), image, audio, text, shapes (rectangle, rounded rectangle, ellipse, polygon, star, line, arrow, pen path), solid, null, adjustment, pre-comp and 2D/3D camera. Visibility, lock, solo, shy, parenting, blend modes, 3D, motion blur, in/out points, trim, split (Ctrl+Shift+D), duplicate, speed.
- **Timeline**: play/pause/stop/loop (Space), frame step (Page Up/Down), zoom and scroll, snapping, markers (*), work area (B/N), keyframe rows for every property.
- **Keyframes**: click the stopwatch next to any property, then change values at another time — a new keyframe is added automatically. With **Auto-Key** on (red button in the timeline, Alt+Shift+K) you don't even need the stopwatch: moving, scaling, rotating or changing any value records keyframes by itself. Select, box-select, drag, copy/paste, duplicate, delete. Linear, hold, Easy Ease (F9), ease in/out, bezier; the **Graph Editor** (Shift+F3) edits speed curves with handles. Position keyframes draw an editable motion path in the viewer.
- **Masks**: rectangle, ellipse and pen masks on any layer; add/subtract/intersect, feather, opacity, expansion, invert — all animatable.
- **Effects** (Effect menu or Effects & Presets panel): blur, color correction, distortion, glow, stylize, noise, sharpen, transform, keying (Chroma Key for green screen with spill suppression and matte view), shadow. Every parameter can be keyframed.
- **Presets**: text (fade, slide, scale, typewriter, character/word reveal, bounce, pop, blur, glitch), logo, shape, transitions, glitch, cinematic, minimal, modern and broadcast (lower third, title card, news ticker). They create normal keyframes you can edit; save your own animation as a preset.
- **Audio**: waveforms, volume (dB) keyframes, mute, fade in/out.
- **Render**: MP4 (H.264 + AAC), WebM (VP9 + Opus, transparent where the browser supports it), GIF, PNG or JPEG sequence (.zip); size, fps, quality, bitrate, work area or whole composition. Video export uses WebCodecs (Chrome, Edge, recent Safari).
- **Projects**: File › Save Project downloads a `.kdmotion` file with all media; the last session is also kept in browser storage (File › Restore Last Session). Undo/redo: Ctrl+Z / Ctrl+Shift+Z.

## PODCAST (automatic multicam editing)

Click **Podcast** at the top. Made for podcasts, interviews, talk shows and panels recorded with **three or more cameras** and **two or more people**.

1. **People** — type the names; optionally add each person's own microphone recording (most accurate).
2. **Cameras** — add all camera videos at once (or drop them anywhere). For each camera choose what it **Shows**: a person (a person can have several cameras: medium, close-up…), the **wide shot** (two-shot / group), or an **insert camera** (hands, table, product, audience). Cameras get the keys 1–9.
3. **Inserts / B-roll** — optional extra clips (places, objects, archive footage).
4. **Analyse** — the app reads the sound of every recording, **synchronises** all cameras and microphones by cross-correlating their sound (to the millisecond; offsets can be nudged frame by frame), finds **who speaks when** for any number of people (voice activity + per-voice level calibration, robust to microphone bleed), and checks by **picture movement** which voice belongs to which person (all assignments compared). Each voice can be re-assigned by hand.
5. **Automatic edit** — follows conversation-editing practice:
   - the camera goes to the person speaking and holds while they keep the floor; a person with several cameras gets a **different angle on each new turn**, and an angle change inside long answers;
   - short replies from listeners ("yeah", "mm-hmm") don't cause a cut, they become **reaction shots** — preferably the real reaction, otherwise the person being answered;
   - several people talking at once (crosstalk) or a long silence → the **wide shot**;
   - **inserts** (insert camera or B-roll) only in the middle of long answers: never before the speaker has been established, never at the end of a turn (the edit always returns to the speaker before the next person talks), never during crosstalk, never back to back with another cutaway, spaced by talk time (Few / Normal / Many), with the conversation sound continuing;
   - cuts land **in the pause** before the new speaker (or on the first word, or late as a J-cut); a **shortest shot** and a **longest speaker shot**; establishing and closing wide shots; pacing presets **Calm / Balanced / Dynamic**;
   - numbers of the edit: shots, average shot length (ASL), cuts per minute, screen time per camera, talk time per person.
6. **Vision mixer** — now its own workspace: click **Mixer** at the top (see *VISION MIXER* below). It uses the same cameras and the same timeline, so switching there and the automatic edit here are one edit.
7. **Split screens** — add a split input from your cameras (side by side, two boxes, top and bottom, three, 2 × 2, picture in picture). It becomes an input like a camera; the automatic edit uses a split that shows two people for their quick back-and-forth (three or more short alternating turns) and when they talk at the same time. Move, resize and crop its boxes freely in the Mixer (SuperSource).
8. **Sound follows the speaker** (automix) — only the person who is speaking is heard: each person's microphone (or camera sound) opens 0.15 s before they speak and closes 0.5 s after, several people at once are all open, during silences the last speaker stays open (room tone), with 60 ms fades; the others are turned off or down (−24/−15/−9 dB). Used in the preview, the rendered video, the Premiere/DaVinci export (one audio track per person, cut to the moments they speak) and Send to Motion (volume keyframes). Or choose one master track.
9. **Review** — program monitor + all cameras; click a camera (or press its number) to change the current shot, or press the number **while playing** to switch live. Click a shot on the timeline to change its camera or pick a B-roll clip, drag a cut to move it, **S** splits, **Delete** removes a shot, Ctrl+Z / Ctrl+Shift+Z undo/redo, ↑/↓ jump between cuts, **I / O** set an export range.
10. **Export**
   - **Render video** — MP4 (H.264, in Chrome/Edge) or WebM; Full HD, HD, 4K, vertical 9:16 (Reels/TikTok) or square, fill or fit. Rendering plays the edit in real time.
   - **Edit for Premiere / DaVinci (.zip)** — FCP7 XML (Premiere Pro, DaVinci Resolve, Final Cut 7) with dissolves and split screens (cells on video tracks 1, 2… with scale, position and crop), CMX3600 EDL, CSV shot list and a written edit report (cameras, sync offsets, talk time, rules used, ASL, shot list with the reason for every cut).
   - **Send to Motion** — the edit becomes a Motion composition (one layer per shot + the sound) to add titles, lower thirds and graphics.
   - **Save edit / Open edit** — keeps cameras, people, cuts, offsets and settings in a small .json file.

## VISION MIXER (live switcher)

Click **Mixer** at the top. The tool bar above the monitors opens every tool in one click: Multiview, Program, Design the multiview, SuperSource · split screen, Reels & sizes, Sound J / L cut, Tips and Shortcuts. A live switcher for the podcast cameras, laid out like a compact broadcast switcher. It works straight away — no analysis needed: add the cameras (or drop them), optionally **Sync cameras by sound**, and switch.

- **Inputs grow with the cameras** — every camera, SuperSource and B-roll clip is an input button (1, 2, 3…), plus Media Player 1/2 (pictures), Color 1/2, Color Bars and Black. Each input has a short button name and a long multiview name you can type.
- **Hardware panel** — a red **PROGRAM** row (cuts at once) and a green **PREVIEW** row of input buttons with **STILL** and **BLACK**: choose the next camera on PREVIEW, then **CUT** (straight) or **AUTO** (the selected effect); **FTB** fades to black; **EFFECT** (wipe left-right, wipe top-bottom, DVE push, circle wipe, MIX, DIP); **DURATION** 0.5 / 1.0 / 1.5 / 2.0 s; **VIDEO OUT** (input 1–4, multiview, program on the big monitor); **PICTURE IN PICTURE** (four corners, ON / OFF); **SUPERSOURCE** (side by side, 2 × 2, picture in picture, three — one click makes the split screen with the cameras filled in; ON puts it on program; EDIT opens the large editor); **REC / STOP** (play and record your switching on the timeline) and **RENDER**; an **audio** section per input (AFV = heard only while on program, ON, OFF, level ▲▼, RESET) and MIC 1 / MIC 2 when people have microphones. **AUDIO** hides the audio buttons for a slimmer panel.
- **Software panel** — Program and Preview buses (the preview always holds the next input, so **CUT** and **AUTO** work straight away; the old program goes back to preview), a **T-bar**, rate, Transition Style (**MIX / DIP / WIPE / DVE**), SuperSource layouts (to preview) and Logo / DSK 1 and 2 (**TIE**, rate, **ON AIR**, **AUTO**).
- **SuperSource (split screens)** — 1 · choose a layout, 2 · click a camera for each box, 3 · drag the boxes and their corners (Shift keeps the shape, snapping, Alt turns snapping off); crop per side, *camera shape*, up to four boxes, bring to front, background, border for all boxes, and a **border per box with each side on its own** (top, bottom, left, right) and its colour. **Animation**: the boxes come in (slide, drop, zoom, grow, fade) when the split goes on air, and **layout changes can be animated** — go to a moment, click a layout, and the boxes move to it from there (recorded, listed, removable).
- **Any file** — videos, sound files and pictures (pictures become still inputs IMG1, IMG2…). Files the browser can't play (AVI, WMV, MKV/HEVC, MXF, MPG, WMA, AC3, AMR, AIFF…) are converted automatically with a built-in FFmpeg converter (downloaded once, about 31 MB).
- **Format · Reels & framing** — YouTube 16:9 (720p / 1080p / 4K), Reels · TikTok · Shorts 9:16, Story 9:16, Instagram / Facebook 4:5, square 1:1, 2:3, 4:3, 21:9, X / LinkedIn, or any size. **Auto centre** finds the person in every camera (skin colour + movement over the whole recording); drag the yellow frame and zoom to centre by hand.
- **Picture in picture and logos** — a camera in a corner (size, position, border, crop); logos and lower thirds (PNG with transparency, in MP1/MP2) over everything with DSK 1 / 2.
- **Multiview** — Preview (green) and Program (red) with tally, names, audio meters, safe area and timecode, and the **suggested** input (amber) from who is talking. Three ready layouts or **your own layout**: press *Layout* on the multiview and, on each window, choose what it shows, make it wider / narrower / taller / shorter, move it or remove it, add windows, choose the number of columns.
- **Resizable layout** — drag the lines between the side panel, the monitors, the switcher panel and the timeline (double-click a line to reset); the panels scale themselves to fit. The sizes are remembered.
- **Timeline** — shots with transitions; a **Sound** lane with the waveform, separate from the picture but **linked**: with *Program sound · Picture* the sound cuts with the picture; unlink (or Alt-drag) to move a sound cut alone for a **J-cut / L-cut**. Lanes for PIP, DSK 1, DSK 2 and FTB. **Tips** (after *Find who speaks*): the timeline marks where the picture shows the wrong person, cuts come late or early, a cut is in the middle of a word, a shot is too long or flashes by, a jump cut, or crosstalk on a single person — each tip says why and fixes it in one click (*Cut to …*, *Move the cut*, *Join the shots*). While switching, the input that fits who is talking glows amber.
- **Render video** (top right) — choose MP4, MOV, WebM, MKV, AVI, GIF, MP3, WAV or M4A; one click renders everything you switched with the sound (I / O set a range). The browser records MP4 or WebM; the other formats are converted afterwards. (Inside the claude.ai preview only MP4, WebM and GIF can be saved.)
- **Keyboard shortcuts** — every tool of the Mixer and the Podcast workspace has a key; open the list with the keyboard button or Shift + /, press *Change* and the new key. Keys follow the key position, so they work with Kurdish, Arabic and English keyboards.

Very large videos (over ~1.9 GB each) can't be read whole by the browser for their sound; add the microphones as separate WAV/MP3 files.

## What's in it

| Area | Highlights |
|---|---|
| Documents | Presets (Instagram, YouTube, A4/A3, HD…), units px/in/cm/mm, resolution, RGB/Grayscale, background white/black/transparent/custom; multiple documents in tabs; Image Size, Canvas Size (anchor), rotate/flip canvas, crop, trim |
| Canvas | Zoom (wheel/pinch, steps, fit, fill, 100%), pan (Space/Hand/middle mouse), view rotation, rulers, draggable guides, grid, pixel grid at ≥800 %, snapping to canvas/guides/layers with smart guides |
| Tools (28) | Move, Rect/Ellipse marquee, Lasso, Polygonal lasso, Magic wand, Crop, Eyedropper, Brush, Pencil, Clone stamp, Eraser, Paint bucket, Gradient (linear/radial/angle/reflected/diamond), Blur, Sharpen, Smudge, Dodge, Burn, Pen, Path selection, Text, Rectangle, Ellipse, Polygon/Star, Line/Arrow, Hand, Zoom — each with its own options bar |
| Layers | Pixel, text, shape, adjustment and group layers; drag‑and‑drop reordering and nesting; multi‑select; rename; hide (Alt‑click to solo); lock; opacity & fill; 16 blend modes + pass‑through; clipping masks; merge down/selected/visible; flatten; rasterize; align & distribute |
| Transform | Handles for scale/rotate/skew, distort and perspective; Shift constrain, Alt from center, 15° rotation snap; numeric X/Y/W/H/angle; flips and 90° rotations. Pixel layers keep their original pixels until a destructive edit (non‑destructive scaling) |
| Text | On‑canvas editing; font, weight, size, italic, underline, strikethrough, alignment (incl. justify), tracking, leading, color, opacity, case, stroke, shadow; point or wrapping paragraph text; stays editable |
| Shapes | Rectangle (corner radius), ellipse, polygon, star, triangle, line, arrow, custom pen paths; solid or gradient fill, stroke (inside/center/outside, dashed/dotted), editable anchors |
| Masks | Layer masks (reveal all / hide all / from selection, paint black/white/gray, density, feather, invert, disable, apply, link, view) and vector masks |
| Selections | Rect, ellipse, lasso, polygon, magic wand, color range; add/subtract/intersect; select all/inverse/reselect; feather/expand/contract/border; transform selection; move selection; animated edges |
| Adjustments | As layers (non‑destructive) or applied to pixels: Color Adjust (exposure, brightness, contrast, highlights, shadows, whites, blacks, temperature, tint, vibrance, saturation, hue, gamma, clarity, sharpness), Brightness/Contrast, Levels, Curves, Exposure, Hue/Saturation, Vibrance, Color Balance, Black & White, Gradient Map, Selective Color, Invert, Threshold, Posterize |
| Filters | Gaussian/Box/Motion/Radial blur, Sharpen, Unsharp mask, Add noise, Median, Pixelate, Emboss, Find edges, Glow, Twirl, Wave, Pinch, Spherize — live preview, run in a Web Worker with progress; Drop shadow, Outer glow and Stroke as editable layer styles |
| Color | HSV picker with HEX / RGB / HSL / HSB entry, foreground/background, recent colors, swatches, eyedropper |
| History | Undo/redo with a History panel; slider drags merge into one step; memory‑bounded |
| Files | Open/import PNG, JPG, WEBP, GIF (first frame), BMP, SVG, TIFF (none/PackBits/LZW/Deflate), PSD, `.dps` projects; drag‑and‑drop and clipboard paste; export PNG/JPG/WEBP (quality, size, DPI, transparency), SVG (vectors kept), PDF, PSD |
| Projects | Save to browser storage (IndexedDB) with thumbnails; recent projects; rename/delete; download `.dps` backups; autosave with "Recover previous document?" after a crash |

Keyboard shortcuts follow desktop conventions (V, M, L, W, C, I, B, S, E, G, R, O, P, T, A, U, H, Z; Shift cycles tools in a group; Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z, Ctrl/Cmd+S/O/N/C/V/X/A/J/G/E/T, Delete, arrows to nudge, `[` `]` brush size, 1–0 opacity, Space for Hand, Tab to collapse panels). Help › Keyboard Shortcuts lists them all. Shortcuts never fire while typing in a field.

## Architecture

```
src/
  types/        document model (layers, masks, shapes, text, adjustments, history)
  state/        Zustand‑compatible stores: documents+history, tools, UI (persisted)
  history/      memory accounting for undo states
  layers/       tree operations, factories, geometry/hit testing, document operations (crop, resize, rotate)
  canvas/       Engine (viewport, input, overlays, rulers), Compositor (blend modes, masks, clipping, effects,
                adjustment layers, caching, dirty‑rect redraws), text & shape renderers, selections
  tools/        one module per tool family + shared transform session and brush engine
  adjustments/  pixel processing for every adjustment type
  filters/      self‑contained filter kernel (serialized into a Web Worker), definitions, runner
  file-system/  importers, exporters (PNG/JPG/WEBP/SVG/PDF), PSD reader/writer, TIFF decoder, projects, IndexedDB
  editor/       user‑level actions (layers, edit, files, clipboard, presets) shared by menus, panels and shortcuts
  shortcuts/    command registry (menus + shortcuts share one source) and keyboard dispatcher
  components/   React UI: editor shell, panels, dialogs, controls
```

Key design decisions:

- **Immutable document state.** Every edit produces a new `DocState`; pixel canvases are never mutated after they are committed, so history states share unchanged layers and undo is instant.
- **Canvas outside React.** The `Engine` subscribes to the stores and redraws on `requestAnimationFrame`; React only re-renders panels. Tools draw live previews through engine "overrides" and commit once on pointer up.
- **Non‑destructive by default.** Layer transforms are matrices, adjustments are layers, masks are separate, effects are styles. Only explicit pixel operations (painting, filters, Image › Adjustments) bake pixels.
- **Performance.** Per‑layer render caching, cached adjustment inputs, a reduced‑resolution preview while dragging adjustment sliders on large images (refined when you pause), dirty‑rectangle recomposite while painting, a mip‑mapped view when zoomed out, filters in a Web Worker (with automatic main‑thread fallback when workers are blocked).
- **One command registry** drives the menu bar, keyboard shortcuts and tooltips so they can't drift apart.

## Notes and limits

- PSD: 8‑bit RGB/Grayscale files are supported with layers, names, order, groups, opacity, blend modes, visibility, clipping, layer masks and canvas size. Text layers import as editable text when their text data can be read (font metrics may differ slightly); on export, text is written as pixels with its name. Adjustment layers are included in the merged image only. 16/32‑bit and PSB files are not supported.
- GIF opens as its first frame. Very large images (over 16384 px on a side or ~134 MP) are scaled down on open with a notice.
- Some browsers reserve Ctrl+N/W/T; Alt+N and Alt+W are provided, and every command is also in the menus.
- Projects live in this browser's storage; use File › Download Project (.dps) for backups or moving between machines.
