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

    // 2. Select a real step so the inspector shows detail, then capture.
    await page
      .getByRole('button', { name: /Take a steady job/ })
      .first()
      .click();
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
    await page
      .getByRole('button', { name: /Take a steady job/ })
      .first()
      .click();
    await pause(800);
    await page
      .getByRole('button', { name: /Dossier/ })
      .first()
      .click();
    await pause(1400);
    await shoot(page, '06-dossier');

    // 7. Two universes compared: fork the open one, then compare the two.
    await page.getByRole('button', { name: 'Graph' }).first().click();
    await pause(700);
    await page
      .getByRole('button', { name: /Take a steady job/ })
      .first()
      .click();
    await pause(700);
    await page.getByRole('button', { name: 'What if…' }).first().click();
    await pause(600);
    // Move the assumption slider to its maximum so the fork is a real change.
    await page.locator('.modal input[type=range]').first().focus();
    await page.keyboard.press('End');
    await pause(300);
    await page.getByRole('button', { name: /Create counterfactual/ }).click();
    await pause(1600);
    await page.getByRole('button', { name: /Universes/ }).click();
    await pause(700);
    await page.getByRole('button', { name: /Compare →/ }).click();
    await pause(1600);
    await page.waitForSelector('main[aria-label="Comparing two universes"]', { timeout: 15_000 });
    const universeHeading = await page.locator('main h2').innerText();
    if (!universeHeading.includes('versus')) {
      throw new Error(`universe comparison did not render: ${universeHeading}`);
    }
    await shoot(page, '07-universes');

    // 8. Starting a new universe from a template.
    await page.getByRole('button', { name: '✦ New' }).click();
    await pause(700);
    await page.locator('.template-card', { hasText: 'The pivot' }).click();
    await pause(600);
    const activeTemplate = page.locator('.template-card.is-active .template-title');
    await activeTemplate.waitFor({ timeout: 10_000 });
    if ((await activeTemplate.innerText()) !== 'The pivot') {
      throw new Error('the template picker did not mark the chosen template');
    }
    await shoot(page, '08-templates');

    // 9. Session notes: what the person concluded, kept with the universe.
    // Close the new-universe dialog without creating another document, so the
    // note belongs to the universe the rest of the screenshots show.
    await page.getByRole('button', { name: 'Close' }).click();
    await pause(500);
    await page.getByRole('button', { name: /Notes/ }).click();
    await pause(600);
    await page
      .locator('.modal textarea.notes-textarea')
      .fill(
        'The move only works if the rent stays under 1100 a month.\n\n' +
          'I would want three months of savings in place first, and to visit for a week before committing.\n\n' +
          'Next: ask about the notice period and whether the role can start in April.'
      );
    await pause(500);
    await shoot(page, '09-notes');

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
