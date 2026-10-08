// Renders the app icons into public/ (node dev/icons.mjs). Run again only to change the design.
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../public/', import.meta.url));

// The month card's income strip on navy, with a shekel sign: the same language as the app.
function art(size, { round, pad }) {
  const s = 512, r = round ? 112 : 0, inset = pad ? 52 : 0;
  const w = s - 2 * inset, x0 = inset;
  const bar = (x, width, fill) => `<rect x="${x}" y="${x0 + w * 0.6}" width="${width}" height="${w * 0.15}" rx="${w * 0.03}" fill="${fill}"/>`;
  const bx = x0 + w * 0.17, bw = w * 0.66, gap = w * 0.012;
  const segs = [[0.24, '#8FA2B5'], [0.38, '#E8A033'], [0.38, '#86D9A8']];
  let x = bx, bars = '';
  for (const [f, c] of segs) { const ww = bw * f - gap; bars += bar(x, ww, c); x += bw * f; }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${s} ${s}">
    <rect width="${s}" height="${s}" rx="${r}" fill="#16314B"/>
    <text x="${s / 2}" y="${x0 + w * 0.5}" text-anchor="middle" font-family="'Times New Roman', serif" font-size="${w * 0.42}" fill="#F2F5F3">₪</text>
    ${bars}
  </svg>`;
}

function badge(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 96 96">
    <text x="48" y="74" text-anchor="middle" font-family="'Times New Roman', serif" font-size="78" fill="#FFFFFF">₪</text>
  </svg>`;
}

const ICONS = [
  ['icon-192.png', 192, art(192, { round: true })],
  ['icon-512.png', 512, art(512, { round: true })],
  ['icon-maskable-512.png', 512, art(512, { pad: true })],
  ['apple-touch-icon.png', 180, art(180, {})],
  ['badge-96.png', 96, badge(96)]
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, svg] of ICONS) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.screenshot({ path: OUT + name, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('wrote', name);
}
await browser.close();
