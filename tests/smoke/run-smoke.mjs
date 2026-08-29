/**
 * Browser smoke test: boots the production build in headless Chromium and
 * verifies the game actually runs — menu renders, a run starts, the ship
 * steers with the keyboard, the simulation steps, and no page errors fire.
 *
 * WebGL runs through SwiftShader (software GL) so this works on CI runners.
 *
 *   node tests/smoke/run-smoke.mjs
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const distDir = path.join(root, 'dist');

if (!existsSync(path.join(distDir, 'index.html'))) {
  console.error('dist/ not built — run `npm run build` first.');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let filePath = path.join(distDir, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!filePath.startsWith(distDir) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream' });
  res.end(readFileSync(filePath));
});

const PORT = 4179;
await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
console.log(`[smoke] serving dist on http://127.0.0.1:${PORT}`);

const pageErrors = [];
const consoleErrors = [];

const browser = await chromium.launch({
  headless: true,
  args: [
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--disable-gpu-sandbox',
    '--no-sandbox',
  ],
});

let failed = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed += 1;
};

try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, // phone-shaped, like the APK
    hasTouch: true,
  });
  const page = await context.newPage();
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => Boolean(window.__starfall), null, { timeout: 20000 });
  check('game object exposed after boot', true);

  // Menu visible with the launch button.
  const launchBtn = page.getByRole('button', { name: 'LAUNCH' });
  await launchBtn.waitFor({ state: 'visible', timeout: 10000 });
  check('title menu renders with LAUNCH button', true);

  // WebGL context actually created by the renderer.
  const webgl = await page.evaluate(() => {
    const c = document.getElementById('gl');
    return Boolean(c) && (c.getContext('webgl2') !== null || c.getContext('webgl') !== null);
  });
  check('WebGL context live on #gl canvas', webgl);

  // Start a run and wait for the simulation to reach the playing state.
  await launchBtn.click();
  await page.waitForFunction(
    () => window.__starfall?.game.currentState === 'playing',
    null,
    { timeout: 20000, polling: 100 },
  );
  check('run reaches the playing state', true);

  // Steer right via keyboard and confirm the ship integrates the input.
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(600);
  await page.keyboard.up('ArrowRight');
  const shipX = await page.evaluate(() => window.__starfall.game['player'].x);
  check('ship steers right on ArrowRight', shipX > 0.5, `x=${shipX.toFixed(2)}`);

  // Let the swarm run for a while; enemies should spawn and fire.
  await page.waitForTimeout(7000);
  const snapshot = await page.evaluate(() => {
    const g = window.__starfall.game;
    return {
      state: g.currentState,
      enemies: g['enemies'].active.length,
      bullets: g['bullets'].active.length,
      elapsed: g['elapsed'],
      fps: 1,
    };
  });
  check('simulation still playing after 7s', snapshot.state === 'playing', snapshot.state);
  check('enemies spawned during play', snapshot.enemies > 0, `n=${snapshot.enemies}`);
  check('wave clock advancing', snapshot.elapsed > 6, `t=${snapshot.elapsed.toFixed(1)}s`);

  // Pause and resume through the HUD.
  await page.click('.pause-btn');
  await page.waitForFunction(
    () => window.__starfall?.game.currentState === 'paused',
    null,
    { timeout: 5000 },
  );
  check('pause button pauses the run', true);
  await page.getByRole('button', { name: 'RESUME' }).click();
  await page.waitForFunction(
    () => window.__starfall?.game.currentState === 'playing',
    null,
    { timeout: 5000 },
  );
  check('resume returns to play', true);

  // HUD shows a numeric score.
  const scoreText = await page.textContent('.hud-score');
  check('HUD score is numeric', /^\d[\d,]*$/.test(scoreText ?? ''), `score="${scoreText}"`);

  const screenshotPath = path.join(root, 'tests', 'smoke', 'smoke.png');
  await page.screenshot({ path: screenshotPath });
  console.log(`[smoke] screenshot -> ${screenshotPath}`);
} catch (err) {
  failed += 1;
  console.error('FAIL  smoke flow crashed:', err);
} finally {
  await browser.close();
  server.close();
}

const realErrors = pageErrors.filter((e) => !e.includes('net::') && !e.includes('favicon'));
check('no uncaught page errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
check(
  'no console errors',
  consoleErrors.filter((e) => !e.includes('favicon') && !e.includes('ERR_INTERNET_DISCONNECTED'))
    .length === 0,
  consoleErrors.slice(0, 3).join(' | '),
);

if (failed > 0) {
  console.error(`[smoke] ${failed} check(s) FAILED`);
  process.exit(1);
}
console.log('[smoke] all checks passed');
process.exit(0);
