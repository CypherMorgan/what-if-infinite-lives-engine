/**
 * Generates build/icon.ico — a multi-resolution Windows icon for the app.
 *
 * The artwork is drawn without any image library: raw RGBA pixel buffers are
 * composed for each size, then wrapped in PNG-in-ICO containers (ICO supports
 * embedded PNG payloads since Windows Vista, which is what electron-builder
 * and Explorer expect for 256px entry).
 *
 * Design: deep-space rounded square, cyan/violet branching glyph — three
 * diverging paths from a single node, matching the app's graph language.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUT = path.join(__dirname, '..', 'build', 'icon.ico');
const PREVIEW_DIR = path.join(__dirname, '..', 'build');
const SIZES = [256, 128, 64, 48, 32, 24, 16];

/* ------------------------------------------------------------------ */
/* Tiny raster helpers                                                 */
/* ------------------------------------------------------------------ */

function canvas(size) {
  return { size, data: new Float64Array(size * size * 4) };
}

function blend(c, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= c.size || y >= c.size || a <= 0) return;
  const i = (y * c.size + x) * 4;
  const d = c.data;
  const sa = Math.min(1, a);
  const da = d[i + 3];
  const outA = sa + da * (1 - sa);
  if (outA <= 0) return;
  d[i] = (r * sa + d[i] * da * (1 - sa)) / outA;
  d[i + 1] = (g * sa + d[i + 1] * da * (1 - sa)) / outA;
  d[i + 2] = (b * sa + d[i + 2] * da * (1 - sa)) / outA;
  d[i + 3] = outA;
}

/** Signed distance from point to a rounded rectangle centred at cx,cy. */
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 <= 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
  return Math.hypot(wx - vx * t, wy - vy * t);
}

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/* ------------------------------------------------------------------ */
/* Artwork                                                             */
/* ------------------------------------------------------------------ */

const CYAN = [79, 216, 255];
const VIOLET = [177, 140, 255];
const AMBER = [255, 183, 77];
const VOID_A = [10, 15, 30];
const VOID_B = [5, 7, 13];

/** Renders the icon at a given size using 4x supersampling for antialiasing. */
function render(size, ss = 4) {
  const big = size * ss;
  const c = canvas(big);
  const S = big;

  // ---- background: rounded square with a vertical deep-space gradient ----
  const pad = 0.055 * S;
  const hw = S / 2 - pad;
  const r = 0.22 * S;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const d = sdRoundRect(px, py, S / 2, S / 2, hw, hw, r);
      const cov = Math.max(0, Math.min(1, 0.5 - d));
      if (cov <= 0) continue;
      const t = y / S;
      const base = mix(VOID_A, VOID_B, t);
      // subtle corner glows, echoing the app's background
      const glowCyan = Math.max(0, 1 - Math.hypot(px - S * 0.86, py - S * 0.12) / (S * 0.62));
      const glowViolet = Math.max(0, 1 - Math.hypot(px - S * 0.12, py - S * 0.92) / (S * 0.62));
      const rr = base[0] + glowCyan ** 2 * 26 + glowViolet ** 2 * 30;
      const gg = base[1] + glowCyan ** 2 * 58 + glowViolet ** 2 * 24;
      const bb = base[2] + glowCyan ** 2 * 70 + glowViolet ** 2 * 66;
      blend(c, x, y, rr, gg, bb, cov);
    }
  }

  // ---- glyph: one origin node branching into three paths ----
  const ox = S * 0.235;
  const oy = S * 0.5;

  const branches = [
    { ex: S * 0.79, ey: S * 0.245, colour: CYAN, w: 0.052 },
    { ex: S * 0.79, ey: S * 0.5, colour: VIOLET, w: 0.052 },
    { ex: S * 0.79, ey: S * 0.755, colour: AMBER, w: 0.052 },
  ];

  // soft outer glow pass, then the crisp stroke pass
  for (const pass of [
    { hw: 2.4, alpha: 0.2 },
    { hw: 1.0, alpha: 1 },
  ]) {
    for (const b of branches) {
      const midX = (ox + b.ex) / 2;
      const w = ((b.w * S) / 2) * pass.hw;
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const px = x + 0.5;
          const py = y + 0.5;
          // quadratic-ish curve approximated by two segments through a control point
          const d1 = sdSegment(px, py, ox, oy, midX, oy);
          const d2 = sdSegment(px, py, midX, oy, b.ex, b.ey);
          const d = Math.min(d1, d2);
          const cov = Math.max(0, Math.min(1, w - d));
          if (cov <= 0) continue;
          blend(c, x, y, b.colour[0], b.colour[1], b.colour[2], cov * pass.alpha);
        }
      }
    }
  }

  // ---- nodes: origin disc plus endpoint discs ----
  const dots = [
    { x: ox, y: oy, r: 0.082 * S, colour: [232, 237, 249] },
    ...branches.map((b) => ({ x: b.ex, y: b.ey, r: 0.062 * S, colour: b.colour })),
  ];
  for (const d of dots) {
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const dist = Math.hypot(px - d.x, py - d.y);
        const cov = Math.max(0, Math.min(1, d.r - dist));
        if (cov <= 0) continue;
        blend(c, x, y, d.colour[0], d.colour[1], d.colour[2], cov);
      }
    }
  }

  // ---- downsample with box filter ----
  const out = Buffer.alloc(size * size * 4);
  const n = ss * ss;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r0 = 0,
        g0 = 0,
        b0 = 0,
        a0 = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const i = ((y * ss + sy) * big + (x * ss + sx)) * 4;
          r0 += c.data[i];
          g0 += c.data[i + 1];
          b0 += c.data[i + 2];
          a0 += c.data[i + 3];
        }
      }
      const o = (y * size + x) * 4;
      out[o] = Math.round(Math.min(255, r0 / n));
      out[o + 1] = Math.round(Math.min(255, g0 / n));
      out[o + 2] = Math.round(Math.min(255, b0 / n));
      out[o + 3] = Math.round(Math.min(255, a0 / n));
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* PNG encoding (no dependencies)                                      */
/* ------------------------------------------------------------------ */

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ */
/* ICO container                                                       */
/* ------------------------------------------------------------------ */

function buildIco(pngs) {
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);

  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  pngs.forEach((p, i) => {
    const e = i * 16;
    dir[e] = p.size >= 256 ? 0 : p.size; // 0 means 256
    dir[e + 1] = p.size >= 256 ? 0 : p.size;
    dir[e + 2] = 0; // palette
    dir[e + 3] = 0; // reserved
    dir.writeUInt16LE(1, e + 4); // colour planes
    dir.writeUInt16LE(32, e + 6); // bits per pixel
    dir.writeUInt32BE(0, e + 8);
    dir.writeUInt32LE(p.data.length, e + 8);
    dir.writeUInt32LE(offset, e + 12);
    offset += p.data.length;
  });

  return Buffer.concat([header, dir, ...pngs.map((p) => p.data)]);
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

fs.mkdirSync(PREVIEW_DIR, { recursive: true });

const pngs = SIZES.map((size) => ({
  size,
  data: encodePng(render(size, size >= 64 ? 4 : 6), size),
}));
fs.writeFileSync(OUT, buildIco(pngs));

// A standalone 256px PNG is handy for the README and GitHub social preview.
fs.writeFileSync(path.join(PREVIEW_DIR, 'icon-256.png'), encodePng(render(256, 4), 256));

console.log(`icon.ico written (${SIZES.join(', ')}px) -> ${OUT}`);
console.log(`icon-256.png written -> ${path.join(PREVIEW_DIR, 'icon-256.png')}`);
