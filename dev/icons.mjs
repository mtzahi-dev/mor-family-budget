// Renders the app icons into public/ (node dev/icons.mjs). Run again only to change the design.
// A gold dollar coin over the name "Mor", on the app's indigo-violet gradient.
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../public/', import.meta.url));
const FONTS = 'https://fonts.googleapis.com/css2?family=Rubik:wght@600;700;800&display=block';

// scale < 1 keeps everything inside the safe circle of a maskable icon
function art(size, { round = false, scale = 1 } = {}) {
  const s = 512, r = round ? 116 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${s} ${s}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5B50F0"/><stop offset=".55" stop-color="#6D3BEF"/><stop offset="1" stop-color="#8B3FE6"/></linearGradient>
      <radialGradient id="glow" cx=".2" cy=".05" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
      <linearGradient id="face" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFE38A"/><stop offset=".55" stop-color="#FBBF24"/><stop offset="1" stop-color="#F59E0B"/></linearGradient>
      <linearGradient id="inner" x1="1" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#FFE9A6"/><stop offset="1" stop-color="#F7B227"/></linearGradient>
      <filter id="shadow" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="14" stdDeviation="14" flood-color="#2A0F6B" flood-opacity=".45"/></filter>
    </defs>
    <rect width="${s}" height="${s}" rx="${r}" fill="url(#bg)"/>
    <rect width="${s}" height="${s}" rx="${r}" fill="url(#glow)"/>
    <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
      <g filter="url(#shadow)">
        <circle cx="256" cy="206" r="122" fill="#D97706"/>
        <circle cx="256" cy="194" r="122" fill="url(#face)"/>
      </g>
      <circle cx="256" cy="194" r="94" fill="url(#inner)"/>
      <circle cx="256" cy="194" r="94" fill="none" stroke="#B45309" stroke-opacity=".35" stroke-width="5"/>
      <path d="M176 128a118 118 0 0 1 98-42" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="12" stroke-linecap="round"/>
      <text x="256" y="194" dy=".36em" text-anchor="middle" font-family="Rubik, sans-serif" font-weight="800" font-size="150" fill="#92400E">$</text>
      <text x="256" y="440" text-anchor="middle" font-family="Rubik, sans-serif" font-weight="700" font-size="104" letter-spacing="-2" fill="#FFFFFF">Mor</text>
    </g>
  </svg>`;
}

// Android's notification badge: a white silhouette on transparent
function badge(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 96 96">
    <defs><mask id="cut"><rect width="96" height="96" fill="#fff"/>
      <text x="48" y="48" dy=".36em" text-anchor="middle" font-family="Rubik, sans-serif" font-weight="800" font-size="60" fill="#000">$</text></mask></defs>
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
  await page.evaluate(() => Promise.all([document.fonts.load('800 100px Rubik', '$'), document.fonts.load('700 100px Rubik', 'Mor')]));
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + name, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('wrote', name);
}
await browser.close();
