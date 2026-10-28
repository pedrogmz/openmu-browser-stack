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
    } else if (type === 'IDAT') {
      idatChunks.push(buf.subarray(pos + 8, pos + 8 + len));
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }

  const compressed = Buffer.concat(idatChunks);
  const decompressed = zlib.inflateSync(compressed);

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
      const a = x >= bpp ? unfilt[x - bpp] : 0;
      const b = prevLine[x];
      const c = x >= bpp ? prevLine[x - bpp] : 0;

      let val = currLine[x];
      if (filter === 0) unfilt[x] = val;
      else if (filter === 1) unfilt[x] = (val + a) & 0xFF;
      else if (filter === 2) unfilt[x] = (val + b) & 0xFF;
      else if (filter === 3) unfilt[x] = (val + Math.floor((a + b) / 2)) & 0xFF;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        unfilt[x] = (val + (pa <= pb && pa <= pc ? a : (pb <= pc ? b : c))) & 0xFF;
      }
    }
    unfilt.copy(pixels, y * width * bpp);
    prevLine = unfilt;
  }
  return { width, height, bpp, pixels };
}

const { width, height, bpp, pixels } = decodePng('C:\\Users\\Poisson\\.gemini\\antigravity\\brain\\d9f85c3b-b987-4fd6-bf80-1860dd74ac21\\shot_tour.png');

// Find non-black width (since there's a black bar on right)
for (let x = width - 1; x >= 0; x--) {
  let isBlack = true;
  for (let y = 100; y < height - 100; y += 10) {
    const idx = (y * width + x) * bpp;
    if (pixels[idx] > 10 || pixels[idx+1] > 10 || pixels[idx+2] > 10) {
      isBlack = false;
      break;
    }
  }
  if (!isBlack) {
    console.log('Last non-black column x =', x);
    break;
  }
}

// Find Valhalla button bounding box:
// The button background is dark gray with a rounded border and white text "Valhalla"
let minX = 9999, maxX = 0, minY = 9999, maxY = 0;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const idx = (y * width + x) * bpp;
    const r = pixels[idx], g = pixels[idx+1], b = pixels[idx+2];
    // "Valhalla" text is light/white (r,g,b > 180)
    if (r > 190 && g > 190 && b > 190 && x < 500 && y > 250) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}
console.log('Valhalla text bbox:', { minX, maxX, minY, maxY, centerX: Math.round((minX+maxX)/2), centerY: Math.round((minY+maxY)/2) });

// Now in after_valhalla_click.png, find the glove cursor position:
const { pixels: clickPix } = decodePng('C:\\Users\\Poisson\\.gemini\\antigravity\\brain\\d9f85c3b-b987-4fd6-bf80-1860dd74ac21\\after_valhalla_click.png');
// Find difference between shot_tour.png and after_valhalla_click.png
let diffMinX = 9999, diffMaxX = 0, diffMinY = 9999, diffMaxY = 0;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const idx = (y * width + x) * bpp;
    const dr = Math.abs(pixels[idx] - clickPix[idx]);
    const dg = Math.abs(pixels[idx+1] - clickPix[idx+1]);
    const db = Math.abs(pixels[idx+2] - clickPix[idx+2]);
    if (dr + dg + db > 60) {
      if (x < diffMinX) diffMinX = x;
      if (x > diffMaxX) diffMaxX = x;
      if (y < diffMinY) diffMinY = y;
      if (y > diffMaxY) diffMaxY = y;
    }
  }
}
console.log('Difference bbox (where cursor/click happened):', { diffMinX, diffMaxX, diffMinY, diffMaxY });
