/**
 * The graph stage: canvas host, pointer/keyboard interaction, zoom controls
 * and the minimap.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Store } from '../state/store';
import { useAppState } from '../state/store';
import { GraphRenderer, type Camera } from '../graph/GraphRenderer';
import { boundsOf } from '../../core/layout';
import { visibleNodes } from '../../core/graph';
import { exportCanvasAsPng } from '../utils/exportCanvas';
import { GraphKey } from './GraphKey';
import { OrientationCard } from './OrientationCard';

export function Stage({ store }: { store: Store }) {
  const state = useAppState(store);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const miniRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<GraphRenderer | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [pointerMode, setPointerMode] = useState<'idle' | 'pan' | 'drag'>('idle');
  const dragRef = useRef<{
    id: string | null;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    moved: boolean;
    snapshotDoc: typeof state.doc;
  } | null>(null);
  const panRef = useRef<{
    sx: number;
    sy: number;
    camX: number;
    camY: number;
    moved: boolean;
  } | null>(null);

  /* -------- create renderer -------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;
    let renderer: GraphRenderer;
    try {
      renderer = new GraphRenderer(canvas);
    } catch (err) {
      store.setStatus((err as Error).message);
      return;
    }
    rendererRef.current = renderer;

    const ro = new ResizeObserver(() => {
      const rect = host.getBoundingClientRect();
      renderer.resize(rect.width, rect.height);
      drawMini();
    });
    ro.observe(host);
    const rect = host.getBoundingClientRect();
    renderer.resize(rect.width, rect.height);

    return () => {
      ro.disconnect();
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [store]);

  /* -------- feed document + options -------- */
  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.camera = state.camera;
    r.setDocument(state.doc);
    r.updateOptions({
      selection: new Set(state.selected ? [state.selected] : []),
      path: new Set(state.path),
      hover,
      query: state.query,
      reducedMotion: state.settings.reducedMotion,
      showSpread: state.settings.showSpread,
      showGrid: state.settings.showGrid,
      compareNodeId: state.compare?.b.nodeId ?? null,
    });
    if (store.recentlyAdded.length > 0) {
      r.markGrowth(store.recentlyAdded);
      store.recentlyAdded = [];
    }
    drawMini();
  }, [state, hover, store]);

  /* -------- initial fit -------- */
  const didFit = useRef(false);
  useEffect(() => {
    if (didFit.current) return;
    const r = rendererRef.current;
    if (!r || r.views.size === 0) return;
    const fit = r.fitCamera();
    if (fit) {
      didFit.current = true;
      store.setCamera(fit);
    }
  }, [state.doc, store]);

  /* -------- wheel zoom -------- */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const r = rendererRef.current;
      if (!r) return;
      if (e.shiftKey) {
        store.setCamera({ x: state.camera.x + (e.deltaY + e.deltaX) / state.camera.scale });
        return;
      }
      const factor = Math.exp(-e.deltaY * 0.0016);
      const nextScale = Math.min(2.4, Math.max(0.1, state.camera.scale * factor));
      // zoom about the cursor: keep the world point under the pointer fixed
      const rect = host.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const [wx, wy] = r.toWorld(sx, sy);
      const cam: Camera = {
        scale: nextScale,
        x: wx - (sx - rect.width / 2) / nextScale,
        y: wy - (sy - rect.height / 2) / nextScale,
      };
      store.setCamera(cam);
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, [store, state.camera]);

  /* -------- pointer -------- */
  const onPointerDown = (e: React.PointerEvent): void => {
    const r = rendererRef.current;
    const host = hostRef.current;
    if (!r || !host) return;
    const rect = host.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (e.button === 1 || e.button === 2 || e.altKey) {
      panRef.current = { sx, sy, camX: state.camera.x, camY: state.camera.y, moved: false };
      setPointerMode('pan');
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;

    const hit = r.nodeAt(sx, sy);
    if (hit) {
      store.select(hit);
      const point = state.doc.layout[hit];
      dragRef.current = {
        id: hit,
        startX: sx,
        startY: sy,
        origX: point?.x ?? 0,
        origY: point?.y ?? 0,
        moved: false,
        snapshotDoc: state.doc,
      };
      setPointerMode('drag');
    } else {
      panRef.current = { sx, sy, camX: state.camera.x, camY: state.camera.y, moved: false };
      setPointerMode('pan');
      store.selectEdge(null);
    }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent): void => {
    const r = rendererRef.current;
    const host = hostRef.current;
    if (!r || !host) return;
    const rect = host.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (panRef.current) {
      const p = panRef.current;
      const dx = (sx - p.sx) / state.camera.scale;
      const dy = (sy - p.sy) / state.camera.scale;
      if (Math.abs(sx - p.sx) + Math.abs(sy - p.sy) > 2) p.moved = true;
      store.setCamera({ x: p.camX - dx, y: p.camY - dy });
      return;
    }

    if (dragRef.current) {
      const d = dragRef.current;
      const dx = (sx - d.startX) / state.camera.scale;
      const dy = (sy - d.startY) / state.camera.scale;
      if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true;
      if (!d.id || !d.moved) return;
      const doc = { ...d.snapshotDoc };
      doc.layout = {
        ...doc.layout,
        [d.id]: { x: Math.round(d.origX + dx), y: Math.round(d.origY + dy) },
      };
      store.transientDoc(doc);
      return;
    }

    const hit = r.nodeAt(sx, sy);
    if (hit !== hover) setHover(hit);
  };

  const endPointer = (e: React.PointerEvent): void => {
    const host = hostRef.current;
    if (host?.hasPointerCapture?.(e.pointerId)) host.releasePointerCapture(e.pointerId);
    if (panRef.current) {
      const moved = panRef.current.moved;
      panRef.current = null;
      setPointerMode('idle');
      if (!moved) store.select(null);
      store.saveCamera();
      return;
    }
    const d = dragRef.current;
    dragRef.current = null;
    setPointerMode('idle');
    if (d?.id && d.moved) {
      store.commitTransient(`Move “${d.snapshotDoc.nodes[d.id]?.title ?? d.id}”`, d.snapshotDoc);
    }
  };

  const onDoubleClick = (e: React.MouseEvent): void => {
    const r = rendererRef.current;
    const host = hostRef.current;
    if (!r || !host) return;
    const rect = host.getBoundingClientRect();
    const hit = r.nodeAt(e.clientX - rect.left, e.clientY - rect.top);
    if (hit) store.expandNode(hit);
  };

  /* -------- zoom controls -------- */
  const zoomBy = useCallback(
    (factor: number) => {
      const c = store.getState().camera;
      store.setCamera({ scale: Math.min(2.4, Math.max(0.1, c.scale * factor)) });
    },
    [store]
  );

  const fit = useCallback(() => {
    const r = rendererRef.current;
    if (!r) return;
    const cam = r.fitCamera();
    if (cam) store.setCamera(cam);
  }, [store]);

  useEffect(() => {
    window.addEventListener('whatifs:fit-stage', fit);
    return () => window.removeEventListener('whatifs:fit-stage', fit);
  }, [fit]);

  const focusSelected = useCallback(() => {
    const s = store.getState();
    const id = s.selected;
    const point = id ? s.doc.layout[id] : undefined;
    if (point) store.setCamera({ x: point.x, y: point.y, scale: Math.max(s.camera.scale, 0.8) });
  }, [store]);

  /* -------- minimap -------- */
  const drawMini = useCallback(() => {
    const mini = miniRef.current;
    const r = rendererRef.current;
    const doc = store.getState().doc;
    if (!mini || !r) return;
    const ctx = mini.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = mini.clientWidth || 188;
    const h = mini.clientHeight || 130;
    mini.width = Math.floor(w * dpr);
    mini.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const b = boundsOf(doc.layout);
    if (!b) return;
    const pad = 24;
    const spanX = Math.max(1, b.maxX - b.minX);
    const spanY = Math.max(1, b.maxY - b.minY);
    const k = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY);
    const ox = (w - spanX * k) / 2 - b.minX * k;
    const oy = (h - spanY * k) / 2 - b.minY * k;

    // edges
    ctx.strokeStyle = 'rgba(43, 55, 96, 0.7)';
    ctx.lineWidth = 0.7;
    for (const e of Object.values(doc.edges)) {
      const a = doc.layout[e.from];
      const c = doc.layout[e.to];
      if (!a || !c) continue;
      ctx.beginPath();
      ctx.moveTo(a.x * k + ox, a.y * k + oy);
      ctx.lineTo(c.x * k + ox, c.y * k + oy);
      ctx.stroke();
    }

    // nodes
    const visible = new Set(visibleNodes(doc).map((n) => n.id));
    const sel = store.getState().selected;
    for (const n of Object.values(doc.nodes)) {
      const p = doc.layout[n.id];
      if (!p) continue;
      const shown = visible.has(n.id);
      ctx.fillStyle =
        n.id === sel ? '#4fd8ff' : shown ? 'rgba(154, 166, 196, 0.72)' : 'rgba(98, 112, 154, 0.26)';
      const size = n.id === sel ? 5 : 3.2;
      ctx.fillRect(p.x * k + ox - size / 2, p.y * k + oy - size / 2, size, size);
    }

    // viewport rectangle
    const cam = store.getState().camera;
    const worldLeft = cam.x - rContentW(r) / 2 / cam.scale;
    const worldTop = cam.y - rContentH(r) / 2 / cam.scale;
    ctx.strokeStyle = 'rgba(79, 216, 255, 0.8)';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      worldLeft * k + ox,
      worldTop * k + oy,
      (rContentW(r) / cam.scale) * k,
      (rContentH(r) / cam.scale) * k
    );
  }, [store]);

  useEffect(() => {
    const id = window.setInterval(drawMini, 260);
    return () => window.clearInterval(id);
  }, [drawMini]);

  const onMiniPointer = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const mini = miniRef.current;
    const doc = store.getState().doc;
    if (!mini) return;
    const b = boundsOf(doc.layout);
    if (!b) return;
    const rect = mini.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const pad = 24;
    const spanX = Math.max(1, b.maxX - b.minX);
    const spanY = Math.max(1, b.maxY - b.minY);
    const k = Math.min((rect.width - pad * 2) / spanX, (rect.height - pad * 2) / spanY);
    const ox = (rect.width - spanX * k) / 2 - b.minX * k;
    const oy = (rect.height - spanY * k) / 2 - b.minY * k;
    store.setCamera({ x: (mx - ox) / k, y: (my - oy) / k });
  };

  const matchCount =
    state.query.trim().length >= 2
      ? visibleNodes(state.doc).filter(
          (n) =>
            n.title.toLowerCase().includes(state.query.trim().toLowerCase()) ||
            n.summary.toLowerCase().includes(state.query.trim().toLowerCase())
        ).length
      : 0;

  return (
    <div className="stage">
      <div
        ref={hostRef}
        className={`canvas-host ${pointerMode === 'drag' ? 'dragging' : ''} ${pointerMode === 'pan' ? 'panning' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        <canvas ref={canvasRef} />
      </div>

      <div className="stage-overlay">
        <div className="stage-top-left">
          <div className="zoom-pill">
            <button className="btn" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out">
              −
            </button>
            <span className="zoom-level">{Math.round(state.camera.scale * 100)}%</span>
            <button className="btn" onClick={() => zoomBy(1.25)} aria-label="Zoom in">
              +
            </button>
            <button className="btn" onClick={fit} aria-label="Fit to view">
              Fit
            </button>
            <button className="btn" onClick={focusSelected} aria-label="Center selection">
              ◎
            </button>
            <button
              className="btn"
              onClick={() => {
                const c = canvasRef.current;
                if (c) {
                  try {
                    exportCanvasAsPng(c, state.doc.title + '.png');
                    store.toast('Graph exported as PNG', 'success');
                  } catch {
                    store.toast('Failed to export PNG', 'error');
                  }
                }
              }}
              aria-label="Export graph as PNG"
              title="Export graph as PNG"
            >
              📸 PNG
            </button>
          </div>
          {matchCount > 0 && (
            <span className="chip chip-cyan" style={{ marginTop: 6 }}>
              {matchCount} match{matchCount === 1 ? '' : 'es'}
            </span>
          )}
        </div>

        <GraphKey store={store} />
        <OrientationCard />
      </div>

      {state.settings.showMinimap && (
        <div className="minimap">
          <canvas
            ref={miniRef}
            onPointerDown={onMiniPointer}
            onPointerMove={(e) => {
              if (e.buttons === 1) onMiniPointer(e);
            }}
          />
        </div>
      )}
    </div>
  );
}

function rContentW(r: GraphRenderer): number {
  return r.width;
}
function rContentH(r: GraphRenderer): number {
  return r.height;
}
