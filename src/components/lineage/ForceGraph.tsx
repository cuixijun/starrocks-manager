'use client';

/**
 * ForceGraph — Canvas-rendered, d3-force-directed lineage graph.
 *
 * Features:
 *  - All table nodes shown directly with DB clustering
 *  - Degree-based node sizing
 *  - Database color coding
 *  - Canvas rendering for 1000+ node performance
 *  - Zoom / pan / drag
 *  - Hover tooltip, click to select
 *  - Highlight selected node + neighbors
 */

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { select } from 'd3-selection';
import { zoom as d3Zoom, zoomIdentity, type ZoomTransform } from 'd3-zoom';
import type { Simulation } from 'd3-force';
import type { GraphNode, GraphLink } from './graph-types';
import { getDbColor, getQueryNodeColor } from './graph-types';
import { createSimulation } from './graph-layout';

/* ── Props ────────────────────────────────────────────────── */

interface ForceGraphProps {
  nodes: GraphNode[];
  links: GraphLink[];
  selectedNodeId: string | null;
  onNodeClick: (node: GraphNode) => void;
  onBackgroundClick: () => void;
  nodeDepth: number | 'all';
  onDepthChange: (depth: number | 'all') => void;
}

/* ── Constants ────────────────────────────────────────────── */

const NODE_HIT_PADDING = 8;

/* ── Component ────────────────────────────────────────────── */

export default function ForceGraph({
  nodes,
  links,
  selectedNodeId,
  onNodeClick,
  onBackgroundClick,
  nodeDepth,
  onDepthChange,
}: ForceGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<Simulation<GraphNode, GraphLink> | null>(null);
  const transformRef = useRef<ZoomTransform>(zoomIdentity);
  const hoveredRef = useRef<GraphNode | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; node: GraphNode } | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const animFrameRef = useRef<number>(0);
  const nodesRef = useRef<GraphNode[]>([]);
  const linksRef = useRef<GraphLink[]>([]);
  const selectedRef = useRef<string | null>(null);
  const neighborIdsRef = useRef<Set<string>>(new Set());
  const needsRedrawRef = useRef(false);
  const isSimRunningRef = useRef(false);
  const canvasSizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const wasDraggingRef = useRef(false);
  const zoomBehaviorRef = useRef<ReturnType<typeof d3Zoom<HTMLCanvasElement, unknown>> | null>(null);
  const readyRef = useRef(false);  // 门控：防止多个 effect 各自触发首帧绘制

  // Keep refs in sync
  nodesRef.current = nodes;
  linksRef.current = links;
  selectedRef.current = selectedNodeId;

  // Compute neighbor IDs for selection highlight
  useEffect(() => {
    const ids = new Set<string>();
    if (selectedNodeId) {
      links.forEach(l => {
        const src = typeof l.source === 'object' ? (l.source as GraphNode).id : l.source;
        const tgt = typeof l.target === 'object' ? (l.target as GraphNode).id : l.target;
        if (src === selectedNodeId) ids.add(tgt as string);
        if (tgt === selectedNodeId) ids.add(src as string);
      });
    }
    neighborIdsRef.current = ids;
  }, [selectedNodeId, links]);

  // Resize observer — only fire once for initial dimensions, then on actual resize
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        setDimensions(prev => {
          // Skip if dimensions haven't actually changed (avoids re-triggering simulation)
          if (prev && prev.width === Math.round(width) && prev.height === Math.round(height)) return prev;
          return { width: Math.round(width), height: Math.round(height) };
        });
      }
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // isDark helper
  const isDark = useCallback(() => {
    return typeof document !== 'undefined' &&
      document.documentElement.getAttribute('data-theme') === 'dark';
  }, []);

  /* ── Canvas size sync (separate from draw for perf) ──── */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !dimensions) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = dimensions.width * dpr;
    canvas.height = dimensions.height * dpr;
    canvas.style.width = `${dimensions.width}px`;
    canvas.style.height = `${dimensions.height}px`;
    canvasSizeRef.current = { w: dimensions.width, h: dimensions.height, dpr };
  }, [dimensions]);

  /* ── Drawing ──────────────────────────────────────────── */

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { w: width, h: height, dpr } = canvasSizeRef.current;
    if (width === 0 || height === 0) return;

    // Reset transform & clear
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const t = transformRef.current;
    const dark = isDark();
    const currentNodes = nodesRef.current;
    const currentLinks = linksRef.current;
    const selected = selectedRef.current;
    const neighborIds = neighborIdsRef.current;
    const hovered = hoveredRef.current;

    // Background grid pattern
    const gridColor = dark ? 'rgba(51,65,85,0.3)' : 'rgba(226,232,240,0.6)';
    const gridSize = 30 * t.k;
    if (gridSize > 4) { // skip grid when very zoomed out
      const offsetX = t.x % gridSize;
      const offsetY = t.y % gridSize;
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (let x = offsetX; x < width; x += gridSize) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }
      for (let y = offsetY; y < height; y += gridSize) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      ctx.stroke();
    }

    // Apply zoom transform
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.scale(t.k, t.k);

    // Draw edges (thinner lines)
    currentLinks.forEach(link => {
      const src = link.source as GraphNode;
      const tgt = link.target as GraphNode;
      if (src.x === undefined || src.y === undefined || tgt.x === undefined || tgt.y === undefined) return;

      const isRelated = selected && (
        src.id === selected || tgt.id === selected ||
        neighborIds.has(src.id) || neighborIds.has(tgt.id)
      );
      const isFaded = selected && !isRelated;
      const isDirectlySelected = selected && (src.id === selected || tgt.id === selected);

      const srcColor = getDbColor(src.colorIdx, dark);
      ctx.globalAlpha = isFaded ? 0.05 : isDirectlySelected ? 0.7 : 0.45;
      ctx.strokeStyle = srcColor.border;
      ctx.lineWidth = isDirectlySelected ? 1.2 : 0.6;

      // Draw curved edge
      const dx = tgt.x - src.x;
      const dy = tgt.y - src.y;
      const cx = (src.x + tgt.x) / 2 + dy * 0.08;
      const cy = (src.y + tgt.y) / 2 - dx * 0.08;

      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.quadraticCurveTo(cx, cy, tgt.x, tgt.y);
      ctx.stroke();

      // Arrow head — larger and more visible
      const angle = Math.atan2(tgt.y - cy, tgt.x - cx);
      const arrowLen = isDirectlySelected ? 10 : 8;
      const arrowWidth = Math.PI / 5;
      // Position arrow tip at the edge of target rect
      const hw = tgt.nodeWidth / 2 + 2;
      const hh = tgt.nodeHeight / 2 + 2;
      // Approximate rect edge intersection
      const absC = Math.abs(Math.cos(angle));
      const absS = Math.abs(Math.sin(angle));
      const edgeDist = absC > 0.001 ? Math.min(hw / absC, hh / absS) : hh / absS;
      const ax = tgt.x - Math.cos(angle) * Math.min(edgeDist, Math.sqrt(hw * hw + hh * hh));
      const ay = tgt.y - Math.sin(angle) * Math.min(edgeDist, Math.sqrt(hw * hw + hh * hh));

      ctx.globalAlpha = isFaded ? 0.05 : isDirectlySelected ? 0.85 : 0.55;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax - arrowLen * Math.cos(angle - arrowWidth), ay - arrowLen * Math.sin(angle - arrowWidth));
      ctx.lineTo(ax - arrowLen * Math.cos(angle + arrowWidth), ay - arrowLen * Math.sin(angle + arrowWidth));
      ctx.closePath();
      ctx.fillStyle = srcColor.border;
      ctx.fill();

      ctx.globalAlpha = 1.0;
    });

    // Draw nodes — rectangles for TABLE/VIEW, diamonds for QUERY
    currentNodes.forEach(node => {
      if (node.x === undefined || node.y === undefined) return;

      const isSelected = node.id === selected;
      const isNeighbor = neighborIds.has(node.id);
      const isHovered = hovered?.id === node.id;
      const isFaded = selected && !isSelected && !isNeighbor;
      const isQuery = node.nodeType === 'QUERY';

      const color = isQuery ? getQueryNodeColor(dark) : getDbColor(node.colorIdx, dark);
      const hw = node.nodeWidth / 2;
      const hh = node.nodeHeight / 2;
      const scale = isHovered ? 1.06 : isSelected ? 1.08 : 1.0;
      const sW = hw * scale;
      const sH = hh * scale;

      ctx.globalAlpha = isFaded ? 0.12 : 1.0;

      if (isQuery) {
        // ── QUERY node: premium rounded pill ──
        const rx = sH; // fully rounded ends (pill shape)

        // Outer glow ring for selected/hovered
        if (isSelected || isHovered) {
          const gp = 4;
          ctx.beginPath();
          roundRect(ctx, node.x - sW - gp, node.y - sH - gp,
            (sW + gp) * 2, (sH + gp) * 2, rx + gp);
          ctx.fillStyle = `rgba(${hexToRgb(color.border)}, 0.15)`;
          ctx.fill();
        }

        // Pill background with gradient
        const grad = ctx.createLinearGradient(node.x - sW, node.y, node.x + sW, node.y);
        if (isSelected) {
          grad.addColorStop(0, dark ? '#B45309' : '#D97706');
          grad.addColorStop(1, dark ? '#92400E' : '#B45309');
        } else {
          grad.addColorStop(0, dark ? 'rgba(251,191,36,0.12)' : 'rgba(245,158,11,0.08)');
          grad.addColorStop(1, dark ? 'rgba(217,119,6,0.18)' : 'rgba(245,158,11,0.15)');
        }
        ctx.beginPath();
        roundRect(ctx, node.x - sW, node.y - sH, sW * 2, sH * 2, rx);
        ctx.fillStyle = grad;
        ctx.fill();

        // Pill border — dashed for non-selected, solid for selected
        ctx.strokeStyle = color.border;
        if (isSelected) {
          ctx.lineWidth = 2;
          ctx.setLineDash([]);
        } else {
          ctx.lineWidth = 1.2;
          ctx.setLineDash([3, 2]);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // ⚡ badge circle on left side
        const badgeR = 8;
        const badgeCx = node.x - sW + badgeR + 5;
        const badgeCy = node.y;

        // Badge circle fill
        ctx.beginPath();
        ctx.arc(badgeCx, badgeCy, badgeR, 0, Math.PI * 2);
        ctx.fillStyle = isSelected
          ? 'rgba(255,255,255,0.25)'
          : (dark ? 'rgba(251,191,36,0.25)' : 'rgba(245,158,11,0.18)');
        ctx.fill();
        ctx.strokeStyle = isSelected ? 'rgba(255,255,255,0.5)' : color.border;
        ctx.lineWidth = 0.8;
        ctx.stroke();

        // ⚡ icon inside badge
        ctx.font = `bold 9px Inter, system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = isSelected ? '#FFFFFFDD' : color.border;
        ctx.fillText('⚡', badgeCx, badgeCy);

        // Fingerprint text — centered in remaining space
        const fingerprint = node.tableName.replace(/^query_/, '').substring(0, 10);
        const textCx = badgeCx + badgeR + (sW - badgeR - 5) + 2; // center of remaining space recomputed
        const textAreaCx = (badgeCx + badgeR + 4 + node.x + sW - 4) / 2;

        ctx.font = `600 8px 'JetBrains Mono', monospace`;
        ctx.textAlign = 'center';
        ctx.fillStyle = isFaded
          ? (dark ? 'rgba(148,163,184,0.3)' : 'rgba(100,116,139,0.3)')
          : isSelected ? '#FFFFFFE6' : (dark ? '#FDE68A' : '#78350F');
        ctx.fillText(fingerprint, textAreaCx, node.y + 0.5);
      } else {
        // ── TABLE / VIEW node: rounded rectangle ──
        const rx = 5;

        // Outer glow for selected/hovered
        if (isSelected || isHovered) {
          const glowPad = 3;
          ctx.beginPath();
          roundRect(ctx, node.x - sW - glowPad, node.y - sH - glowPad,
            (sW + glowPad) * 2, (sH + glowPad) * 2, rx + 2);
          ctx.fillStyle = `rgba(${hexToRgb(color.border)}, 0.12)`;
          ctx.fill();
        }

        // Node rect background
        ctx.beginPath();
        roundRect(ctx, node.x - sW, node.y - sH, sW * 2, sH * 2, rx);
        ctx.fillStyle = isSelected ? color.border : color.bg;
        ctx.fill();
        ctx.strokeStyle = color.border;
        ctx.lineWidth = isSelected ? 2 : 1.2;
        ctx.stroke();

        // Left color accent bar
        ctx.beginPath();
        ctx.moveTo(node.x - sW + rx, node.y - sH);
        ctx.lineTo(node.x - sW, node.y - sH + rx);
        ctx.lineTo(node.x - sW, node.y + sH - rx);
        ctx.lineTo(node.x - sW + rx, node.y + sH);
        ctx.lineTo(node.x - sW + rx, node.y - sH);
        ctx.closePath();
        ctx.fillStyle = isSelected ? '#ffffff44' : color.border;
        ctx.globalAlpha = isFaded ? 0.08 : (isSelected ? 0.5 : 0.25);
        ctx.fill();
        ctx.globalAlpha = isFaded ? 0.12 : 1.0;

        // DB name text (small, colored, top row)
        const dbFontSize = Math.max(5, Math.min(7, 7));
        ctx.font = `600 ${dbFontSize}px Inter, system-ui`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = isSelected ? '#ffffffcc' : color.border;
        const textX = node.x - sW + rx + 5;
        ctx.fillText(truncate(node.dbName, 18), textX, node.y - 5);

        // Table name text (bold, primary, bottom row)
        const tableFontSize = Math.max(7, Math.min(9, 9));
        ctx.font = `700 ${tableFontSize}px 'JetBrains Mono', monospace`;
        ctx.fillStyle = isFaded
          ? (dark ? 'rgba(148,163,184,0.3)' : 'rgba(100,116,139,0.3)')
          : isSelected ? '#ffffffe6' : (dark ? '#E2E8F0' : '#1E293B');
        ctx.fillText(truncate(node.tableName, 20), textX, node.y + 6);
      }

      ctx.globalAlpha = 1.0;
    });

    ctx.restore();
  }, [dimensions, isDark]);

  /* ── Simulation ───────────────────────────────────────── */

  // Single rAF-based render loop that only runs when needed
  const scheduleRedraw = useCallback(() => {
    if (needsRedrawRef.current) return; // already scheduled
    needsRedrawRef.current = true;
    animFrameRef.current = requestAnimationFrame(() => {
      needsRedrawRef.current = false;
      draw();
    });
  }, [draw]);

  const [layoutBusy, setLayoutBusy] = useState(false);
  const layoutCancelRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!dimensions) return; // 等待真实尺寸
    if (nodes.length === 0) {
      if (simRef.current) simRef.current.stop();
      isSimRunningRef.current = false;
      setLayoutBusy(false);
      draw(); // clear canvas
      return;
    }

    // ── Cancel any in-progress async layout ──
    if (layoutCancelRef.current) { layoutCancelRef.current(); layoutCancelRef.current = null; }
    if (simRef.current) simRef.current.stop();
    cancelAnimationFrame(animFrameRef.current);
    needsRedrawRef.current = false;

    const sim = createSimulation(nodes, links, dimensions.width, dimensions.height);
    simRef.current = sim;

    // Detect if nodes already have positions (filter scenario vs fresh data)
    const alreadyPositioned = nodes.filter(n => n.x !== undefined && n.y !== undefined).length;
    const needsWarmup = alreadyPositioned < nodes.length * 0.8;

    sim.stop();

    // ── Helper: compute fit-to-view transform and sync to d3-zoom ──
    const applyFitToView = () => {
      const pad = 20;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      nodes.forEach(n => {
        if (n.x === undefined || n.y === undefined) return;
        const hw = n.nodeWidth / 2;
        const hh = n.nodeHeight / 2;
        if (n.x - hw < minX) minX = n.x - hw;
        if (n.y - hh < minY) minY = n.y - hh;
        if (n.x + hw > maxX) maxX = n.x + hw;
        if (n.y + hh > maxY) maxY = n.y + hh;
      });

      if (nodes.length > 0 && isFinite(minX)) {
        const bw = maxX - minX;
        const bh = maxY - minY;
        const scale = Math.min(
          (dimensions.width - pad * 2) / (bw || 1),
          (dimensions.height - pad * 2) / (bh || 1),
          3,
        );
        const tx = (dimensions.width - bw * scale) / 2 - minX * scale;
        const ty = (dimensions.height - bh * scale) / 2 - minY * scale;
        transformRef.current = zoomIdentity.translate(tx, ty).scale(scale);
      }
      // Sync to d3-zoom internal state so wheel pan continues from here
      const canvas = canvasRef.current;
      if (canvas && zoomBehaviorRef.current) {
        const sel = select(canvas);
        const zb = zoomBehaviorRef.current;
        const prevHandler = zb.on('zoom');
        zb.on('zoom', null);
        sel.call(zb.transform, transformRef.current);
        if (prevHandler) zb.on('zoom', prevHandler);
      }
    };

    // ── Layout execution ──
    if (!needsWarmup) {
      // ── 快速路径（过滤场景）：轻量布局，同步执行 ──
      nodes.forEach(n => { n.vx = 0; n.vy = 0; });
      sim.alpha(0.5);
      const lightTicks = Math.min(40, Math.max(20, nodes.length));
      for (let i = 0; i < lightTicks; i++) sim.tick();
      applyFitToView();
      readyRef.current = true;
      setLayoutBusy(false);
      draw();
    } else {
      // ── 异步分帧布局（首次加载/大图）：可取消，不阻塞主线程 ──
      setLayoutBusy(true);
      readyRef.current = false;
      sim.alpha(1);
      const totalTicks = Math.min(120, Math.max(60, nodes.length));
      let completed = 0;
      let cancelled = false;
      const TICKS_PER_FRAME = 15; // batch 15 ticks per rAF to balance speed/responsiveness

      const tickBatch = () => {
        if (cancelled) return;
        const end = Math.min(completed + TICKS_PER_FRAME, totalTicks);
        for (let i = completed; i < end; i++) sim.tick();
        completed = end;

        if (completed < totalTicks) {
          animFrameRef.current = requestAnimationFrame(tickBatch);
        } else {
          // Layout complete
          applyFitToView();
          readyRef.current = true;
          setLayoutBusy(false);
          draw();
        }
      };

      layoutCancelRef.current = () => { cancelled = true; setLayoutBusy(false); };
      animFrameRef.current = requestAnimationFrame(tickBatch);
    }

    // 注册 tick/end 仅用于后续拖动时的仿真
    sim.on('tick', () => { scheduleRedraw(); });
    sim.on('end', () => { isSimRunningRef.current = false; draw(); });
    isSimRunningRef.current = false;

    return () => {
      if (layoutCancelRef.current) { layoutCancelRef.current(); layoutCancelRef.current = null; }
      sim.stop();
      isSimRunningRef.current = false;
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [nodes, links, dimensions, draw, scheduleRedraw]);

  // Redraw on selection change (skip initial mount)
  useEffect(() => {
    if (!readyRef.current) return;
    draw();
  }, [selectedNodeId, draw]);

  // Theme change observer
  useEffect(() => {
    const observer = new MutationObserver(() => draw());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, [draw]);

  /* ── Zoom, Pan & Drag ──────────────────────────────────── */

  const dragStateRef = useRef<{ node: GraphNode; startX: number; startY: number } | null>(null);

  /* ── T-7 fix: shared hit-test helper (single source of truth) ──── */

  /** Hit-test in world (simulation) coordinates — O(n) linear scan */
  const hitTestWorld = useCallback((px: number, py: number): GraphNode | null => {
    const currentNodes = nodesRef.current;
    for (let i = currentNodes.length - 1; i >= 0; i--) {
      const n = currentNodes[i];
      if (n.x === undefined || n.y === undefined) continue;
      const hw = n.nodeWidth / 2 + NODE_HIT_PADDING;
      const hh = n.nodeHeight / 2 + NODE_HIT_PADDING;
      if (px >= n.x - hw && px <= n.x + hw && py >= n.y - hh && py <= n.y + hh) {
        return n;
      }
    }
    return null;
  }, []);

  /** Hit-test from client (screen) coordinates — converts to world, then delegates */
  const findNodeAt = useCallback((clientX: number, clientY: number): GraphNode | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const t = transformRef.current;
    const x = (clientX - rect.left - t.x) / t.k;
    const y = (clientY - rect.top - t.y) / t.k;
    return hitTestWorld(x, y);
  }, [hitTestWorld]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const sel = select(canvas);

    // Zoom behavior — filter out mousedowns on nodes (let drag handle those)
    const zoomBehavior = d3Zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.05, 5])
      .filter((event) => {
        // Allow wheel zoom always
        if (event.type === 'wheel') return true;
        // For mouse events, check if we're on a node
        if (event.type === 'mousedown') {
          const rect = canvas.getBoundingClientRect();
          const t = transformRef.current;
          const x = (event.clientX - rect.left - t.x) / t.k;
          const y = (event.clientY - rect.top - t.y) / t.k;
          if (hitTestWorld(x, y)) return false;
        }
        return true;
      })
      .on('zoom', (event) => {
        transformRef.current = event.transform;
        draw();
      });

    zoomBehaviorRef.current = zoomBehavior;
    sel.call(zoomBehavior);
    // Initial draw (zoom effect runs once on mount)
    draw();

    // Manual node drag via native mouse events
    const handleMouseDown = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const t = transformRef.current;
      const x = (e.clientX - rect.left - t.x) / t.k;
      const y = (e.clientY - rect.top - t.y) / t.k;
      const node = hitTestWorld(x, y);

      if (node) {
        // Only allow dragging highlighted nodes (selected + neighbors)
        // When nothing is selected, all nodes are draggable
        const sel = selectedRef.current;
        const isHighlighted = !sel || node.id === sel || neighborIdsRef.current.has(node.id);
        if (!isHighlighted) return; // faded nodes can't be dragged

        dragStateRef.current = { node, startX: e.clientX, startY: e.clientY };
        wasDraggingRef.current = false;
        node.fx = node.x;
        node.fy = node.y;
        // 低 alphaTarget 让邻居节点几乎不受力移动，避免抖动
        if (simRef.current) simRef.current.alphaTarget(0.05).restart();
        e.stopPropagation();
        canvas.style.cursor = 'grabbing';
      }
    };

    const handleMouseMoveGlobal = (e: MouseEvent) => {
      const ds = dragStateRef.current;
      if (!ds) return;
      // Mark as drag if moved more than 5px from start
      const dx = e.clientX - ds.startX;
      const dy = e.clientY - ds.startY;
      if (dx * dx + dy * dy > 25) wasDraggingRef.current = true;
      const rect = canvas.getBoundingClientRect();
      const t = transformRef.current;
      ds.node.fx = (e.clientX - rect.left - t.x) / t.k;
      ds.node.fy = (e.clientY - rect.top - t.y) / t.k;
      scheduleRedraw();
    };

    const handleMouseUpGlobal = () => {
      const ds = dragStateRef.current;
      if (!ds) return;
      // 保留拖动后的位置，不让节点弹回
      // fx/fy 保持当前值，节点钉住在新位置
      if (simRef.current) simRef.current.alphaTarget(0);
      dragStateRef.current = null;
      canvas.style.cursor = 'grab';
    };

    canvas.addEventListener('mousedown', handleMouseDown, true);
    window.addEventListener('mousemove', handleMouseMoveGlobal);
    window.addEventListener('mouseup', handleMouseUpGlobal);

    return () => {
      sel.on('.zoom', null);
      canvas.removeEventListener('mousedown', handleMouseDown, true);
      window.removeEventListener('mousemove', handleMouseMoveGlobal);
      window.removeEventListener('mouseup', handleMouseUpGlobal);
    };
  }, [draw, hitTestWorld]);

  /* ── Mouse events ─────────────────────────────────────── */

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragStateRef.current) return; // Don't update tooltip while dragging
    const node = findNodeAt(e.clientX, e.clientY);
    const prevHovered = hoveredRef.current;
    hoveredRef.current = node;
    const canvas = canvasRef.current;
    if (canvas && !dragStateRef.current) canvas.style.cursor = node ? 'pointer' : 'grab';

    if (node) {
      const rect = canvasRef.current!.getBoundingClientRect();
      setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, node });
    } else {
      setTooltip(null);
    }
    // Only redraw if hovered node actually changed (avoids 60fps full redraws)
    if (prevHovered?.id !== node?.id) {
      scheduleRedraw();
    }
  }, [findNodeAt, scheduleRedraw]);

  /* ── Smooth center-on-node animation ────────────────────── */

  const centerOnNode = useCallback((node: GraphNode) => {
    const canvas = canvasRef.current;
    const zoom = zoomBehaviorRef.current;
    if (!canvas || !zoom || node.x === undefined || node.y === undefined) return;

    const { w, h } = canvasSizeRef.current;
    const curT = transformRef.current;
    // Target: keep current scale, center node in visible area
    // Right panel is 320px wide, so the visible center is shifted left
    const PANEL_WIDTH = 320;
    const targetK = Math.max(curT.k, 0.8); // ensure readable zoom
    const targetX = (w - PANEL_WIDTH) / 2 - node.x * targetK;
    const targetY = h / 2 - node.y * targetK;

    // Animate with requestAnimationFrame lerp (~300ms)
    const startT = { x: curT.x, y: curT.y, k: curT.k };
    const duration = 300;
    let startTime: number | null = null;

    const easeInOutCubic = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    const animate = (now: number) => {
      if (!startTime) startTime = now;
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = easeInOutCubic(progress);

      const k = startT.k + (targetK - startT.k) * ease;
      const x = startT.x + (targetX - startT.x) * ease;
      const y = startT.y + (targetY - startT.y) * ease;

      const newTransform = zoomIdentity.translate(x, y).scale(k);
      transformRef.current = newTransform;
      // Sync d3-zoom internal state
      const sel = select(canvas);
      zoom.on('zoom', null); // temporarily disable to prevent feedback
      sel.call(zoom.transform, newTransform);
      zoom.on('zoom', (event) => {
        transformRef.current = event.transform;
        draw();
      }); // restore
      draw();

      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [draw]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    // Suppress click if we just finished dragging
    if (wasDraggingRef.current) {
      wasDraggingRef.current = false;
      return;
    }
    const node = findNodeAt(e.clientX, e.clientY);
    if (node) {
      onNodeClick(node);
      centerOnNode(node);
    } else {
      onBackgroundClick();
    }
  }, [findNodeAt, onNodeClick, onBackgroundClick, centerOnNode]);

  const handleMouseLeave = useCallback(() => {
    hoveredRef.current = null;
    setTooltip(null);
    draw();
  }, [draw]);

  /* ── Tooltip render ───────────────────────────────────── */

  const dark = isDark();

  return (
    <div ref={wrapRef} className="ln-canvas-wrap">
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onClick={handleClick}
        onMouseLeave={handleMouseLeave}
        style={{ display: 'block', width: '100%', height: '100%' }}
      />

      {/* Tooltip */}
      {tooltip && (
        <div
          className="ln-tooltip"
          style={{
            left: tooltip.x + 12,
            top: tooltip.y - 10,
          }}
        >
          <div className="ln-tooltip-header">
            <span
              className="ln-tooltip-dot"
              style={{ background: tooltip.node.nodeType === 'QUERY'
                ? getQueryNodeColor(dark).dot
                : getDbColor(tooltip.node.colorIdx, dark).dot }}
            />
            <span className="ln-tooltip-db">
              {tooltip.node.nodeType === 'QUERY' ? '⚡ 查询' : tooltip.node.dbName}
            </span>
          </div>
          <div className="ln-tooltip-table">
            {tooltip.node.nodeType === 'QUERY'
              ? tooltip.node.tableName.replace(/^query_/, '').substring(0, 20)
              : tooltip.node.tableName}
          </div>
          <div className="ln-tooltip-meta">
            {tooltip.node.nodeType === 'QUERY'
              ? `关联表: ${tooltip.node.degree}`
              : `度数: ${tooltip.node.degree}`}
          </div>
        </div>
      )}

      {/* Loading overlay during async layout */}
      {layoutBusy && nodes.length > 0 && (
        <div className="ln-layout-overlay">
          <div className="spinner" />
          <span>布局计算中...</span>
        </div>
      )}

      {/* Empty state */}
      {nodes.length === 0 && (
        <div className="ln-empty-overlay">
          <div className="empty-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
            <div className="empty-state-text">暂无血缘数据，请点击「同步血缘」采集</div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Utility ──────────────────────────────────────────────── */

function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `${r},${g},${b}`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen - 1) + '…' : text;
}
