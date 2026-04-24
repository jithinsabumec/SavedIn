/**
 * Generates simple PNG icons for the extension using the Canvas API via node-canvas.
 * Run once: node generate-icons.js
 * Requires: npm install canvas (only needed at dev time, not bundled)
 *
 * If you'd rather drop in your own PNGs, just place them in icons/ and skip this.
 */

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const sizes = [16, 48, 128];

for (const size of sizes) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Background circle
  ctx.fillStyle = '#0A66C2';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();

  // "S" lettermark
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.round(size * 0.55)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('S', size / 2, size / 2 + size * 0.03);

  const buffer = canvas.toBuffer('image/png');
  const outPath = path.join(__dirname, 'icons', `icon${size}.png`);
  fs.writeFileSync(outPath, buffer);
  console.log(`Written: ${outPath}`);
}
