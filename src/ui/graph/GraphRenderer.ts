/**
 * Canvas2D graph renderer.
 *
 * Hand-written renderer with a world<->screen camera, cubic-bezier edges,
 * rounded-rect node cards, hit testing, node dragging and a short animation
 * clock for branch growth. Kept as a plain class (not React) so the animation
 * loop, hit testing and pointer state live in one predictable place.
 */
import type { NodeId, SimEdge, SimNode, SimulationDoc } from '../../core/types';
import { visibleNodes } from '../../core/graph';
import { LAYOUT } from '../../core/layout';

export interface Camera {
  x: number;
  y: number;
  scale: number;
}
export interface LayoutBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RenderOptions {
  selection: Set<NodeId>;
  path: Set<NodeId>;
  hover: NodeId | null;
  query: string;
  reducedMotion: boolean;
  showSpread: boolean;
  showGrid: boolean;
  compareNodeId: NodeId | null;
}

export interface NodeView {
  id: NodeId;
  box: LayoutBox;
  hue: number;
  grow: number;
  born: number;
}

export const NODE_W = 286;
export const NODE_H = 104;

const TYPE_MARK: Record<SimNode['type'], string> = {
  start: '◆',
  decision: '◈',
  event: '●',
  opportunity: '▲',
  setback: '▼',
  milestone: '✦',
  consequence: '»',
  alternative: '❖',
  ending: '■',
};

const TYPE_TINT: Record<SimNode['type'], [number, number, number]> = {
  start: [79, 216, 255],
  decision: [255, 183, 77],
  event: [177, 140, 255],
  opportunity: [92, 230, 168],
  setback: [255, 125, 156],
  milestone: [255, 224, 130],
  consequence: [154, 166, 196],
  alternative: [126, 200, 255],
  ending: [232, 237, 249],
};

function hueRgb(hue: number, s = 0.62, l = 0.62): [number, number, number] {
  return hslToRgb((((hue % 360) + 360) % 360) / 360, s, l);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const f = (n: number): number => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

function rgba(c: [number, number, number], a: number): string {
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
}

function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/** Deterministic vertical nudge so stacked cards do not look mechanically aligned. */
function jitterFor(id: string): number {
  return (hash01(id) - 0.5) * 5;
}

export class GraphRenderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private w = 0;
  private h = 0;

  camera: Camera = { x: 0, y: 0, scale: 1 };
  views = new Map<NodeId, NodeView>();
  doc: SimulationDoc | null = null;
  opts: RenderOptions = {
    selection: new Set(),
    path: new Set(),
    hover: null,
    query: '',
    reducedMotion: false,
    showSpread: true,
    showGrid: true,
    compareNodeId: null,
  };

  private raf = 0;
  private edgeAnims = new Map<string, number>();
  private newIds = new Set<NodeId>();

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable in this browser.');
    this.ctx = ctx;
  }

  /** Canvas size in CSS pixels (used by the minimap for viewport mapping). */
  get width(): number {
    return this.w;
  }
  get height(): number {
    return this.h;
  }

  dispose(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  resize(cssW: number, cssH: number): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.w = cssW;
    this.h = cssH;
    this.canvas.width = Math.max(1, Math.floor(cssW * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(cssH * this.dpr));
    this.invalidate();
  }

  invalidate(): void {
    if (this.raf) return;
    const loop = (t: number): void => {
      this.raf = 0;
      let animating = false;
      if (this.opts.reducedMotion) {
        for (const v of this.views.values()) v.grow = 1;
        this.edgeAnims.clear();
        this.newIds.clear();
      } else {
        for (const v of this.views.values()) {
          if (v.grow >= 1) continue;
          const age = (t - v.born) / 420;
          v.grow = easeOutCubic(clamp01(age));
          if (age < 1) animating = true;
        }
        for (const [id, born] of this.edgeAnims) {
          if (t - born < 420) animating = true;
          else this.edgeAnims.delete(id);
        }
      }
      this.paint();
      if (animating) this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Mark nodes (and their incoming edges) as freshly grown for animation. */
  markGrowth(ids: readonly NodeId[]): void {
    this.newIds = new Set(ids);
    if (this.opts.reducedMotion) return;
    const now = performance.now();
    for (const id of ids) {
      const v = this.views.get(id);
      if (v) {
        v.born = now;
        v.grow = 0;
      }
      for (const e of Object.values(this.doc?.edges ?? {}))
        if (e.to === id) this.edgeAnims.set(e.id, now);
    }
    this.invalidate();
  }

  /* ---------------- transforms ---------------- */

  toScreen(wx: number, wy: number): [number, number] {
    return [
      (wx - this.camera.x) * this.camera.scale + this.w / 2,
      (wy - this.camera.y) * this.camera.scale + this.h / 2,
    ];
  }

  toWorld(sx: number, sy: number): [number, number] {
    return [
      (sx - this.w / 2) / this.camera.scale + this.camera.x,
      (sy - this.h / 2) / this.camera.scale + this.camera.y,
    ];
  }

  setDocument(doc: SimulationDoc): void {
    this.doc = doc;
    const keep = visibleNodes(doc);
    const next = new Map<NodeId, NodeView>();
    for (const n of keep) {
      const point = doc.layout[n.id];
      if (!point) continue;
      const prev = this.views.get(n.id);
      const hue = doc.branches[n.branch]?.hue ?? 200;
      next.set(n.id, {
        id: n.id,
        box: { x: point.x, y: point.y + jitterFor(n.id), w: NODE_W, h: NODE_H },
        hue,
        grow: prev ? prev.grow : this.newIds.has(n.id) ? 0 : 1,
        born: prev ? prev.born : performance.now() - 1000,
      });
    }
    this.views = next;
    this.invalidate();
  }

  updateOptions(patch: Partial<RenderOptions>): void {
    this.opts = { ...this.opts, ...patch };
    this.invalidate();
  }

  /* ---------------- hit testing ---------------- */

  nodeAt(sx: number, sy: number): NodeId | null {
    const [wx, wy] = this.toWorld(sx, sy);
    const list = [...this.views.values()];
    for (let i = list.length - 1; i >= 0; i--) {
      const v = list[i]!;
      if (wx >= v.box.x && wx <= v.box.x + v.box.w && wy >= v.box.y && wy <= v.box.y + v.box.h)
        return v.id;
    }
    return null;
  }

  contentBounds(): { x0: number; y0: number; x1: number; y1: number } | null {
    if (this.views.size === 0) return null;
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const v of this.views.values()) {
      x0 = Math.min(x0, v.box.x);
      y0 = Math.min(y0, v.box.y);
      x1 = Math.max(x1, v.box.x + v.box.w);
      y1 = Math.max(y1, v.box.y + v.box.h);
    }
    return { x0, y0, x1, y1 };
  }

  fitCamera(margin = 90): Camera | null {
    const b = this.contentBounds();
    if (!b) return null;
    const cw = b.x1 - b.x0 + margin * 2;
    const ch = b.y1 - b.y0 + margin * 2;
    if (cw <= 0 || ch <= 0 || !Number.isFinite(cw) || !Number.isFinite(ch)) return null;
    const scale = Math.min(this.w / cw, this.h / ch, 1.15);
    return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, scale: Math.max(0.12, scale) };
  }

  /* ---------------- painting ---------------- */

  private paint(): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (!this.doc) return;

    if (this.opts.showGrid) this.paintGrid();

    const q = this.opts.query.trim().toLowerCase();
    const matching = new Set<NodeId>();
    if (q.length >= 2) {
      for (const n of Object.values(this.doc.nodes)) {
        if (n.title.toLowerCase().includes(q) || n.summary.toLowerCase().includes(q))
          matching.add(n.id);
      }
    }

    for (const e of Object.values(this.doc.edges)) {
      const a = this.views.get(e.from);
      const b = this.views.get(e.to);
      if (!a || !b) continue;
      this.paintEdge(e, a, b);
    }

    for (const n of Object.values(this.doc.nodes)) {
      const v = this.views.get(n.id);
      if (!v) continue;
      this.paintNode(n, v, matching.has(n.id));
    }
  }

  private paintGrid(): void {
    const ctx = this.ctx;
    const step = LAYOUT.columnWidth * this.camera.scale;
    if (step < 24) return;
    const [ox, oy] = this.toScreen(0, 0);
    const alpha = Math.min(0.55, this.camera.scale * 0.6);
    ctx.save();
    ctx.strokeStyle = `rgba(43, 55, 96, ${alpha * 0.3})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const startX = ((ox % step) + step) % step;
    const startY = ((oy % step) + step) % step;
    for (let x = startX; x < this.w; x += step) {
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, this.h);
    }
    for (let y = startY; y < this.h; y += step) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(this.w, Math.round(y) + 0.5);
    }
    ctx.stroke();
    ctx.restore();
  }

  private paintEdge(e: SimEdge, a: NodeView, b: NodeView): void {
    const ctx = this.ctx;
    const onPath = this.opts.selection.has(e.from) || this.opts.selection.has(e.to);
    const pathEdge = this.opts.path.has(e.from) && this.opts.path.has(e.to);
    const emphasised = onPath || pathEdge;

    const ax = a.box.x + a.box.w;
    const ay = a.box.y + a.box.h / 2;
    const bx = b.box.x;
    const by = b.box.y + b.box.h / 2;
    const [sx1, sy1] = this.toScreen(ax, ay);
    const [sx2, sy2] = this.toScreen(bx, by);
    const mx = (sx1 + sx2) / 2;

    const anim = this.edgeAnims.get(e.id);
    let progress = 1;
    if (anim !== undefined && !this.opts.reducedMotion)
      progress = clamp01((performance.now() - anim) / 420);

    const accent = hueRgb(a.hue, 0.7, 0.62);
    ctx.save();
    ctx.lineCap = 'round';

    // confidence → line weight & opacity
    const conf = e.confidence === 'high' ? 1 : e.confidence === 'medium' ? 0.66 : 0.4;
    ctx.lineWidth = emphasised ? 2.4 : e.kind === 'choice' ? 1.9 : 1.3;
    ctx.strokeStyle = emphasised ? rgba(accent, 0.95) : rgba(accent, 0.42 * conf + 0.12);
    if (e.confidence === 'low') ctx.setLineDash([4, 4]);

    ctx.beginPath();
    ctx.moveTo(sx1, sy1);
    if (progress >= 1) {
      ctx.bezierCurveTo(mx, sy1, mx, sy2, sx2, sy2);
      ctx.stroke();
    } else {
      const steps = 24;
      const upto = Math.max(1, Math.floor(steps * progress));
      for (let i = 0; i <= upto; i++) {
        const t = i / steps;
        const p = bez(sx1, sy1, mx, sy1, mx, sy2, sx2, sy2, t);
        if (i === 0) ctx.moveTo(p[0], p[1]);
        else ctx.lineTo(p[0], p[1]);
      }
      ctx.stroke();
      const head = bez(sx1, sy1, mx, sy1, mx, sy2, sx2, sy2, progress);
      ctx.setLineDash([]);
      ctx.fillStyle = rgba(accent, 0.95);
      ctx.shadowColor = rgba(accent, 0.9);
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(head[0], head[1], 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    // arrowhead
    const p = bez(sx1, sy1, mx, sy1, mx, sy2, sx2, sy2, 0.93);
    const q2 = bez(sx1, sy1, mx, sy1, mx, sy2, sx2, sy2, 0.88);
    const ang = Math.atan2(p[1] - q2[1], p[0] - q2[0]);
    const size = emphasised ? 8 : 6;
    ctx.setLineDash([]);
    ctx.fillStyle = emphasised ? rgba(accent, 0.95) : rgba(accent, 0.5 * conf + 0.2);
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(p[0] - size * Math.cos(ang - 0.44), p[1] - size * Math.sin(ang - 0.44));
    ctx.lineTo(p[0] - size * Math.cos(ang + 0.44), p[1] - size * Math.sin(ang + 0.44));
    ctx.closePath();
    ctx.fill();

    // hypothesis label on choice edges
    if (this.camera.scale > 0.42 && (e.kind === 'choice' || emphasised) && e.hypothesis) {
      const mid = bez(sx1, sy1, mx, sy1, mx, sy2, sx2, sy2, 0.5);
      const size2 = Math.max(8, 9.5 * Math.min(1.1, this.camera.scale));
      ctx.font = `500 ${size2}px ${monoFont()}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = ellipsize(ctx, e.hypothesis, 190);
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(6, 9, 17, 0.9)';
      roundRect(ctx, mid[0] - tw / 2 - 5, mid[1] - 8, tw + 10, 16, 8);
      ctx.fill();
      ctx.fillStyle = emphasised ? 'rgba(232, 237, 249, 0.92)' : 'rgba(154, 166, 196, 0.78)';
      ctx.fillText(label, mid[0], mid[1] + 0.5);
    }

    ctx.restore();
  }

  private paintNode(n: SimNode, v: NodeView, matched: boolean): void {
    const ctx = this.ctx;
    if (v.grow <= 0) return;

    const sel = this.opts.selection.has(n.id);
    const onPath = this.opts.path.has(n.id);
    const hover = this.opts.hover === n.id;
    const compare = this.opts.compareNodeId === n.id;
    const branchColour = hueRgb(v.hue, 0.68, 0.6);
    const typeColour = TYPE_TINT[n.type];

    const cx = v.box.x + v.box.w / 2;
    const cy = v.box.y + v.box.h / 2;
    const [sx, sy] = this.toScreen(cx, cy);
    const w = v.box.w * this.camera.scale;
    const h = v.box.h * this.camera.scale;
    if (w < 10 || h < 6) return;

    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(v.grow, v.grow);
    ctx.translate(-sx, -sy);

    const x = sx - w / 2;
    const y = sy - h / 2;
    const r = 11 * Math.min(1, this.camera.scale);
    const s = Math.min(1.2, Math.max(0.55, this.camera.scale));

    // glow behind selected / path nodes
    if (sel || onPath) {
      ctx.shadowColor = rgba(branchColour, sel ? 0.5 : 0.24);
      ctx.shadowBlur = sel ? 26 : 14;
    }

    // card body
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    if (sel) {
      grad.addColorStop(0, '#182748');
      grad.addColorStop(1, '#0e1730');
    } else if (hover) {
      grad.addColorStop(0, '#141d38');
      grad.addColorStop(1, '#0d1325');
    } else {
      grad.addColorStop(0, '#101528');
      grad.addColorStop(1, '#0a0e1c');
    }
    ctx.fillStyle = grad;
    roundRect(ctx, x, y, w, h, r);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;

    // border
    ctx.lineWidth = sel ? 2.1 : 1;
    ctx.strokeStyle = sel
      ? rgba(branchColour, 0.95)
      : matched
        ? 'rgba(79, 216, 255, 0.85)'
        : compare
          ? 'rgba(255, 183, 77, 0.8)'
          : hover
            ? rgba(branchColour, 0.55)
            : 'rgba(43, 55, 96, 0.9)';
    if (matched && !sel) ctx.lineWidth = 1.5;
    roundRect(ctx, x, y, w, h, r);
    ctx.stroke();

    // branch-colour rail
    ctx.fillStyle = rgba(branchColour, 0.95);
    roundRect(ctx, x + 1, y + 3, 3.5 * s, h - 6, 2);
    ctx.fill();

    // type mark
    ctx.font = `${13 * s}px ${uiFont()}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgb(${typeColour[0]}, ${typeColour[1]}, ${typeColour[2]})`;
    ctx.fillText(TYPE_MARK[n.type], x + 12 * s, y + 17 * s);

    // title
    ctx.font = `600 ${12.5 * s}px ${uiFont()}`;
    ctx.fillStyle = '#e8edf9';
    ctx.fillText(ellipsize(ctx, n.title, w - 52 * s), x + 28 * s, y + 17 * s);

    // summary line
    if (this.camera.scale > 0.42) {
      ctx.font = `400 ${10.2 * s}px ${uiFont()}`;
      ctx.fillStyle = 'rgba(154, 166, 196, 0.92)';
      ctx.fillText(ellipsize(ctx, n.summary, w - 26 * s), x + 12 * s, y + 38 * s);
    }

    // horizon + branch
    const branchName = this.doc?.branches[n.branch]?.name ?? n.branch;
    ctx.font = `500 ${9.4 * s}px ${monoFont()}`;
    ctx.fillStyle = rgba(branchColour, 0.85);
    const foot = `${n.horizon}  ·  ${ellipsize(ctx, branchName, 110)}`;
    ctx.fillText(ellipsize(ctx, foot, w - 60 * s), x + 12 * s, y + h - 12 * s);

    // right-side flags
    ctx.textAlign = 'right';
    ctx.font = `600 ${8.6 * s}px ${monoFont()}`;
    const flagX = x + w - 12 * s;
    if (n.expanded) {
      ctx.fillStyle = 'rgba(154, 166, 196, 0.5)';
      ctx.fillText('EXPANDED', flagX, y + 17 * s);
    } else if (n.expandable) {
      ctx.fillStyle = 'rgba(79, 216, 255, 0.9)';
      ctx.fillText('+ EXPAND', flagX, y + 17 * s);
    }

    // state chips (spread)
    if (this.opts.showSpread && this.camera.scale > 0.55 && n.state) {
      const primary = Object.entries(n.state).slice(0, 2);
      ctx.textAlign = 'left';
      ctx.font = `500 ${8.8 * s}px ${monoFont()}`;
      let chipX = x + 12 * s;
      for (const [key, value] of primary) {
        const text = `${shortKey(key)} ${Math.round(value)}`;
        const tw = ctx.measureText(text).width;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        roundRect(ctx, chipX, y + h - 27 * s, tw + 10 * s, 13 * s, 6.5 * s);
        ctx.fill();
        ctx.fillStyle = 'rgba(154, 166, 196, 0.9)';
        ctx.fillText(text, chipX + 5 * s, y + h - 20 * s);
        chipX += tw + 15 * s;
        if (chipX > x + w - 60 * s) break;
      }
    }

    ctx.restore();
  }
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function bez(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  t: number
): [number, number] {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return [a * x0 + b * x1 + c * x2 + d * x3, a * y0 + b * y1 + c * y2 + d * y3];
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (maxW <= 8) return '';
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + '…';
}

function shortKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .slice(0, 10);
}

function uiFont(): string {
  return '"Segoe UI", system-ui, sans-serif';
}
function monoFont(): string {
  return '"Cascadia Code", Consolas, monospace';
}

export { hueRgb, rgba };
