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

  // Each scanline has 1 filter byte + width * bytesPerPixel
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
      if (filter === 0) {
        unfilt[x] = val;
      } else if (filter === 1) {
        unfilt[x] = (val + a) & 0xFF;
      } else if (filter === 2) {
        unfilt[x] = (val + b) & 0xFF;
      } else if (filter === 3) {
        unfilt[x] = (val + Math.floor((a + b) / 2)) & 0xFF;
      } else if (filter === 4) {
        // Paeth
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        let pr;
        if (pa <= pb && pa <= pc) pr = a;
        else if (pb <= pc) pr = b;
        else pr = c;
        unfilt[x] = (val + pr) & 0xFF;
      }
    }
    unfilt.copy(pixels, y * width * bpp);
    prevLine = unfilt;
  }

  return { width, height, bpp, pixels };
}

const { width, height, bpp, pixels } = decodePng('C:\\Users\\Poisson\\.gemini\\antigravity\\brain\\d9f85c3b-b987-4fd6-bf80-1860dd74ac21\\after_valhalla_click.png');
console.log('Decoded PNG:', width, 'x', height, 'bpp:', bpp);

// Let's find white/bright pixels corresponding to the text "Valhalla" or the button frame
// Valhalla button border or text:
// Let's scan for the text or button box
// The button in legacy theme has a border or label text around y in 300..500, x in 200..450
for (let y = 300; y < 550; y += 10) {
  let brightCount = 0;
  for (let x = 200; x < 450; x++) {
    const idx = (y * width + x) * bpp;
    const r = pixels[idx], g = pixels[idx+1], b = pixels[idx+2];
    if (r > 180 && g > 180 && b > 180) {
      brightCount++;
    }
  }
  if (brightCount > 5) {
    console.log(`Row y=${y} has ${brightCount} bright pixels`);
  }
}
