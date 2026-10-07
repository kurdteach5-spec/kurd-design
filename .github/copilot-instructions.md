# KURD DESIGN — notes for GitHub Copilot

Browser-based layered image editor. React 19 + TypeScript + Vite + Tailwind CSS 4. No backend: everything runs in the browser; projects are stored in IndexedDB.

## Rules that keep the editor working
- Document state is immutable. Change a document only through `commit()` in `src/state/documentStore.ts`, returning a new `DocState`. Pass `{ history: 'Label' }` to create an undo step.
- Never mutate a pixel canvas that is already in a committed state (history shares them). Copy it, draw on the copy, commit the copy. Tools get a writable copy from `getPaintTarget()` in `src/tools/helpers.ts`.
- The canvas is rendered outside React by `Engine` (`src/canvas/engine.ts`) and `Compositor` (`src/canvas/compositor.ts`). Don't render the document from React components.
- Menu items, keyboard shortcuts and tooltips come from one registry: `src/shortcuts/commands.ts`. Add new commands there; add them to menus in `src/components/editor/MenuBar.tsx`.
- New tools implement the `Tool` interface (`src/tools/types.ts`) and are registered in `src/tools/registry.ts`; their options live in `src/state/toolStore.ts` and their options bar in `src/components/editor/OptionsBar.tsx`.
- Filters in `src/filters/kernel.ts` are serialized into a Web Worker: keep everything inside `filterKernel()` self-contained (no imports, no outer variables).
- The UI is in English, Kurdish (Sorani) and Arabic. Write UI text in English as usual; `src/i18n/index.ts` translates the page live using `src/i18n/ckb.ts` and `src/i18n/ar.ts`. When you add or change visible text, add the same English string with its translation to both files (use `{0}`, `{1}` for changing values, e.g. `"Opening {0}…"`). Put user content (layer text, file names typed by the user) inside `translate="no"` if it must never be translated.
- Switching language does not change the layout (the page stays `dir="ltr"`); translated Kurdish/Arabic strings are wrapped in Unicode isolates so they read right-to-left in place. Prefer logical Tailwind classes (`ms-`/`me-`, `ps-`/`pe-`, `start-`/`end-`) for new UI.
- Smart objects (`type: 'smart'`) keep their embedded layers in `contents` and non-destructive `filters`; rendering is cached in `smartContentCanvas()` (`src/canvas/compositor.ts`), actions live in `src/editor/smartObjects.ts`.
- The Motion workspace lives in `src/motion/` and has its own store (`src/motion/store.ts`; change the project only through `mcommit()` / functions in `src/motion/actions.ts`). Rendering is `src/motion/render/renderer.ts` (canvas 2D + WebGL effects in `render/glfx.ts`, effect definitions in `render/effectDefs.ts`), export in `src/motion/export/`. Animation presets are in `src/motion/presets.ts`. Motion menu commands and shortcuts are in `src/motion/commands.ts`. `src/state/workspace.ts` switches between Design and Motion; Design keyboard shortcuts are disabled while Motion is open.
- UI colors come from the Tailwind theme tokens in `src/index.css` (`bg-panel`, `text-muted`, `text-accent`, …).

## Commands
- `npm run dev` — local dev server
- `npm run build` — production build (used by Vercel)
- `npm run typecheck` — TypeScript check
