/**
 * Sanity-checks README screenshots: verifies each is a real, varied image
 * (not blank, not a solid error colour) and reports basic statistics.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const dir = path.join(__dirname, '..', 'docs', 'screenshots');

function decodePng(file) {
  const buf = fs.readFileSync(file);
  let off = 8,
    width = 0,
    height = 0,
    colorType = 0,
    bitDepth = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const px = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = px.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
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
          const pa = Math.abs(p - a),
            pb = Math.abs(p - b),
            pc = Math.abs(p - c);
          v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
          break;
        }
      }
      cur[x] = v;
    }
  }
  return { width, height, channels, px, bitDepth };
}

let failures = 0;
for (const name of fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.png'))
  .sort()) {
  const img = decodePng(path.join(dir, name));
  const { width, height, channels, px } = img;
  let sum = 0,
    sumSq = 0,
    n = 0;
  let minLum = 255,
    maxLum = 0;
  const colours = new Set();
  for (let y = 0; y < height; y += 7) {
    for (let x = 0; x < width; x += 7) {
      const i = (y * width + x) * channels;
      const lum = (px[i] + px[i + 1] + px[i + 2]) / 3;
      sum += lum;
      sumSq += lum * lum;
      n++;
      if (lum < minLum) minLum = lum;
      if (lum > maxLum) maxLum = lum;
      if (colours.size < 4000)
        colours.add((px[i] >> 4) * 256 + (px[i + 1] >> 4) * 16 + (px[i + 2] >> 4));
    }
  }
  const mean = sum / n;
  const std = Math.sqrt(sumSq / n - mean * mean);
  const distinct = colours.size;
  const ok = std > 8 && distinct > 60 && maxLum - minLum > 80;
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'BAD '} ${name}  ${width}x${height}  mean=${mean.toFixed(1)} std=${std.toFixed(1)} ` +
      `lum=[${minLum.toFixed(0)},${maxLum.toFixed(0)}] distinctColors~${distinct}`
  );
}

if (failures > 0) {
  console.error(`\n${failures} screenshot(s) look blank or invalid.`);
  process.exit(1);
}
console.log('\nAll screenshots look valid.');
