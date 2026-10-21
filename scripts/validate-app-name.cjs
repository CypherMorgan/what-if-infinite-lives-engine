/**
 * Guard against a Windows-fatal application name.
 *
 * Electron derives `app.getPath('userData')` from the application name, which
 * falls back to `productName` in package.json. If that name contains a character
 * Windows forbids in a path segment (most easily `?`, as in "What If?"), Chromium
 * aborts the process while resolving the invalid userData directory. The app then
 * dies on launch with exit code -36861 and no window, no log, and no userData
 * folder — which is exactly how v1.0.0 shipped broken.
 *
 * The main process overrides the on-disk name via `app.setName(APP_FS_NAME)`.
 * This check asserts that override target is legal, and that the styled
 * `productName` is only ever used for display.
 */
const fs = require('node:fs');
const path = require('node:path');

const ILLEGAL_CHARS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);

/** Windows forbids the C0 control range in filenames as well. */
function hasIllegalChar(value) {
  for (const ch of value) {
    if (ILLEGAL_CHARS.has(ch)) return true;
    const code = ch.codePointAt(0);
    if (code !== undefined && code <= 0x1f) return true;
  }
  return false;
}

/** Reserved DOS device names, which Windows also rejects as a path segment. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const mainSource = fs.readFileSync(path.join(root, 'electron', 'main.ts'), 'utf8');

const problems = [];

const match = mainSource.match(/const\s+APP_FS_NAME\s*=\s*'([^']*)'/);
if (!match) {
  problems.push('electron/main.ts no longer defines APP_FS_NAME; the app name is not sanitised.');
} else {
  const fsName = match[1];
  if (hasIllegalChar(fsName)) {
    problems.push(`APP_FS_NAME contains a character illegal in a Windows path: ${fsName}`);
  }
  if (RESERVED.test(fsName)) {
    problems.push(`APP_FS_NAME is a reserved Windows device name: ${fsName}`);
  }
  if (fsName.trim().length === 0) {
    problems.push('APP_FS_NAME is empty.');
  }
}

if (!/app\.setName\(APP_FS_NAME\)/.test(mainSource)) {
  problems.push('electron/main.ts does not call app.setName(APP_FS_NAME).');
}

if (!('productName' in pkg)) {
  problems.push('package.json is missing productName.');
}

if (problems.length > 0) {
  console.error('app-name check failed:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log('app-name check passed.');
console.log(`  display name : ${pkg.productName}`);
console.log(`  on-disk name : ${match[1]}`);
