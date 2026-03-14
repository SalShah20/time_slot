import sharp from 'sharp';
import { mkdirSync } from 'fs';

const sizes = [72, 96, 128, 144, 152, 180, 192, 384, 512];
const svgPath = 'public/icon.svg';

mkdirSync('public/icons', { recursive: true });

for (const size of sizes) {
  await sharp(svgPath)
    .resize(size, size)
    .png()
    .toFile(`public/icons/icon-${size}.png`);
  console.log(`Generated icon-${size}.png`);
}

// Apple touch icon in public root
await sharp(svgPath).resize(180, 180).png().toFile('public/apple-touch-icon.png');
console.log('Generated apple-touch-icon.png');
