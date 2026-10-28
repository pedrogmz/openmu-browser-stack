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

const shotTour = decodePng('C:\\Users\\Poisson\\.gemini\\antigravity\\brain\\d9f85c3b-b987-4fd6-bf80-1860dd74ac21\\shot_tour.png');
const shotClick = decodePng('C:\\Users\\Poisson\\.gemini\\antigravity\\brain\\d9f85c3b-b987-4fd6-bf80-1860dd74ac21\\after_valhalla_click.png');

// Compare only where diff is concentrated in a small area (the cursor changed position):
// In shot_tour, cursor was at some position. In shotClick, cursor was at new position.
// Let's find white pixels of the glove in shotClick that were NOT white in shotTour:
let cursorPixels = [];
for (let y = 0; y < shotClick.height; y++) {
  for (let x = 0; x < shotClick.width; x++) {
    const idx = (y * shotClick.width + x) * shotClick.bpp;
    const r = shotClick.pixels[idx], g = shotClick.pixels[idx+1], b = shotClick.pixels[idx+2];
    const tr = shotTour.pixels[idx], tg = shotTour.pixels[idx+1], tb = shotTour.pixels[idx+2];
    if (r > 200 && g > 200 && b > 200 && (tr < 150 || tg < 150 || tb < 150)) {
      // White glove pixel appearing only in shotClick
      // Exclude background animations (torches/chains)
      if (x < 500 && y > 200) {
        cursorPixels.push({ x, y });
      }
    }
  }
}

if (cursorPixels.length > 0) {
  let minX = Math.min(...cursorPixels.map(p => p.x));
  let maxX = Math.max(...cursorPixels.map(p => p.x));
  let minY = Math.min(...cursorPixels.map(p => p.y));
  let maxY = Math.max(...cursorPixels.map(p => p.y));
  console.log('Cursor moved to in shotClick:', { minX, maxX, minY, maxY, centerX: (minX+maxX)/2, centerY: (minY+maxY)/2 });
} else {
  console.log('No new cursor pixels found.');
}
