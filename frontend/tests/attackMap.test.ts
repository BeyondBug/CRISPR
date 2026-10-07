import assert from 'node:assert/strict';
import test from 'node:test';
import { attackEdgeKey, combineAttackPaths, layoutAttackMap, reachableWithoutResource, relatedAttackPaths, selectedAttackEdges } from '../src/utils/attackMap.ts';
import type { AttackPath, AttackPathNode } from '../src/types/index.ts';

const node = (id: string, type: AttackPathNode['type'] = 'compute'): AttackPathNode => ({ id, label: id, type });
const path = (id: string, nodes: AttackPathNode[], connections: [string, string, string?][]): AttackPath => ({
  id, title: id, severity: 'HIGH', nodes,
  edges: connections.map(([source, target, label], index) => ({ id: `${id}-${index}`, source, target, label })),
});
const focused = path('payment', [node('internet', 'internet'), node('gateway', 'api'), node('authentication'), node('role', 'identity'), node('payments', 'database')], [
  ['internet', 'gateway', 'public exposure'], ['gateway', 'authentication', 'routes traffic'],
  ['authentication', 'role', 'assumes role'], ['role', 'payments', 'reads data'],
]);

test('related branches share an internal resource, not only the internet or a terminal target', () => {
  const related = path('legacy', [node('internet', 'internet'), node('gateway', 'api'), node('legacy'), node('customer-data', 'data')], [['internet', 'gateway'], ['gateway', 'legacy'], ['legacy', 'customer-data']]);
  const internetOnly = path('vpn', [node('internet', 'internet'), node('vpn', 'api'), node('backups', 'data')], [['internet', 'vpn'], ['vpn', 'backups']]);
  const targetOnly = path('other-payments', [node('other-entry', 'internet'), node('workload'), node('payments', 'database')], [['other-entry', 'workload'], ['workload', 'payments']]);
  assert.deepEqual(relatedAttackPaths([focused, internetOnly, targetOnly, related], focused).map(item => item.id), ['legacy']);
});

test('combining routes preserves different relationship evidence while deduplicating shared resources and hops', () => {
  const alternative = path('alternative', [node('gateway', 'api'), node('authentication'), node('audit', 'data')], [
    ['gateway', 'authentication', 'routes traffic'], ['gateway', 'authentication', 'admin access'], ['authentication', 'audit', 'exports'],
  ]);
  const original = JSON.stringify([focused, alternative]);
  const merged = combineAttackPaths([focused, alternative], 'combined');
  assert.equal(merged.nodes.length, 6);
  assert.equal(merged.edges.length, 6);
  assert.deepEqual(merged.edges.filter(edge => edge.source === 'gateway' && edge.target === 'authentication').map(edge => edge.label).sort(), ['admin access', 'routes traffic']);
  assert.equal(merged.edges.some(edge => edge.source === 'authentication' && edge.target === 'audit' && edge.label === 'exports'), true);
  assert.equal(JSON.stringify([focused, alternative]), original, 'merging must not alter source evidence');
});

test('focused branches stay separate from the selected route and use supplied connections only', () => {
  const related = path('legacy', [node('gateway', 'api'), node('legacy'), node('customer-data', 'data')], [['gateway', 'legacy'], ['legacy', 'customer-data']]);
  const disconnected = path('isolated', [node('isolated', 'data')], []);
  const merged = combineAttackPaths([focused, related, disconnected], 'map');
  const before = JSON.stringify(merged);
  const positions = layoutAttackMap(merged, focused);
  assert.equal(positions.size, merged.nodes.length);
  assert.ok(positions.get('legacy')!.x > positions.get('gateway')!.x);
  assert.ok(positions.get('customer-data')!.x > positions.get('legacy')!.x);
  assert.notEqual(positions.get('legacy')!.y, positions.get('authentication')!.y);
  assert.equal(new Set([...positions.values()].map(point => `${point.x}:${point.y}`)).size, positions.size);
  assert.equal(JSON.stringify(merged), before, 'layout must not invent connections or rewrite evidence');
});

test('overview handles cycles and disconnected components without dropping or overlapping resources', () => {
  const evidence = path('cycle', [node('a'), node('b'), node('c'), node('isolated'), node('second-root'), node('child')], [
    ['a', 'b'], ['b', 'c'], ['c', 'a'], ['second-root', 'child'],
  ]);
  const positions = layoutAttackMap(evidence);
  assert.deepEqual([...positions.keys()].sort(), evidence.nodes.map(item => item.id).sort());
  assert.equal(new Set([...positions.values()].map(point => `${point.x}:${point.y}`)).size, evidence.nodes.length, 'disconnected roots must not hide one another');
  assert.ok([...positions.values()].every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
});

test('missing relationships leave distinct resources visible without synthesizing a hop', () => {
  const evidence = path('missing-hop', [node('entry', 'internet'), node('service'), node('data', 'database')], []);
  const original = JSON.stringify(evidence);
  const positions = layoutAttackMap(evidence);
  assert.equal(positions.size, 3);
  assert.equal(new Set([...positions.values()].map(point => `${point.x}:${point.y}`)).size, 3);
  assert.equal(JSON.stringify(evidence), original);
});

test('dangling relationship endpoints do not create phantom map resources', () => {
  const evidence = path('incomplete', [node('entry', 'internet'), node('data', 'database')], [['entry', 'missing-resource'], ['missing-source', 'data']]);
  const positions = layoutAttackMap(evidence);
  assert.deepEqual([...positions.keys()].sort(), ['data', 'entry']);
  assert.equal(evidence.edges.length, 2, 'original evidence should remain available for inspection');
});

test('blocking a shared account interrupts every target reached exclusively through that account', () => {
  const evidence = path('shared-account', [node('internet', 'internet'), node('store', 'api'), node('credential', 'vulnerability'), node('account', 'identity'), node('orders', 'data'), node('payments', 'database')], [
    ['internet', 'store'], ['store', 'credential'], ['credential', 'account'], ['account', 'orders'], ['account', 'payments'],
  ]);
  assert.equal(reachableWithoutResource(evidence, 'not-blocked').has('orders'), true);
  assert.equal(reachableWithoutResource(evidence, 'not-blocked').has('payments'), true);
  const before = JSON.stringify(evidence);
  const reached = reachableWithoutResource(evidence, 'account');
  assert.deepEqual([...reached].sort(), ['credential', 'internet', 'store']);
  assert.equal(JSON.stringify(evidence), before, 'a control preview must not modify recorded relationships');
});

test('an independent alternative route stays reachable when a shared account is blocked', () => {
  const evidence = path('alternative-access', [node('internet', 'internet'), node('account', 'identity'), node('independent-api', 'api'), node('orders', 'data'), node('payments', 'database')], [
    ['internet', 'account'], ['account', 'orders'], ['account', 'payments'], ['internet', 'independent-api'], ['independent-api', 'orders'],
  ]);
  const reached = reachableWithoutResource(evidence, 'account');
  assert.equal(reached.has('orders'), true, 'the target still has a recorded alternative route');
  assert.equal(reached.has('payments'), false, 'this target depends on the blocked account');
  assert.equal(reached.has('independent-api'), true);
  assert.equal(reached.has('account'), false);
});

test('reachability safely handles cycles, missing hops and dangling endpoints', () => {
  const evidence = path('cyclic-access', [node('internet', 'internet'), node('a'), node('b'), node('data', 'database'), node('isolated', 'data')], [
    ['internet', 'a'], ['a', 'b'], ['b', 'a'], ['b', 'data'], ['a', 'missing-resource'], ['missing-source', 'isolated'],
  ]);
  assert.deepEqual([...reachableWithoutResource(evidence, 'not-blocked')].sort(), ['a', 'b', 'data', 'internet']);
  assert.deepEqual([...reachableWithoutResource(evidence, 'b')].sort(), ['a', 'internet']);
  assert.equal(reachableWithoutResource(evidence, 'internet').size, 0, 'a blocked entry point cannot seed traversal');
});

test('edge labels remain hidden until a resource is selected', () => {
  for (const selection of [undefined, null, '']) {
    assert.equal(selectedAttackEdges(focused, selection).size, 0);
  }
  assert.equal(selectedAttackEdges(focused, 'unknown-resource').size, 0);
});

test('selection includes all incoming evidence and downstream branches while excluding an upstream sibling', () => {
  const branch = path('branch', [node('gateway', 'api'), node('authentication'), node('legacy'), node('customer-data', 'data')], [
    ['gateway', 'authentication', 'admin access'], ['gateway', 'legacy', 'legacy route'], ['legacy', 'customer-data', 'exports'],
  ]);
  const downstream = path('downstream', [node('role', 'identity'), node('service'), node('exports', 'data')], [
    ['role', 'service', 'can call service'], ['service', 'exports', 'can export data'],
  ]);
  const combined = combineAttackPaths([focused, branch, downstream], 'selected-map');
  const labels = selectedAttackEdges(combined, 'authentication');
  assert.deepEqual([...labels].sort(), [...focused.edges, branch.edges[0], ...downstream.edges].map(attackEdgeKey).sort());
  assert.equal(labels.has(attackEdgeKey(branch.edges[0])), true, 'parallel incoming evidence is part of the upstream path');
  assert.equal(labels.has(attackEdgeKey(branch.edges[1])), false);
  assert.equal(labels.has(attackEdgeKey(branch.edges[2])), false);
});

test('selecting a root labels every downstream branch and a leaf labels only paths leading to it', () => {
  const alternative = path('alternative', [node('gateway', 'api'), node('legacy'), node('exports', 'data')], [
    ['gateway', 'legacy', 'alternate access'], ['legacy', 'exports', 'reads exports'],
  ]);
  const combined = combineAttackPaths([focused, alternative], 'branched-map');
  assert.deepEqual([...selectedAttackEdges(combined, 'internet')].sort(), combined.edges.map(attackEdgeKey).sort());
  assert.deepEqual([...selectedAttackEdges(combined, 'payments')].sort(), focused.edges.map(attackEdgeKey).sort());
  assert.deepEqual([...selectedAttackEdges(combined, 'exports')].sort(), [focused.edges[0], ...alternative.edges].map(attackEdgeKey).sort());
});

test('overview selection labels ancestor and descendant paths but excludes unrelated sibling branches even with cycles', () => {
  const overview = path('overview', [node('internet', 'internet'), node('gateway', 'api'), node('account', 'identity'), node('orders', 'data'), node('service'), node('analytics'), node('report', 'data'), node('sibling'), node('archive', 'data'), node('isolated-a'), node('isolated-b')], [
    ['internet', 'gateway', 'public access'], ['gateway', 'account', 'login'], ['account', 'orders', 'read orders'],
    ['gateway', 'sibling', 'other access'], ['sibling', 'archive', 'read archive'],
    ['account', 'service', 'service access'], ['service', 'account', 'return credential'],
    ['orders', 'analytics', 'export'], ['analytics', 'orders', 'return connection'], ['analytics', 'report', 'generate report'],
    ['isolated-a', 'isolated-b', 'isolated cycle'], ['isolated-b', 'isolated-a', 'cycle return'],
  ]);
  const labels = selectedAttackEdges(overview, 'orders');
  const expected = overview.edges.filter(edge => !['sibling', 'archive', 'isolated-a', 'isolated-b'].includes(edge.source) && !['sibling', 'archive', 'isolated-a', 'isolated-b'].includes(edge.target));
  assert.deepEqual([...labels].sort(), expected.map(attackEdgeKey).sort());
  assert.equal(labels.has(attackEdgeKey(overview.edges[3])), false, 'sharing a gateway alone does not put a sibling edge on the selected path');
  assert.equal(labels.has(attackEdgeKey(overview.edges[4])), false);
});

test('a route can begin at a recorded service without an internet node', () => {
  const evidence = path('service-entry', [node('api', 'api'), node('account', 'identity'), node('data', 'database')], [['api', 'account'], ['account', 'data']]);
  assert.deepEqual([...reachableWithoutResource(evidence, 'account')], ['api']);
});

test('a narrow map keeps every resource distinct and preserves supplied evidence', () => {
  const original = JSON.stringify(focused);
  const positions = layoutAttackMap(focused, focused, true);
  assert.equal(positions.size, focused.nodes.length);
  assert.equal(new Set([...positions.values()].map(point => `${point.x}:${point.y}`)).size, focused.nodes.length);
  assert.ok([...positions.values()].every(point => point.x <= 300));
  assert.equal(JSON.stringify(focused), original);
});
