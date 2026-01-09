// Run with: bun scripts/generate-icons.ts
// Generates PWA icons as PNG files

import sharp from "sharp";
import { mkdirSync, existsSync } from "fs";
import { join } from "path";

const iconsDir = join(process.cwd(), "public/icons");
const splashDir = join(process.cwd(), "public/splash");

// Ensure directories exist
if (!existsSync(iconsDir)) mkdirSync(iconsDir, { recursive: true });
if (!existsSync(splashDir)) mkdirSync(splashDir, { recursive: true });

const generateSvg = (size: number, rounded = true) => {
  const radius = rounded ? Math.floor(size * 0.2) : 0;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#000000" rx="${radius}"/>
  <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-family="system-ui, -apple-system, sans-serif" font-weight="600" font-size="${Math.floor(size * 0.52)}">$</text>
</svg>`);
};

const generateSplashSvg = (width: number, height: number) => {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  <text x="50%" y="48%" dominant-baseline="middle" text-anchor="middle" fill="#000000" font-family="system-ui, -apple-system, sans-serif" font-weight="600" font-size="${Math.floor(Math.min(width, height) * 0.15)}">$</text>
  <text x="50%" y="56%" dominant-baseline="middle" text-anchor="middle" fill="#666666" font-family="system-ui, -apple-system, sans-serif" font-weight="400" font-size="${Math.floor(Math.min(width, height) * 0.04)}">spendalert</text>
</svg>`);
};

const iconSizes = [
  { name: "icon-152.png", size: 152 },
  { name: "icon-167.png", size: 167 },
  { name: "icon-180.png", size: 180 },
  { name: "icon-192.png", size: 192 },
  { name: "icon-512.png", size: 512 },
  { name: "apple-touch-icon.png", size: 180 },
];

const splashSizes = [
  { name: "splash-1290x2796.png", width: 1290, height: 2796 },
  { name: "splash-1179x2556.png", width: 1179, height: 2556 },
  { name: "splash-1284x2778.png", width: 1284, height: 2778 },
  { name: "splash-1170x2532.png", width: 1170, height: 2532 },
  { name: "splash-1125x2436.png", width: 1125, height: 2436 },
  { name: "splash-1242x2688.png", width: 1242, height: 2688 },
  { name: "splash-828x1792.png", width: 828, height: 1792 },
  { name: "splash-1242x2208.png", width: 1242, height: 2208 },
  { name: "splash-750x1334.png", width: 750, height: 1334 },
  { name: "splash-640x1136.png", width: 640, height: 1136 },
];

async function main() {
  console.log("Generating icons...\n");

  // Generate icons
  for (const { name, size } of iconSizes) {
    const svg = generateSvg(size);
    await sharp(svg).png().toFile(join(iconsDir, name));
    console.log(`  ${name} (${size}x${size})`);
  }

  console.log("\nGenerating splash screens...\n");

  // Generate splash screens
  for (const { name, width, height } of splashSizes) {
    const svg = generateSplashSvg(width, height);
    await sharp(svg).png().toFile(join(splashDir, name));
    console.log(`  ${name} (${width}x${height})`);
  }

  console.log("\nDone!");
}

main().catch(console.error);
