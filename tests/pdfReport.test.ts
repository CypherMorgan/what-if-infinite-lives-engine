/**
 * Printable report tests.
 *
 * The PDF is a document somebody may read, print and share, so the things
 * that matter are that it is complete, that it is honest about what it is,
 * and that nothing the user typed can escape into the markup and become part
 * of the document.
 */
import { describe, expect, it } from 'vitest';
import { ALL_PACKS } from '../src/core/packs';
import { createUniverse } from '../src/core/engine';
import { withSensitivity } from '../src/core/counterfactual';
import {
  buildPathMapSvg,
  buildPdfReport,
  escapeHtml,
  pdfReportFileName,
} from '../src/core/pdfReport';
import type { ScenarioPrompt, SimulationDoc } from '../src/core/types';

const prompt: ScenarioPrompt = {
  situation: 'I have worked in support for three years and want to move into software engineering.',
  decision: 'Should I take a six-month bootcamp or keep self-studying while working?',
  goals: ['Become a developer', 'Keep income stable'],
  constraints: ['Mortgage payment'],
  horizon: 24,
  branchCount: 3,
  imagination: 0.45,
  resources: ['savings of 12000', 'income 2400/month'],
  archetypes: [],
  title: 'Bootcamp or self-study?',
};

function makeDoc(seed = 42): SimulationDoc {
  return withSensitivity(createUniverse({ packs: ALL_PACKS, seed, prompt }), ALL_PACKS);
}

/** A node a few steps along, so the report has a path to talk about. */
function aPathNode(doc: SimulationDoc): string {
  const start = Object.values(doc.nodes).find((n) => n.type === 'start');
  const others = Object.values(doc.nodes).filter((n) => n.id !== start?.id);
  return (others[0]?.id ?? start?.id ?? '') as string;
}

const NOW = new Date('2026-10-21T12:00:00Z');

describe('escapeHtml', () => {
  it('escapes every character that could break out of markup', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
    );
    expect(escapeHtml("it's & more")).toBe('it&#39;s &amp; more');
  });

  it('leaves ordinary text alone', () => {
    expect(escapeHtml('Bootcamp or self-study?')).toBe('Bootcamp or self-study?');
  });
});

describe('buildPdfReport', () => {
  it('produces a complete, self-contained document', () => {
    const doc = makeDoc();
    const html = buildPdfReport(doc, aPathNode(doc), ALL_PACKS, { now: NOW });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('</html>');
    // Nothing may be fetched from anywhere.
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).toContain("default-src 'none'");
  });

  it('names the universe, the step and the day it was made', () => {
    const doc = makeDoc();
    const nodeId = aPathNode(doc);
    const node = doc.nodes[nodeId]!;
    const html = buildPdfReport(doc, nodeId, ALL_PACKS, { now: NOW });
    expect(html).toContain('Path report');
    expect(html).toContain(escapeHtml(doc.title));
    expect(html).toContain(escapeHtml(node.title));
    expect(html).toContain('21 October 2026');
  });

  it('includes the situation the report is about', () => {
    const doc = makeDoc();
    const html = buildPdfReport(doc, aPathNode(doc), ALL_PACKS, { now: NOW });
    expect(html).toContain('The situation');
    expect(html).toContain(escapeHtml(prompt.situation));
    expect(html).toContain(escapeHtml(prompt.decision));
    expect(html).toContain('Looking ahead 2 years');
  });

  it('lists the steps of the path in order', () => {
    const doc = makeDoc();
    const nodeId = aPathNode(doc);
    const html = buildPdfReport(doc, nodeId, ALL_PACKS, { now: NOW });
    expect(html).toContain('The path, step by step');
    const steps = [...html.matchAll(/<span class="step-no">(\d+)<\/span>/g)].map((m) => m[1]);
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.map(Number)).toEqual(steps.map((_, i) => i + 1));
  });

  it('carries the brief, with the model labelled as a model', () => {
    const doc = makeDoc();
    const html = buildPdfReport(doc, aPathNode(doc), ALL_PACKS, { now: NOW });
    expect(html).toContain('The brief');
    expect(html).toContain('This is a model, not a prophecy');
    expect(html).toContain('Nothing here is a prediction');
  });

  it('lists the assumptions the answer rests on', () => {
    const doc = makeDoc();
    const html = buildPdfReport(doc, aPathNode(doc), ALL_PACKS, { now: NOW });
    expect(html).toContain('What it rests on');
    for (const a of doc.assumptions) {
      expect(html).toContain(escapeHtml(a.label));
    }
  });

  it('escapes anything the user typed, so a note cannot become markup', () => {
    const doc = makeDoc();
    const nodeId = aPathNode(doc);
    const hostile = '<img src=x onerror="alert(1)">';
    doc.nodes[nodeId]!.userNotes = hostile;
    doc.title = hostile;
    const html = buildPdfReport(doc, nodeId, ALL_PACKS, { now: NOW });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });

  it('says so plainly when the step is not in the universe', () => {
    const doc = makeDoc();
    const html = buildPdfReport(doc, 'no-such-node', ALL_PACKS, { now: NOW });
    expect(html).toContain('not in this universe');
    expect(html).toContain('</html>');
  });

  it('can leave the map and the timeline out', () => {
    const doc = makeDoc();
    const html = buildPdfReport(doc, aPathNode(doc), ALL_PACKS, {
      now: NOW,
      skipMap: true,
      skipTimeline: true,
    });
    expect(html).not.toContain('The map');
    expect(html).not.toContain('The path, step by step');
    expect(html).toContain('The brief');
  });

  it('is the same every time it is made for the same document', () => {
    const doc = makeDoc();
    const nodeId = aPathNode(doc);
    const a = buildPdfReport(doc, nodeId, ALL_PACKS, { now: NOW });
    const b = buildPdfReport(doc, nodeId, ALL_PACKS, { now: NOW });
    expect(a).toBe(b);
  });
});

describe('buildPathMapSvg', () => {
  it('draws the universe and numbers the steps on the path', () => {
    const doc = makeDoc();
    const nodeId = aPathNode(doc);
    const svg = buildPathMapSvg(doc, [nodeId]);
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox=');
    expect(svg).toContain('role="img"');
    expect(svg).toContain('</svg>');
    // One numbered marker for the one step on the path.
    const badges = [...svg.matchAll(/<circle[^>]*fill="#1c6fa8"[^>]*>/g)];
    expect(badges).toHaveLength(1);
    expect(svg).toContain('>1</text>');
  });

  it('describes itself for anyone who cannot see it', () => {
    const doc = makeDoc();
    const svg = buildPathMapSvg(doc, [aPathNode(doc)]);
    expect(svg).toContain('aria-label="A map of the whole universe');
    expect(svg).toContain('<title>');
  });

  it('draws nothing at all when there is nothing to draw', () => {
    const doc = makeDoc();
    doc.nodes = {};
    expect(buildPathMapSvg(doc, [])).toBe('');
  });

  it('stays short enough to sit on one page', () => {
    const doc = makeDoc();
    const svg = buildPathMapSvg(doc, [aPathNode(doc)]);
    const height = Number(/height="([\d.]+)"/.exec(svg)?.[1] ?? '0');
    expect(height).toBeGreaterThan(0);
    expect(height).toBeLessThan(420);
  });
});

describe('pdfReportFileName', () => {
  it('is a name a filesystem will accept', () => {
    const doc = makeDoc();
    const name = pdfReportFileName(doc, aPathNode(doc));
    expect(name.endsWith('.pdf')).toBe(true);
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
  });

  it('strips the characters Windows will not take', () => {
    const doc = makeDoc();
    doc.title = 'a/b:c*d?e"f<g>h|i';
    const name = pdfReportFileName(doc, aPathNode(doc));
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
  });

  it('never comes back empty', () => {
    const doc = makeDoc();
    doc.title = '';
    expect(pdfReportFileName(doc, aPathNode(doc)).length).toBeGreaterThan(0);
  });
});
