// GPU effects for the Motion renderer (WebGL 1). Layers are uploaded as premultiplied textures,
// effects run as fragment-shader passes between framebuffers, and the result is copied back to a
// 2D canvas. Also draws perspective-correct 3D layers.
import type { EffectParamValue } from '../types';
import { effectDef } from './effectDefs';
import { createCanvas, ctx2d } from '../../utils/canvas';
import { hexToRgb } from '../../utils/color';

export interface FxContext {
  time: number;
  fps: number;
  /** source pixels per effect pixel (layer scale × preview quality) */
  scale: number;
  /** layer movement in source px per second (for the Motion Blur effect) */
  velocity: [number, number];
  /** seed so the same layer's noise differs from others */
  seed: number;
}
export interface EvaluatedEffect { type: string; params: Record<string, EffectParamValue> }

interface Tex { tex: WebGLTexture; fb: WebGLFramebuffer; w: number; h: number }
interface Prog { p: WebGLProgram; u: Map<string, WebGLUniformLocation | null>; aPos: number; aUv: number }

const VS = `attribute vec2 a_pos; varying vec2 v_uv; void main(){ v_uv = a_pos*0.5+0.5; gl_Position = vec4(a_pos,0.0,1.0); }`;
const VS_FLIP = `attribute vec2 a_pos; varying vec2 v_uv; void main(){ v_uv = vec2(a_pos.x*0.5+0.5, 0.5-a_pos.y*0.5); gl_Position = vec4(a_pos,0.0,1.0); }`;
const VS_PERSP = `attribute vec4 a_pos; attribute vec2 a_uv; varying vec2 v_uv; void main(){ v_uv = a_uv; gl_Position = a_pos; }`;

const HEAD = `precision highp float; varying vec2 v_uv; uniform sampler2D u_tex; uniform vec2 u_size;
vec4 tex(vec2 uv){ return texture2D(u_tex, uv); }
vec3 unpre(vec4 c){ return c.a > 0.0001 ? c.rgb / c.a : vec3(0.0); }
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
`;

const FS: Record<string, string> = {
  copy: `${HEAD} void main(){ gl_FragColor = tex(v_uv); }`,
  blur: `${HEAD} uniform vec2 u_step; uniform float u_sigma; uniform float u_n;
    void main(){ vec4 acc = vec4(0.0); float wsum = 0.0;
      for (int i = -40; i <= 40; i++) { float fi = float(i); if (abs(fi) > u_n) continue;
        float w = exp(-0.5 * fi * fi / (u_sigma * u_sigma)); acc += tex(v_uv + u_step * fi) * w; wsum += w; }
      gl_FragColor = acc / wsum; }`,
  dirblur: `${HEAD} uniform vec2 u_vec;
    void main(){ vec4 acc = vec4(0.0); for (int i = 0; i < 48; i++) { float f = float(i)/47.0 - 0.5; acc += tex(v_uv + u_vec * f); } gl_FragColor = acc / 48.0; }`,
  radialblur: `${HEAD} uniform vec2 u_center; uniform float u_amount; uniform float u_spin;
    void main(){ vec4 acc = vec4(0.0); vec2 p = v_uv * u_size; vec2 d = p - u_center;
      for (int i = 0; i < 40; i++) { float f = float(i)/39.0;
        vec2 q;
        if (u_spin > 0.5) { float a = (f - 0.5) * u_amount * 1.2; float c = cos(a), s = sin(a); q = u_center + vec2(c*d.x - s*d.y, s*d.x + c*d.y); }
        else q = u_center + d * (1.0 - f * u_amount * 0.5);
        acc += tex(q / u_size); }
      gl_FragColor = acc / 40.0; }`,
  bc: `${HEAD} uniform float u_b; uniform float u_c;
    void main(){ vec4 c = tex(v_uv); vec3 r = unpre(c); r = (r - 0.5) * u_c + 0.5 + u_b; gl_FragColor = vec4(clamp(r,0.0,1.0)*c.a, c.a); }`,
  hsl: `${HEAD} uniform float u_h; uniform float u_s; uniform float u_l; uniform float u_colorize;
    vec3 rgb2hsl(vec3 c){ float mx=max(max(c.r,c.g),c.b), mn=min(min(c.r,c.g),c.b); float l=(mx+mn)*0.5; float h=0.0, s=0.0;
      if (mx>mn){ float d=mx-mn; s = l>0.5 ? d/(2.0-mx-mn) : d/(mx+mn);
        if (mx==c.r) h=(c.g-c.b)/d+(c.g<c.b?6.0:0.0); else if (mx==c.g) h=(c.b-c.r)/d+2.0; else h=(c.r-c.g)/d+4.0; h/=6.0; }
      return vec3(h,s,l); }
    float h2r(float p,float q,float t){ if(t<0.0)t+=1.0; if(t>1.0)t-=1.0; if(t<1.0/6.0)return p+(q-p)*6.0*t; if(t<0.5)return q; if(t<2.0/3.0)return p+(q-p)*(2.0/3.0-t)*6.0; return p; }
    vec3 hsl2rgb(vec3 c){ if (c.y<=0.0) return vec3(c.z); float q = c.z<0.5 ? c.z*(1.0+c.y) : c.z+c.y-c.z*c.y; float p=2.0*c.z-q;
      return vec3(h2r(p,q,c.x+1.0/3.0), h2r(p,q,c.x), h2r(p,q,c.x-1.0/3.0)); }
    void main(){ vec4 c = tex(v_uv); vec3 r = unpre(c); vec3 h = rgb2hsl(r);
      if (u_colorize > 0.5) { h.x = fract(u_h); h.y = clamp(0.25 + u_s * 0.75, 0.0, 1.0); }
      else { h.x = fract(h.x + u_h); h.y = clamp(h.y * (1.0 + u_s), 0.0, 1.0); }
      vec3 o = hsl2rgb(h); if (u_l > 0.0) o = mix(o, vec3(1.0), u_l); else o = mix(o, vec3(0.0), -u_l);
      gl_FragColor = vec4(o * c.a, c.a); }`,
  balance: `${HEAD} uniform vec3 u_s; uniform vec3 u_m; uniform vec3 u_hh;
    void main(){ vec4 c = tex(v_uv); vec3 r = unpre(c); float l = luma(r);
      float ws = clamp(1.0 - l * 3.0, 0.0, 1.0), wh = clamp(l * 3.0 - 2.0, 0.0, 1.0), wm = 1.0 - ws - wh;
      r += (u_s * ws + u_m * wm + u_hh * wh) * 0.4; gl_FragColor = vec4(clamp(r,0.0,1.0) * c.a, c.a); }`,
  exposure: `${HEAD} uniform float u_e; uniform float u_g;
    void main(){ vec4 c = tex(v_uv); vec3 r = unpre(c) * exp2(u_e); r = pow(max(r, 0.0), vec3(1.0 / u_g)); gl_FragColor = vec4(clamp(r,0.0,1.0) * c.a, c.a); }`,
  tint: `${HEAD} uniform vec3 u_black; uniform vec3 u_white; uniform float u_amount;
    void main(){ vec4 c = tex(v_uv); vec3 r = unpre(c); vec3 t = mix(u_black, u_white, luma(r)); gl_FragColor = vec4(mix(r, t, u_amount) * c.a, c.a); }`,
  fill: `${HEAD} uniform vec3 u_color; uniform float u_amount;
    void main(){ vec4 c = tex(v_uv); vec3 r = unpre(c); gl_FragColor = vec4(mix(r, u_color, u_amount) * c.a, c.a); }`,
  invert: `${HEAD} uniform float u_blend;
    void main(){ vec4 c = tex(v_uv); vec3 r = unpre(c); gl_FragColor = vec4(mix(1.0 - r, r, u_blend) * c.a, c.a); }`,
  posterize: `${HEAD} uniform float u_levels;
    void main(){ vec4 c = tex(v_uv); vec3 r = floor(unpre(c) * u_levels) / (u_levels - 1.0); gl_FragColor = vec4(clamp(r,0.0,1.0) * c.a, c.a); }`,
  vignette: `${HEAD} uniform float u_amount; uniform float u_sizev; uniform float u_soft; uniform vec3 u_color;
    void main(){ vec4 c = tex(v_uv); vec2 d = (v_uv - 0.5) * vec2(u_size.x / max(u_size.x, u_size.y), u_size.y / max(u_size.x, u_size.y)) * 2.0;
      float r = length(d); float f = smoothstep(u_sizev, u_sizev + u_soft, r) * u_amount;
      vec3 o = mix(unpre(c), u_color, f); gl_FragColor = vec4(o * c.a, c.a); }`,
  noise: `${HEAD} uniform float u_amount; uniform float u_color; uniform float u_seed;
    void main(){ vec4 c = tex(v_uv); vec3 r = unpre(c); vec2 p = floor(v_uv * u_size);
      vec3 n = u_color > 0.5 ? vec3(hash(p + u_seed), hash(p + u_seed + 17.0), hash(p + u_seed + 39.0)) : vec3(hash(p + u_seed));
      r += (n - 0.5) * u_amount; gl_FragColor = vec4(clamp(r,0.0,1.0) * c.a, c.a); }`,
  grain: `${HEAD} uniform float u_amount; uniform float u_gsize; uniform float u_seed;
    void main(){ vec4 c = tex(v_uv); vec3 r = unpre(c); vec2 p = v_uv * u_size / u_gsize;
      float n = vnoise(p + u_seed * 13.1) * 0.6 + vnoise(p * 2.1 - u_seed * 7.3) * 0.4;
      float l = luma(r); float w = 1.0 - abs(l - 0.5) * 1.2;
      r += (n - 0.5) * u_amount * w; gl_FragColor = vec4(clamp(r,0.0,1.0) * c.a, c.a); }`,
  sharpen: `${HEAD} uniform float u_amount;
    void main(){ vec2 px = 1.0 / u_size; vec4 c = tex(v_uv);
      vec4 n = tex(v_uv + vec2(px.x,0.0)) + tex(v_uv - vec2(px.x,0.0)) + tex(v_uv + vec2(0.0,px.y)) + tex(v_uv - vec2(0.0,px.y));
      vec4 o = c + (c * 4.0 - n) * u_amount; gl_FragColor = vec4(clamp(o.rgb, 0.0, o.a), clamp(o.a, 0.0, 1.0)); }`,
  pixelate: `${HEAD} uniform float u_cell;
    void main(){ vec2 p = (floor(v_uv * u_size / u_cell) + 0.5) * u_cell; gl_FragColor = tex(p / u_size); }`,
  rgbsplit: `${HEAD} uniform vec2 u_off;
    void main(){ vec4 r = tex(v_uv + u_off), g = tex(v_uv), b = tex(v_uv - u_off);
      gl_FragColor = vec4(r.r, g.g, b.b, max(max(r.a, g.a), b.a)); }`,
  chroma: `${HEAD} uniform float u_amount;
    void main(){ vec2 d = (v_uv - 0.5); vec2 o = d * u_amount / max(u_size.x, u_size.y) * 2.0;
      vec4 r = tex(v_uv + o), g = tex(v_uv), b = tex(v_uv - o); gl_FragColor = vec4(r.r, g.g, b.b, max(max(r.a, g.a), b.a)); }`,
  glitch: `${HEAD} uniform float u_amount; uniform float u_block; uniform float u_rgb; uniform float u_seed;
    void main(){ vec2 p = v_uv * u_size; float band = floor(p.y / u_block);
      float r1 = hash(vec2(band, u_seed)); float r2 = hash(vec2(band * 1.7, u_seed + 3.1));
      float on = step(1.0 - u_amount * 0.6, r1);
      float shift = (r2 - 0.5) * u_block * 6.0 * on * u_amount;
      vec2 uv = (p + vec2(shift, 0.0)) / u_size;
      float rs = u_rgb * (0.4 + on) * u_amount / u_size.x;
      vec4 cr = tex(uv + vec2(rs, 0.0)), cg = tex(uv), cb = tex(uv - vec2(rs, 0.0));
      vec4 o = vec4(cr.r, cg.g, cb.b, max(max(cr.a, cg.a), cb.a));
      if (on > 0.5 && r2 > 0.92) o.rgb = o.a - o.rgb;
      gl_FragColor = o; }`,
  displace: `${HEAD} uniform float u_amount; uniform float u_dsize; uniform float u_evo; uniform float u_wave;
    void main(){ vec2 p = v_uv * u_size; vec2 q = p / u_dsize; vec2 off;
      if (u_wave > 0.5) off = vec2(sin(q.y * 6.2831 + u_evo), cos(q.x * 6.2831 + u_evo * 0.7)) * 0.5;
      else off = vec2(vnoise(q + u_evo) + vnoise(q * 2.0 + u_evo * 1.3) * 0.5, vnoise(q + 31.7 - u_evo) + vnoise(q * 2.0 + 11.0 - u_evo) * 0.5) / 1.5 - 0.5;
      gl_FragColor = tex((p + off * 2.0 * u_amount) / u_size); }`,
  wave: `${HEAD} uniform float u_h; uniform float u_w; uniform vec2 u_dir; uniform float u_phase;
    void main(){ vec2 p = v_uv * u_size; vec2 perp = vec2(-u_dir.y, u_dir.x);
      float s = sin(dot(p, u_dir) / u_w * 6.2831 + u_phase); gl_FragColor = tex((p + perp * s * u_h) / u_size); }`,
  bulge: `${HEAD} uniform vec2 u_center; uniform float u_radius; uniform float u_height;
    void main(){ vec2 p = v_uv * u_size; vec2 d = p - u_center; float r = length(d) / u_radius;
      if (r < 1.0) { float f = 1.0 - u_height * (1.0 - r * r) * (1.0 - r * r) * 0.6; p = u_center + d * f; }
      gl_FragColor = tex(p / u_size); }`,
  xform: `${HEAD} uniform mat3 u_inv; uniform float u_opacity;
    void main(){ vec3 q = u_inv * vec3(v_uv * u_size, 1.0); vec2 uv = q.xy / u_size;
      vec4 c = (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec4(0.0) : tex(uv); gl_FragColor = c * u_opacity; }`,
  chromakey: `${HEAD} uniform vec3 u_key; uniform float u_tol; uniform float u_soft; uniform float u_spill; uniform float u_matte;
    vec2 cbcr(vec3 c){ return vec2(-0.168736*c.r - 0.331264*c.g + 0.5*c.b, 0.5*c.r - 0.418688*c.g - 0.081312*c.b); }
    void main(){ vec4 c = tex(v_uv); vec3 r = unpre(c);
      float d = distance(cbcr(r), cbcr(u_key));
      float a = smoothstep(u_tol, u_tol + u_soft + 0.0001, d);
      // spill suppression on the key's dominant channel
      if (u_key.g >= u_key.r && u_key.g >= u_key.b) { float lim = max(r.r, r.b); r.g = mix(r.g, min(r.g, lim), u_spill); }
      else if (u_key.b >= u_key.r) { float lim = max(r.r, r.g); r.b = mix(r.b, min(r.b, lim), u_spill); }
      else { float lim = max(r.g, r.b); r.r = mix(r.r, min(r.r, lim), u_spill); }
      float alpha = c.a * a;
      if (u_matte > 0.5) gl_FragColor = vec4(vec3(alpha), 1.0); else gl_FragColor = vec4(r * alpha, alpha); }`,
  lumakey: `${HEAD} uniform float u_th; uniform float u_soft; uniform float u_inv;
    void main(){ vec4 c = tex(v_uv); float l = luma(unpre(c)); if (u_inv > 0.5) l = 1.0 - l;
      float a = smoothstep(u_th, u_th + u_soft + 0.0001, l); gl_FragColor = c * a; }`,
  bright: `${HEAD} uniform float u_th;
    void main(){ vec4 c = tex(v_uv); float l = luma(unpre(c)); gl_FragColor = c * smoothstep(u_th - 0.08, u_th + 0.02, l); }`,
  addglow: `${HEAD} uniform sampler2D u_glow; uniform float u_int; uniform vec3 u_color; uniform float u_useColor;
    void main(){ vec4 c = tex(v_uv); vec4 g = texture2D(u_glow, v_uv) * u_int; if (u_useColor > 0.5) g.rgb = u_color * g.a;
      vec4 o = c + g; gl_FragColor = vec4(min(o.rgb, vec3(1.0)), min(o.a, 1.0)); }`,
  shadowsrc: `${HEAD} uniform vec3 u_color; uniform float u_opacity; uniform vec2 u_off;
    void main(){ float a = tex(v_uv - u_off / u_size).a * u_opacity; gl_FragColor = vec4(u_color * a, a); }`,
  longshadow: `${HEAD} uniform vec3 u_color; uniform float u_opacity; uniform vec2 u_vec;
    void main(){ float a = 0.0; for (int i = 1; i <= 64; i++) { a = max(a, tex(v_uv - u_vec * float(i) / 64.0).a); } a *= u_opacity; gl_FragColor = vec4(u_color * a, a); }`,
  under: `${HEAD} uniform sampler2D u_top; uniform float u_only;
    void main(){ vec4 s = tex(v_uv); vec4 t = texture2D(u_top, v_uv); gl_FragColor = u_only > 0.5 ? s : t + s * (1.0 - t.a); }`,
  flip: `${HEAD} uniform vec2 u_flip; void main(){ vec2 uv = mix(v_uv, 1.0 - v_uv, u_flip); gl_FragColor = tex(uv); }`,
  persp: `precision highp float; varying vec2 v_uv; uniform sampler2D u_tex; uniform float u_opacity; void main(){ gl_FragColor = texture2D(u_tex, v_uv) * u_opacity; }`,
};

class GLFX {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGLRenderingContext;
  private progs = new Map<string, Prog>();
  private quad: WebGLBuffer;
  private pool: Tex[] = [];
  private maxSize: number;

  constructor() {
    this.canvas = document.createElement('canvas');
    const gl = this.canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: false }) as WebGLRenderingContext | null;
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;
    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.maxSize = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE) as number, 8192);
    this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; });
  }

  get limit() { return this.maxSize; }

  private program(name: string, vs = VS): Prog {
    const key = name + (vs === VS ? '' : vs === VS_FLIP ? '|flip' : '|persp');
    let p = this.progs.get(key); if (p) return p;
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Shader ${name}: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS[name]));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`Program ${name}: ${gl.getProgramInfoLog(prog)}`);
    p = { p: prog, u: new Map(), aPos: gl.getAttribLocation(prog, 'a_pos'), aUv: gl.getAttribLocation(prog, 'a_uv') };
    this.progs.set(key, p);
    return p;
  }

  private loc(p: Prog, name: string) {
    if (!p.u.has(name)) p.u.set(name, this.gl.getUniformLocation(p.p, name));
    return p.u.get(name)!;
  }

  newTex(w: number, h: number): Tex {
    const i = this.pool.findIndex((t) => t.w === w && t.h === h);
    if (i >= 0) return this.pool.splice(i, 1)[0];
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fb, w, h };
  }
  release(t: Tex) { if (this.pool.length < 12) this.pool.push(t); else { this.gl.deleteTexture(t.tex); this.gl.deleteFramebuffer(t.fb); } }

  upload(src: TexImageSource, w: number, h: number): Tex {
    const gl = this.gl; const t = this.newTex(w, h);
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    return t;
  }

  /** Runs one full-screen pass. extra textures bind to the named samplers. */
  pass(name: string, input: Tex, uniforms: Record<string, number | number[]>, extra: Record<string, Tex> = {}, out?: Tex): Tex {
    const gl = this.gl;
    const target = out ?? this.newTex(input.w, input.h);
    const p = this.program(name);
    gl.useProgram(p.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
    gl.viewport(0, 0, target.w, target.h);
    gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, input.tex); gl.uniform1i(this.loc(p, 'u_tex'), 0);
    let unit = 1;
    for (const [k, t] of Object.entries(extra)) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t.tex); gl.uniform1i(this.loc(p, k), unit); unit++; }
    gl.uniform2f(this.loc(p, 'u_size'), input.w, input.h);
    for (const [k, v] of Object.entries(uniforms)) {
      const l = this.loc(p, k); if (!l) continue;
      if (typeof v === 'number') gl.uniform1f(l, v);
      else if (v.length === 2) gl.uniform2f(l, v[0], v[1]);
      else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]);
      else if (v.length === 9) gl.uniformMatrix3fv(l, false, v);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(p.aPos); gl.vertexAttribPointer(p.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return target;
  }

  /** Copies a texture into a new 2D canvas. */
  toCanvas(t: Tex, out?: HTMLCanvasElement): HTMLCanvasElement {
    const gl = this.gl;
    if (this.canvas.width !== t.w || this.canvas.height !== t.h) { this.canvas.width = t.w; this.canvas.height = t.h; }
    const p = this.program('copy', VS_FLIP);
    gl.useProgram(p.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, t.w, t.h);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t.tex); gl.uniform1i(this.loc(p, 'u_tex'), 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(p.aPos); gl.vertexAttribPointer(p.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    const c = out ?? createCanvas(t.w, t.h);
    if (c.width !== t.w || c.height !== t.h) { c.width = t.w; c.height = t.h; }
    const x = ctx2d(c); x.globalCompositeOperation = 'copy'; x.drawImage(this.canvas, 0, 0); x.globalCompositeOperation = 'source-over';
    return c;
  }

  /** Draws `src` as a perspective-correct quad. corners: screen px (x, y) with view depth w (> 0). */
  perspective(src: TexImageSource, sw: number, sh: number, corners: { x: number; y: number; w: number }[], outW: number, outH: number, opacity: number): HTMLCanvasElement {
    const gl = this.gl;
    const t = this.upload(src, sw, sh);
    if (this.canvas.width !== outW || this.canvas.height !== outH) { this.canvas.width = outW; this.canvas.height = outH; }
    const p = this.program('persp', VS_PERSP);
    gl.useProgram(p.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, outW, outH);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.BLEND);
    // order: tl, tr, bl, br (triangle strip); clip = (ndc * w, w)
    const uv = [0, 0, 1, 0, 0, 1, 1, 1];
    const v: number[] = [];
    corners.forEach((c, i) => { const nx = (c.x / outW) * 2 - 1, ny = 1 - (c.y / outH) * 2; v.push(nx * c.w, ny * c.w, 0, c.w, uv[i * 2], uv[i * 2 + 1]); });
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STREAM_DRAW);
    gl.enableVertexAttribArray(p.aPos); gl.vertexAttribPointer(p.aPos, 4, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(p.aUv); gl.vertexAttribPointer(p.aUv, 2, gl.FLOAT, false, 24, 16);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t.tex); gl.uniform1i(this.loc(p, 'u_tex'), 0);
    gl.uniform1f(this.loc(p, 'u_opacity'), opacity);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(p.aUv);
    gl.deleteBuffer(buf);
    this.release(t);
    return this.canvas;
  }
}

let lost = false;
let instance: GLFX | null = null;
let failed = false;
export function glfx(): GLFX | null {
  if (lost) { instance = null; lost = false; }
  if (instance || failed) return instance;
  try { instance = new GLFX(); } catch (e) { console.warn('WebGL effects unavailable', e); failed = true; }
  return instance;
}
export const hasWebGL = () => !!glfx();

const rgb3 = (hex: string): [number, number, number] => { const c = hexToRgb(String(hex)); return [c.r / 255, c.g / 255, c.b / 255]; };
const N = (p: Record<string, EffectParamValue>, k: string) => Number(p[k]) || 0;
const deg = (d: number) => (d * Math.PI) / 180;

/** Applies a chain of evaluated effects to a premultiplied 2D canvas; returns a new canvas. */
export function applyEffects(src: HTMLCanvasElement, effects: EvaluatedEffect[], ctx: FxContext): HTMLCanvasElement {
  if (!effects.length) return src;
  const fx = glfx();
  if (!fx || src.width > fx.limit || src.height > fx.limit) return applyEffectsCPU(src, effects, ctx);
  const w = src.width, h = src.height;
  let cur = fx.upload(src, w, h);
  const swap = (next: Tex) => { if (next !== cur) { fx.release(cur); cur = next; } };
  const blur = (t: Tex, radius: number, dims = 'both'): Tex => {
    if (radius < 0.3) return fx.pass('copy', t, {});
    const sigma = radius / 2;
    const reach = sigma * 3;
    const step = Math.max(1, reach / 40);
    let r = t;
    const doPass = (dx: number, dy: number) => {
      const n = Math.min(40, Math.ceil(reach / step));
      const out = fx.pass('blur', r, { u_step: [(dx * step) / w, (dy * step) / h], u_sigma: sigma / step, u_n: n });
      if (r !== t) fx.release(r);
      r = out;
    };
    if (dims !== 'v') doPass(1, 0);
    if (dims !== 'h') doPass(0, 1);
    // very large radii: a second pass smooths the stepped sampling
    if (step > 2) { if (dims !== 'v') doPass(1, 0); if (dims !== 'h') doPass(0, 1); }
    return r === t ? fx.pass('copy', t, {}) : r;
  };
  const S = ctx.scale;
  const seedT = Math.floor(ctx.time * ctx.fps);
  for (const e of effects) {
    const p = e.params;
    switch (e.type) {
      case 'gaussian-blur': swap(blur(cur, N(p, 'blurriness') * S, String(p.dims))); break;
      case 'directional-blur': { const a = deg(N(p, 'direction') - 90), L = N(p, 'length') * S; swap(fx.pass('dirblur', cur, { u_vec: [(Math.cos(a) * L) / w, (Math.sin(a) * L) / h] })); break; }
      case 'motion-blur': {
        const k = (N(p, 'amount') / 100) * (0.5 / Math.max(1, ctx.fps));
        const vx = ctx.velocity[0] * k, vy = ctx.velocity[1] * k;
        if (Math.hypot(vx, vy) > 0.5) swap(fx.pass('dirblur', cur, { u_vec: [vx / w, vy / h] }));
        break;
      }
      case 'radial-blur': { const c = p.center as [number, number]; swap(fx.pass('radialblur', cur, { u_center: [(c[0] / 100) * w, (c[1] / 100) * h], u_amount: N(p, 'amount') / 100, u_spin: p.mode === 'spin' ? 1 : 0 })); break; }
      case 'brightness-contrast': swap(fx.pass('bc', cur, { u_b: N(p, 'brightness') / 255, u_c: Math.max(0, 1 + N(p, 'contrast') / 100) })); break;
      case 'brightness': swap(fx.pass('bc', cur, { u_b: N(p, 'brightness') / 255, u_c: 1 })); break;
      case 'contrast': swap(fx.pass('bc', cur, { u_b: 0, u_c: Math.max(0, 1 + N(p, 'contrast') / 100) })); break;
      case 'hue-saturation': swap(fx.pass('hsl', cur, { u_h: N(p, 'hue') / 360, u_s: N(p, 'saturation') / 100, u_l: N(p, 'lightness') / 100, u_colorize: N(p, 'colorize') })); break;
      case 'color-balance': swap(fx.pass('balance', cur, { u_s: [N(p, 'sr'), N(p, 'sg'), N(p, 'sb')].map((v) => v / 100), u_m: [N(p, 'mr'), N(p, 'mg'), N(p, 'mb')].map((v) => v / 100), u_hh: [N(p, 'hr'), N(p, 'hg'), N(p, 'hb')].map((v) => v / 100) })); break;
      case 'exposure': swap(fx.pass('exposure', cur, { u_e: N(p, 'exposure'), u_g: Math.max(0.05, N(p, 'gamma')) })); break;
      case 'tint': swap(fx.pass('tint', cur, { u_black: rgb3(String(p.black)), u_white: rgb3(String(p.white)), u_amount: N(p, 'amount') / 100 })); break;
      case 'fill': swap(fx.pass('fill', cur, { u_color: rgb3(String(p.color)), u_amount: N(p, 'opacity') / 100 })); break;
      case 'invert': swap(fx.pass('invert', cur, { u_blend: N(p, 'blend') / 100 })); break;
      case 'posterize': swap(fx.pass('posterize', cur, { u_levels: Math.max(2, N(p, 'levels')) })); break;
      case 'vignette': swap(fx.pass('vignette', cur, { u_amount: N(p, 'amount') / 100, u_sizev: N(p, 'size') / 100, u_soft: Math.max(0.01, N(p, 'softness') / 100), u_color: rgb3(String(p.color)) })); break;
      case 'noise': swap(fx.pass('noise', cur, { u_amount: N(p, 'amount') / 100, u_color: N(p, 'color'), u_seed: (N(p, 'animate') ? seedT : 0) * 0.37 + ctx.seed })); break;
      case 'film-grain': swap(fx.pass('grain', cur, { u_amount: N(p, 'intensity') / 100, u_gsize: Math.max(0.3, N(p, 'size') * S), u_seed: (N(p, 'animate') ? seedT : 0) + ctx.seed })); break;
      case 'sharpen': swap(fx.pass('sharpen', cur, { u_amount: N(p, 'amount') / 100 })); break;
      case 'pixelate': swap(fx.pass('pixelate', cur, { u_cell: Math.max(1, N(p, 'size') * S) })); break;
      case 'rgb-split': { const a = deg(N(p, 'angle')), d = N(p, 'amount') * S; swap(fx.pass('rgbsplit', cur, { u_off: [(Math.cos(a) * d) / w, (Math.sin(a) * d) / h] })); break; }
      case 'chromatic-aberration': swap(fx.pass('chroma', cur, { u_amount: N(p, 'amount') * S })); break;
      case 'glitch': swap(fx.pass('glitch', cur, { u_amount: N(p, 'amount') / 100, u_block: Math.max(2, N(p, 'blocks') * S), u_rgb: N(p, 'rgb') * S, u_seed: Math.floor(ctx.time * N(p, 'speed')) + ctx.seed })); break;
      case 'displacement': swap(fx.pass('displace', cur, { u_amount: N(p, 'amount') * S, u_dsize: Math.max(2, N(p, 'size') * S), u_evo: N(p, 'evolution') / 100 + (N(p, 'animate') ? ctx.time * 0.6 : 0), u_wave: p.type === 'wave' ? 1 : 0 })); break;
      case 'wave-warp': { const a = deg(N(p, 'direction') - 90); swap(fx.pass('wave', cur, { u_h: N(p, 'height') * S, u_w: Math.max(1, N(p, 'width') * S), u_dir: [Math.cos(a), Math.sin(a)], u_phase: ctx.time * N(p, 'speed') * Math.PI * 2 })); break; }
      case 'bulge': { const c = p.center as [number, number]; swap(fx.pass('bulge', cur, { u_center: [(c[0] / 100) * w, (c[1] / 100) * h], u_radius: Math.max(1, (N(p, 'radius') / 100) * Math.max(w, h)), u_height: N(p, 'height') / 100 })); break; }
      case 'transform': {
        const pos = p.position as [number, number]; const sc = N(p, 'scale') / 100 || 0.0001; const r = deg(N(p, 'rotation'));
        const cx = w / 2, cy = h / 2, tx = pos[0] * S, ty = pos[1] * S;
        // forward: T(c + t) R S T(-c); inverse maps output px → source px
        const cs = Math.cos(-r) / sc, sn = Math.sin(-r) / sc;
        const ox = cx + tx, oy = cy + ty;
        // inv(q) = c + R(-r)/s · (q - o)
        const inv = [cs, sn, 0, -sn, cs, 0, cx - (cs * ox - sn * oy), cy - (sn * ox + cs * oy), 1];
        swap(fx.pass('xform', cur, { u_inv: inv, u_opacity: N(p, 'opacity') / 100 }));
        break;
      }
      case 'flip': swap(fx.pass('flip', cur, { u_flip: [N(p, 'h') ? 1 : 0, N(p, 'v') ? 1 : 0] })); break;
      case 'chroma-key': {
        const tol = (N(p, 'tolerance') / 100) * 0.35, soft = (N(p, 'softness') / 100) * 0.25;
        swap(fx.pass('chromakey', cur, { u_key: rgb3(String(p.key)), u_tol: tol, u_soft: soft, u_spill: N(p, 'spill') / 100, u_matte: N(p, 'matte') }));
        break;
      }
      case 'luma-key': swap(fx.pass('lumakey', cur, { u_th: N(p, 'threshold') / 100, u_soft: N(p, 'softness') / 100, u_inv: N(p, 'invert') })); break;
      case 'glow': {
        const bright = fx.pass('bright', cur, { u_th: N(p, 'threshold') / 100 });
        const g = blur(bright, N(p, 'radius') * S); fx.release(bright);
        const out = fx.pass('addglow', cur, { u_int: N(p, 'intensity') / 100, u_color: rgb3(String(p.color)), u_useColor: N(p, 'useColor') }, { u_glow: g });
        fx.release(g); swap(out); break;
      }
      case 'drop-shadow': {
        const a = deg(N(p, 'direction') - 90), d = N(p, 'distance') * S;
        const sh = fx.pass('shadowsrc', cur, { u_color: rgb3(String(p.color)), u_opacity: N(p, 'opacity') / 100, u_off: [Math.cos(a) * d, Math.sin(a) * d] });
        const sb = blur(sh, N(p, 'softness') * S); fx.release(sh);
        const out = fx.pass('under', sb, { u_only: N(p, 'only') }, { u_top: cur });
        fx.release(sb); swap(out); break;
      }
      case 'long-shadow': {
        const a = deg(N(p, 'direction') - 90), L = N(p, 'length') * S;
        const sh = fx.pass('longshadow', cur, { u_color: rgb3(String(p.color)), u_opacity: N(p, 'opacity') / 100, u_vec: [(Math.cos(a) * L) / w, (Math.sin(a) * L) / h] });
        const out = fx.pass('under', sh, { u_only: 0 }, { u_top: cur });
        fx.release(sh); swap(out); break;
      }
      default: break;
    }
  }
  const res = fx.toCanvas(cur);
  fx.release(cur);
  return res;
}

/** Fallback without WebGL: the effects 2D canvas filters can express. */
function applyEffectsCPU(src: HTMLCanvasElement, effects: EvaluatedEffect[], ctx: FxContext): HTMLCanvasElement {
  const filters: string[] = [];
  for (const e of effects) {
    const p = e.params;
    if (e.type === 'gaussian-blur') filters.push(`blur(${(N(p, 'blurriness') * ctx.scale) / 2}px)`);
    else if (e.type === 'brightness-contrast') filters.push(`brightness(${1 + N(p, 'brightness') / 150}) contrast(${1 + N(p, 'contrast') / 100})`);
    else if (e.type === 'hue-saturation') filters.push(`hue-rotate(${N(p, 'hue')}deg) saturate(${1 + N(p, 'saturation') / 100})`);
    else if (e.type === 'invert') filters.push(`invert(${1 - N(p, 'blend') / 100})`);
    else if (e.type === 'drop-shadow') { const a = deg(N(p, 'direction') - 90), d = N(p, 'distance') * ctx.scale; filters.push(`drop-shadow(${Math.cos(a) * d}px ${Math.sin(a) * d}px ${N(p, 'softness') * ctx.scale / 2}px ${String(p.color)})`); }
  }
  if (!filters.length) return src;
  const out = createCanvas(src.width, src.height); const x = ctx2d(out);
  x.filter = filters.join(' '); x.drawImage(src, 0, 0);
  return out;
}

/** Extra pixels around a layer needed by its effects (in effect px). */
export function effectsPad(effects: EvaluatedEffect[]): number {
  let pad = 0;
  for (const e of effects) { const d = effectDef(e.type); if (d?.pad) pad += d.pad(e.params); }
  return Math.min(pad, 2000);
}
