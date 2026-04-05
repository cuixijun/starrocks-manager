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

  // ── Adaptive force parameters based on node count ──
  // Fewer nodes → more screen space per node → increase spacing
  const n = nodes.length;
  const sparsity = n < 20 ? 2.5 : n < 50 ? 1.8 : n < 100 ? 1.3 : 1.0;
  const linkDist = Math.round(80 * sparsity);
  const chargeStr = Math.round(-150 * sparsity);
  const collideExtra = Math.round(6 * sparsity);

  const sim = forceSimulation<GraphNode>(nodes)
    .force('link', forceLink<GraphNode, GraphLink>(links)
      .id(d => d.id)
      .distance(linkDist)
      .strength(0.5),
    )
    .force('charge', forceManyBody<GraphNode>()
      .strength(chargeStr)
      .distanceMax(400 * sparsity),
    )
    .force('center', forceCenter(width / 2, height / 2).strength(0.08))
    .force('collide', forceCollide<GraphNode>()
      .radius(d => d.radius + collideExtra)
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

/** Get resolved link source/target id (handles both string and object forms) */
function linkSrc(l: GraphLink): string {
  return typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
}
function linkTgt(l: GraphLink): string {
  return typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;
}

export function filterGraph(
  graph: BuiltGraph,
  searchTerm: string,
  dbFilter: string,
  nodeDepth: number | 'all' = 'all',
  selectedNodeId?: string | null,
  hideQueryNodes?: boolean,
): BuiltGraph {
  let filteredNodes = graph.nodes;

  // Query node filter
  if (hideQueryNodes) {
    filteredNodes = filteredNodes.filter(n => n.nodeType !== 'QUERY');
  }

  // Helper: get links within current filtered node set
  const linksWithin = (nodeSet: Set<string>) =>
    graph.links.filter(l => nodeSet.has(linkSrc(l)) && nodeSet.has(linkTgt(l)));

  // DB filter
  if (dbFilter) {
    const currentNodeSet = new Set(filteredNodes.map(n => n.id));
    const validLinks = linksWithin(currentNodeSet);

    const nodeIds = new Set<string>();
    filteredNodes.forEach(n => {
      if (n.dbName === dbFilter) nodeIds.add(n.id);
    });
    // Also include nodes connected to the filtered DB (only via valid links)
    validLinks.forEach(l => {
      const src = linkSrc(l), tgt = linkTgt(l);
      if (nodeIds.has(src)) nodeIds.add(tgt);
      if (nodeIds.has(tgt)) nodeIds.add(src);
    });
    filteredNodes = filteredNodes.filter(n => nodeIds.has(n.id));
  }

  // Search filter — BFS from matched nodes to find connected subgraph
  if (searchTerm) {
    const q = searchTerm.toLowerCase();

    // Step 1: Find directly matched nodes
    const directMatches = new Set<string>();
    filteredNodes.forEach(n => {
      if (n.tableName.toLowerCase().includes(q) || n.dbName.toLowerCase().includes(q)) {
        directMatches.add(n.id);
      }
    });

    if (directMatches.size > 0) {
      // Step 2: Build adjacency from links within *current* filtered set only
      const currentNodeSet = new Set(filteredNodes.map(n => n.id));
      const validLinks = linksWithin(currentNodeSet);
      const adj = new Map<string, string[]>();
      currentNodeSet.forEach(id => adj.set(id, []));
      validLinks.forEach(l => {
        const src = linkSrc(l), tgt = linkTgt(l);
        adj.get(src)?.push(tgt);
        adj.get(tgt)?.push(src);
      });

      // Step 3: BFS from all matched nodes, 1-hop only (direct neighbors)
      const reachable = new Set(directMatches);
      for (const matchId of directMatches) {
        for (const nbr of (adj.get(matchId) || [])) {
          reachable.add(nbr);
        }
      }

      filteredNodes = filteredNodes.filter(n => reachable.has(n.id));
    } else {
      // No matches at all — return empty
      filteredNodes = [];
    }
  }

  // Depth filter: BFS from selected node (bidirectional) or global topo depth
  if (nodeDepth !== 'all' && typeof nodeDepth === 'number') {
    const nodeIdSet = new Set(filteredNodes.map(n => n.id));
    const validLinks = linksWithin(nodeIdSet);

    if (selectedNodeId && nodeIdSet.has(selectedNodeId)) {
      // ── Bidirectional BFS from selected node ──
      const upstream = new Map<string, string[]>();   // target → sources
      const downstream = new Map<string, string[]>(); // source → targets
      nodeIdSet.forEach(id => { upstream.set(id, []); downstream.set(id, []); });

      validLinks.forEach(l => {
        const src = linkSrc(l), tgt = linkTgt(l);
        downstream.get(src)?.push(tgt);
        upstream.get(tgt)?.push(src);
      });

      // BFS helper
      const bfs = (startId: string, adjMap: Map<string, string[]>, maxDepth: number): Set<string> => {
        const visited = new Set<string>([startId]);
        let frontier = [startId];
        for (let d = 0; d < maxDepth && frontier.length > 0; d++) {
          const next: string[] = [];
          for (const id of frontier) {
            for (const nbr of (adjMap.get(id) || [])) {
              if (!visited.has(nbr)) {
                visited.add(nbr);
                next.push(nbr);
              }
            }
          }
          frontier = next;
        }
        return visited;
      };

      const upNodes = bfs(selectedNodeId, upstream, nodeDepth);
      const downNodes = bfs(selectedNodeId, downstream, nodeDepth);
      const reachable = new Set([...upNodes, ...downNodes]);
      filteredNodes = filteredNodes.filter(n => reachable.has(n.id));
    } else {
      // ── No selected node: fall back to global topo depth ──
      const adj = new Map<string, string[]>();
      const inDegree = new Map<string, number>();
      nodeIdSet.forEach(id => { adj.set(id, []); inDegree.set(id, 0); });

      validLinks.forEach(l => {
        const src = linkSrc(l), tgt = linkTgt(l);
        adj.get(src)?.push(tgt);
        inDegree.set(tgt, (inDegree.get(tgt) || 0) + 1);
      });

      const topoDepth = new Map<string, number>();
      const queue: string[] = [];
      nodeIdSet.forEach(id => {
        topoDepth.set(id, 0);
        if ((inDegree.get(id) || 0) === 0) queue.push(id);
      });

      while (queue.length > 0) {
        const id = queue.shift()!;
        const d = topoDepth.get(id) || 0;
        for (const nbr of (adj.get(id) || [])) {
          topoDepth.set(nbr, Math.max(topoDepth.get(nbr) || 0, d + 1));
          const newIn = (inDegree.get(nbr) || 1) - 1;
          inDegree.set(nbr, newIn);
          if (newIn === 0) queue.push(nbr);
        }
      }

      filteredNodes = filteredNodes.filter(n => (topoDepth.get(n.id) || 0) < nodeDepth);
    }
  }

  // Final: build filtered links, then remove orphan nodes
  const nodeIdSet = new Set(filteredNodes.map(n => n.id));
  const filteredLinks = graph.links.filter(l =>
    nodeIdSet.has(linkSrc(l)) && nodeIdSet.has(linkTgt(l))
  );

  // Remove orphan nodes (zero connections in the final graph)
  // Keep orphans only if they are direct search matches (user searched for them explicitly)
  const connectedIds = new Set<string>();
  filteredLinks.forEach(l => {
    connectedIds.add(linkSrc(l));
    connectedIds.add(linkTgt(l));
  });

  if (searchTerm) {
    const q = searchTerm.toLowerCase();
    filteredNodes = filteredNodes.filter(n =>
      connectedIds.has(n.id) ||
      n.tableName.toLowerCase().includes(q) ||
      n.dbName.toLowerCase().includes(q)
    );
  } else {
    filteredNodes = filteredNodes.filter(n => connectedIds.has(n.id));
  }

  return { nodes: filteredNodes, links: filteredLinks, dbColorMap: graph.dbColorMap };
}
