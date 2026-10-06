# KURD DESIGN — notes for GitHub Copilot

Browser-based layered image editor. React 19 + TypeScript + Vite + Tailwind CSS 4. No backend: everything runs in the browser; projects are stored in IndexedDB.

## Rules that keep the editor working
- Document state is immutable. Change a document only through `commit()` in `src/state/documentStore.ts`, returning a new `DocState`. Pass `{ history: 'Label' }` to create an undo step.
- Never mutate a pixel canvas that is already in a committed state (history shares them). Copy it, draw on the copy, commit the copy. Tools get a writable copy from `getPaintTarget()` in `src/tools/helpers.ts`.
- The canvas is rendered outside React by `Engine` (`src/canvas/engine.ts`) and `Compositor` (`src/canvas/compositor.ts`). Don't render the document from React components.
- Menu items, keyboard shortcuts and tooltips come from one registry: `src/shortcuts/commands.ts`. Add new commands there; add them to menus in `src/components/editor/MenuBar.tsx`.
- New tools implement the `Tool` interface (`src/tools/types.ts`) and are registered in `src/tools/registry.ts`; their options live in `src/state/toolStore.ts` and their options bar in `src/components/editor/OptionsBar.tsx`.
- Filters in `src/filters/kernel.ts` are serialized into a Web Worker: keep everything inside `filterKernel()` self-contained (no imports, no outer variables).
- UI colors come from the Tailwind theme tokens in `src/index.css` (`bg-panel`, `text-muted`, `text-accent`, …).

## Commands
- `npm run dev` — local dev server
- `npm run build` — production build (used by Vercel)
- `npm run typecheck` — TypeScript check
