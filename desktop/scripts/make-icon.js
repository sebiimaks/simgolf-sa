// Draws the app icon (resources/icon.png, 1024 px) from the SVG below, in the
// setup page's colours: a golf ball on a tee on the violet dimpled ground.
// electron-builder turns it into .icns / .ico. Run: npx electron scripts/make-icon.js

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const dimples = [];
for (let y = 0; y < 9; y++) {
  for (let x = 0; x < 9; x++) dimples.push(`<circle cx="${112 + x * 100 + (y % 2) * 50}" cy="${112 + y * 100}" r="17"/>`);
}
const ballDimples = [[-70, -60], [-10, -95], [55, -70], [-95, 5], [-30, -25], [40, -10], [90, 15], [-60, 60], [5, 40], [65, 70], [-5, 105]]
  .map(([x, y]) => `<circle cx="${512 + x}" cy="${430 + y}" r="19"/>`).join('');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a3fe0"/><stop offset="1" stop-color="#241078"/></linearGradient>
    <radialGradient id="ball" cx="0.38" cy="0.32" r="0.75"><stop offset="0" stop-color="#ffffff"/><stop offset="0.7" stop-color="#eeeaff"/><stop offset="1" stop-color="#b9b2ee"/></radialGradient>
    <linearGradient id="grass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2dbb4f"/><stop offset="1" stop-color="#0d5c22"/></linearGradient>
    <clipPath id="tile"><rect x="100" y="100" width="824" height="824" rx="185"/></clipPath>
  </defs>
  <g clip-path="url(#tile)">
    <rect x="100" y="100" width="824" height="824" fill="url(#bg)"/>
    <g fill="#ffffff" opacity="0.10">${dimples.join('')}</g>
    <ellipse cx="512" cy="1010" rx="560" ry="270" fill="url(#grass)"/>
    <ellipse cx="512" cy="752" rx="120" ry="22" fill="#000" opacity="0.25"/>
    <path d="M452 610 h120 l-34 44 v96 h-52 v-96 z" fill="#b4642c" stroke="#5a2810" stroke-width="12" stroke-linejoin="round"/>
    <circle cx="512" cy="430" r="190" fill="url(#ball)" stroke="#241078" stroke-width="14"/>
    <g fill="#c3c0ef">${ballDimples}</g>
  </g>
</svg>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
    `<html><body style="margin:0;background:transparent">${svg}</body></html>`));
  await new Promise((r) => setTimeout(r, 300));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  const out = path.join(__dirname, '../resources/icon.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, img.resize({ width: 1024, height: 1024 }).toPNG());
  console.log(`wrote ${out}`);
  app.quit();
});
