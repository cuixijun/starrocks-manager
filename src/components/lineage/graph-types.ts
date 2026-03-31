/**
 * Data models for the force-directed lineage graph.
 */

import type { SimulationNodeDatum, SimulationLinkDatum } from 'd3-force';

/* ── Raw API types ────────────────────────────────────────── */

export interface RawLineageNode {
  id: number;
  cluster_id: number;
  catalog_name: string;
  db_name: string;
  table_name: string;
  node_type: string;
}

export interface RawLineageEdge {
  id: number;
  source_node_id: number;
  target_node_id: number;
  relation_type: string;
  digest: string;
  sample_sql: string;
  exec_count: number;
  last_exec_time: string;
  users: string;
}

export interface RawLineageGraph {
  nodes: RawLineageNode[];
  edges: RawLineageEdge[];
}

/* ── Force graph types ────────────────────────────────────── */

export interface GraphNode extends SimulationNodeDatum {
  id: string;          // stringified node id
  nodeId: number;      // original numeric id
  dbName: string;
  tableName: string;
  label: string;       // "db.table"
  colorIdx: number;    // index into color palette
  degree: number;      // in-degree + out-degree
  radius: number;      // collide radius for d3-force
  nodeWidth: number;   // rendered rect width
  nodeHeight: number;  // rendered rect height
  nodeType: 'TABLE' | 'VIEW' | 'QUERY';  // node category
  // d3 will add x, y, vx, vy
}

export interface GraphLink extends SimulationLinkDatum<GraphNode> {
  edgeId: number;
  relationType: string;
  execCount: number;
  lastExecTime: string;
  sampleSql: string;
  weight: number;      // normalized edge weight for rendering
}

/* ── Color palette (consistent with existing DB_PALETTE) ── */

export interface DbColor {
  dot: string;
  fill: string;
  fillDark: string;
  border: string;
  borderDark: string;
  text: string;
  textDark: string;
  bg: string;
  bgDark: string;
}

export const DB_COLORS: DbColor[] = [
  { dot: '#3B82F6', fill: 'rgba(59,130,246,0.12)',  fillDark: 'rgba(96,165,250,0.15)',  border: '#3B82F6', borderDark: '#60A5FA', text: '#1E40AF', textDark: '#93C5FD', bg: '#EFF6FF', bgDark: '#1E3A5F' },
  { dot: '#8B5CF6', fill: 'rgba(139,92,246,0.12)',  fillDark: 'rgba(167,139,250,0.15)', border: '#8B5CF6', borderDark: '#A78BFA', text: '#5B21B6', textDark: '#C4B5FD', bg: '#F5F3FF', bgDark: '#2E1065' },
  { dot: '#16A34A', fill: 'rgba(22,163,74,0.12)',   fillDark: 'rgba(74,222,128,0.15)',  border: '#16A34A', borderDark: '#4ADE80', text: '#166534', textDark: '#86EFAC', bg: '#F0FDF4', bgDark: '#14532D' },
  { dot: '#CA8A04', fill: 'rgba(202,138,4,0.12)',   fillDark: 'rgba(250,204,21,0.15)',  border: '#CA8A04', borderDark: '#FACC15', text: '#854D0E', textDark: '#FDE68A', bg: '#FEFCE8', bgDark: '#422006' },
  { dot: '#DC2626', fill: 'rgba(220,38,38,0.12)',   fillDark: 'rgba(248,113,113,0.15)', border: '#DC2626', borderDark: '#F87171', text: '#991B1B', textDark: '#FCA5A5', bg: '#FEF2F2', bgDark: '#7F1D1D' },
  { dot: '#0D9488', fill: 'rgba(13,148,136,0.12)',  fillDark: 'rgba(45,212,191,0.15)',  border: '#0D9488', borderDark: '#2DD4BF', text: '#115E59', textDark: '#5EEAD4', bg: '#F0FDFA', bgDark: '#134E4A' },
  { dot: '#EA580C', fill: 'rgba(234,88,12,0.12)',   fillDark: 'rgba(251,146,60,0.15)',  border: '#EA580C', borderDark: '#FB923C', text: '#9A3412', textDark: '#FDBA74', bg: '#FFF7ED', bgDark: '#431407' },
  { dot: '#0284C7', fill: 'rgba(2,132,199,0.12)',   fillDark: 'rgba(56,189,248,0.15)',  border: '#0284C7', borderDark: '#38BDF8', text: '#0C4A6E', textDark: '#7DD3FC', bg: '#F0F9FF', bgDark: '#0C4A6E' },
  { dot: '#DB2777', fill: 'rgba(219,39,119,0.12)',  fillDark: 'rgba(244,114,182,0.15)', border: '#DB2777', borderDark: '#F472B6', text: '#9D174D', textDark: '#FBCFE8', bg: '#FDF2F8', bgDark: '#831843' },
  { dot: '#4F46E5', fill: 'rgba(79,70,229,0.12)',   fillDark: 'rgba(129,140,248,0.15)', border: '#4F46E5', borderDark: '#818CF8', text: '#3730A3', textDark: '#A5B4FC', bg: '#EEF2FF', bgDark: '#312E81' },
];

export function getDbColor(idx: number, isDark: boolean): { fill: string; border: string; text: string; bg: string; dot: string } {
  const c = DB_COLORS[idx % DB_COLORS.length];
  return {
    fill: isDark ? c.fillDark : c.fill,
    border: isDark ? c.borderDark : c.border,
    text: isDark ? c.textDark : c.text,
    bg: isDark ? c.bgDark : c.bg,
    dot: c.dot,
  };
}

/* ── Query node special color ─────────────────────────────── */

export const QUERY_NODE_COLOR = {
  dot: '#F59E0B',
  fill: 'rgba(245,158,11,0.10)',
  fillDark: 'rgba(251,191,36,0.15)',
  border: '#F59E0B',
  borderDark: '#FBBF24',
  text: '#92400E',
  textDark: '#FDE68A',
  bg: '#FFFBEB',
  bgDark: '#451A03',
};

export function getQueryNodeColor(isDark: boolean) {
  const c = QUERY_NODE_COLOR;
  return {
    fill: isDark ? c.fillDark : c.fill,
    border: isDark ? c.borderDark : c.border,
    text: isDark ? c.textDark : c.text,
    bg: isDark ? c.bgDark : c.bg,
    dot: c.dot,
  };
}

/* ── Stats types ──────────────────────────────────────────── */

export interface LineageStats {
  totalNodes: number;
  totalEdges: number;
  databases: { db_name: string; cnt: number }[];
  lastSync: { sync_time: string; status: string } | null;
}

export interface SyncResult {
  digestsFound: number;
  edgesCreated: number;
  edgesUpdated: number;
  parseErrors: number;
  queryDigestsFound: number;
  queryNodesCreated: number;
  queryEdgesCreated: number;
  status: string;
  errorMsg?: string;
}

export interface SyncLog {
  id: number;
  sync_time: string;
  digests_found: number;
  edges_created: number;
  edges_updated: number;
  parse_errors: number;
  status: string;
  error_msg: string | null;
}
