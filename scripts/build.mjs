// Offline build for environments without Vite.
// Bundles src/main.tsx with esbuild and compiles Tailwind CSS via its Node API.
//   node scripts/build.mjs           -> dist/ (index.html + assets) and dist/kurd-design.html (single file)
//   node scripts/build.mjs --serve   -> rebuild on change and serve on http://localhost:5173
import * as esbuild from 'esbuild';
import { compile } from 'tailwindcss';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const serve = process.argv.includes('--serve');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|html)$/.test(e.name)) out.push(p);
  }
  return out;
}

async function buildCss(file) {
  const css = fs.readFileSync(file, 'utf8');
  const compiler = await compile(css, {
    base: path.dirname(file),
    async loadStylesheet(id, base) {
      let p;
      if (id === 'tailwindcss') p = path.join(root, 'node_modules/tailwindcss/index.css');
      else if (id.startsWith('tailwindcss/')) p = path.join(root, 'node_modules', id.endsWith('.css') ? id : id + '.css');
      else p = path.resolve(base, id);
      return { path: p, base: path.dirname(p), content: fs.readFileSync(p, 'utf8') };
    },
  });
  const candidates = new Set();
  for (const f of [...walk(path.join(root, 'src')), path.join(root, 'index.html')]) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/[A-Za-z0-9_\-:/.\[\]#%()!@,>=+*&]+/g)) candidates.add(m[0]);
  }
  return compiler.build([...candidates]);
}

const tailwindPlugin = {
  name: 'tailwind',
  setup(build) {
    build.onLoad({ filter: /\.css$/ }, async (args) => ({ contents: await buildCss(args.path), loader: 'css' }));
  },
};

const options = {
  entryPoints: [path.join(root, 'src/main.tsx')],
  bundle: true,
  outdir: path.join(dist, 'assets'),
  entryNames: 'app',
  format: 'esm',
  target: 'es2022',
  jsx: 'automatic',
  minify: !serve,
  sourcemap: serve ? 'inline' : false,
  define: { 'process.env.NODE_ENV': serve ? '"development"' : '"production"' },
  plugins: [tailwindPlugin],
  logLevel: 'info',
};

function writeHtml() {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const multi = html.replace(
    '<script type="module" src="/src/main.tsx"></script>',
    '<link rel="stylesheet" href="./assets/app.css" />\n    <script type="module" src="./assets/app.js"></script>',
  );
  fs.writeFileSync(path.join(dist, 'index.html'), multi);
  if (!serve) {
    const js = fs.readFileSync(path.join(dist, 'assets/app.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
    const css = fs.readFileSync(path.join(dist, 'assets/app.css'), 'utf8');
    // function replacer: the bundle may contain "$&" / "$'" which string replacements would expand
    const single = html.replace(
      '<script type="module" src="/src/main.tsx"></script>',
      () => `<style>${css}</style>\n    <script type="module">${js}</script>`,
    );
    fs.writeFileSync(path.join(dist, 'kurd-design.html'), single);
    // body-only variant for hosts that supply their own document skeleton
    const fav = (html.match(/<link rel="icon"[^>]*>/) || [''])[0];
    const fontLink = (html.match(/<link rel="stylesheet" href="https:\/\/fonts[^>]*>/) || [''])[0];
    fs.writeFileSync(path.join(dist, 'kurd-design-embed.html'), `<title>KURD DESIGN</title>\n${fav}\n${fontLink}\n<style>${css}</style>\n<div id="root"></div>\n<script type="module">${js}</script>\n`);
  }
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

if (serve) {
  const ctx = await esbuild.context({
    ...options,
    plugins: [...options.plugins, { name: 'html', setup(b) { b.onEnd(() => writeHtml()); } }],
  });
  await ctx.watch();
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
  http.createServer((req, res) => {
    let p = path.join(dist, decodeURIComponent((req.url || '/').split('?')[0]));
    if (p.endsWith('/')) p = path.join(p, 'index.html');
    fs.readFile(p, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
      res.end(data);
    });
  }).listen(5173, () => console.log('KURD DESIGN dev server: http://localhost:5173'));
} else {
  await esbuild.build(options);
  writeHtml();
  console.log('Built dist/index.html and dist/kurd-design.html');
}
