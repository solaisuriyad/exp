/**
 * Generates the Android launcher icons from public/icon.svg.
 *
 *   npm run assets:generate
 *
 * Writes legacy `ic_launcher.png` at every density bucket plus the two 108 dp
 * adaptive-icon layers (foreground / monochrome) that `mipmap-anydpi-v26`
 * references. Rerun this whenever the logo changes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svgPath = path.join(root, 'public', 'icon.svg');
const resDir = path.join(root, 'android', 'app', 'src', 'main', 'res');

if (!fs.existsSync(svgPath)) {
  console.error(`Source SVG not found at ${svgPath}`);
  process.exit(1);
}
const svg = fs.readFileSync(svgPath);

/** Legacy launcher icon sizes (square, full-bleed). */
const DENSITIES = [
  ['mipmap-mdpi', 48],
  ['mipmap-hdpi', 72],
  ['mipmap-xhdpi', 96],
  ['mipmap-xxhdpi', 144],
  ['mipmap-xxxhdpi', 192],
];

/**
 * Adaptive icon layers are 108 dp, of which only the inner 72 dp is guaranteed
 * visible (the launcher masks the rest), so the artwork is rendered at 432 px
 * and the logo occupies the safe zone.
 */
const ADAPTIVE_PX = 432;

/**
 * Re-centre and shrink the artwork so it fits the adaptive-icon safe zone.
 * Wrapping in an outer <svg> with a translate+scale avoids editing the source.
 */
const adaptiveLayer = (inner, extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${ADAPTIVE_PX}" height="${ADAPTIVE_PX}" viewBox="0 0 ${ADAPTIVE_PX} ${ADAPTIVE_PX}">
    <g transform="translate(${ADAPTIVE_PX / 2} ${ADAPTIVE_PX / 2}) scale(0.62) translate(-256 -256)">
      ${inner}
    </g>
    ${extra}
  </svg>`;

/** The ship mark lifted out of the source SVG, reused for both layers. */
const SHIP_MARK = `
  <g transform="translate(256 252)">
    <path d="M0 -132 L46 62 L0 34 L-46 62 Z" fill="#d8f4ff" />
    <path d="M-46 62 L-118 106 L-52 100 Z" fill="#7fa8d8" />
    <path d="M46 62 L118 106 L52 100 Z" fill="#7fa8d8" />
    <circle cx="0" cy="-30" r="17" fill="#64f5ff" />
    <path d="M-22 70 L0 150 L22 70 Z" fill="#9dff6a" opacity="0.92" />
  </g>`;

const BACKGROUND = `<svg xmlns="http://www.w3.org/2000/svg" width="${ADAPTIVE_PX}" height="${ADAPTIVE_PX}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="35%" r="75%">
      <stop offset="0%" stop-color="#1b2a63" />
      <stop offset="60%" stop-color="#0a0a24" />
      <stop offset="100%" stop-color="#04030f" />
    </radialGradient>
  </defs>
  <rect width="${ADAPTIVE_PX}" height="${ADAPTIVE_PX}" fill="url(#bg)" />
</svg>`;

const main = async () => {
  let written = 0;

  for (const [dir, size] of DENSITIES) {
    const out = path.join(resDir, dir);
    fs.mkdirSync(out, { recursive: true });
    await sharp(svg, { density: 384 })
      .resize(size, size)
      .png()
      .toFile(path.join(out, 'ic_launcher.png'));
    // Round variant: same art, circular alpha mask.
    const circle = Buffer.from(
      `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`,
    );
    await sharp(svg, { density: 384 })
      .resize(size, size)
      .composite([{ input: circle, blend: 'dest-in' }])
      .png()
      .toFile(path.join(out, 'ic_launcher_round.png'));
    written += 2;
  }

  // Adaptive icon layers.
  const foreground = adaptiveLayer(SHIP_MARK);
  const monochrome = adaptiveLayer(
    SHIP_MARK.replaceAll('#d8f4ff', '#ffffff')
      .replaceAll('#7fa8d8', '#ffffff')
      .replaceAll('#64f5ff', '#ffffff')
      .replaceAll('#9dff6a', '#ffffff'),
  );

  for (const [dir, size] of DENSITIES) {
    const out = path.join(resDir, dir);
    const scale = size / 108;
    const px = Math.round(ADAPTIVE_PX * scale);
    await sharp(Buffer.from(foreground), { density: 384 })
      .resize(px, px)
      .png()
      .toFile(path.join(out, 'ic_launcher_foreground.png'));
    await sharp(Buffer.from(monochrome), { density: 384 })
      .resize(px, px)
      .png()
      .toFile(path.join(out, 'ic_launcher_monochrome.png'));
    written += 2;
  }

  // Play Store listing image.
  const storeDir = path.join(root, 'mobile', 'assets');
  fs.mkdirSync(storeDir, { recursive: true });
  await sharp(svg, { density: 384 }).resize(512, 512).png().toFile(path.join(storeDir, 'icon-512.png'));
  await sharp(Buffer.from(BACKGROUND), { density: 384 })
    .composite([{ input: Buffer.from(foreground), density: 384 }])
    .png()
    .toFile(path.join(storeDir, 'play-store-icon.png'));
  written += 2;

  // Monochrome layer for themed icons.
  await sharp(Buffer.from(monochrome), { density: 384 })
    .resize(ADAPTIVE_PX, ADAPTIVE_PX)
    .png()
    .toFile(path.join(storeDir, 'adaptive-monochrome.png'));

  // Capacitor splash screen (portrait 1280x960 is the plugin's default slot).
  const splash = await sharp(Buffer.from(BACKGROUND), { density: 384 })
    .resize(1280, 960, { fit: 'cover' })
    .composite([
      {
        input: await sharp(Buffer.from(foreground), { density: 384 })
          .resize(520, 520)
          .png()
          .toBuffer(),
        gravity: 'centre',
      },
    ])
    .png()
    .toBuffer();
  for (const [dir, w] of [
    ['drawable-land-mdpi', 480],
    ['drawable-land-hdpi', 800],
    ['drawable-land-xhdpi', 1280],
    ['drawable-land-xxhdpi', 1920],
    ['drawable-port-mdpi', 480],
    ['drawable-port-hdpi', 800],
    ['drawable-port-xhdpi', 1280],
    ['drawable-port-xxhdpi', 1920],
  ]) {
    const out = path.join(resDir, dir);
    fs.mkdirSync(out, { recursive: true });
    await sharp(splash).resize({ width: w }).png().toFile(path.join(out, 'splash.png'));
    written += 1;
  }
  written += 1;

  console.log(`Generated ${written} icon assets from public/icon.svg`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
