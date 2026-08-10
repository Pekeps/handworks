// Headless screenshot harness for visual verification of poses.
// Usage: node scripts/snap.mjs [pose ...]   (default: a representative set)
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = process.env.SNAP_BASE ?? 'http://localhost:5173';
const OUT = new URL('../.snaps/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');

const poses = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      '', 'basic.open', 'basic.fist', 'basic.point', 'basic.thumbsUp', 'basic.peace', 'basic.ok',
      'asl.A', 'asl.B', 'asl.C', 'asl.D', 'asl.E', 'asl.F', 'asl.G', 'asl.I', 'asl.L',
      'asl.O', 'asl.R', 'asl.S', 'asl.V', 'asl.W', 'asl.X', 'asl.Y',
      'shadow.dog', 'shadow.dogBark', 'shadow.rabbit', 'shadow.swan', 'shadow.snail',
    ];

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--use-angle=default', '--window-size=900,900'],
  defaultViewport: { width: 900, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.error('CONSOLE:', m.text());
});

let first = true;
for (const pose of poses) {
  const url = `${BASE}/playground.html${pose ? `#${pose}` : ''}`;
  if (first) {
    await page.goto(url, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__handworksReady === true', { timeout: 15000 });
    first = false;
  } else {
    await page.evaluate((h) => {
      location.hash = h;
    }, pose);
  }
  await new Promise((r) => setTimeout(r, 700));
  const name = (pose || 'neutral').replace(/\./g, '_');
  await page.screenshot({ path: `${OUT}${name}.png` });
  console.log('snapped', name);
  // extra views when SNAP_VIEWS=1: palm-side and thumb-side profile
  if (process.env.SNAP_VIEWS) {
    const views = {
      back: [0, 0.05, -0.55],
      side: [-0.55, 0.05, 0.05],
    };
    for (const [label, [x, y, z]] of Object.entries(views)) {
      await page.evaluate((px, py, pz) => {
        const stage = window.__stage;
        stage.camera.position.set(px, py, pz);
        stage.controls?.target.set(0, 0.05, 0);
      }, x, y, z);
      await new Promise((r) => setTimeout(r, 150));
      await page.screenshot({ path: `${OUT}${name}_${label}.png` });
    }
    await page.evaluate(() => {
      const stage = window.__stage;
      stage.camera.position.set(0, 0.05, 0.55);
      stage.controls?.target.set(0, 0.05, 0);
    });
  }
}

// shadow theater page
await page.goto(`${BASE}/shadow.html`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: `${OUT}theater.png` });
console.log('snapped theater');

await browser.close();
