/**
 * Validates build/icon.ico: container structure and each embedded PNG.
 *
 * Guards against the class of bug where the artwork renders but the alpha
 * channel is written on the wrong scale (making the icon invisible). Exits
 * non-zero if any entry is malformed or lacks a full 0–255 alpha range.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const file = path.join(__dirname, '..', 'build', 'icon.ico');
const buf = fs.readFileSync(file);

const reserved = buf.readUInt16LE(0);
const type = buf.readUInt16LE(2);
const count = buf.readUInt16LE(4);
if (reserved !== 0 || type !== 1 || count < 1) {
  console.error(`Invalid ICO header: reserved=${reserved} type=${type} count=${count}`);
  process.exit(1);
}

function decodePng(png) {
  if (!(png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47)) {
    return { ok: false, reason: 'bad PNG signature' };
  }
  let off = 8;
  let width = 0,
    height = 0,
    colorType = 0;
  const idat = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const chunkType = png.toString('ascii', off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + len);
    if (chunkType === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (chunkType === 'IDAT') {
      idat.push(data);
    }
    off += 12 + len;
  }
  if (colorType !== 6) return { ok: false, reason: `unexpected colorType ${colorType}` };

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = width * bpp;
  const px = Buffer.alloc(width * height * bpp);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = px.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      switch (filter) {
        case 1:
          v = (v + a) & 255;
          break;
        case 2:
          v = (v + b) & 255;
          break;
        case 3:
          v = (v + ((a + b) >> 1)) & 255;
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
          break;
        }
      }
      cur[x] = v;
    }
  }

  let minA = 255,
    maxA = 0,
    opaque = 0;
  for (let i = 3; i < px.length; i += 4) {
    if (px[i] < minA) minA = px[i];
    if (px[i] > maxA) maxA = px[i];
    if (px[i] === 255) opaque++;
  }
  return { ok: true, width, height, minA, maxA, opaque };
}

let failures = 0;
for (let i = 0; i < count; i++) {
  const e = 6 + 16 * i;
  const w = buf[e];
  const bpp = buf.readUInt16LE(e + 6);
  const len = buf.readUInt32LE(e + 8);
  const off = buf.readUInt32LE(e + 12);
  const png = buf.subarray(off, off + len);
  const wpx = w === 0 ? 256 : w;
  const res = decodePng(png);

  const problems = [];
  if (!res.ok) {
    problems.push(res.reason);
  } else {
    if (res.width !== wpx || res.height !== wpx)
      problems.push(`size mismatch ${res.width}x${res.height}`);
    if (res.maxA !== 255) problems.push(`no fully opaque pixels (max alpha ${res.maxA})`);
    if (res.minA !== 0) problems.push(`no transparent pixels (min alpha ${res.minA})`);
    if (res.opaque === 0) problems.push('fully transparent');
  }

  if (problems.length > 0) {
    failures++;
    console.error(`FAIL ${wpx}px  bpp=${bpp} len=${len}  ${problems.join('; ')}`);
  } else {
    console.log(
      `ok   ${wpx}px  bpp=${bpp} len=${len}  alpha=[${res.minA},${res.maxA}] opaque=${res.opaque}`
    );
  }
}

if (failures > 0) {
  console.error(`\n${failures}/${count} icon entries failed validation.`);
  process.exit(1);
}
console.log(`\nAll ${count} icon entries valid.`);
