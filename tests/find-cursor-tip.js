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

const shot1 = decodePng('C:\\Users\\Poisson\\.gemini\\antigravity\\brain\\d9f85c3b-b987-4fd6-bf80-1860dd74ac21\\step1_serverlist.png');
const shot2 = decodePng('C:\\Users\\Poisson\\.gemini\\antigravity\\brain\\d9f85c3b-b987-4fd6-bf80-1860dd74ac21\\step2_after_click.png');

// Find the cursor in shot2:
// The MU cursor is a white/silver glove pointing up-left.
// The tip of the index finger is the top-most, left-most bright pixel of the cursor!
// In shot2, let's look around x: 300..450, y: 350..550
let topY = 9999, leftX = 9999;
let cursorPoints = [];
for (let y = 350; y < 550; y++) {
  for (let x = 300; x < 450; x++) {
    const idx = (y * shot2.width + x) * shot2.bpp;
    const r = shot2.pixels[idx], g = shot2.pixels[idx+1], b = shot2.pixels[idx+2];
    const r1 = shot1.pixels[idx], g1 = shot1.pixels[idx+1], b1 = shot1.pixels[idx+2];
    if (r > 180 && g > 180 && b > 180 && (r1 < 100 || g1 < 100 || b1 < 100)) {
      cursorPoints.push({ x, y });
    }
  }
}

if (cursorPoints.length > 0) {
  let minY = Math.min(...cursorPoints.map(p => p.y));
  let minX = Math.min(...cursorPoints.map(p => p.x));
  let maxY = Math.max(...cursorPoints.map(p => p.y));
  let maxX = Math.max(...cursorPoints.map(p => p.x));
  // The tip of the pointer finger in the MU glove cursor:
  // Pointer finger points towards top-left, so the tip is at minX / minY
  console.log('Cursor points range:', { minX, maxX, minY, maxY });
  const topPixels = cursorPoints.filter(p => p.y <= minY + 2);
  console.log('Top pixels of cursor:', topPixels);
} else {
  console.log('No cursor points found.');
}
