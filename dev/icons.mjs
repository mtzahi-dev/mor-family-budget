// Renders the app icons into public/ (node dev/icons.mjs). Run again only to change the design.
// A gold shekel coin over the name "Mor", on the app's navy.
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../public/', import.meta.url));
const FONTS = 'https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@700;900&display=block';

// scale < 1 keeps everything inside the safe circle of a maskable icon
function art(size, { round = false, scale = 1 } = {}) {
  const s = 512, r = round ? 112 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${s} ${s}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1D3E5E"/><stop offset="1" stop-color="#122A41"/></linearGradient>
      <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F6C25E"/><stop offset="1" stop-color="#D98E1F"/></linearGradient>
    </defs>
    <rect width="${s}" height="${s}" rx="${r}" fill="url(#bg)"/>
    <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
      <circle cx="256" cy="196" r="118" fill="url(#gold)"/>
      <circle cx="256" cy="196" r="96" fill="none" stroke="#16314B" stroke-opacity=".28" stroke-width="7"/>
      <text x="256" y="196" dy=".35em" text-anchor="middle" font-family="'Frank Ruhl Libre', serif" font-weight="900" font-size="150" fill="#16314B">₪</text>
      <text x="256" y="436" text-anchor="middle" font-family="'Frank Ruhl Libre', serif" font-weight="700" font-size="112" letter-spacing="2" fill="#F2F5F3">Mor</text>
    </g>
  </svg>`;
}

// Android's notification badge: a white silhouette on transparent
function badge(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 96 96">
    <defs><mask id="cut"><rect width="96" height="96" fill="#fff"/>
      <text x="48" y="48" dy=".35em" text-anchor="middle" font-family="'Frank Ruhl Libre', serif" font-weight="900" font-size="56" fill="#000">₪</text></mask></defs>
    <circle cx="48" cy="48" r="44" fill="#FFFFFF" mask="url(#cut)"/>
  </svg>`;
}

const ICONS = [
  ['icon-192.png', 192, art(192, { round: true })],
  ['icon-512.png', 512, art(512, { round: true })],
  ['icon-maskable-512.png', 512, art(512, { scale: 0.78 })],
  ['apple-touch-icon.png', 180, art(180)],
  ['badge-96.png', 96, badge(96)]
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, svg] of ICONS) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><head><link rel="stylesheet" href="${FONTS}"></head><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.evaluate(() => Promise.all([
    document.fonts.load('900 100px "Frank Ruhl Libre"', '₪'), document.fonts.load('700 100px "Frank Ruhl Libre"', 'Mor')
  ]));
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + name, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('wrote', name);
}
await browser.close();
