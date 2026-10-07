import type { AttackPath, AttackPathNode, AttackPathEdge } from '../types';

export interface MapPoint { x: number; y: number }

export const attackEdgeKey = (edge: AttackPathEdge) => JSON.stringify([edge.source, edge.target, edge.label]);

/** Label every upstream path into the selection and every downstream branch. */
export function selectedAttackEdges(path: AttackPath, selectedId?: string | null): Set<string> {
  if (!selectedId) return new Set();
  const ancestors = new Set([selectedId]), descendants = new Set([selectedId]);
  let changed = true;
  while (changed) {
    changed = false;
    path.edges.forEach(edge => {
      if (ancestors.has(edge.target) && !ancestors.has(edge.source)) { ancestors.add(edge.source); changed = true; }
      if (descendants.has(edge.source) && !descendants.has(edge.target)) { descendants.add(edge.target); changed = true; }
    });
  }
  return new Set(path.edges.filter(edge =>
    (ancestors.has(edge.source) && ancestors.has(edge.target)) ||
    (descendants.has(edge.source) && descendants.has(edge.target))
  ).map(attackEdgeKey));
}

export function reachableWithoutResource(path: AttackPath, blockedId: string): Set<string> {
  const nodeIds = new Set(path.nodes.map(node => node.id));
  const reached = new Set<string>();
  const internetEntries = path.nodes.filter(node => node.type === 'internet');
  const entries = internetEntries.length ? internetEntries : path.nodes.filter(node => !path.edges.some(edge => edge.target === node.id));
  const queue = entries.filter(node => node.id !== blockedId).map(node => node.id);
  while (queue.length) {
    const id = queue.shift()!;
    if (reached.has(id)) continue;
    reached.add(id);
    path.edges.filter(edge => edge.source === id && edge.target !== blockedId && nodeIds.has(edge.target))
      .forEach(edge => { if (!reached.has(edge.target)) queue.push(edge.target); });
  }
  return reached;
}

/** Related routes must share an internal resource, not just the public internet. */
export function relatedAttackPaths(paths: AttackPath[], focused: AttackPath): AttackPath[] {
  const internal = new Set(focused.nodes.slice(1, -1).filter(node => node.type !== 'internet').map(node => node.id));
  const overlap = (path: AttackPath) => path.nodes.filter(node => internal.has(node.id)).length;
  return paths.filter(path => path.id !== focused.id && overlap(path) > 0)
    .sort((a, b) => overlap(b) - overlap(a) || a.nodes.length - b.nodes.length).slice(0, 2);
}

export function combineAttackPaths(paths: AttackPath[], id: string): AttackPath {
  const nodes = new Map<string, AttackPathNode>();
  const edges = new Map<string, AttackPath['edges'][number]>();
  paths.forEach(path => {
    path.nodes.forEach(node => nodes.set(node.id, nodes.get(node.id) ?? node));
    path.edges.forEach(edge => edges.set(JSON.stringify([edge.source, edge.target, edge.label]), edge));
  });
  return { id, title: paths[0]?.title ?? 'Attack map', severity: paths[0]?.severity ?? 'INFO', nodes: [...nodes.values()], edges: [...edges.values()] };
}

/** Fixed starting positions only. The canvas keeps user positions separately. */
export function layoutAttackMap(path: AttackPath, focused?: AttackPath, compact = false): Map<string, MapPoint> {
  const positions = new Map<string, MapPoint>();
  if (focused) {
    if (compact) {
      // Stagger the main route down a narrow canvas; keep alternate targets beside it.
      focused.nodes.forEach((node, index) => positions.set(node.id, { x: index % 2 ? 300 : 110, y: 110 + index * 190 }));
      const extraNodes = path.nodes.filter(node => !positions.has(node.id));
      extraNodes.forEach((node, index) => positions.set(node.id, { x: index % 2 ? 300 : 110, y: 130 + (focused.nodes.length + index) * 190 }));
      return positions;
    }
    focused.nodes.forEach((node, index) => {
      const last = index === focused.nodes.length - 1;
      const y = index === 0 ? 270 : last ? 270 : node.type === 'vulnerability' ? 110
        : ['identity', 'user'].includes(node.type) ? 340 : index % 2 ? 230 : 190;
      positions.set(node.id, { x: 110 + index * 215, y });
    });
    // Each alternate branch receives its own row; follow real edges only.
    let branchRow = 0;
    const remaining = new Set(path.nodes.filter(node => !positions.has(node.id)).map(node => node.id));
    const rows = new Map<string, number>();
    while (remaining.size) {
      let progressed = false;
      for (const nodeId of remaining) {
        const incoming = path.edges.find(edge => edge.target === nodeId && positions.has(edge.source));
        if (!incoming) continue;
        const parent = positions.get(incoming.source)!;
        const row = rows.get(incoming.source) ?? branchRow++;
        rows.set(nodeId, row);
        positions.set(nodeId, { x: parent.x + 215, y: row === 1 ? 105 : 540 + Math.max(0, row - 1) * 190 });
        remaining.delete(nodeId);
        progressed = true;
      }
      if (!progressed) {
        // Disconnected evidence stays visibly separate, with no invented edge.
        remaining.forEach(nodeId => positions.set(nodeId, { x: 110, y: 540 + branchRow++ * 190 }));
        break;
      }
    }
    return positions;
  }
  const incoming = new Set(path.edges.map(edge => edge.target));
  const roots = path.nodes.filter(node => !incoming.has(node.id));
  const nodeIds = new Set(path.nodes.map(node => node.id));
  const queue = (roots.length ? roots : path.nodes.slice(0, 1)).map((node, lane) => ({ id: node.id, depth: 0, lane }));
  let nextLane = queue.length;
  while (queue.length) {
    const item = queue.shift()!;
    if (positions.has(item.id)) continue;
    const node = path.nodes.find(node => node.id === item.id);
    positions.set(item.id, { x: 110 + item.depth * 235, y: 150 + item.lane * 180 + (node?.type === 'vulnerability' ? -40 : item.depth % 2 ? 25 : 0) });
    path.edges.filter(edge => edge.source === item.id).forEach((edge, index) => {
      if (nodeIds.has(edge.target) && !positions.has(edge.target)) queue.push({ id: edge.target, depth: item.depth + 1, lane: index === 0 ? item.lane : nextLane++ });
    });
  }
  path.nodes.filter(node => !positions.has(node.id)).forEach(node => positions.set(node.id, { x: 110, y: 150 + nextLane++ * 180 }));
  return positions;
}

export function mapNodeRole(node: AttackPathNode, isEntry: boolean, isTarget: boolean): string {
  if (isEntry) return 'ENTRY POINT';
  if (isTarget) return 'BUSINESS TARGET';
  if (node.type === 'vulnerability') return 'SECURITY WEAKNESS';
  if (['identity', 'user'].includes(node.type)) return 'ACCOUNT & PERMISSIONS';
  return 'CONNECTED SERVICE';
}
