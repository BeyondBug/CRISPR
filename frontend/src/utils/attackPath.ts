import type { AttackPath, AttackPathEdge, AttackPathNode } from '../types';

const TRANSITIONS: Record<string, string> = {
  'publicly reachable': 'Anyone on the internet can reach the store API. Public access is the starting point for this scenario.',
  'credential exposed': 'An API credential is exposed by this service. Someone who obtains it could use the account linked to that credential.',
  'authenticates as': 'This credential can authenticate as the store service account. Its permissions determine what an outsider could reach next.',
  'can read customer orders': 'The service account can read customer orders. If the exposed credential is used, customer names, addresses and order details could be accessed.',
  'can manage payments': 'The same account can manage the payment service, extending potential access beyond customer orders.',
  'can read and update payments': 'Access to the payment service could allow payment records to be read or changed.',
  'can download customer exports': 'The account can download customer exports. This creates another route to sensitive customer data.',
  'internet exposed': 'Public exposure makes this resource reachable from outside the organization.',
  'routes traffic': 'Application traffic can move from the gateway into this service.',
  'exploitable finding': 'A vulnerability finding is attached to this service. Review the finding to validate whether it can be exploited.',
  'assumes role': 'The recorded relationship connects the finding to a privileged role. Access to that role could enable the next step.',
  'admin access': 'This role has administrative access to the next workload, increasing the reach of a compromised identity.',
  'reads and writes': 'Recorded read and write access could expose or alter the data stored here.',
  'legacy route': 'The gateway also exposes a legacy application route that needs its own access controls.',
  'export permission': 'Export permission could allow sensitive data to leave this resource.',
  'remote access': 'A remote-access service creates a route from the internet into the environment.',
  'stolen session': 'The route includes a stolen-session scenario that could bypass a normal sign-in.',
  'admin network access': 'Administrative network access creates a route into the control plane.',
  'service token access': 'A service token provides a permission link to the next resource.',
  'remote desktop': 'Remote desktop access connects these two systems.',
  'credential reuse': 'Reused credentials could allow access to another system.',
  'phishing delivery': 'Email is the entry route for a phishing scenario.',
  'malicious attachment': 'A malicious attachment could provide access to this endpoint if opened.',
  'token theft': 'The scenario links the endpoint to a service account through possible token theft.',
  'privileged login': 'A privileged account can sign in to this application.',
  'database write': 'Write permission could allow business records to be changed.',
  'public webhook': 'A public webhook exposes a connection into the build system.',
  'secret exposure': 'Exposed deployment credentials could provide access beyond the build system.',
  'cluster admin': 'Cluster administrator permissions could extend access across production workloads.',
  'image push': 'Image-push permissions could allow changes to the container supply chain.',
  'workload identity': 'A workload identity provides an access link to this data resource.',
  'domain admin access': 'Domain administrator access connects this system to backup management.',
  'backup policy control': 'Control over backup policy could affect recovery and business continuity.',
};

const CONTROLS: Record<string, string> = {
  internet: 'Reduce public exposure and allow only the entry points the business needs.',
  api: 'Restrict ingress and require strong authentication on exposed routes.',
  compute: 'Harden the workload and restrict access to the next resource in the route.',
  identity: 'Reduce role permissions and rotate any exposed credentials or tokens.',
  user: 'Require phishing-resistant MFA and review privileged access.',
  vulnerability: 'Remediate the finding and validate the fix with fresh evidence.',
  database: 'Limit read and write access to approved services and audit data access.',
  data: 'Restrict export permissions and review who can access sensitive data.',
  storage: 'Remove broad storage permissions and audit access to sensitive objects.',
  network: 'Segment the network and restrict administrative connectivity.',
};

export function describeAttackStep(path: AttackPath, index: number): {
  node: AttackPathNode; incoming?: AttackPathEdge; stage: string; explanation: string; control: string;
} | null {
  const node = path.nodes[index];
  if (!node) return null;
  const previous = path.nodes[index - 1];
  // Only describe a transition when the supplied evidence connects the two steps.
  const incoming = previous ? path.edges.find(edge => edge.source === previous.id && edge.target === node.id) : undefined;
  const relation = incoming?.label?.toLowerCase().replace(/_/g, ' ').trim();
  const stage = index === 0 ? 'Entry point' : index === path.nodes.length - 1 ? 'Business target'
    : node.type === 'vulnerability' ? 'Security weakness' : ['identity', 'user'].includes(node.type) ? 'Permissions & access' : 'Connected resource';
  const explanation = index === 0
    ? node.type === 'internet' ? 'Start outside the organization. Follow the numbered connections to see which business asset this route can reach.' : 'This is the first recorded resource in the selected route.'
    : !incoming ? 'No direct relationship was supplied between this step and the previous resource. Validate the missing connection before treating this as a continuous route.'
    : relation && TRANSITIONS[relation] ? TRANSITIONS[relation]
    : `The supplied evidence connects ${previous.label} to ${node.label}${incoming.label ? ` through “${incoming.label}”` : ''}. Validate this relationship before assuming an attacker can use it.`;
  const demoControl = path.demo && ['Exposed API Credential', 'Exposed Deployment Token'].includes(node.id)
    ? 'Revoke and rotate the exposed credential, remove it from public responses or files, and check for reuse.'
    : path.demo && node.id === 'Store Service Account' ? 'Give this account only the permissions the store needs. Separate access to orders, payments and customer exports.' : undefined;
  return { node, incoming, stage, explanation: path.demo && node.description && (index === 0 || incoming) ? node.description : explanation, control: demoControl ?? CONTROLS[node.type] ?? 'Review this relationship and restrict unnecessary access before validating the route again.' };
}

export function routeMetric(value: number | undefined, format: (value: number) => string): string {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? format(value) : 'Not provided';
}
