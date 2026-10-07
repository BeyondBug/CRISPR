import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Pause, Play, RotateCcw, Waypoints, GitBranch } from 'lucide-react';
import AttackPathGraph from '../components/attackpath/AttackPathGraph';
import type { AttackPath, AttackPathNode, Severity } from '../types';
import { getAttackPaths } from '../lib/api';
import { toast } from '../lib/toastStore';
import { combineAttackPaths, relatedAttackPaths } from '../utils/attackMap';

export default function AttackPaths() {
  const [paths, setPaths] = useState<AttackPath[]>([]);
  const [activePathId, setActivePathId] = useState('');
  const [selectedNode, setSelectedNode] = useState<AttackPathNode | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [showBranches, setShowBranches] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const activePath = paths.find(path => path.id === activePathId) ?? paths[0];
  const topology = useMemo(() => paths.length ? combineAttackPaths(paths, 'enterprise-topology') : null, [paths]);
  const branchPaths = useMemo(() => activePath ? relatedAttackPaths(paths, activePath) : [], [paths, activePath]);
  const focusedMap = useMemo(() => activePath ? combineAttackPaths([activePath, ...(showBranches ? branchPaths : [])], `map-${activePath.id}`) : null, [activePath, branchPaths, showBranches]);
  const stepIndex = selectedNode && activePath ? activePath.nodes.findIndex(node => node.id === selectedNode.id) : -1;
  const selectedPath = selectedNode && !activePath?.nodes.some(node => node.id === selectedNode.id)
    ? paths.find(path => path.nodes.some(node => node.id === selectedNode.id)) ?? activePath : activePath;

  // One timer per step; changing routes, pausing or unmounting cancels it.
  useEffect(() => {
    if (!playing || showAll || !activePath || !activePath.nodes.length) return;
    const timer = window.setTimeout(() => {
      const next = stepIndex + 1;
      if (next < activePath.nodes.length) setSelectedNode(activePath.nodes[next]);
      if (next >= activePath.nodes.length - 1) setPlaying(false);
    }, 3200);
    return () => window.clearTimeout(timer);
  }, [playing, showAll, activePath, stepIndex]);

  const selectPath = (path: AttackPath) => {
    setPlaying(false);
    setActivePathId(path.id);
    setSelectedNode(null);
  };
  const selectNode = (node: AttackPathNode | null) => {
    setPlaying(false);
    setSelectedNode(node);
  };
  useEffect(() => {
    let active = true;
    getAttackPaths().then((rows: any[]) => {
      if (!active) return;
      const normalized: AttackPath[] = rows.map((row, index): AttackPath => {
        const severity: Severity = Number(row.risk_score ?? 0) >= 80 ? 'CRITICAL' : Number(row.risk_score ?? 0) >= 60 ? 'HIGH' : 'MEDIUM';
        if (Array.isArray(row.nodes) && row.nodes.every((node: any) => node && typeof node === 'object' && node.id)) {
          return { ...row, severity: row.severity ?? severity, edges: Array.isArray(row.edges) ? row.edges : [] } as AttackPath;
        }
        if (Array.isArray(row.nodes) && row.nodes.length > 0) {
          const nodeNames = row.nodes.map((node: any) => String(node));
          const nodes: AttackPathNode[] = nodeNames.map((name: string, nodeIndex: number) => ({
            id: name,
            label: name,
            type: nodeIndex === 0 ? 'internet' : nodeIndex === nodeNames.length - 1 ? 'database' : 'compute',
            severity: nodeIndex === 0 ? undefined : severity,
            x: 70 + nodeIndex * 190,
            y: 120 + (nodeIndex % 2) * 70,
          }));
          const edges = Array.isArray(row.edges) ? row.edges.map((edge: any, edgeIndex: number) => ({
            id: String(edge.external_edge_id ?? edge.id ?? `${row.id}-edge-${edgeIndex}`),
            source: String(edge.source_node ?? edge.source ?? nodeNames[edgeIndex]),
            target: String(edge.target_node ?? edge.target ?? nodeNames[edgeIndex + 1]),
            label: String(edge.relation_type ?? edge.label ?? 'Reachable').replace(/_/g, ' '),
            risky: true,
          })) : [];
          return {
            id: String(row.id ?? `path-${index + 1}`),
            title: `${row.start ?? nodeNames[0]} → ${row.target ?? nodeNames[nodeNames.length - 1]}`,
            severity,
            confidence: row.confidence,
            financial_impact_inr: row.financial_impact_inr,
            demo: row.demo,
            scenario_summary: row.scenario_summary,
            nodes,
            edges,
          };
        }
        const startId = `${row.id ?? index}-start`;
        const targetId = `${row.id ?? index}-target`;
        return {
          id: String(row.id ?? `path-${index + 1}`), title: `${row.start ?? 'Entry point'} → ${row.target ?? 'Target'}`, severity,
          nodes: [
            { id: startId, label: row.start ?? 'Entry point', type: 'internet', x: 70, y: 100 },
            { id: targetId, label: row.target ?? 'Target', type: 'database', severity, x: 300, y: 100 },
          ],
          edges: [],
        };
      }).filter(path => path.nodes.length > 0);
      setPaths(normalized);
      setActivePathId(normalized[0]?.id ?? '');
      setLoading(false);
    }).catch((requestError) => {
      if (!active) return;
      const detail = requestError?.response?.data?.detail ?? 'The backend could not calculate attack paths.';
      setError(typeof detail === 'string' ? detail : JSON.stringify(detail));
      setLoading(false);
      toast.error('Attack paths unavailable', 'The backend could not calculate attack paths.');
    });
    return () => { active = false; };
  }, []);
  if (loading) return <div className="page-container"><div className="card empty-state">Loading attack-path evidence…</div></div>;
  if (!activePath) return <div className="page-container"><div className="card empty-state">{error || 'No attack paths are currently available.'}</div></div>;

  return <div className="page-container page-stack attack-canvas-page">
    <div className="attack-path-heading">
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Waypoints size={22} color="var(--color-primary-blue)" />Attack Paths</h1>
    </div>

    <div className="attack-explorer-toolbar">
      <label className="attack-route-picker">Route
        <select aria-label="Attack path" value={activePath.id} onChange={event => {
          const path = paths.find(item => item.id === event.target.value);
          if (path) selectPath(path);
        }}>
          {paths.map(path => <option key={path.id} value={path.id}>{path.title} · {path.severity}</option>)}
        </select>
      </label>
      <div className="attack-view-switch" role="group" aria-label="Graph view">
        <button aria-pressed={!showAll} onClick={() => { setPlaying(false); setShowAll(false); setSelectedNode(null); }}>Attack map</button>
        <button aria-pressed={showAll} onClick={() => { setPlaying(false); setShowAll(true); setSelectedNode(null); }}>All {paths.length} paths</button>
      </div>
    </div>

    <div className="card attack-journey-card attack-canvas-card">
      {!showAll && <div className="attack-walkthrough-toolbar">
        <button className="attack-play-button" style={{ minWidth: 86, justifyContent: 'center' }} disabled={activePath.nodes.length < 2} onClick={() => {
          if (playing) setPlaying(false);
          else {
            if (stepIndex < 0 || stepIndex === activePath.nodes.length - 1) setSelectedNode(activePath.nodes[0]);
            setPlaying(true);
          }
        }}>{playing ? <Pause size={15} /> : stepIndex === activePath.nodes.length - 1 ? <RotateCcw size={15} /> : <Play size={15} />}{playing ? 'Pause' : stepIndex === activePath.nodes.length - 1 ? 'Replay' : 'Play'}</button>
        {branchPaths.length > 0 && <label className="attack-branch-toggle"><input type="checkbox" checked={showBranches} onChange={event => {
          setShowBranches(event.target.checked);
          if (!event.target.checked && selectedNode && !activePath.nodes.some(node => node.id === selectedNode.id)) setSelectedNode(null);
        }} /><GitBranch size={15} />Related branches</label>}
        <div className="attack-step-navigation">
          <button aria-label="Previous step" disabled={stepIndex <= 0} onClick={() => selectNode(activePath.nodes[stepIndex - 1])}><ArrowLeft size={16} /></button>
          <strong style={{ width: 80, flexShrink: 0, textAlign: 'center' }} aria-hidden={stepIndex < 0}>{stepIndex >= 0 ? `Step ${stepIndex + 1} / ${activePath.nodes.length}` : '\u00a0'}</strong>
          <button aria-label="Next step" disabled={stepIndex >= activePath.nodes.length - 1} onClick={() => selectNode(activePath.nodes[stepIndex + 1])}><ArrowRight size={16} /></button>
        </div>
      </div>}
      {topology && focusedMap && <AttackPathGraph key={showAll ? topology.id : activePath.id} path={showAll ? topology : focusedMap} focusedPath={activePath} selectedPath={selectedPath} showNodeExplanation routeLayout={!showAll} stepIndex={!showAll && stepIndex >= 0 ? stepIndex : undefined} animateFlow={playing} height={showAll ? 620 : 550} selectedNodeId={selectedNode?.id ?? null} onSelectNode={selectNode} />}
    </div>
  </div>;
}
