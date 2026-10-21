/**
 * Accessibility guards.
 *
 * These are static checks — they read the source rather than run the app —
 * but they pin the things that are easy to break by accident and expensive
 * to notice: a canvas that stops describing itself, a heading level that
 * skips, a colour that quietly drops below the contrast threshold.
 *
 * They are not a substitute for testing with a screen reader. They are the
 * floor, not the ceiling.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const UI_DIR = join(ROOT, 'src', 'ui');

/* ------------------------------------------------------------------ */
/* reading the source                                                  */
/* ------------------------------------------------------------------ */

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.tsx') || full.endsWith('.ts')) out.push(full);
  }
  return out;
}

const UI_FILES = walk(UI_DIR).filter((f) => f.endsWith('.tsx'));

function sourceOf(file: string): string {
  return readFileSync(file, 'utf8');
}

function rel(file: string): string {
  return relative(ROOT, file).replace(/\\/g, '/');
}

/* ------------------------------------------------------------------ */
/* contrast                                                            */
/* ------------------------------------------------------------------ */

function channels(hex: string): [number, number, number] {
  const h = hex.replace('#', '').trim();
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

/** The WCAG 2.1 contrast ratio between two colours, from 1 to 21. */
function contrast(a: string, b: string): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

const THEME = readFileSync(join(UI_DIR, 'theme.css'), 'utf8');

function themeVar(name: string): string {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`).exec(THEME);
  if (!m) throw new Error(`theme.css does not define --${name}`);
  return m[1]!;
}

/* ------------------------------------------------------------------ */
/* tests                                                               */
/* ------------------------------------------------------------------ */

describe('Accessibility — colour', () => {
  const backgrounds = ['void', 'deep', 'panel', 'raised', 'hover'].map((n) => themeVar(`bg-${n}`));

  it('keeps every text colour readable on every surface it sits on', () => {
    // WCAG 2.1 AA for body text is 4.5:1.
    const texts = ['text', 'text-dim', 'text-faint', 'cyan', 'violet', 'amber', 'green', 'rose'];
    const failures: string[] = [];
    for (const name of texts) {
      const fg = themeVar(name);
      for (const bg of backgrounds) {
        const ratio = contrast(fg, bg);
        if (ratio < 4.5) failures.push(`--${name} on ${bg} is ${ratio.toFixed(2)}:1`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('keeps the three levels of text distinguishable', () => {
    // A "faint" label that matches the body text defeats the purpose of
    // having three levels at all.
    const plain = themeVar('text');
    const dim = themeVar('text-dim');
    const faint = themeVar('text-faint');
    expect(contrast(plain, dim)).toBeGreaterThan(1.2);
    expect(contrast(dim, faint)).toBeGreaterThan(1.1);
  });

  it('gives the controls it needs to be found an outline you can see', () => {
    // WCAG 2.1 AA, 1.4.11: 3:1 for the boundary of a user interface
    // component. For an empty text field, or a switch that is switched off,
    // that boundary is the only thing that says the control is there.
    const control = themeVar('line-control');
    for (const bg of ['void', 'deep', 'panel', 'raised'].map((n) => themeVar(`bg-${n}`))) {
      expect(contrast(control, bg)).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('Accessibility — markup', () => {
  it('describes every canvas', () => {
    const offenders: string[] = [];
    for (const file of UI_FILES) {
      const src = sourceOf(file);
      const re = /<canvas\b([^>]*)>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        if (!/aria-label=/.test(m[1] ?? '')) offenders.push(`${rel(file)}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('gives every image an alt attribute', () => {
    const offenders: string[] = [];
    for (const file of UI_FILES) {
      const src = sourceOf(file);
      const re = /<img\b([^>]*)>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        if (!/\balt=/.test(m[1] ?? '')) offenders.push(`${rel(file)}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never uses a positive tabindex', () => {
    const offenders: string[] = [];
    for (const file of UI_FILES) {
      const src = sourceOf(file);
      const re = /tab[Ii]ndex=\{?(\d+)\}?/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        if (Number(m[1]) > 0) offenders.push(`${rel(file)}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('marks a dialog as modal when it is one', () => {
    // A dialog that says it is a dialog but not that it is modal leaves a
    // screen reader free to read the page behind it.
    const offenders: string[] = [];
    for (const file of UI_FILES) {
      const src = sourceOf(file);
      const re = /<div\b[^>]*role="dialog"[^>]*>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        if (!/aria-modal="true"/.test(m[0])) offenders.push(`${rel(file)}: ${m[0].slice(0, 90)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('has exactly one top-level heading', () => {
    const offenders: string[] = [];
    let total = 0;
    for (const file of UI_FILES) {
      const src = sourceOf(file);
      const count = (src.match(/<h1\b/g) ?? []).length;
      total += count;
      if (count > 0 && !rel(file).endsWith('App.tsx')) {
        offenders.push(`${rel(file)} has ${count} h1`);
      }
    }
    expect(total).toBe(1);
    expect(offenders).toEqual([]);
  });

  it('does not skip a heading level', () => {
    // Each file's headings are read on their own: a panel that starts at h3
    // with nothing above it is a level nobody can reach.
    const offenders: string[] = [];
    for (const file of UI_FILES) {
      const src = sourceOf(file);
      const levels = [...src.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
      let last = 0;
      for (const level of levels) {
        if (last !== 0 && level > last + 1) {
          offenders.push(`${rel(file)}: h${last} -> h${level}`);
        }
        last = level;
      }
    }
    expect(offenders).toEqual([]);
  });

  it('labels the table that lists the differences', () => {
    const src = sourceOf(join(UI_DIR, 'components', 'BranchDiffView.tsx'));
    expect(src).toMatch(/<table[^>]*className="dossier-table"/);
    expect(src).toMatch(/<caption/);
  });
});

describe('Accessibility — focus', () => {
  it('gives a visible focus ring to anything a keyboard can reach', () => {
    expect(THEME).toMatch(/focus-visible/);
    // The rule must not be written so weakly that a component's own rule
    // can never be seen.
    expect(THEME).toMatch(/:where\([^)]*\):focus-visible/);
  });

  it('never takes the focus ring away without putting something else there', () => {
    const rules = THEME.split('}');
    for (const rule of rules) {
      if (!/outline:\s*none/.test(rule)) continue;
      // A rule that removes the outline has to replace it with something.
      expect(rule).toMatch(/box-shadow|border-color|border:/);
    }
  });
});
