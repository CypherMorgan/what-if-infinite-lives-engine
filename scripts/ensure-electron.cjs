#!/usr/bin/env node
/**
 * npm 11+ gates lifecycle scripts behind an explicit allow-list, which silently skips
 * Electron's postinstall and leaves the runtime binary missing. The app then cannot start
 * and cannot be packaged, with a confusing error.
 *
 * This script is wired into `postinstall` so a fresh clone always ends up with a working
 * Electron runtime, and reports clearly when the download could not happen (for example on
 * an offline machine) instead of failing later at launch time.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const electronDir = path.join(__dirname, '..', 'node_modules', 'electron');
const pathTxt = path.join(electronDir, 'path.txt');

function binaryPresent() {
  if (!fs.existsSync(pathTxt)) return false;
  try {
    const rel = fs.readFileSync(pathTxt, 'utf8').trim();
    if (!rel) return false;
    return fs.existsSync(path.join(electronDir, 'dist', rel));
  } catch {
    return false;
  }
}

if (!fs.existsSync(electronDir)) {
  console.log('[ensure-electron] electron is not installed; nothing to do.');
  process.exit(0);
}

if (binaryPresent()) {
  console.log('[ensure-electron] Electron runtime present.');
  process.exit(0);
}

console.log('[ensure-electron] Electron runtime missing (lifecycle scripts were blocked).');
console.log('[ensure-electron] Downloading Electron via its own installer...');

const res = spawnSync(process.execPath, ['install.js'], {
  cwd: electronDir,
  stdio: 'inherit',
});

if (res.status !== 0 || !binaryPresent()) {
  console.error('');
  console.error('[ensure-electron] Could not install the Electron runtime automatically.');
  console.error('[ensure-electron] Fix one of these and re-run `npm install`:');
  console.error('[ensure-electron]   - Internet access to https://github.com (Electron binaries host)');
  console.error('[ensure-electron]   - Or run manually:  cd node_modules/electron && node install.js');
  if (process.env.WHATIF_STRICT_POSTINSTALL === '1') process.exit(1);
  process.exit(0);
}

console.log('[ensure-electron] Electron runtime installed.');
