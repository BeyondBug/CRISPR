import { useId, useRef, useState, useEffect, useMemo } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { ZoomIn, ZoomOut, Maximize2, Network, RotateCcw, Expand, ShieldCheck, KeyRound, ShieldAlert, X } from 'lucide-react';
import type { AttackPath, AttackPathNode } from '../../types';
import { ATTACK_NODE_ICON } from '../../config/icons';
import { layoutAttackMap, mapNodeRole, reachableWithoutResource, selectedAttackEdges, attackEdgeKey } from '../../utils/attackMap';
import type { MapPoint } from '../../utils/attackMap';
import AttackNodeExplanation from './AttackNodeExplanation';

interface Props {
  path: AttackPath;
  height?: number;
  selectedNodeId?: string | null;
  onSelectNode?: (node: AttackPathNode | null) => void;
  focusedPath?: AttackPath;
  selectedPath?: AttackPath;
  showNodeExplanation?: boolean;
  routeLayout?: boolean;
  stepIndex?: number;
  animateFlow?: boolean;
  blockedNodeId?: string | null;
}
const COLORS: Record<string, string> = { internet: '#089ebc', api: '#e99238', compute: '#2478d4', identity: '#8059d2', database: '#53ad64', data: '#53ad64', storage: '#53ad64', network: '#e99238', user: '#8059d2', vulnerability: '#e44455' };
function lines(label: string, limit = 24) {
  const result = [''];
  label.split(/\s+/).forEach(word => {
    const last = result.length - 1;
    if (result[last] && (result[last] + ' ' + word).length > limit) result.push(word);
    else result[last] += (result[last] ? ' ' : '') + word;
  });
  return result;
}
function boundsFor(points: MapPoint[]) {
  return { x: Math.min(0, ...points.map(point => point.x - 130)), y: Math.min(0, ...points.map(point => point.y - 90)),
    width: Math.max(320, ...points.map(point => point.x + 140)) - Math.min(0, ...points.map(point => point.x - 130)),
    height: Math.max(240, ...points.map(point => point.y + 120)) - Math.min(0, ...points.map(point => point.y - 90)) };
}
interface Drag { kind: 'node' | 'canvas'; id?: string; start: MapPoint; screenStart: MapPoint; origin: MapPoint; moved: boolean }

export default function AttackPathGraph({ path, height = 320, selectedNodeId, onSelectNode, focusedPath, selectedPath, showNodeExplanation = false, routeLayout = false, stepIndex, animateFlow = false, blockedNodeId }: Props) {
  const id = useId().replace(/:/g, '');
  const graphRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const contentRef = useRef<SVGGElement>(null);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<MapPoint>({ x: 0, y: 0 });
  const [positions, setPositions] = useState<Record<string, MapPoint>>({});
  const [fitBounds, setFitBounds] = useState<ReturnType<typeof boundsFor> | null>(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [previewNodeId, setPreviewNodeId] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState(1000);
  const compact = containerWidth < 480 && routeLayout;
  const route = focusedPath ?? (routeLayout ? path : undefined);
  const highlightedRoute = selectedPath ?? route;
  const initialPositions = useMemo(() => layoutAttackMap(path, routeLayout ? route : undefined, compact), [path, route, routeLayout, compact]);
  const bounds = fitBounds ?? boundsFor([...initialPositions.values()]);
  const nodes = path.nodes.map(node => {
    const initial = initialPositions.get(node.id) ?? { x: 110, y: 150 };
    const offset = positions[node.id] ?? { x: 0, y: 0 };
    return { ...node, x: initial.x + offset.x, y: initial.y + offset.y };
  });
  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  const blockedId = blockedNodeId ?? previewNodeId;
  const reachable = blockedId ? reachableWithoutResource(path, blockedId) : null;
  const labeledEdges = selectedAttackEdges(path, selectedNodeId);
  const routeIndices = new Map(highlightedRoute?.nodes.map((node, index) => [node.id, index]));
  const isRouteEdge = (source: string, target: string, label?: string) => !highlightedRoute || highlightedRoute.edges.some(edge => edge.source === source && edge.target === target && edge.label === label);
  const targets = new Set(path.nodes.filter(node => ['database', 'data', 'storage'].includes(node.type)).map(node => node.id));
  if (route?.nodes.length) targets.add(route.nodes[route.nodes.length - 1].id);
  const roots = new Set(path.nodes.filter(node => node.type === 'internet' && !path.edges.some(edge => edge.target === node.id)).map(node => node.id));
  if (route?.nodes.length) roots.add(route.nodes[0].id);
  const visibleNodeIds = path.nodes.map(node => node.id).sort().join('\0');
  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }); setPositions({}); setFitBounds(null); setStatus(''); setPreviewNodeId(null); }, [path.id]);
  useEffect(() => { setFitBounds(null); setZoom(1); setPan({ x: 0, y: 0 }); }, [visibleNodeIds]);
  useEffect(() => { setFitBounds(null); }, [compact]);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width));
    if (graphRef.current) observer.observe(graphRef.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!expanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setExpanded(false); };
    document.addEventListener('keydown', close);
    graphRef.current?.querySelector<HTMLButtonElement>('[data-expand-map]')?.focus();
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', close); };
  }, [expanded]);
  useEffect(() => {
    const svg = svgRef.current;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom(value => Math.max(.3, Math.min(3, value * (event.deltaY < 0 ? 1.1 : .9))));
    };
    svg?.addEventListener('wheel', wheel, { passive: false });
    return () => svg?.removeEventListener('wheel', wheel);
  }, []);

  const pointAt = (clientX: number, clientY: number, forNode: boolean): MapPoint | null => {
    const matrix = (forNode ? contentRef.current : svgRef.current)?.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  };
  const startDrag = (event: ReactPointerEvent<SVGElement>, nodeId?: string) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const start = pointAt(event.clientX, event.clientY, !!nodeId);
    const node = nodeId ? nodeMap.get(nodeId) : undefined;
    if (!start) return;
    suppressClick.current = false;
    drag.current = { kind: nodeId ? 'node' : 'canvas', id: nodeId, start, screenStart: { x: event.clientX, y: event.clientY }, origin: node ? { x: node.x, y: node.y } : pan, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const finishDrag = () => {
    if (drag.current?.moved) {
      suppressClick.current = true;
      if (drag.current.id) setStatus(`${nodeMap.get(drag.current.id)?.label ?? 'Resource'} moved. Connections updated.`);
    }
    drag.current = null;
    setDragging(false);
  };
  const fit = () => { setFitBounds(boundsFor(nodes)); setZoom(1); setPan({ x: 0, y: 0 }); };

  return <div className={`attack-security-graph attack-map-canvas${expanded ? ' attack-map-canvas-expanded' : ''}`} ref={graphRef} role={expanded ? 'dialog' : undefined} aria-modal={expanded ? true : undefined} aria-label={expanded ? 'Expanded attack map' : undefined} onKeyDown={event => {
    if (!expanded || event.key !== 'Tab') return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]')];
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}>
    <div className="attack-graph-legend" aria-label="Map legend">
      <span><i className="attack-route-line" />Selected route</span><span><i className="attack-branch-line" />Related branch</span>
      <span><i style={{ background: COLORS.vulnerability }} />Weakness</span><span><i style={{ background: COLORS.identity }} />Account</span><span><i style={{ background: COLORS.data }} />Business data</span>
    </div>
    <svg ref={svgRef} width="100%" height={compact ? Math.max(height, bounds.height * containerWidth / bounds.width) : height} viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`} role={onSelectNode ? 'group' : 'img'} aria-label={`${path.title}: ${nodes.length} movable resources and ${path.edges.length} relationships`} aria-describedby={`${id}-instructions`} style={{ display: 'block', touchAction: 'none', cursor: dragging ? 'grabbing' : 'grab' }}
      onPointerDown={event => startDrag(event)}
      onPointerMove={event => {
        const current = drag.current;
        if (!current) return;
        if (!current.moved && Math.hypot(event.clientX - current.screenStart.x, event.clientY - current.screenStart.y) < 6) return;
        const point = pointAt(event.clientX, event.clientY, current.kind === 'node');
        if (!point) return;
        const dx = point.x - current.start.x, dy = point.y - current.start.y;
        current.moved = true; setDragging(true);
        const next = { x: current.origin.x + dx, y: current.origin.y + dy };
        if (current.kind === 'node' && current.id) {
          const initial = initialPositions.get(current.id) ?? { x: 110, y: 150 };
          setPositions(previous => ({ ...previous, [current.id!]: { x: next.x - initial.x, y: next.y - initial.y } }));
        }
        else setPan(next);
      }}
      onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={finishDrag}
      onClick={event => { if (!suppressClick.current && (event.target === event.currentTarget || (event.target as Element).hasAttribute('data-map-background'))) onSelectNode?.(null); }}>
      <defs>
        <pattern id={`${id}-dots`} width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="#cdd6e3" /></pattern>
        {['route', 'branch', 'weakness'].map(kind => <marker key={kind} id={`${id}-${kind}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill={kind === 'route' ? '#4776d9' : kind === 'weakness' ? '#d95b68' : '#a3acbc'} /></marker>)}
      </defs>
      <rect data-map-background x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height} fill={`url(#${id}-dots)`} />
      <g ref={contentRef} data-testid="attack-map-content" transform={`translate(${pan.x + bounds.x + bounds.width / 2} ${pan.y + bounds.y + bounds.height / 2}) scale(${zoom}) translate(${-bounds.x - bounds.width / 2} ${-bounds.y - bounds.height / 2})`}>
        {path.edges.map(edge => {
          const source = nodeMap.get(edge.source), target = nodeMap.get(edge.target);
          if (!source || !target) return null;
          const angle = Math.atan2(target.y - source.y, target.x - source.x);
          const sx = source.x + Math.cos(angle) * 38, sy = source.y + Math.sin(angle) * 38;
          const tx = target.x - Math.cos(angle) * 43, ty = target.y - Math.sin(angle) * 43;
          const focused = isRouteEdge(edge.source, edge.target, edge.label);
          const current = focused && edge.target === selectedNodeId;
          const weakness = source.type === 'vulnerability' || target.type === 'vulnerability';
          const stroke = focused ? weakness ? '#d95b68' : '#4776d9' : '#a3acbc';
          const horizontal = Math.abs(tx - sx) > Math.abs(ty - sy);
          const labelY = horizontal && Math.abs(source.y - target.y) < 45
            ? Math.min(source.y, target.y) - 74 : (sy + ty) / 2 - 13;
          const curve = horizontal ? `M${sx} ${sy} C${(sx + tx) / 2} ${sy}, ${(sx + tx) / 2} ${ty}, ${tx} ${ty}`
            : `M${sx} ${sy} C${sx} ${(sy + ty) / 2}, ${tx} ${(sy + ty) / 2}, ${tx} ${ty}`;
          const interrupted = reachable && (!reachable.has(edge.source) || !reachable.has(edge.target));
          return <g key={attackEdgeKey(edge)} opacity={interrupted ? .2 : 1} className={focused ? 'attack-map-route-edge' : 'attack-map-branch-edge'}>
            <path className={current && animateFlow ? 'attack-flow-current attack-flow-playing' : undefined} d={curve} stroke={stroke} strokeWidth={focused ? 3 : 1.8} strokeDasharray={focused ? undefined : '5 5'} fill="none" markerEnd={`url(#${id}-${focused ? weakness ? 'weakness' : 'route' : 'branch'})`} />
            {edge.label && (!onSelectNode || labeledEdges.has(attackEdgeKey(edge))) && <text x={(sx + tx) / 2 + (horizontal ? 0 : 14)} y={labelY} textAnchor="middle" fontSize="12" fill={focused ? '#516380' : '#728099'} stroke="#fff" strokeWidth="7" paintOrder="stroke">{edge.label.replace(/_/g, ' ')}</text>}
          </g>;
        })}
        {nodes.map(node => {
          const blocked = node.id === blockedId;
          const Icon = blocked ? ShieldCheck : node.type === 'vulnerability' ? /credential|token/i.test(node.label) ? KeyRound : ShieldAlert : ATTACK_NODE_ICON[node.type] ?? Network;
          const color = COLORS[node.type] ?? COLORS.compute;
          const selected = node.id === selectedNodeId;
          const showRole = selected || !onSelectNode;
          const index = routeIndices.get(node.id);
          const isTarget = targets.has(node.id);
          const role = blocked ? 'CONTROL PREVIEW' : mapNodeRole(node, roots.has(node.id), isTarget);
          const select = () => {
            if (suppressClick.current) { suppressClick.current = false; return; }
            onSelectNode?.(selected ? null : path.nodes.find(original => original.id === node.id) ?? null);
          };
          const labelLines = lines(node.label);
          return <g key={node.id} data-node-id={node.id} transform={`translate(${node.x} ${node.y})`} opacity={reachable && !reachable.has(node.id) && !blocked ? .35 : 1} role={onSelectNode ? 'button' : undefined} tabIndex={onSelectNode ? 0 : undefined} aria-label={`Inspect ${node.label}`} aria-pressed={onSelectNode ? selected : undefined} style={{ cursor: dragging ? 'grabbing' : 'grab' }}
            onPointerDown={event => startDrag(event, node.id)} onClick={select} onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); suppressClick.current = false; select(); }
              if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
                event.preventDefault(); const amount = event.shiftKey ? 40 : 15;
                setPositions(previous => {
                  const offset = previous[node.id] ?? { x: 0, y: 0 };
                  return { ...previous, [node.id]: { x: offset.x + (event.key === 'ArrowRight' ? amount : event.key === 'ArrowLeft' ? -amount : 0), y: offset.y + (event.key === 'ArrowDown' ? amount : event.key === 'ArrowUp' ? -amount : 0) } };
                });
                setStatus(`${node.label} moved. Connections updated.`);
              }
            }}>
            {showRole && <text className="attack-node-role" textAnchor="middle" y="-56" fontSize="9" fontWeight="700" letterSpacing=".7" fill={isTarget ? '#478750' : node.type === 'vulnerability' ? '#c34658' : '#62718a'} stroke="white" strokeWidth="5" paintOrder="stroke">{role}</text>}
            <circle className={selected && animateFlow ? 'attack-node-playing' : undefined} r={isTarget ? 43 : 39} fill={isTarget ? '#edf7ee' : '#fff'} stroke={selected ? '#285fe5' : isTarget ? '#a7d2aa' : color} strokeWidth={selected ? 3 : 1.5} opacity="1" />
            <circle r="31" fill={blocked ? '#438663' : color} />
            <g transform="translate(-14 -14)"><Icon size={28} color="white" strokeWidth={1.8} /></g>
            {selected && index !== undefined && <g transform="translate(-29 -28)"><circle r="12" fill="#285fe5" stroke="#c8d6ec" /><text textAnchor="middle" y="4" fontSize="11" fill="#fff" fontWeight="700">{index + 1}</text></g>}
            {labelLines.map((line, i) => <text className="attack-node-label" key={i} y={61 + i * 16} textAnchor="middle" fill="#25334a" fontSize="14" fontWeight="600" stroke="white" strokeWidth="5" paintOrder="stroke">{line}</text>)}
          </g>;
        })}
      </g>
    </svg>
    {showNodeExplanation && onSelectNode && selectedNodeId && highlightedRoute && <AttackNodeExplanation nodeId={selectedNodeId} route={highlightedRoute} graph={path}
      onSelectNode={node => {
        onSelectNode(node);
        [...(svgRef.current?.querySelectorAll<SVGGElement>('[data-node-id]') ?? [])].find(element => element.getAttribute('data-node-id') === node.id)?.focus({ preventScroll: true });
      }}
      onClose={() => { svgRef.current?.querySelector<SVGGElement>('[aria-pressed="true"]')?.focus({ preventScroll: true }); onSelectNode(null); }} />}
    <div className="attack-graph-controls attack-graph-controls-inline">
      <button onClick={() => setZoom(value => Math.min(3, value + .2))} aria-label="Zoom in" title="Zoom in"><ZoomIn size={17} /></button>
      <button onClick={() => setZoom(value => Math.max(.3, value - .2))} aria-label="Zoom out" title="Zoom out"><ZoomOut size={17} /></button>
      <button onClick={fit} aria-label="Fit map" title="Fit all resources without changing their positions"><Maximize2 size={17} /></button>
      <button onClick={() => { setPositions({}); setFitBounds(null); setZoom(1); setPan({ x: 0, y: 0 }); setStatus('Starting layout restored.'); }} aria-label="Reset layout" title="Restore starting node positions"><RotateCcw size={17} /></button>
      <button data-expand-map onClick={() => setExpanded(value => !value)} aria-label={expanded ? 'Close expanded map' : 'Expand map'} title={expanded ? 'Close map (Esc)' : 'Expand map'}>{expanded ? <X size={17} /> : <Expand size={17} />}</button>
      {onSelectNode && <button disabled={!selectedNodeId || nodeMap.get(selectedNodeId)?.type === 'internet'} onClick={() => setPreviewNodeId(value => value === selectedNodeId ? null : selectedNodeId ?? null)} aria-label="Preview blocking selected resource" aria-pressed={!!selectedNodeId && previewNodeId === selectedNodeId} title="Preview blocking selected resource"><ShieldCheck size={17} /></button>}
      {previewNodeId && <button onClick={() => setPreviewNodeId(null)} aria-label="Clear control preview" title="Clear control preview"><X size={17} /></button>}
      <output aria-label="Graph zoom">{Math.round(zoom * 100)}%</output>
      {previewNodeId && <span className="attack-map-preview-label">Control preview</span>}
    </div>
    <span id={`${id}-instructions`} className="sr-only">Drag resources to move them. Arrow keys move a focused resource. Drag the canvas to pan.</span>
    <span role="status" className="sr-only">{status}</span>
  </div>;
}
