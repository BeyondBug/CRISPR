import { ArrowUpRight, X } from 'lucide-react';
import type { AttackPath, AttackPathNode } from '../../types';
import { describeAttackStep } from '../../utils/attackPath';

interface Props {
  nodeId: string;
  route: AttackPath;
  graph: AttackPath;
  onSelectNode: (node: AttackPathNode) => void;
  onClose: () => void;
}

export default function AttackNodeExplanation({ nodeId, route, graph, onSelectNode, onClose }: Props) {
  const step = describeAttackStep(route, route.nodes.findIndex(node => node.id === nodeId));
  if (!step) return null;
  const nextIds = new Set(graph.edges.filter(edge => edge.source === nodeId && edge.target !== nodeId).map(edge => edge.target));
  const nextNodes = graph.nodes.filter(node => nextIds.has(node.id));

  return <aside className="attack-node-explanation" aria-label="Selected node explanation">
    <header>
      <div><small>{step.stage}</small><h2>{step.node.label}</h2></div>
      <button className="attack-explanation-close" onClick={onClose} aria-label="Close node explanation" title="Close explanation"><X size={16} /></button>
    </header>
    <p aria-live="polite">{step.explanation}</p>
    {nextNodes.length > 0 && <div className="attack-explanation-next">
      <strong>Next in the path</strong>
      <div>{nextNodes.map(node => <button key={node.id} onClick={() => onSelectNode(node)}>{node.label}<ArrowUpRight size={12} /></button>)}</div>
    </div>}
    <details key={nodeId}>
      <summary>How to reduce this risk</summary>
      <p>{step.control}</p>
    </details>
  </aside>;
}
