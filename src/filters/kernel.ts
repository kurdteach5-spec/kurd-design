/* eslint-disable */
/**
 * Self-contained filter implementations. This function is serialized with
 * `Function.prototype.toString` into a Web Worker, so it must not reference
 * anything outside its own body. It's also callable on the main thread as a fallback.
 */
export function filterKernel() {
  type P = Record<string, number | string | boolean>;
  type Progress = (p: number) => void;

  function clamp(v: number) { return v < 0 ? 0 : v > 255 ? 255 : v; }

  function boxBlurPremult(d: Uint8ClampedArray, w: number, h: number, r: number, passes: number, progress?: Progress, p0 = 0, p1 = 1) {
    if (r < 1) return;
    const n = w * h; const f = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { const a = d[i * 4 + 3] / 255; f[i * 4] = d[i * 4] * a; f[i * 4 + 1] = d[i * 4 + 1] * a; f[i * 4 + 2] = d[i * 4 + 2] * a; f[i * 4 + 3] = d[i * 4 + 3]; }
    const t = new Float32Array(n * 4);
    const iarr = 1 / (r + r + 1);
    for (let pass = 0; pass < passes; pass++) {
      for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let c = 0; c < 4; c++) {
          let acc = 0;
          for (let k = -r; k <= r; k++) acc += f[(row + Math.min(w - 1, Math.max(0, k))) * 4 + c];
          for (let x = 0; x < w; x++) {
            t[(row + x) * 4 + c] = acc * iarr;
            acc += f[(row + Math.min(w - 1, x + r + 1)) * 4 + c] - f[(row + Math.max(0, x - r)) * 4 + c];
          }
        }
      }
      for (let x = 0; x < w; x++) {
        for (let c = 0; c < 4; c++) {
          let acc = 0;
          for (let k = -r; k <= r; k++) acc += t[(Math.min(h - 1, Math.max(0, k)) * w + x) * 4 + c];
          for (let y = 0; y < h; y++) {
            f[(y * w + x) * 4 + c] = acc * iarr;
            acc += t[(Math.min(h - 1, y + r + 1) * w + x) * 4 + c] - t[(Math.max(0, y - r) * w + x) * 4 + c];
          }
        }
      }
      if (progress) progress(p0 + ((p1 - p0) * (pass + 1)) / passes);
    }
    for (let i = 0; i < n; i++) {
      const a = f[i * 4 + 3]; const k = a > 0 ? 255 / a : 0;
      d[i * 4] = f[i * 4] * k; d[i * 4 + 1] = f[i * 4 + 1] * k; d[i * 4 + 2] = f[i * 4 + 2] * k; d[i * 4 + 3] = a;
    }
  }

  function gaussian(d: Uint8ClampedArray, w: number, h: number, radius: number, progress?: Progress) {
    // three box passes approximate a gaussian with sigma ≈ radius / 2
    const sigma = Math.max(0.5, radius / 2);
    const r = Math.max(1, Math.round(Math.sqrt((12 * sigma * sigma) / 3 + 1) / 2));
    boxBlurPremult(d, w, h, r, 3, progress);
  }

  function sample(src: Uint8ClampedArray, w: number, h: number, x: number, y: number, out: number[]) {
    // bilinear with edge clamp
    x = Math.max(0, Math.min(w - 1.001, x)); y = Math.max(0, Math.min(h - 1.001, y));
    const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
    const i00 = (y0 * w + x0) * 4, i10 = i00 + 4, i01 = i00 + w * 4, i11 = i01 + 4;
    for (let c = 0; c < 4; c++) {
      const a = src[i00 + c] + (src[i10 + c] - src[i00 + c]) * fx;
      const b = src[i01 + c] + (src[i11 + c] - src[i01 + c]) * fx;
      out[c] = a + (b - a) * fy;
    }
  }

  function convolve(d: Uint8ClampedArray, w: number, h: number, k: number[], bias = 0, keepAlpha = true) {
    const src = new Uint8ClampedArray(d);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const xx = Math.min(w - 1, Math.max(0, x + i)), yy = Math.min(h - 1, Math.max(0, y + j));
        const p = (yy * w + xx) * 4, kk = k[(j + 1) * 3 + (i + 1)];
        r += src[p] * kk; g += src[p + 1] * kk; b += src[p + 2] * kk;
      }
      const o = (y * w + x) * 4;
      d[o] = clamp(r + bias); d[o + 1] = clamp(g + bias); d[o + 2] = clamp(b + bias);
      if (!keepAlpha) d[o + 3] = 255;
    }
  }

  function displace(d: Uint8ClampedArray, w: number, h: number, map: (x: number, y: number, out: number[]) => void, progress?: Progress) {
    const src = new Uint8ClampedArray(d); const pt = [0, 0]; const px = [0, 0, 0, 0];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        map(x + 0.5, y + 0.5, pt);
        const o = (y * w + x) * 4;
        if (pt[0] < 0 || pt[1] < 0 || pt[0] >= w || pt[1] >= h) { d[o + 3] = 0; continue; }
        sample(src, w, h, pt[0] - 0.5, pt[1] - 0.5, px);
        d[o] = px[0]; d[o + 1] = px[1]; d[o + 2] = px[2]; d[o + 3] = px[3];
      }
      if (progress && y % 64 === 0) progress(y / h);
    }
  }

  const filters: Record<string, (d: Uint8ClampedArray, w: number, h: number, p: P, progress: Progress) => void> = {
    'gaussian-blur': (d, w, h, p, pr) => gaussian(d, w, h, Number(p.radius), pr),
    'box-blur': (d, w, h, p, pr) => boxBlurPremult(d, w, h, Math.max(1, Math.round(Number(p.radius))), 1, pr),
    'motion-blur': (d, w, h, p, pr) => {
      const src = new Uint8ClampedArray(d);
      const a = (Number(p.angle) * Math.PI) / 180, dist = Math.max(1, Number(p.distance));
      const steps = Math.max(2, Math.round(dist));
      const dx = Math.cos(a), dy = -Math.sin(a);
      const px = [0, 0, 0, 0];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let r = 0, g = 0, b = 0, al = 0;
          for (let s = 0; s < steps; s++) {
            const t = (s / (steps - 1) - 0.5) * dist;
            sample(src, w, h, x + dx * t, y + dy * t, px);
            const aa = px[3] / 255; r += px[0] * aa; g += px[1] * aa; b += px[2] * aa; al += px[3];
          }
          const o = (y * w + x) * 4; const k = al > 0 ? 255 / al : 0;
          d[o] = r * k; d[o + 1] = g * k; d[o + 2] = b * k; d[o + 3] = al / steps;
        }
        if (y % 32 === 0) pr(y / h);
      }
    },
    'radial-blur': (d, w, h, p, pr) => {
      const src = new Uint8ClampedArray(d);
      const cx = (Number(p.centerX) / 100) * w, cy = (Number(p.centerY) / 100) * h;
      const amount = Number(p.amount) / 100; const spin = p.mode === 'spin';
      const steps = Math.max(4, Math.min(48, Math.round(Number(p.amount) / 2) + 4));
      const px = [0, 0, 0, 0];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const dx = x - cx, dy = y - cy;
          let r = 0, g = 0, b = 0, al = 0;
          for (let s = 0; s < steps; s++) {
            const t = (s / (steps - 1) - 0.5);
            let sx: number, sy: number;
            if (spin) { const ang = t * amount * 0.6; const c = Math.cos(ang), sn = Math.sin(ang); sx = cx + dx * c - dy * sn; sy = cy + dx * sn + dy * c; }
            else { const k = 1 + t * amount * 0.5; sx = cx + dx * k; sy = cy + dy * k; }
            sample(src, w, h, sx, sy, px);
            const aa = px[3] / 255; r += px[0] * aa; g += px[1] * aa; b += px[2] * aa; al += px[3];
          }
          const o = (y * w + x) * 4; const k = al > 0 ? 255 / al : 0;
          d[o] = r * k; d[o + 1] = g * k; d[o + 2] = b * k; d[o + 3] = al / steps;
        }
        if (y % 32 === 0) pr(y / h);
      }
    },
    'sharpen': (d, w, h, p) => { const a = Number(p.amount) / 100; convolve(d, w, h, [0, -a, 0, -a, 1 + 4 * a, -a, 0, -a, 0]); },
    'unsharp-mask': (d, w, h, p, pr) => {
      const blur = new Uint8ClampedArray(d); gaussian(blur, w, h, Number(p.radius), pr);
      const amt = Number(p.amount) / 100, th = Number(p.threshold);
      for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) {
        const diff = d[i + c] - blur[i + c];
        if (Math.abs(diff) >= th) d[i + c] = clamp(d[i + c] + diff * amt);
      }
    },
    'add-noise': (d, _w, _h, p) => {
      const amt = (Number(p.amount) / 100) * 255; const mono = !!p.monochromatic; const gauss = p.distribution === 'gaussian';
      let seed = 1234567;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      const n = () => (gauss ? (rnd() + rnd() + rnd() + rnd() - 2) * 0.866 : rnd() * 2 - 1);
      for (let i = 0; i < d.length; i += 4) {
        if (!d[i + 3]) continue;
        if (mono) { const v = n() * amt; d[i] = clamp(d[i] + v); d[i + 1] = clamp(d[i + 1] + v); d[i + 2] = clamp(d[i + 2] + v); }
        else { d[i] = clamp(d[i] + n() * amt); d[i + 1] = clamp(d[i + 1] + n() * amt); d[i + 2] = clamp(d[i + 2] + n() * amt); }
      }
    },
    'median': (d, w, h, p, pr) => {
      const r = Math.max(1, Math.round(Number(p.radius))); const src = new Uint8ClampedArray(d);
      const hist = new Uint32Array(256 * 3);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          hist.fill(0); let n = 0;
          for (let j = -r; j <= r; j++) {
            const yy = Math.min(h - 1, Math.max(0, y + j));
            for (let i = -r; i <= r; i++) {
              const xx = Math.min(w - 1, Math.max(0, x + i)); const k = (yy * w + xx) * 4;
              hist[src[k]]++; hist[256 + src[k + 1]]++; hist[512 + src[k + 2]]++; n++;
            }
          }
          const o = (y * w + x) * 4; const half = n / 2;
          for (let c = 0; c < 3; c++) { let acc = 0, v = 0; for (; v < 256; v++) { acc += hist[c * 256 + v]; if (acc >= half) break; } d[o + c] = v; }
        }
        if (y % 16 === 0) pr(y / h);
      }
    },
    'pixelate': (d, w, h, p) => {
      const s = Math.max(2, Math.round(Number(p.cellSize)));
      for (let by = 0; by < h; by += s) for (let bx = 0; bx < w; bx += s) {
        let r = 0, g = 0, b = 0, a = 0, n = 0;
        const ex = Math.min(w, bx + s), ey = Math.min(h, by + s);
        for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) { const k = (y * w + x) * 4; const aa = d[k + 3]; r += d[k] * aa; g += d[k + 1] * aa; b += d[k + 2] * aa; a += aa; n++; }
        const k2 = a ? 1 / a : 0;
        for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) { const k = (y * w + x) * 4; d[k] = r * k2; d[k + 1] = g * k2; d[k + 2] = b * k2; d[k + 3] = a / n; }
      }
    },
    'emboss': (d, w, h, p) => {
      const a = (Number(p.angle) * Math.PI) / 180, hgt = Math.max(1, Number(p.height)), amt = Number(p.amount) / 100;
      const src = new Uint8ClampedArray(d); const dx = Math.cos(a) * hgt, dy = -Math.sin(a) * hgt; const px = [0, 0, 0, 0], qx = [0, 0, 0, 0];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        sample(src, w, h, x + dx, y + dy, px); sample(src, w, h, x - dx, y - dy, qx);
        const o = (y * w + x) * 4;
        const lum = (c: number[]) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
        const v = 128 + (lum(px) - lum(qx)) * amt * 2;
        d[o] = d[o + 1] = d[o + 2] = clamp(v);
      }
    },
    'find-edges': (d, w, h) => {
      const src = new Uint8ClampedArray(d);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) {
          const g = (i: number, j: number) => src[(Math.min(h - 1, Math.max(0, y + j)) * w + Math.min(w - 1, Math.max(0, x + i))) * 4 + c];
          const gx = -g(-1, -1) - 2 * g(-1, 0) - g(-1, 1) + g(1, -1) + 2 * g(1, 0) + g(1, 1);
          const gy = -g(-1, -1) - 2 * g(0, -1) - g(1, -1) + g(-1, 1) + 2 * g(0, 1) + g(1, 1);
          d[o + c] = clamp(255 - Math.hypot(gx, gy));
        }
      }
    },
    'twirl': (d, w, h, p, pr) => {
      const ang = (Number(p.angle) * Math.PI) / 180, cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2;
      displace(d, w, h, (x, y, out) => {
        const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
        if (r >= R) { out[0] = x; out[1] = y; return; }
        const t = ang * (1 - r / R) * (1 - r / R); const c = Math.cos(t), s = Math.sin(t);
        out[0] = cx + dx * c - dy * s; out[1] = cy + dx * s + dy * c;
      }, pr);
    },
    'wave': (d, w, h, p, pr) => {
      const A = Number(p.amplitude), L = Math.max(2, Number(p.wavelength));
      displace(d, w, h, (x, y, out) => { out[0] = x + Math.sin((y / L) * Math.PI * 2) * A; out[1] = y + Math.sin((x / L) * Math.PI * 2) * A; }, pr);
    },
    'pinch': (d, w, h, p, pr) => {
      const amt = Number(p.amount) / 100, cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2;
      displace(d, w, h, (x, y, out) => {
        const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy) / R;
        if (r >= 1 || r === 0) { out[0] = x; out[1] = y; return; }
        // amount > 0 pinches toward the center, < 0 bulges outward
        const src = Math.pow(r, 1 - amt * 0.5);
        const ease = 1 - Math.pow(r, 4); // fade the effect toward the edge
        const f = 1 + (src / r - 1) * ease;
        out[0] = cx + dx * f; out[1] = cy + dy * f;
      }, pr);
    },
    'spherize': (d, w, h, p, pr) => {
      const amt = Number(p.amount) / 100, cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2;
      displace(d, w, h, (x, y, out) => {
        const dx = (x - cx) / R, dy = (y - cy) / R, r = Math.hypot(dx, dy);
        if (r >= 1 || r === 0) { out[0] = x; out[1] = y; return; }
        const nr = Math.asin(r) / (Math.PI / 2);
        const f = 1 + (nr / r - 1) * amt;
        out[0] = cx + dx * f * R; out[1] = cy + dy * f * R;
      }, pr);
    },
    'glow': (d, w, h, p, pr) => {
      const bright = new Uint8ClampedArray(d); const th = Number(p.threshold);
      for (let i = 0; i < bright.length; i += 4) {
        const l = 0.299 * bright[i] + 0.587 * bright[i + 1] + 0.114 * bright[i + 2];
        const k = l > th ? (l - th) / (255 - th || 1) : 0;
        bright[i] *= k; bright[i + 1] *= k; bright[i + 2] *= k;
      }
      gaussian(bright, w, h, Number(p.radius), pr);
      const amt = Number(p.intensity) / 100;
      for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = clamp(255 - ((255 - d[i + c]) * (255 - bright[i + c] * amt)) / 255);
    },
    'invert': (d) => { for (let i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; } },
    'desaturate': (d) => { for (let i = 0; i < d.length; i += 4) { const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = d[i + 1] = d[i + 2] = v; } },
  };

  return {
    names: Object.keys(filters),
    run(name: string, d: Uint8ClampedArray, w: number, h: number, params: P, progress: Progress) {
      const f = filters[name];
      if (!f) throw new Error('Unknown filter: ' + name);
      f(d, w, h, params, progress || function () {});
    },
  };
}
