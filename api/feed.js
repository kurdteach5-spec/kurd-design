// Feed reader for the Auto Posts section (Vercel serverless function).
// Browsers may not read most news feeds directly (CORS), so the app asks this function:
//   /api/feed?url=https://www.trumpstruth.org/feed
// It only reads public http(s) addresses, never private networks, and returns at most 4 MB.
const MAX = 4 * 1024 * 1024; // pictures and feeds; videos open from their own site
const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?|\[?f[cd][0-9a-f]{2}:|metadata\.google\.internal)/i;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'x-sc-key');
  res.setHeader('Access-Control-Expose-Headers', 'x-feed-status');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).send('Only GET'); return; }
  const raw = Array.isArray(req.query?.url) ? req.query.url[0] : req.query?.url;
  let target;
  try { target = new URL(String(raw || '')); } catch { res.status(400).send('Give a full address in ?url='); return; }
  if (!/^https?:$/.test(target.protocol) || PRIVATE.test(target.hostname) || target.username || target.password) { res.status(400).send('This address is not allowed.'); return; }
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
    Accept: 'application/rss+xml, application/atom+xml, application/xml, application/json, text/xml, text/html, image/*, */*;q=0.5',
    'Accept-Language': 'en-US,en;q=0.9',
  };
  // the ScrapeCreators key is passed on only to ScrapeCreators
  const key = req.headers['x-sc-key'];
  if (key && target.hostname === 'api.scrapecreators.com') headers['x-api-key'] = String(key);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(target, {
      signal: ctrl.signal, redirect: 'follow',
      headers,
    });
    const type = r.headers.get('content-type') || 'application/octet-stream';
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX) { res.status(413).send('The file is too large.'); return; }
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', type.startsWith('image/') || type.startsWith('video/') ? 'public, s-maxage=86400, max-age=86400' : 'no-store');
    if (!r.ok) res.setHeader('x-feed-status', String(r.status));
    res.status(r.ok ? 200 : 502).send(buf);
  } catch (e) {
    res.status(504).send(e && e.name === 'AbortError' ? 'The source did not answer in time.' : 'The source could not be reached.');
  } finally { clearTimeout(timer); }
}
