/**
 * Graph integrity, repair and queries.
 *
 * Nodes and edges are stored as keyed records, so duplicate ids are structurally impossible
 * in a document that was built in memory — but they are entirely possible in an imported or
 * hand-edited file. `validateGraph` is the gate that keeps malformed data out of the store,
 * and `repairGraph` reconstructs derived relationships (children/parents) from the edge list,
 * which is the single source of truth for connectivity.
 */
import type { BranchId, NodeId, SimEdge, SimNode, SimulationDoc } from './types';
import { edgeList, nodeList } from './types';

export interface GraphReport {
  errors: string[];
  warnings: string[];
}

export const MAX_NODES = 5000;
export const MAX_EDGES = 20000;

/**
 * Structural validation. `errors` means the document must not be loaded; `warnings` means it
 * is usable but something is degraded.
 */
export function validateGraph(doc: SimulationDoc): GraphReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  const nodes = Object.values(doc.nodes);
  const edges = Object.values(doc.edges);

  if (nodes.length > MAX_NODES) {
    errors.push(`Document has ${nodes.length} nodes, which exceeds the limit of ${MAX_NODES}.`);
  }
  if (edges.length > MAX_EDGES) {
    errors.push(`Document has ${edges.length} edges, which exceeds the limit of ${MAX_EDGES}.`);
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const branchIds = new Set(Object.keys(doc.branches));

  const starts = nodes.filter((n) => n.type === 'start');
  if (starts.length === 0) errors.push('Document has no starting node.');
  if (starts.length > 1)
    errors.push(`Document has ${starts.length} starting nodes; exactly one is expected.`);

  for (const edge of edges) {
    if (!nodeIds.has(edge.from))
      errors.push(`Edge "${edge.id}" references missing source node "${edge.from}".`);
    if (!nodeIds.has(edge.to))
      errors.push(`Edge "${edge.id}" references missing target node "${edge.to}".`);
  }

  for (const node of nodes) {
    if (!branchIds.has(node.branch)) {
      errors.push(`Node "${node.id}" belongs to missing branch "${node.branch}".`);
    }
    for (const parent of node.parents) {
      if (!nodeIds.has(parent)) {
        errors.push(`Node "${node.id}" lists missing parent "${parent}".`);
      }
    }
    for (const child of node.children) {
      if (!nodeIds.has(child)) {
        errors.push(`Node "${node.id}" lists missing child "${child}".`);
      }
    }
  }

  // Connectivity: derived from the edge list, which is the source of truth.
  if (errors.length === 0) {
    const adjacency = new Map<NodeId, NodeId[]>();
    for (const edge of edges) {
      const list = adjacency.get(edge.from) ?? [];
      list.push(edge.to);
      adjacency.set(edge.from, list);
    }
    const startId = starts[0]?.id;
    if (startId) {
      const seen = new Set<NodeId>();
      const stack: NodeId[] = [startId];
      while (stack.length > 0) {
        const id = stack.pop() as NodeId;
        if (seen.has(id)) continue;
        seen.add(id);
        for (const next of adjacency.get(id) ?? []) {
          if (!seen.has(next)) stack.push(next);
        }
      }
      const unreachable = nodes.filter((n) => !seen.has(n.id));
      if (unreachable.length > 0) {
        warnings.push(
          `${unreachable.length} node${unreachable.length === 1 ? ' is' : 's are'} not reachable from the start node and will not be shown.`
        );
      }
    }
  }

  // Layout coverage.
  const missingLayout = nodes.filter((n) => !doc.layout[n.id]);
  if (missingLayout.length > 0) {
    warnings.push(
      `${missingLayout.length} node${missingLayout.length === 1 ? ' has' : 's have'} no saved position.`
    );
  }

  for (const branch of Object.values(doc.branches)) {
    if (!doc.nodes[branch.root]) {
      warnings.push(`Branch "${branch.id}" points at a missing root node.`);
    }
  }

  return { errors, warnings };
}

/**
 * Rebuilds derived structure from the edge list and drops anything dangling.
 *
 * This is what makes importing a hand-edited file safe: rather than trusting the embedded
 * parent/child arrays, they are recomputed. Nodes with no path from a start node are removed.
 */
export function repairGraph(doc: SimulationDoc): { doc: SimulationDoc; fixed: string[] } {
  const fixed: string[] = [];
  const nodeIds = new Set(Object.keys(doc.nodes));

  // 1. Drop edges with missing endpoints.
  const edges: Record<string, SimEdge> = {};
  for (const edge of Object.values(doc.edges)) {
    if (nodeIds.has(edge.from) && nodeIds.has(edge.to)) edges[edge.id] = edge;
    else fixed.push(`Removed edge "${edge.id}" (dangling reference).`);
  }

  // 2. Rebuild parents/children from the surviving edges.
  const nodes: Record<string, SimNode> = {};
  for (const node of Object.values(doc.nodes)) {
    nodes[node.id] = { ...node, parents: [], children: [] };
  }
  for (const edge of Object.values(edges)) {
    const from = nodes[edge.from];
    const to = nodes[edge.to];
    if (!from || !to) continue;
    if (!from.children.includes(edge.to)) from.children.push(edge.to);
    if (!to.parents.includes(edge.from)) to.parents.push(edge.from);
  }
  if (Object.keys(edges).length !== Object.keys(doc.edges).length) {
    // already noted above
  }

  // 3. Remove nodes not reachable from a start node, and any that became orphaned.
  const startId = Object.values(nodes).find((n) => n.type === 'start')?.id;
  if (startId) {
    const seen = new Set<NodeId>();
    const stack: NodeId[] = [startId];
    while (stack.length > 0) {
      const id = stack.pop() as NodeId;
      if (seen.has(id) || !nodes[id]) continue;
      seen.add(id);
      for (const child of nodes[id]?.children ?? []) stack.push(child);
    }
    for (const id of Object.keys(nodes)) {
      if (!seen.has(id)) {
        delete nodes[id];
        fixed.push(`Removed unreachable node "${id}".`);
      }
    }
    // Rebuild edges to only touch surviving nodes.
    const pruned: Record<string, SimEdge> = {};
    for (const edge of Object.values(edges)) {
      if (nodes[edge.from] && nodes[edge.to]) pruned[edge.id] = edge;
    }
    Object.assign(edges, pruned);
    for (const id of Object.keys(edges)) {
      const edge = edges[id];
      if (!edge || !nodes[edge.from] || !nodes[edge.to]) delete edges[id];
    }
  }

  // 4. Prune branches with no surviving nodes.
  const branches: Record<BranchId, (typeof doc.branches)[string]> = {};
  for (const [id, branch] of Object.entries(doc.branches)) {
    const stillPresent = Object.values(nodes).some((n) => n.branch === id);
    if (stillPresent) {
      branches[id] = nodes[branch.root] ? branch : { ...branch, root: startId ?? branch.root };
    } else {
      fixed.push(`Removed empty branch "${id}".`);
    }
  }

  // 5. Prune layout entries for removed nodes.
  const layout: typeof doc.layout = {};
  for (const [id, point] of Object.entries(doc.layout)) {
    if (nodes[id]) layout[id] = point;
  }

  const collapsed = doc.collapsed.filter((id) => branches[id] !== undefined);

  return {
    doc: { ...doc, nodes, edges, branches, layout, collapsed },
    fixed,
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Nodes whose branch is not collapsed. */
export function visibleNodes(doc: SimulationDoc): SimNode[] {
  const collapsed = new Set(doc.collapsed);
  return nodeList(doc).filter((n) => !collapsed.has(n.branch));
}

export function ancestorsOf(doc: SimulationDoc, nodeId: NodeId): NodeId[] {
  const out: NodeId[] = [];
  const seen = new Set<NodeId>();
  const stack: NodeId[] = [nodeId];
  while (stack.length > 0) {
    const id = stack.pop() as NodeId;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = doc.nodes[id];
    if (!node) continue;
    for (const parent of node.parents) {
      if (!seen.has(parent)) {
        out.push(parent);
        stack.push(parent);
      }
    }
  }
  return out;
}

export function descendantsOf(doc: SimulationDoc, nodeId: NodeId): NodeId[] {
  const out: NodeId[] = [];
  const seen = new Set<NodeId>([nodeId]);
  const stack: NodeId[] = [nodeId];
  while (stack.length > 0) {
    const id = stack.pop() as NodeId;
    const node = doc.nodes[id];
    if (!node) continue;
    out.push(id);
    for (const child of node.children) {
      if (seen.has(child)) continue;
      seen.add(child);
      stack.push(child);
    }
  }
  return out;
}

export interface SearchHit {
  id: NodeId;
  field: 'title' | 'summary' | 'assumption' | 'uncertainty';
  text: string;
}

/** Case-insensitive search across node text, returning the field that matched. */
export function searchNodes(doc: SimulationDoc, query: string, limit = 60): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const hits: SearchHit[] = [];

  for (const node of nodeList(doc)) {
    if (node.title.toLowerCase().includes(q)) {
      hits.push({ id: node.id, field: 'title', text: node.title });
    } else if (node.summary.toLowerCase().includes(q)) {
      hits.push({ id: node.id, field: 'summary', text: node.summary });
    } else {
      const assumption = node.assumptions.find((a) => a.toLowerCase().includes(q));
      if (assumption) {
        hits.push({ id: node.id, field: 'assumption', text: assumption });
      } else {
        const uncertainty = node.uncertainties.find((a) => a.toLowerCase().includes(q));
        if (uncertainty) hits.push({ id: node.id, field: 'uncertainty', text: uncertainty });
      }
    }
    if (hits.length >= limit) break;
  }
  return hits;
}

/** Edges leaving a node, used by the "why this path?" explanation. */
export function outgoingEdges(doc: SimulationDoc, nodeId: NodeId): SimEdge[] {
  return edgeList(doc).filter((e) => e.from === nodeId);
}
