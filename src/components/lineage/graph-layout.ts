/**
 * Graph layout — transforms raw lineage data into d3-force compatible structures.
 * Uses clustering force to group nodes by database.
 */

import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  forceX,
  forceY,
  type Simulation,
} from 'd3-force';

import type {
  RawLineageGraph,
  GraphNode,
  GraphLink,
} from './graph-types';

/* ── Build graph from raw API data ────────────────────────── */

export interface BuiltGraph {
  nodes: GraphNode[];
  links: GraphLink[];
  dbColorMap: Map<string, number>;
}

export function buildGraph(raw: RawLineageGraph): BuiltGraph {
  // Build db → colorIdx mapping
  const dbCounts = new Map<string, number>();
  raw.nodes.forEach(n => {
    dbCounts.set(n.db_name, (dbCounts.get(n.db_name) || 0) + 1);
  });
  // Sort by count descending for consistent color assignment
  const sortedDbs = [...dbCounts.entries()].sort((a, b) => b[1] - a[1]);
  const dbColorMap = new Map<string, number>();
  sortedDbs.forEach(([db], i) => dbColorMap.set(db, i));

  // Compute degree for each node
  const degreeMap = new Map<number, number>();
  raw.edges.forEach(e => {
    degreeMap.set(e.source_node_id, (degreeMap.get(e.source_node_id) || 0) + 1);
    degreeMap.set(e.target_node_id, (degreeMap.get(e.target_node_id) || 0) + 1);
  });

  // Build nodes
  const nodeMap = new Map<string, GraphNode>();
  const nodes: GraphNode[] = raw.nodes.map(n => {
    const degree = degreeMap.get(n.id) || 0;
    const isQuery = n.node_type === 'QUERY';

    // Handle 3-segment "catalog.db.table" names
    let dbName = n.db_name;
    let tableName = n.table_name;

    if (isQuery) {
      // Query node: table_name is "query_{digest}", display short fingerprint
      tableName = n.table_name; // keep full for data; display will truncate
    } else {
      const fullParts = `${n.db_name}.${n.table_name}`.split('.');
      if (fullParts.length >= 3) {
        dbName = fullParts.slice(0, fullParts.length - 1).join('.');
        tableName = fullParts[fullParts.length - 1];
      }
    }

    // Compute rect dimensions based on text length
    const displayName = isQuery
      ? tableName.replace(/^query_/, '').substring(0, 10) // short fingerprint
      : tableName;
    const tableCharWidth = 5.5;  // approximate char width at 9px font
    const dbCharWidth = 4;       // approximate char width at 7px font
    const textWidth = Math.max(
      displayName.length * tableCharWidth,
      (isQuery ? 'QUERY'.length : dbName.length) * dbCharWidth
    );
    // Query pill: badge circle (18px) + gap (4px) + text + padding
    const nodeWidth = isQuery
      ? Math.min(110, Math.max(70, textWidth + 38))  // extra space for ⚡ badge
      : Math.min(140, Math.max(60, textWidth + 20));
    const nodeHeight = isQuery ? 22 : 30;  // compact pill height
    const radius = Math.max(nodeWidth, nodeHeight) / 2; // collide radius

    const node: GraphNode = {
      id: String(n.id),
      nodeId: n.id,
      dbName,
      tableName,
      label: isQuery ? `query:${tableName.replace(/^query_/, '').substring(0, 12)}` : `${dbName}.${tableName}`,
      colorIdx: isQuery ? -1 : (dbColorMap.get(n.db_name) ?? 0),  // -1 = query color
      degree,
      radius,
      nodeWidth,
      nodeHeight,
      nodeType: (n.node_type as GraphNode['nodeType']) || 'TABLE',
    };
    nodeMap.set(node.id, node);
    return node;
  });

  // Build links
  const links: GraphLink[] = raw.edges
    .filter(e => nodeMap.has(String(e.source_node_id)) && nodeMap.has(String(e.target_node_id)))
    .map(e => ({
      source: String(e.source_node_id),
      target: String(e.target_node_id),
      edgeId: e.id,
      relationType: e.relation_type,
      execCount: e.exec_count,
      lastExecTime: e.last_exec_time,
      sampleSql: e.sample_sql,
      weight: Math.min(5, 1 + Math.log2(e.exec_count || 1)),
    }));

  return { nodes, links, dbColorMap };
}

/* ── Create force simulation ──────────────────────────────── */

export function createSimulation(
  nodes: GraphNode[],
  links: GraphLink[],
  width: number,
  height: number,
): Simulation<GraphNode, GraphLink> {
  // Compute DB cluster centers — arrange DBs in a circle around center
  const uniqueDbs = [...new Set(nodes.map(n => n.dbName))];
  const dbCenters = new Map<string, { x: number; y: number }>();
  const clusterRadius = Math.min(width, height) * 0.35;

  uniqueDbs.forEach((db, i) => {
    const angle = (2 * Math.PI * i) / uniqueDbs.length - Math.PI / 2;
    dbCenters.set(db, {
      x: width / 2 + clusterRadius * Math.cos(angle),
      y: height / 2 + clusterRadius * Math.sin(angle),
    });
  });

  const sim = forceSimulation<GraphNode>(nodes)
    .force('link', forceLink<GraphNode, GraphLink>(links)
      .id(d => d.id)
      .distance(80)
      .strength(0.5),
    )
    .force('charge', forceManyBody<GraphNode>()
      .strength(-150)
      .distanceMax(400),
    )
    .force('center', forceCenter(width / 2, height / 2).strength(0.08))
    .force('collide', forceCollide<GraphNode>()
      .radius(d => d.radius + 6)
      .strength(0.9),
    )
    // Clustering force — pull nodes toward their DB cluster center
    .force('clusterX', forceX<GraphNode>()
      .x(d => dbCenters.get(d.dbName)?.x ?? width / 2)
      .strength(0.08),
    )
    .force('clusterY', forceY<GraphNode>()
      .y(d => dbCenters.get(d.dbName)?.y ?? height / 2)
      .strength(0.08),
    )
    .alphaDecay(0.05)        // settle ~2.5x faster
    .velocityDecay(0.55)     // heavy damping — kills jitter
    .alphaMin(0.005);        // stop earlier

  return sim;
}

/* ── Filtering helpers ────────────────────────────────────── */

export function filterGraph(
  graph: BuiltGraph,
  searchTerm: string,
  dbFilter: string,
  nodeDepth: number | 'all' = 'all',
): BuiltGraph {
  let filteredNodes = graph.nodes;

  // DB filter
  if (dbFilter) {
    const nodeIds = new Set<string>();
    filteredNodes.forEach(n => {
      if (n.dbName === dbFilter) nodeIds.add(n.id);
    });
    // Also include nodes connected to the filtered DB
    graph.links.forEach(l => {
      const src = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
      const tgt = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;
      if (nodeIds.has(src)) nodeIds.add(tgt);
      if (nodeIds.has(tgt)) nodeIds.add(src);
    });
    filteredNodes = filteredNodes.filter(n => nodeIds.has(n.id));
  }

  // Search filter
  if (searchTerm) {
    const q = searchTerm.toLowerCase();
    const matchedIds = new Set<string>();
    filteredNodes.forEach(n => {
      if (n.tableName.toLowerCase().includes(q) || n.dbName.toLowerCase().includes(q)) {
        matchedIds.add(n.id);
      }
    });
    // Include neighbors
    graph.links.forEach(l => {
      const src = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
      const tgt = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;
      if (matchedIds.has(src)) matchedIds.add(tgt);
      if (matchedIds.has(tgt)) matchedIds.add(src);
    });
    filteredNodes = filteredNodes.filter(n => matchedIds.has(n.id));
  }

  // 拓扑深度截断：计算每个节点在 DAG 中的层级（最长路径深度），只保留 depth < nodeDepth 的节点
  if (nodeDepth !== 'all' && typeof nodeDepth === 'number') {
    const nodeIdSet = new Set(filteredNodes.map(n => n.id));
    // 构建邻接表和入度
    const adj = new Map<string, string[]>();
    const inDegree = new Map<string, number>();
    nodeIdSet.forEach(id => { adj.set(id, []); inDegree.set(id, 0); });

    graph.links.forEach(l => {
      const src = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
      const tgt = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;
      if (!nodeIdSet.has(src) || !nodeIdSet.has(tgt)) return;
      adj.get(src)?.push(tgt);
      inDegree.set(tgt, (inDegree.get(tgt) || 0) + 1);
    });

    // 拓扑排序 + 动态规划求每个节点的最长路径深度
    const topoDepth = new Map<string, number>();
    const queue: string[] = [];
    nodeIdSet.forEach(id => {
      topoDepth.set(id, 0);
      if ((inDegree.get(id) || 0) === 0) queue.push(id);
    });

    while (queue.length > 0) {
      const id = queue.shift()!;
      const d = topoDepth.get(id) || 0;
      const neighbors = adj.get(id) || [];
      for (const nbr of neighbors) {
        // 取最长路径
        topoDepth.set(nbr, Math.max(topoDepth.get(nbr) || 0, d + 1));
        const newIn = (inDegree.get(nbr) || 1) - 1;
        inDegree.set(nbr, newIn);
        if (newIn === 0) queue.push(nbr);
      }
    }

    // 只保留拓扑深度 < nodeDepth 的节点
    filteredNodes = filteredNodes.filter(n => (topoDepth.get(n.id) || 0) < nodeDepth);
  }

  const nodeIdSet = new Set(filteredNodes.map(n => n.id));
  const filteredLinks = graph.links.filter(l => {
    const src = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
    const tgt = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;
    return nodeIdSet.has(src) && nodeIdSet.has(tgt);
  });

  return { nodes: filteredNodes, links: filteredLinks, dbColorMap: graph.dbColorMap };
}
