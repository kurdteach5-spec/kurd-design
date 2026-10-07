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
- **Keyframes**: click the stopwatch next to any property, then change values at another time. Select, box-select, drag, copy/paste, duplicate, delete. Linear, hold, Easy Ease (F9), ease in/out, bezier; the **Graph Editor** (Shift+F3) edits speed curves with handles. Position keyframes draw an editable motion path in the viewer.
- **Masks**: rectangle, ellipse and pen masks on any layer; add/subtract/intersect, feather, opacity, expansion, invert — all animatable.
- **Effects** (Effect menu or Effects & Presets panel): blur, color correction, distortion, glow, stylize, noise, sharpen, transform, keying (Chroma Key for green screen with spill suppression and matte view), shadow. Every parameter can be keyframed.
- **Presets**: text (fade, slide, scale, typewriter, character/word reveal, bounce, pop, blur, glitch), logo, shape, transitions, glitch, cinematic, minimal, modern and broadcast (lower third, title card, news ticker). They create normal keyframes you can edit; save your own animation as a preset.
- **Audio**: waveforms, volume (dB) keyframes, mute, fade in/out.
- **Render**: MP4 (H.264 + AAC), WebM (VP9 + Opus, transparent where the browser supports it), GIF, PNG or JPEG sequence (.zip); size, fps, quality, bitrate, work area or whole composition. Video export uses WebCodecs (Chrome, Edge, recent Safari).
- **Projects**: File › Save Project downloads a `.kdmotion` file with all media; the last session is also kept in browser storage (File › Restore Last Session). Undo/redo: Ctrl+Z / Ctrl+Shift+Z.

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
