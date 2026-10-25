/**
 * The printable path report.
 *
 * A PDF is a different job from the screen: no interaction, no hovering, no
 * scrolling, and paper that costs money to print. So this is not a screenshot
 * of the app and not a dump of the Markdown export — it is laid out for a
 * page, in ink-friendly colours, with the same honesty rules as the rest of
 * the app. Every number in it is computed by the engine, every claim is
 * labelled as a model's claim, and where the model has nothing to say the
 * report says so rather than filling the gap.
 *
 * The module is deliberately free of DOM and of Electron. It turns a document
 * and a node into one complete, self-contained HTML string. The desktop shell
 * prints that string to PDF; a browser can print it to a printer. Nothing
 * here can reach the network, and every piece of text the user typed is
 * escaped before it goes anywhere near the markup.
 */
import type { NodeId, SimNode, SimulationDoc } from './types';
import type { RulePack } from './rulePack';
import { pathTo } from './engine';
import { visibleNodes } from './graph';
import { formatValue } from './vars';
import { APP_VERSION } from './importExport';
import { buildDossier } from './dossier';
import { describeHorizon } from './graphLegend';

/**
 * The width the report is laid out for, in CSS pixels.
 *
 * A4 with the gutters the stylesheet asks for gives about 688px of page, and
 * the report itself is capped at 178mm — 672px. Everything in the document is
 * drawn to that width, which is why the map can use fixed pixel sizes and
 * still come out the right size on paper.
 */
const REPORT_WIDTH = 672;

/* ------------------------------------------------------------------ */
/* escaping                                                            */
/* ------------------------------------------------------------------ */

/**
 * Make a string safe to put inside HTML.
 *
 * Everything the user typed goes through here: the universe title, the
 * situation, their notes on a step, the name of a branch. Without this, a
 * note reading `<img onerror=...>` would become part of the document.
 */
export function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ------------------------------------------------------------------ */
/* the map                                                             */
/* ------------------------------------------------------------------ */

/**
 * The printable map.
 *
 * The screen draws the universe as a tree that runs down the page; a page of
 * paper does not have that much height to spare, and a map stretched over
 * three sheets of A4 is not a map. So the printable map is the same graph
 * drawn the other way round: one row per path, one shared time axis across
 * the page, time running left to right. Every path in the universe is there,
 * the path this report is about is drawn in blue and its steps are numbered,
 * and the same numbers are used in the step-by-step list underneath — so the
 * picture and the text cannot drift apart.
 */
export function buildPathMapSvg(doc: SimulationDoc, path: readonly NodeId[]): string {
  const pathSet = new Set(path);
  const stepOf = new Map<NodeId, number>();
  path.forEach((id, i) => stepOf.set(id, i + 1));

  const nodes = visibleNodes(doc);
  if (nodes.length === 0) return '';

  /* --- one lane per path ------------------------------------------- */

  const lanes: { id: string; name: string; nodes: SimNode[] }[] = [];
  for (const branch of Object.values(doc.branches)) {
    const own = nodes.filter((n) => n.branch === branch.id);
    if (own.length > 0) lanes.push({ id: branch.id, name: branch.name, nodes: own });
  }
  // A node whose branch is missing from the map (a repaired import, say)
  // still has to appear somewhere, so it gets a lane of its own.
  const placed = new Set(lanes.flatMap((l) => l.nodes.map((n) => n.id)));
  for (const node of nodes) {
    if (placed.has(node.id)) continue;
    const stray = lanes.find((l) => l.id === node.branch);
    if (stray) stray.nodes.push(node);
    else lanes.push({ id: node.branch, name: node.branch, nodes: [node] });
    placed.add(node.id);
  }

  /* --- the geometry ------------------------------------------------ */

  const maxT = Math.max(1, ...nodes.map((n) => n.t));
  const plotLeft = 152;
  const plotRight = REPORT_WIDTH - 16;
  const plotW = plotRight - plotLeft;
  const xOf = (t: number): number => plotLeft + (t / maxT) * plotW;

  interface Placed {
    id: NodeId;
    x: number;
    y: number;
    step: number | null;
    onPath: boolean;
  }
  const placed2 = new Map<NodeId, Placed>();
  const laneRows: { name: string; onPath: boolean; top: number; height: number }[] = [];

  let cursor = 8;
  for (const lane of lanes) {
    const byT = new Map<number, SimNode[]>();
    for (const n of lane.nodes) byT.set(n.t, [...(byT.get(n.t) ?? []), n]);
    let widest = 1;
    for (const list of byT.values()) widest = Math.max(widest, list.length);
    const height = Math.max(74, widest * 26 + 32);
    const centre = cursor + height / 2;
    for (const [t, list] of [...byT.entries()].sort((a, b) => a[0] - b[0])) {
      list.sort((a, b) => a.id.localeCompare(b.id));
      list.forEach((node, i) => {
        const offset = list.length === 1 ? 0 : (i - (list.length - 1) / 2) * 26;
        placed2.set(node.id, {
          id: node.id,
          x: xOf(t),
          y: centre + offset,
          step: stepOf.get(node.id) ?? null,
          onPath: pathSet.has(node.id),
        });
      });
    }
    laneRows.push({
      name: lane.name,
      onPath: lane.nodes.some((n) => pathSet.has(n.id)),
      top: cursor,
      height,
    });
    cursor += height;
  }

  const axisY = cursor + 14;
  const height = axisY + 26;

  /* --- drawing ----------------------------------------------------- */

  const parts: string[] = [];
  parts.push(
    `<svg class="map" viewBox="0 0 ${REPORT_WIDTH} ${round(height)}" width="${REPORT_WIDTH}" ` +
      `height="${round(height)}" role="img" aria-label="${escapeHtml(mapDescription(doc, path))}">`
  );
  parts.push('<title>' + escapeHtml(mapDescription(doc, path)) + '</title>');

  // The band behind the path this report is about.
  for (const lane of laneRows) {
    if (!lane.onPath) continue;
    parts.push(
      `<rect x="${plotLeft - 10}" y="${round(lane.top + 4)}" ` +
        `width="${round(plotRight - plotLeft + 20)}" height="${round(lane.height - 8)}" ` +
        `rx="7" fill="#eaf2fa" />`
    );
  }

  // The lane labels, and the hairline between lanes.
  laneRows.forEach((lane, i) => {
    const centre = lane.top + lane.height / 2;
    parts.push(
      `<text x="${plotLeft - 14}" y="${round(centre + 4)}" text-anchor="end" ` +
        `font-size="11" font-family="Segoe UI, system-ui, sans-serif" ` +
        `fill="${lane.onPath ? '#1c6fa8' : '#48505f'}" ` +
        `font-weight="${lane.onPath ? '700' : '400'}">${escapeHtml(clip(lane.name, 26))}</text>`
    );
    if (i > 0) {
      parts.push(
        `<line x1="${plotLeft - 10}" y1="${round(lane.top)}" x2="${plotRight}" ` +
          `y2="${round(lane.top)}" stroke="#e3e8f0" stroke-width="1" />`
      );
    }
  });

  // The edges.
  for (const edge of Object.values(doc.edges)) {
    const from = placed2.get(edge.from);
    const to = placed2.get(edge.to);
    if (!from || !to) continue;
    const onPath = from.onPath && to.onPath;
    const dx = Math.max(18, Math.abs(to.x - from.x) * 0.45);
    parts.push(
      `<path d="M ${round(from.x)} ${round(from.y)} ` +
        `C ${round(from.x + dx)} ${round(from.y)}, ${round(to.x - dx)} ${round(to.y)}, ` +
        `${round(to.x)} ${round(to.y)}" fill="none" ` +
        `stroke="${onPath ? '#1c6fa8' : '#c6cdda'}" ` +
        `stroke-width="${onPath ? '2' : '1.3'}" stroke-linecap="round" />`
    );
  }

  // The nodes.
  for (const node of placed2.values()) {
    if (node.step !== null) continue;
    parts.push(`<circle cx="${round(node.x)}" cy="${round(node.y)}" r="4.5" fill="#b3bdcc" />`);
  }
  for (const node of placed2.values()) {
    if (node.step === null) continue;
    parts.push(
      `<circle cx="${round(node.x)}" cy="${round(node.y)}" r="9.5" fill="#1c6fa8" ` +
        `stroke="#ffffff" stroke-width="2" />`
    );
    parts.push(
      `<text x="${round(node.x)}" y="${round(node.y + 3.8)}" text-anchor="middle" ` +
        `font-size="10.5" font-family="Segoe UI, system-ui, sans-serif" ` +
        `font-weight="700" fill="#ffffff">${node.step}</text>`
    );
  }

  // The time axis.
  parts.push(
    `<line x1="${plotLeft - 10}" y1="${round(axisY)}" x2="${plotRight}" ` +
      `y2="${round(axisY)}" stroke="#b9c2d0" stroke-width="1" />`
  );
  parts.push(
    `<line x1="${plotLeft}" y1="${round(axisY - 4)}" x2="${plotLeft}" ` +
      `y2="${round(axisY + 4)}" stroke="#b9c2d0" stroke-width="1" />`
  );
  parts.push(
    `<line x1="${plotRight}" y1="${round(axisY - 4)}" x2="${plotRight}" ` +
      `y2="${round(axisY + 4)}" stroke="#b9c2d0" stroke-width="1" />`
  );
  parts.push(
    `<text x="${plotLeft - 10}" y="${round(axisY + 17)}" text-anchor="start" ` +
      `font-size="10" font-family="Segoe UI, system-ui, sans-serif" ` +
      `fill="#5a6474">now</text>`
  );
  parts.push(
    `<text x="${plotRight}" y="${round(axisY + 17)}" text-anchor="end" ` +
      `font-size="10" font-family="Segoe UI, system-ui, sans-serif" ` +
      `fill="#5a6474">${escapeHtml(`${maxT} month${maxT === 1 ? '' : 's'}`)}</text>`
  );

  parts.push('</svg>');
  return parts.join('');
}

/** A plain sentence describing the map, for anyone who cannot see it. */
function mapDescription(doc: SimulationDoc, path: readonly NodeId[]): string {
  const branches = new Set<string>();
  for (const id of path) {
    const branch = doc.nodes[id]?.branch;
    if (branch) branches.add(branch);
  }
  const names = [...branches]
    .map((id) => doc.branches[id]?.name)
    .filter((n): n is string => typeof n === 'string');
  const where = names.length > 0 ? names.join(', ') : 'the path';
  return `A map of the whole universe drawn as parallel timelines: one row per path, time running left to right. The path this report is about — ${where} — is drawn in blue, and its steps are numbered from 1.`;
}

/** Shorten a label to fit a lane without letting it wrap. */
function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function round(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/* ------------------------------------------------------------------ */
/* the report                                                          */
/* ------------------------------------------------------------------ */

export interface PdfReportOptions {
  /** How many samples the model-spread figure is built from. */
  samples?: number;
  /** Leave the step-by-step section out. */
  skipTimeline?: boolean;
  /** Leave the map out. */
  skipMap?: boolean;
  /** The moment the report claims to have been made. Defaults to now. */
  now?: Date;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function formatDate(date: Date): string {
  return `${date.getDate()} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

/** A file name that is safe on every filesystem the app might meet. */
export function pdfReportFileName(doc: SimulationDoc, nodeId: NodeId): string {
  const node = doc.nodes[nodeId];
  const parts = [doc.title || 'universe', node?.title ?? 'path'];
  const cleaned = parts
    .join(' - ')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return `${cleaned || 'path report'}.pdf`;
}

/**
 * Build the whole printable report as one HTML document.
 *
 * The result is self-contained: no scripts, no stylesheets, no fonts to
 * fetch, no network of any kind. It can be written to a file, opened in a
 * browser, or printed to PDF, and it will look the same each time.
 */
export function buildPdfReport(
  doc: SimulationDoc,
  nodeId: NodeId,
  packs: readonly RulePack[],
  options: PdfReportOptions = {}
): string {
  const node = doc.nodes[nodeId];
  if (!node) {
    return emptyReport('That step is not in this universe.');
  }

  const now = options.now ?? new Date();
  const path = pathTo(doc, nodeId);
  const dossier = buildDossier(doc, nodeId, packs, { samples: options.samples ?? 24 });

  const body: string[] = [];

  body.push(masthead(doc, node, now));
  body.push(scenario(doc));
  if (!options.skipMap) body.push(mapBlock(doc, path));
  if (dossier) body.push(brief(dossier));
  if (!options.skipTimeline) body.push(steps(doc, path));
  body.push(sessionNotes(doc));
  body.push(restsOn(doc));
  body.push(colophon(doc));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src 'none'; script-src 'none'" />
<title>${escapeHtml(`Path report — ${doc.title}`)}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<main class="report">
${body.join('\n')}
</main>
</body>
</html>
`;
}

/* ------------------------------------------------------------------ */
/* sections                                                            */
/* ------------------------------------------------------------------ */

function masthead(doc: SimulationDoc, node: SimNode, now: Date): string {
  const branch = doc.branches[node.branch]?.name ?? '';
  return `<header class="masthead">
  <p class="kicker">What If? — The Infinite Lives Engine</p>
  <h1>Path report</h1>
  <p class="deck">${escapeHtml(doc.title)}</p>
  <dl class="facts">
    <div><dt>This step</dt><dd>${escapeHtml(node.title)}</dd></div>
    ${branch ? `<div><dt>Path</dt><dd>${escapeHtml(branch)}</dd></div>` : ''}
    <div><dt>Made</dt><dd>${escapeHtml(formatDate(now))}</dd></div>
  </dl>
</header>`;
}

function scenario(doc: SimulationDoc): string {
  const prompt = doc.prompt;
  const rows: string[] = [];
  if (prompt.situation) rows.push(term('Where you are', prompt.situation));
  if (prompt.decision) rows.push(term('The decision in front of you', prompt.decision));
  if (prompt.goals.length > 0) rows.push(term('What you want', list(prompt.goals)));
  if (prompt.constraints.length > 0)
    rows.push(term('What you are bound by', list(prompt.constraints)));
  if (prompt.resources.length > 0)
    rows.push(term('What you have to work with', list(prompt.resources)));
  rows.push(term('How far ahead', `Looking ahead ${describeHorizon(prompt.horizon)}`));
  if (rows.length === 0) return '';
  return `<section class="block">
  <h2>The situation</h2>
  ${rows.join('\n  ')}
</section>`;
}

function term(label: string, value: string): string {
  return `<p class="term"><span class="term-label">${escapeHtml(label)}</span> ${escapeHtml(
    value
  )}</p>`;
}

function list(items: readonly string[]): string {
  return items.join('; ');
}

function mapBlock(doc: SimulationDoc, path: readonly NodeId[]): string {
  const svg = buildPathMapSvg(doc, path);
  if (!svg) return '';
  return `<section class="block">
  <h2>The map</h2>
  <p class="lede">The whole universe, drawn as parallel timelines: one row per path, time running left to right. The path this report is about is drawn in blue, and its steps are numbered — the same numbers are used in the list below.</p>
  <figure class="map-figure">${svg}</figure>
  <ul class="legend">
    <li><span class="swatch swatch-path"></span>the path this report is about</li>
    <li><span class="swatch swatch-other"></span>the other paths</li>
  </ul>
</section>`;
}

function brief(dossier: NonNullable<ReturnType<typeof buildDossier>>): string {
  const moved = dossier.metrics.filter((m) => m.tone !== 'flat');
  const rows = (moved.length > 0 ? moved : dossier.metrics.slice(0, 8))
    .map(
      (m) =>
        `<tr><td>${escapeHtml(m.label)}${
          m.noisy ? ' <span class="noisy" title="The model treats this as jumpy">≈</span>' : ''
        }</td><td class="num">${escapeHtml(m.nowText)}</td><td class="num">${escapeHtml(
          m.projectedText
        )}</td><td class="num tone-${m.tone}">${escapeHtml(m.deltaText)}</td></tr>`
    )
    .join('\n');

  const blocks: string[] = [];

  blocks.push(`<p class="headline">${escapeHtml(dossier.headline)}</p>`);
  blocks.push(`<p class="confidence">${escapeHtml(dossier.confidence)}</p>`);

  if (rows) {
    blocks.push(`<table class="metrics">
  <caption>Where the model puts things by the end of the horizon</caption>
  <thead><tr><th>What</th><th class="num">Now</th><th class="num">Later</th><th class="num">Change</th></tr></thead>
  <tbody>
${rows}
  </tbody>
</table>`);
  }

  if (dossier.spread && dossier.headlineMetric) {
    const s = dossier.spread;
    blocks.push(`<div class="spread">
  <h3>How much ${escapeHtml(dossier.headlineMetric.label)} could wobble</h3>
  <p>Low ${escapeHtml(formatValue(s.p10, dossier.headlineMetric.unit))}, typical ${escapeHtml(
    formatValue(s.p50, dossier.headlineMetric.unit)
  )}, high ${escapeHtml(formatValue(s.p90, dossier.headlineMetric.unit))} — over ${s.samples} runs of the same path with different internal choices. ${escapeHtml(
    dossier.spreadNote
  )}</p>
</div>`);
  }

  if (dossier.gains.length > 0) blocks.push(card('What it buys', 'good', dossier.gains));
  if (dossier.costs.length > 0) blocks.push(card('What it costs', 'bad', dossier.costs));
  if (dossier.risks.length > 0) blocks.push(card('What could go wrong', 'warn', dossier.risks));
  if (dossier.reasons.length > 0)
    blocks.push(card('How the model got here', 'plain', dossier.reasons, true));
  if (dossier.nextSteps.length > 0)
    blocks.push(card('What happens next', 'plain', dossier.nextSteps));

  return `<section class="block">
  <h2>The brief</h2>
  <p class="lede">${escapeHtml(dossier.branchName)} — ${escapeHtml(
    dossier.atLabel
  )}, reaching ${escapeHtml(dossier.projectedLabel)} out.</p>
  ${blocks.join('\n  ')}
</section>`;
}

function card(
  title: string,
  tone: 'good' | 'bad' | 'warn' | 'plain',
  items: readonly string[],
  ordered = false
): string {
  const tag = ordered ? 'ol' : 'ul';
  const body = items.map((i) => `<li>${escapeHtml(i)}</li>`).join('');
  return `<div class="card card-${tone}">
  <h3>${escapeHtml(title)}</h3>
  <${tag}>${body}</${tag}>
</div>`;
}

function steps(doc: SimulationDoc, path: readonly NodeId[]): string {
  if (path.length === 0) return '';
  const items: string[] = [];
  path.forEach((id, i) => {
    const node = doc.nodes[id];
    if (!node) return;
    const details: string[] = [];
    if (node.detail) details.push(`<p>${escapeHtml(node.detail)}</p>`);

    if (node.tradeoffs && (node.tradeoffs.gains.length > 0 || node.tradeoffs.costs.length > 0)) {
      const parts: string[] = [];
      if (node.tradeoffs.gains.length > 0) {
        parts.push(
          `<p class="trade"><span class="trade-label good">Gains</span> ${escapeHtml(
            node.tradeoffs.gains.join('; ')
          )}</p>`
        );
      }
      if (node.tradeoffs.costs.length > 0) {
        parts.push(
          `<p class="trade"><span class="trade-label bad">Costs</span> ${escapeHtml(
            node.tradeoffs.costs.join('; ')
          )}</p>`
        );
      }
      details.push(parts.join('\n'));
    }

    if (node.delta && node.delta.length > 0) {
      const rows = node.delta
        .map((d) => {
          const def = doc.vars.find((v) => v.key === d.key);
          const unit = def?.unit ?? 'index';
          return `<tr><td>${escapeHtml(def?.label ?? d.key)}</td><td class="num">${escapeHtml(
            formatValue(d.before, unit)
          )}</td><td class="num">${escapeHtml(formatValue(d.after, unit))}</td><td>${escapeHtml(
            d.reason
          )}</td></tr>`;
        })
        .join('\n');
      details.push(`<table class="state">
  <caption>What changed at this step</caption>
  <thead><tr><th>What</th><th class="num">Before</th><th class="num">After</th><th>Why</th></tr></thead>
  <tbody>
${rows}
  </tbody>
</table>`);
    } else if (node.state) {
      // No delta to show, so fall back to a short snapshot of where things stood.
      const keys = Object.keys(node.state).slice(0, 6);
      const rows = keys
        .map((k) => {
          const value = node.state?.[k];
          if (value === undefined) return '';
          const def = doc.vars.find((v) => v.key === k);
          return `<tr><td>${escapeHtml(def?.label ?? k)}</td><td class="num">${escapeHtml(
            formatValue(value, def?.unit ?? 'index')
          )}</td></tr>`;
        })
        .filter(Boolean)
        .join('\n');
      if (rows) {
        details.push(`<table class="state">
  <caption>Where things had got to by this point</caption>
  <tbody>
${rows}
  </tbody>
</table>`);
      }
    }

    if (node.nextSteps && node.nextSteps.length > 0) {
      details.push(
        `<p class="trade"><span class="trade-label">Next steps</span> ${escapeHtml(
          node.nextSteps.join('; ')
        )}</p>`
      );
    }

    if (node.failurePoints && node.failurePoints.length > 0) {
      details.push(
        `<p class="trade"><span class="trade-label warn">Where it could go wrong</span> ${escapeHtml(
          node.failurePoints.join('; ')
        )}</p>`
      );
    }

    if (node.userNotes) {
      details.push(
        `<div class="notes"><span class="trade-label">Your notes</span><p>${escapeHtml(
          node.userNotes
        )}</p></div>`
      );
    }

    items.push(`<li class="step">
  <h3><span class="step-no">${i + 1}</span>${escapeHtml(node.title)}</h3>
  <p class="step-when">${escapeHtml(node.horizon)} · month ${node.t}</p>
  <p class="step-summary">${escapeHtml(node.summary)}</p>
  ${details.join('\n  ')}
</li>`);
  });

  return `<section class="block">
  <h2>The path, step by step</h2>
  <ol class="steps">
${items.join('\n')}
  </ol>
</section>`;
}

function sessionNotes(doc: SimulationDoc): string {
  const notes = doc.sessionNotes.trim();
  if (notes.length === 0) return '';
  return `<section class="block">
  <h2>Your notes</h2>
  <p class="lede">Written by you in the app and kept with this universe. Line breaks are preserved exactly as typed.</p>
  <div class="notes"><p>${escapeHtml(notes)}</p></div>
</section>`;
}

function restsOn(doc: SimulationDoc): string {
  if (doc.assumptions.length === 0) return '';
  const rows = doc.assumptions
    .map(
      (a) =>
        `<tr><td>${escapeHtml(a.label)}</td><td class="num">${escapeHtml(
          formatValue(a.value, a.unit)
        )}</td><td class="num">${escapeHtml(formatValue(a.baseValue, a.unit))}</td><td>${escapeHtml(
          a.rationale
        )}</td></tr>`
    )
    .join('\n');
  return `<section class="block">
  <h2>What it rests on</h2>
  <p class="lede">The assumptions this universe was built on. Change any of them and the answer changes with it — which is what the counterfactual tool is for.</p>
  <table class="assumptions">
  <caption>Assumptions, and the value each one started from</caption>
  <thead><tr><th>Assumption</th><th class="num">Used</th><th class="num">Base</th><th>Why</th></tr></thead>
  <tbody>
${rows}
  </tbody>
</table>
</section>`;
}

function colophon(doc: SimulationDoc): string {
  const provenance = doc.meta?.provenance ?? '';
  return `<footer class="colophon">
  <p><strong>This is a model, not a prophecy.</strong> It shows consequences of the numbers you gave it — not what will happen to you. Nothing here is a prediction, and no figure is a probability of anything occurring.</p>
  ${provenance ? `<p class="provenance">${escapeHtml(provenance)}</p>` : ''}
  <p class="made-by">Made with What If? — The Infinite Lives Engine v${escapeHtml(APP_VERSION)}</p>
</footer>`;
}

function emptyReport(message: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>Path report</title><style>${REPORT_CSS}</style></head>
<body><main class="report"><header class="masthead"><h1>Path report</h1><p class="deck">${escapeHtml(
    message
  )}</p></header></main></body>
</html>
`;
}

/* ------------------------------------------------------------------ */
/* the stylesheet                                                      */
/* ------------------------------------------------------------------ */

/**
 * Ink-friendly print styles.
 *
 * Light on white rather than the app's dark panels: a printed page that
 * needs a full toner cartridge to be legible is not a document anybody
 * prints. The colours below are chosen to stay readable in greyscale, which
 * is how most people actually read a printed report.
 */
const REPORT_CSS = `
@page { size: A4; margin: 15mm 14mm 16mm; }

html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

body {
  margin: 0;
  padding: 0;
  background: #ffffff;
  color: #14181f;
  font-family: "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif;
  font-size: 10.5pt;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}

.report { max-width: 672px; margin: 0 auto; }

h1 { font-size: 25pt; line-height: 1.15; margin: 0 0 2mm; letter-spacing: -0.01em; }
h2 {
  font-size: 13.5pt; margin: 0 0 3mm; letter-spacing: 0.01em;
  padding-bottom: 1.6mm; border-bottom: 1.2pt solid #1c6fa8;
}
h3 { font-size: 10.5pt; margin: 0 0 1.5mm; }
p { margin: 0 0 2.4mm; }

.masthead { margin: 0 0 9mm; padding-bottom: 5mm; border-bottom: 2.4pt solid #14181f; }
.kicker {
  margin: 0 0 2mm; font-size: 8.5pt; letter-spacing: 0.12em;
  text-transform: uppercase; color: #5a6474; font-weight: 600;
}
.deck { margin: 0 0 4mm; font-size: 13pt; color: #343c49; }

.facts { display: flex; gap: 12mm; margin: 0; }
.facts div { margin: 0; }
.facts dt {
  margin: 0 0 0.6mm; font-size: 7.5pt; letter-spacing: 0.1em;
  text-transform: uppercase; color: #5a6474; font-weight: 600;
}
.facts dd { margin: 0; font-size: 10pt; }

.block { margin: 0 0 8mm; break-inside: auto; }
.lede { color: #48505f; margin-bottom: 3.5mm; }

.term { margin: 0 0 2.2mm; }
.term-label {
  display: inline-block; min-width: 42mm; font-weight: 600; color: #14181f;
}

.headline { font-size: 12.5pt; line-height: 1.45; margin-bottom: 2mm; }
.confidence { color: #48505f; margin-bottom: 4mm; }

table { width: 100%; border-collapse: collapse; margin: 0 0 4mm; }
caption {
  caption-side: top; text-align: left; font-size: 8.5pt; color: #5a6474;
  padding-bottom: 1.4mm;
}
th, td { text-align: left; padding: 1.3mm 2mm; border-bottom: 0.5pt solid #dde2ea; vertical-align: top; }
thead th { font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.07em; color: #48505f; border-bottom: 1pt solid #b9c2d0; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
.tone-better { color: #14724a; font-weight: 600; }
.tone-worse { color: #a5322f; font-weight: 600; }
.tone-flat { color: #5a6474; }
.noisy { color: #8a6d1f; margin-left: 1.2mm; }

.card {
  break-inside: avoid; margin: 0 0 3.5mm; padding: 2.6mm 3mm;
  border-left: 2.4pt solid #c3cad6; background: #f6f8fb;
}
.card h3 { margin-bottom: 1.2mm; }
.card ul, .card ol { margin: 0; padding-left: 5mm; }
.card li { margin-bottom: 1mm; }
.card-good { border-left-color: #14724a; }
.card-bad { border-left-color: #a5322f; }
.card-warn { border-left-color: #8a6d1f; }

.spread { break-inside: avoid; margin: 0 0 3.5mm; padding: 2.6mm 3mm; background: #f6f8fb; border-left: 2.4pt solid #1c6fa8; }
.spread p { margin: 0; color: #343c49; }

.map-figure { margin: 0 0 3mm; }
.map { width: 672px; max-width: 100%; height: auto; display: block; }
.legend { list-style: none; display: flex; flex-wrap: wrap; gap: 2mm 6mm; margin: 1.5mm 0 0; padding: 0; font-size: 9pt; color: #48505f; }
.legend li { display: flex; align-items: center; gap: 1.8mm; }
.swatch { width: 3mm; height: 3mm; border-radius: 50%; display: inline-block; }
.swatch-path { background: #1c6fa8; }
.swatch-other { background: #b3bdcc; }

.steps { list-style: none; margin: 0; padding: 0; counter-reset: step; }
.step { break-inside: avoid; margin: 0 0 5mm; padding-left: 9mm; position: relative; }
.step::before {
  content: ""; position: absolute; left: 3.4mm; top: 1.2mm; bottom: -5mm;
  width: 0.7pt; background: #dde2ea;
}
.step:last-child::before { display: none; }
.step h3 { font-size: 11.5pt; margin-bottom: 0.6mm; }
.step-no {
  display: inline-flex; align-items: center; justify-content: center;
  width: 5.6mm; height: 5.6mm; margin-right: 2.2mm; border-radius: 50%;
  border: 1pt solid #1c6fa8; color: #1c6fa8; font-size: 8.5pt; font-weight: 700;
  vertical-align: 0.4mm;
}
.step-when { font-size: 8.5pt; color: #5a6474; margin-bottom: 1.4mm; }
.step-summary { margin-bottom: 1.8mm; }
.trade { margin: 0 0 1.4mm; font-size: 9.5pt; color: #343c49; }
.trade-label {
  display: inline-block; font-size: 7.5pt; text-transform: uppercase;
  letter-spacing: 0.08em; font-weight: 700; color: #5a6474; margin-right: 1.5mm;
}
.trade-label.good { color: #14724a; }
.trade-label.bad { color: #a5322f; }
.trade-label.warn { color: #8a6d1f; }
.notes { border-left: 2pt solid #c3cad6; padding-left: 2.6mm; margin: 1.8mm 0 0; }
.notes p { margin: 0.6mm 0 0; white-space: pre-wrap; }

.state { margin-top: 2mm; }
.state caption { padding-bottom: 0.8mm; }

.colophon {
  margin-top: 10mm; padding-top: 3mm; border-top: 0.8pt solid #b9c2d0;
  font-size: 8.5pt; color: #48505f;
}
.colophon p { margin-bottom: 1.6mm; }
.provenance { color: #5a6474; }
.made-by { color: #6b7484; }

@media print {
  .step, .card, .spread { break-inside: avoid; }
  table { break-inside: avoid; }
  tr { break-inside: avoid; }
  h2 { break-after: avoid; }
  h3 { break-after: avoid; }
}
`;
