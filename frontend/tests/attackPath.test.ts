import assert from 'node:assert/strict';
import test from 'node:test';
import { describeAttackStep, routeMetric } from '../src/utils/attackPath.ts';

const route = {
  id: 'route', title: 'Entry → Data', severity: 'HIGH' as const,
  nodes: [
    { id: 'outside', label: 'Internet', type: 'internet' as const },
    { id: 'service', label: 'Payment Service', type: 'compute' as const },
    { id: 'data', label: 'Payment Database', type: 'database' as const },
  ],
  edges: [{ id: 'access', source: 'service', target: 'data', label: 'reads and writes' }],
};
test('a missing hop is explained as missing evidence, never implied access', () => {
  const step = describeAttackStep(route, 1);
  assert.equal(step?.incoming, undefined);
  assert.match(step?.explanation ?? '', /No direct relationship/);
});
test('a supplied hop retains its actual evidence and identifies the target', () => {
  const step = describeAttackStep(route, 2);
  assert.equal(step?.incoming?.id, 'access');
  assert.equal(step?.stage, 'Business target');
  assert.match(step?.explanation ?? '', /read and write/);
  assert.equal(describeAttackStep(route, 3), null);
});
test('an unknown relationship is explained without inventing an exploit', () => {
  const unknown = { ...route, edges: [{ ...route.edges[0], label: 'custom relationship' }] };
  assert.match(describeAttackStep(unknown, 2)?.explanation ?? '', /custom relationship/);
  assert.match(describeAttackStep(unknown, 2)?.explanation ?? '', /Validate this relationship/);
});
test('missing and invalid financial metadata is not shown as zero exposure', () => {
  for (const value of [undefined, 0, -5, NaN, Infinity]) assert.equal(routeMetric(value, String), 'Not provided');
  assert.equal(routeMetric(5000, String), '5000');
});

test('a demo description cannot disguise a missing relationship as a continuous attack step', () => {
  const description = 'An attacker uses the exposed credential to reach this workload.';
  const demo = { ...route, demo: true, nodes: route.nodes.map(node => ({ ...node, description })) };
  const missing = describeAttackStep(demo, 1);
  assert.equal(missing?.incoming, undefined);
  assert.match(missing?.explanation ?? '', /No direct relationship/);
  assert.notEqual(missing?.explanation, description);
  assert.equal(describeAttackStep(demo, 2)?.explanation, description, 'descriptions may explain a supplied relationship');
});

test('demo exposed-credential controls recommend revocation and rotation rather than a vulnerability patch', () => {
  for (const credentialId of ['Exposed API Credential', 'Exposed Deployment Token']) {
    const demo = {
      ...route, demo: true,
      nodes: [route.nodes[0], { id: credentialId, label: credentialId, type: 'vulnerability' as const }, route.nodes[2]],
      edges: [{ id: 'exposure', source: 'outside', target: credentialId, label: 'credential exposed' }],
    };
    const control = describeAttackStep(demo, 1)?.control ?? '';
    assert.match(control, /Revoke and rotate/);
    assert.match(control, /remove it from public/);
    assert.match(control, /check for reuse/);
    assert.doesNotMatch(control, /patch/i);
    assert.match(describeAttackStep({ ...demo, demo: false }, 1)?.control ?? '', /Remediate the finding/, 'live evidence must not receive a demo-specific story just because its label matches');
  }
});
