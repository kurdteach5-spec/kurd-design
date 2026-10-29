// Feed reader for the Auto Posts section (Vercel serverless function).
// Browsers may not read most news feeds directly (CORS), so the app asks this function:
//   /api/feed?url=https://www.trumpstruth.org/feed
// It only reads public http(s) addresses, never private networks, and returns at most 4 MB.
const MAX = 4 * 1024 * 1024;
const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?|\[?f[cd][0-9a-f]{2}:|metadata\.google\.internal)/i;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).send('Only GET'); return; }
  const raw = Array.isArray(req.query?.url) ? req.query.url[0] : req.query?.url;
  let target;
  try { target = new URL(String(raw || '')); } catch { res.status(400).send('Give a full address in ?url='); return; }
  if (!/^https?:$/.test(target.protocol) || PRIVATE.test(target.hostname) || target.username || target.password) { res.status(400).send('This address is not allowed.'); return; }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(target, {
      signal: ctrl.signal, redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SarwarDesignFeedReader/1.0)', Accept: 'application/rss+xml, application/atom+xml, application/xml, application/json, text/xml, image/*, */*;q=0.5' },
    });
    const type = r.headers.get('content-type') || 'application/octet-stream';
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX) { res.status(413).send('The file is too large.'); return; }
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', type.startsWith('image/') ? 'public, s-maxage=86400, max-age=86400' : 'public, s-maxage=60, max-age=0');
    res.status(r.ok ? 200 : 502).send(buf);
  } catch (e) {
    res.status(504).send(e && e.name === 'AbortError' ? 'The source did not answer in time.' : 'The source could not be reached.');
  } finally { clearTimeout(timer); }
}
