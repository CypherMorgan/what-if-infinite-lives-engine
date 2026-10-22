/**
 * Captures README screenshots from the running dev server.
 *
 * Usage: npm run screenshots
 *
 * Playwright drives the app, seeds localStorage so the onboarding tour does
 * not cover the UI, and writes PNGs into docs/screenshots/. The dev server is
 * started automatically (or reused if one is already on the port).
 */
import { chromium, type Page } from '@playwright/test';
import { mkdirSync, existsSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

const OUT_DIR = path.join(process.cwd(), 'docs', 'screenshots');
const PORT = 5199;
const BASE = `http://localhost:${PORT}`;
const VIEWPORT = { width: 1440, height: 900 };

async function waitForServer(url: string, timeoutMs = 120_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Dev server did not start at ${url} within ${timeoutMs}ms`);
}

/** Blocking sleeps are fine here — this is a one-shot capture script. */
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ready(page: Page): Promise<void> {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  // Dismiss the onboarding tour and the toast stack so nothing covers the UI.
  await page.evaluate(() => {
    try {
      localStorage.setItem('whatifs:tour:v1', '1');
      localStorage.setItem('whatifs:key-open:v1', '0');
    } catch {
      // ignore
    }
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.canvas-host canvas', { timeout: 30_000 });
  await page.waitForSelector('.brand-mark', { timeout: 30_000 });
  await pause(1200); // let the graph growth animation settle
}

async function shoot(page: Page, name: string): Promise<void> {
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`captured ${path.relative(process.cwd(), file)}`);
}

async function main(): Promise<void> {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  let server: ChildProcess | null = null;
  try {
    // Reuse an existing server if one is already listening.
    let alreadyUp = false;
    try {
      const res = await fetch(BASE);
      alreadyUp = res.ok;
    } catch {
      alreadyUp = false;
    }

    if (!alreadyUp) {
      console.log('starting dev server...');
      server = spawn('npm', ['run', 'dev'], {
        stdio: 'ignore',
        shell: true,
        detached: false,
      });
      await waitForServer(BASE);
    }

    const browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2, // crisp 2x screenshots
      colorScheme: 'dark',
    });
    const page = await context.newPage();

    // 1. Full application shell with the default universe.
    await ready(page);
    await shoot(page, '01-overview');

    // 2. Select a node so the inspector shows detail, then capture.
    const nodeCards = page.locator('.canvas-host canvas');
    await nodeCards.click({ position: { x: 260, y: 450 }, force: true });
    await pause(900);
    await shoot(page, '02-inspector');

    // 3. Keyboard-shortcuts reference (a real modal, not a mock).
    await page.keyboard.press('Control+/');
    await pause(600);
    await shoot(page, '03-shortcuts');
    await page.keyboard.press('Escape');
    await pause(400);

    // 4. Timeline view.
    await page.getByRole('button', { name: 'Timeline' }).click();
    await pause(900);
    await shoot(page, '04-timeline');

    // 5. Two paths compared side by side.
    await page.getByRole('button', { name: 'Graph' }).first().click();
    await pause(700);
    await page
      .getByRole('button', { name: /Compare/ })
      .first()
      .click();
    await pause(700);
    await page
      .getByRole('button', { name: /Compare/ })
      .last()
      .click();
    await pause(1400);
    await shoot(page, '05-compare');

    // 6. The dossier: the plain-language brief on the selected step.
    await page.getByRole('button', { name: 'Graph' }).first().click();
    await pause(700);
    await page.locator('.canvas-host canvas').click({ position: { x: 260, y: 450 }, force: true });
    await pause(800);
    await page
      .getByRole('button', { name: /Dossier/ })
      .first()
      .click();
    await pause(1400);
    await shoot(page, '06-dossier');

    await browser.close();
    console.log('done.');
  } finally {
    if (server && !server.killed) {
      // spawn with shell:true → kill the tree on Windows.
      if (process.platform === 'win32' && server.pid) {
        spawn('taskkill', ['/pid', String(server.pid), '/f', '/t']);
      } else {
        server.kill();
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
