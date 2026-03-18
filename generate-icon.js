/**
 * Generate a simple tray icon for the printer app.
 * Run once: node generate-icon.js
 * Creates assets/icon.png (256x256) and assets/icon.ico
 */

// Minimal 16x16 PNG with a printer symbol (orange on transparent)
// This is a hand-crafted minimal PNG file
const fs = require('fs');
const path = require('path');

// We'll create a simple 32x32 BMP-style icon using raw PNG encoding
// For now, let's create a proper larger icon using Canvas-free approach

// Create a simple 256x256 PNG with basic shapes
// Using the simplest possible PNG: RGBA pixels

function createPNG(width, height, pixels) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  
  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  
  const ihdrChunk = makeChunk('IHDR', ihdr);
  
  // IDAT chunk - raw pixel data with zlib
  // Build raw scanlines (filter byte 0 = None for each row)
  const rawData = Buffer.alloc(height * (1 + width * 4));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    rawData[offset++] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      rawData[offset++] = pixels[idx];     // R
      rawData[offset++] = pixels[idx + 1]; // G
      rawData[offset++] = pixels[idx + 2]; // B
      rawData[offset++] = pixels[idx + 3]; // A
    }
  }
  
  const zlib = require('zlib');
  const compressed = zlib.deflateSync(rawData);
  const idatChunk = makeChunk('IDAT', compressed);
  
  // IEND chunk
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));
  
  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  
  const typeBuffer = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuffer, data]);
  const crc = crc32(crcData);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc, 0);
  
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

// CRC32 for PNG
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ 0xEDB88320;
      } else {
        crc = crc >>> 1;
      }
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Draw a simple printer icon
function drawPrinterIcon(size) {
  const pixels = new Uint8Array(size * size * 4);
  
  const orange = [255, 140, 0, 255];   // Brand orange
  const dark = [30, 30, 50, 255];      // Dark body
  const white = [255, 255, 255, 255];
  const paper = [240, 240, 235, 255];
  const transparent = [0, 0, 0, 0];
  
  // Fill transparent
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 0; pixels[i+1] = 0; pixels[i+2] = 0; pixels[i+3] = 0;
  }
  
  function setPixel(x, y, color) {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const idx = (y * size + x) * 4;
    pixels[idx] = color[0];
    pixels[idx + 1] = color[1];
    pixels[idx + 2] = color[2];
    pixels[idx + 3] = color[3];
  }
  
  function fillRect(x1, y1, x2, y2, color) {
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        setPixel(x, y, color);
      }
    }
  }
  
  function fillRoundedRect(x1, y1, x2, y2, radius, color) {
    fillRect(x1 + radius, y1, x2 - radius, y2, color);
    fillRect(x1, y1 + radius, x2, y2 - radius, color);
    // Corners (simple circle approximation)
    for (let dy = 0; dy <= radius; dy++) {
      for (let dx = 0; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radius * radius) {
          setPixel(x1 + radius - dx, y1 + radius - dy, color);
          setPixel(x2 - radius + dx, y1 + radius - dy, color);
          setPixel(x1 + radius - dx, y2 - radius + dy, color);
          setPixel(x2 - radius + dx, y2 - radius + dy, color);
        }
      }
    }
  }
  
  function fillCircle(cx, cy, r, color) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r * r) {
          setPixel(cx + dx, cy + dy, color);
        }
      }
    }
  }
  
  // Scale factor
  const s = size / 32;
  const S = (v) => Math.round(v * s);
  
  // Background circle (orange)
  fillCircle(S(16), S(16), S(14), orange);
  
  // Printer body (dark rectangle)
  fillRoundedRect(S(6), S(11), S(26), S(22), S(2), dark);
  
  // Paper input (top - white rectangle sticking out)
  fillRect(S(9), S(6), S(23), S(13), paper);
  
  // Paper output (bottom - white rectangle sticking out)
  fillRect(S(9), S(19), S(23), S(27), white);
  
  // Lines on output paper
  fillRect(S(11), S(21), S(21), S(21), dark);
  fillRect(S(11), S(23), S(19), S(23), dark);
  fillRect(S(11), S(25), S(17), S(25), dark);
  
  // Printer status light (small green dot)
  fillCircle(S(23), S(15), S(1), [0, 220, 0, 255]);
  
  return pixels;
}

// Generate icons
const size = 256;
const pixels = drawPrinterIcon(size);
const pngBuffer = createPNG(size, size, pixels);

const assetsDir = path.join(__dirname, 'assets');
fs.writeFileSync(path.join(assetsDir, 'icon.png'), pngBuffer);
console.log(`Created icon.png (${size}x${size})`);

// Also create a 16x16 version for tray
const size16 = 16;
const pixels16 = drawPrinterIcon(size16);
const png16 = createPNG(size16, size16, pixels16);
fs.writeFileSync(path.join(assetsDir, 'tray-icon.png'), png16);
console.log(`Created tray-icon.png (${size16}x${size16})`);

// Create a 32x32 version too
const size32 = 32;
const pixels32 = drawPrinterIcon(size32);
const png32 = createPNG(size32, size32, pixels32);
fs.writeFileSync(path.join(assetsDir, 'icon-32.png'), png32);
console.log(`Created icon-32.png (${size32}x${size32})`);

console.log('\nNote: For a proper .ico file, use an online converter or');
console.log('install png-to-ico: npm install -g png-to-ico');
console.log('Then run: png-to-ico assets/icon.png > assets/icon.ico');
