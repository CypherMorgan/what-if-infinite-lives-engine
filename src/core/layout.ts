/**
 * Graph layout.
 *
 * A hand-written layered ("Sugiyama-lite") pass rather than a library, for three reasons that
 * came out of the research pass:
 *
 *  1. A decision tree reconverges and can contain back-edges, which is exactly where generic
 *     DAG engines get awkward.
 *  2. The aesthetic we want is a left-to-right timeline with branch grouping, not a generic
 *     DAG rendering.
 *  3. elkjs is EPL-2.0 rather than MIT, and dagre would be ~300 KB for something simpler.
 *
 * The pass: rank by depth, order within rank to reduce crossings, resolve vertical overlap,
 * then centre each rank against its parents.
 */
import type { LayoutPoint, NodeId, SimNode, SimulationDoc } from './types';

export const LAYOUT = {
  columnWidth: 360,
  rowHeight: 138,
  /** Minimum vertical gap between node boxes. */
  gapY: 34,
  /** Gap between two different branches inside the same column. */
  branchGap: 76,
} as const;

/**
 * The size of a node card, in world units.
 *
 * The layout positions a card by its top-left corner, so anything that needs
 * the centre of a node — the printable map, for one — needs this too. It lives
 * here rather than in the renderer so the two cannot drift apart.
 */
export const NODE_CARD_W = 286;
export const NODE_CARD_H = 104;

interface RankEntry {
  id: NodeId;
  node: SimNode;
  order: number;
}

function visibleNodes(doc: SimulationDoc): SimNode[] {
  const collapsed = new Set(doc.collapsed);
  return Object.values(doc.nodes).filter((n) => !collapsed.has(n.branch));
}

/** Groups nodes into ranks by depth, ordering within a rank by branch, then time, then id. */
function buildRanks(nodes: readonly SimNode[]): Map<number, RankEntry[]> {
  const ranks = new Map<number, RankEntry[]>();
  const branchIndex = new Map<string, number>();

  const sorted = nodes.slice().sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    const ai = branchIndex.get(a.branch) ?? 0;
    const bi = branchIndex.get(b.branch) ?? 0;
    if (ai !== bi) return ai - bi;
    if (a.t !== b.t) return a.t - b.t;
    return a.id.localeCompare(b.id);
  });

  for (const node of sorted) {
    if (!branchIndex.has(node.branch)) branchIndex.set(node.branch, branchIndex.size);
    const list = ranks.get(node.depth) ?? [];
    list.push({ id: node.id, node, order: branchIndex.get(node.branch) ?? 0 });
    ranks.set(node.depth, list);
  }
  return ranks;
}

/**
 * One barycenter sweep. Moves each node towards the mean position of its connected neighbours
 * in the previous rank, which is the standard cheap crossing-reduction move.
 */
function barycenterSweep(
  ranks: Map<number, RankEntry[]>,
  neighbours: Map<NodeId, NodeId[]>,
  forward: boolean
): void {
  const keys = [...ranks.keys()].sort((a, b) => (forward ? a - b : b - a));
  const positions = new Map<NodeId, number>();

  for (const depth of keys) {
    const list = ranks.get(depth) ?? [];
    for (const entry of list) positions.set(entry.id, list.indexOf(entry));

    const scored = list.map((entry, idx) => {
      const links = neighbours.get(entry.id) ?? [];
      let sum = 0;
      let count = 0;
      for (const link of links) {
        const p = positions.get(link);
        if (p === undefined) continue;
        sum += p;
        count += 1;
      }
      return { entry, idx, score: count > 0 ? sum / count : idx };
    });

    scored.sort((a, b) => a.score - b.score);
    ranks.set(
      depth,
      scored.map((s) => s.entry)
    );
  }
}

/**
 * Assigns coordinates. Existing positions are preserved for nodes that already have a layout
 * entry when `anchor` is supplied, which is what keeps the user's mental map intact when a
 * branch is expanded.
 */
export function runLayout(doc: SimulationDoc): SimulationDoc {
  const nodes = visibleNodes(doc);
  if (nodes.length === 0) return { ...doc, layout: {} };

  const ranks = buildRanks(nodes);

  // Neighbour map for crossing reduction.
  const neighbours = new Map<NodeId, NodeId[]>();
  for (const node of nodes) {
    const links = [...node.parents, ...node.children];
    if (links.length > 0) neighbours.set(node.id, links);
  }

  for (let i = 0; i < 4; i += 1) {
    barycenterSweep(ranks, neighbours, true);
    barycenterSweep(ranks, neighbours, false);
  }

  const layout: Record<NodeId, LayoutPoint> = {};
  const depths = [...ranks.keys()].sort((a, b) => a - b);
  let previousBottom = 0;

  for (const depth of depths) {
    const list = ranks.get(depth) ?? [];
    let y = 0;
    let lastOrder = -1;
    let lastBranch = '';

    for (let i = 0; i < list.length; i += 1) {
      const entry = list[i] as RankEntry;
      if (i > 0) {
        const sameBranch = entry.node.branch === lastBranch;
        y += LAYOUT.rowHeight + (sameBranch ? LAYOUT.gapY : LAYOUT.branchGap);
      }
      layout[entry.id] = { x: depth * LAYOUT.columnWidth, y };
      lastOrder = entry.order;
      lastBranch = entry.node.branch;
    }
    void lastOrder;

    // Centre this rank vertically against the rank above it.
    if (depths.indexOf(depth) > 0) {
      const listIds = list.map((e) => e.id);
      let parentSum = 0;
      let parentCount = 0;
      for (const id of listIds) {
        const node = doc.nodes[id];
        if (!node) continue;
        for (const pid of node.parents) {
          const p = layout[pid];
          if (!p) continue;
          parentSum += p.y;
          parentCount += 1;
        }
      }
      if (parentCount > 0) {
        const childMid = (y + LAYOUT.rowHeight) / 2;
        const parentMid = parentSum / parentCount;
        const shift = parentMid - childMid;
        for (const id of listIds) {
          const p = layout[id];
          if (p) p.y += shift;
        }
        y += shift;
      }
    }

    previousBottom = y;
  }
  void previousBottom;

  // Normalise so the start node sits at the origin.
  const firstRank = depths[0] !== undefined ? ranks.get(depths[0]) : undefined;
  const first = firstRank?.[0]?.id;
  const origin = first ? layout[first] : undefined;
  if (origin) {
    for (const key of Object.keys(layout)) {
      const p = layout[key];
      if (!p) continue;
      p.x -= origin.x;
      p.y -= origin.y;
    }
  }

  return { ...doc, layout };
}

/**
 * Positions only newly-added nodes relative to their parents, leaving every existing node
 * exactly where it was. Used by branch expansion so the canvas can animate the new nodes in
 * without the rest of the universe moving under the user's cursor.
 */
export function layoutAdded(
  doc: SimulationDoc,
  added: readonly NodeId[]
): Record<NodeId, LayoutPoint> {
  const out: Record<NodeId, LayoutPoint> = {};
  const addedSet = new Set(added);

  // Breadth-first from the known layout so every new node has an anchored parent.
  const queue = added.slice();
  let guard = 0;
  while (queue.length > 0 && guard < 5000) {
    guard += 1;
    const id = queue.shift() as NodeId;
    if (out[id]) continue;
    const node = doc.nodes[id];
    if (!node) continue;

    const parentPos = node.parents
      .map((pid) => doc.layout[pid] ?? out[pid])
      .find((p): p is LayoutPoint => Boolean(p));

    if (!parentPos) {
      out[id] = { x: 0, y: 0 };
      continue;
    }

    // Stack new children vertically with a consistent rhythm.
    const siblings = Object.keys(out).filter((k) => {
      const n = doc.nodes[k];
      return n && n.parents.some((p) => node.parents.includes(p));
    });
    const offset = (siblings.length - (siblings.length % 2)) * (LAYOUT.rowHeight + LAYOUT.gapY);

    out[id] = {
      x: parentPos.x + LAYOUT.columnWidth,
      y: parentPos.y + offset,
    };
    void addedSet;
  }

  return out;
}

/** Bounding box of every node position, for fit-to-view. */
export function boundsOf(layout: Readonly<Record<NodeId, LayoutPoint>>): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} | null {
  const entries = Object.values(layout);
  if (entries.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of entries) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}
