const fs = require('fs');
const zlib = require('zlib');

function decodePng(filepath) {
  const buf = fs.readFileSync(filepath);
  let pos = 8;
  const idatChunks = [];
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    if (type === 'IHDR') {
      width = buf.readUInt32BE(pos + 8);
      height = buf.readUInt32BE(pos + 12);
      bitDepth = buf[pos + 16];
      colorType = buf[pos + 17];
    } else if (type === 'IDAT') idatChunks.push(buf.subarray(pos + 8, pos + 8 + len));
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const decompressed = zlib.inflateSync(Buffer.concat(idatChunks));
  const bpp = colorType === 6 ? 4 : (colorType === 2 ? 3 : 1);
  const stride = 1 + width * bpp;
  const pixels = Buffer.alloc(width * height * bpp);
  let prevLine = Buffer.alloc(width * bpp);
  for (let y = 0; y < height; y++) {
    const lineStart = y * stride;
    const filter = decompressed[lineStart];
    const currLine = decompressed.subarray(lineStart + 1, lineStart + stride);
    const unfilt = Buffer.alloc(width * bpp);
    for (let x = 0; x < width * bpp; x++) {
      const a = x >= bpp ? unfilt[x - bpp] : 0, b = prevLine[x], c = x >= bpp ? prevLine[x - bpp] : 0;
      let val = currLine[x];
      if (filter === 0) unfilt[x] = val;
      else if (filter === 1) unfilt[x] = (val + a) & 0xFF;
      else if (filter === 2) unfilt[x] = (val + b) & 0xFF;
      else if (filter === 3) unfilt[x] = (val + Math.floor((a + b) / 2)) & 0xFF;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        unfilt[x] = (val + (pa <= pb && pa <= pc ? a : (pb <= pc ? b : c))) & 0xFF;
      }
    }
    unfilt.copy(pixels, y * width * bpp);
    prevLine = unfilt;
  }
  return { width, height, bpp, pixels };
}

const shot2 = decodePng('C:\\Users\\Poisson\\.gemini\\antigravity\\brain\\d9f85c3b-b987-4fd6-bf80-1860dd74ac21\\step2_after_click.png');

for (let y = 300; y < shot2.height; y++) {
  let segLen = 0, maxSeg = 0, startX = 0, bestStartX = 0;
  for (let x = 450; x < 750; x++) {
    const idx = (y * shot2.width + x) * shot2.bpp;
    const r = shot2.pixels[idx], g = shot2.pixels[idx+1], b = shot2.pixels[idx+2];
    if (Math.abs(r - g) < 10 && Math.abs(r - b) < 10 && r > 100 && r < 200) {
      if (segLen === 0) startX = x;
      segLen++;
      if (segLen > maxSeg) { maxSeg = segLen; bestStartX = startX; }
    } else {
      segLen = 0;
    }
  }
  if (maxSeg > 30) {
    console.log(`y=${y}: server col gray segment = ${maxSeg} at x=${bestStartX}..${bestStartX+maxSeg}`);
  }
}
