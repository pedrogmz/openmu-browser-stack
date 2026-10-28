const fs = require('fs');

// Simple PNG decoder to read pixels
const pngPath = 'C:\\Users\\Poisson\\.gemini\\antigravity\\brain\\d9f85c3b-b987-4fd6-bf80-1860dd74ac21\\shot_tour.png';
const buf = fs.readFileSync(pngPath);

// PNG header: 8 bytes
// IHDR chunk: 4 bytes length, 4 bytes 'IHDR', 4 bytes width, 4 bytes height
const width = buf.readUInt32BE(16);
const height = buf.readUInt32BE(20);
console.log('PNG dimensions:', width, 'x', height);

// Let's also check after_valhalla_click.png
const buf2 = fs.readFileSync('C:\\Users\\Poisson\\.gemini\\antigravity\\brain\\d9f85c3b-b987-4fd6-bf80-1860dd74ac21\\after_valhalla_click.png');
console.log('after_valhalla_click dimensions:', buf2.readUInt32BE(16), 'x', buf2.readUInt32BE(20));
