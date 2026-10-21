/**
 * Launch smoke test for the packaged Windows application.
 *
 * Why this exists: version 1.0.0 shipped an installer that could not open. The
 * application name contained a `?`, which is illegal in a Windows path, so
 * Chromium aborted during startup and the process exited with code -36861
 * before any window appeared. Nothing caught it, because the end-to-end suite
 * only exercised the Vite browser build and never launched the packaged app.
 *
 * This script launches the real packaged executable, waits for the main process
 * to report that the renderer finished loading (via WHATIFS_SMOKE_MARKER), and
 * fails the build if that never happens. It also verifies the process is still
 * alive afterwards, which catches the "started then immediately died" failure
 * mode.
 *
 * Usage: node scripts/launch-smoke.cjs <path-to-exe> [timeoutMs]
 */
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const exePath = process.argv[2];
const timeoutMs = Number(process.argv[3] ?? 90_000);

if (!exePath) {
  console.error('usage: node scripts/launch-smoke.cjs <path-to-exe> [timeoutMs]');
  process.exit(2);
}

if (!fs.existsSync(exePath)) {
  console.error(`launch-smoke: executable not found: ${exePath}`);
  process.exit(2);
}

const markerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatifs-smoke-'));
const markerPath = path.join(markerDir, 'ready.json');

/** Kill the whole process tree — Electron spawns renderer and GPU children. */
function killTree(pid) {
  try {
    execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

(async () => {
  console.log(`launch-smoke: starting ${exePath}`);
  const isScript = /\.(cmd|bat)$/i.test(exePath);
  let child;
  try {
    child = spawn(exePath, isScript ? [] : [], {
      env: { ...process.env, WHATIFS_SMOKE_MARKER: markerPath },
      stdio: 'ignore',
      detached: false,
      // .cmd/.bat are not executable on their own; the shell has to start them.
      shell: isScript,
    });
  } catch (err) {
    console.error(`launch-smoke: FAILED — could not start ${exePath}: ${err.message}`);
    process.exit(2);
  }

  const started = Date.now();
  let result = null;
  let lastError = '';
  let spawnError = null;
  // Spawn failures are emitted asynchronously, not thrown.
  child.on('error', (err) => {
    spawnError = err;
  });

  while (Date.now() - started < timeoutMs) {
    if (spawnError) {
      lastError = `could not start the process: ${spawnError.message}`;
      break;
    }
    if (child.exitCode !== null) {
      lastError = `process exited early with code ${child.exitCode}`;
      break;
    }
    if (fs.existsSync(markerPath)) {
      try {
        result = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
        break;
      } catch (err) {
        lastError = `readiness marker unreadable: ${err.message}`;
        break;
      }
    }
    await sleep(400);
  }

  if (!result) {
    const alive = isAlive(child.pid);
    killTree(child.pid);
    console.error('launch-smoke: FAILED — the packaged app did not reach a usable window.');
    console.error(`  executable : ${exePath}`);
    console.error(`  waited     : ${Math.round((Date.now() - started) / 1000)}s`);
    console.error(`  still alive: ${alive}`);
    if (lastError) console.error(`  detail     : ${lastError}`);
    console.error(
      '  hint       : a non-zero exit before the marker is written usually means the app\n' +
        '               aborted during startup (illegal path characters in the app name,\n' +
        '               a missing resource, or a packaging error).'
    );
    process.exit(1);
  }

  // The marker is written on `did-finish-load`; the window must still be alive.
  await sleep(1500);
  const alive = isAlive(child.pid);
  killTree(child.pid);

  if (!alive) {
    console.error('launch-smoke: FAILED — the app reported ready but then exited.');
    process.exit(1);
  }

  console.log('launch-smoke: PASSED');
  console.log(`  version : ${result.version}`);
  console.log(`  title   : ${result.title}`);
  console.log(`  startup : ${Math.round((Date.now() - started) / 1000)}s`);
  process.exit(0);
})();
