// ============================================================================
// CRISPR — Core domain types
// ----------------------------------------------------------------------------
// These types describe the shape of data flowing through the whole app,
// regardless of whether it originated from the real backend (VITE_API_MODE=live)
// or the deterministic demo engine / fixtures (VITE_API_MODE=demo).
//
// Legacy entities (Asset/Finding/RiskCase/Compliance) keep the snake_case
// field names already used throughout the existing pages (Findings.tsx,
// Assets.tsx, Risks.tsx, FinancialDashboard.tsx, ...) so we do not have to
// rewrite working code. New domain entities introduced in this pass
// (Repository, Integration, AttackPath, PipelineStage, TimelineEvent,
// Scenario, Vulnerability/SCA) use camelCase since there are no legacy
// consumers to preserve.
// ============================================================================

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export type FindingStatus = 'OPEN' | 'VALIDATED' | 'TRIAGED' | 'RESOLVED' | 'SUPPRESSED';

export type RiskCaseStatus = 'ACTIVE' | 'INVESTIGATING' | 'REMEDIATING' | 'RESOLVED' | 'SUPPRESSED';

export type SourceType =
  | 'BUG_BOUNTY'
  | 'VULNERABILITY_SCANNER'
  | 'XDR'
  | 'IAM'
  | 'THREAT_INTEL'
  | 'SIEM'
  | 'EDR'
  | 'CSPM'
  | 'SAST'
  | 'SCA'
  | 'CODE_REPO';

export interface Owner {
  name: string;
  initials: string;
  team?: string;
}

// ----------------------------------------------------------------------------
// Executive metrics (dashboard KPI grid)
// ----------------------------------------------------------------------------
export interface SecurityMetric {
  id: string;
  label: string;
  value: number | string;
  unit?: string;
  previousValue?: number;
  trendPct?: number; // signed
  trendDirection?: 'up' | 'down' | 'flat';
  trendGood?: boolean; // whether the trend direction is a good thing
  status?: Severity | 'GOOD' | 'NEUTRAL';
  icon?: string; // key into icon registry
  tooltip?: string;
  sparkline?: number[];
  /** navigation target when the metric card is clicked */
  navigateTo?: string;
  /** filter params applied at navigateTo, e.g. { severity: 'CRITICAL' } */
  navigateFilter?: Record<string, string>;
}

// ----------------------------------------------------------------------------
// Assets (legacy snake_case, matches existing mock/API + pages)
// ----------------------------------------------------------------------------
export interface AssetControls {
  mfa_pct: number;
  edr_pct: number;
  waf: boolean;
  patching_pct: number;
  segmentation: boolean;
}

export interface Asset {
  asset_id: string;
  name: string;
  type: string;
  business_unit: string;
  business_service: string;
  criticality: number;
  data_sensitivity: number;
  revenue_dependency: number;
  internet_facing: boolean;
  is_regulated: boolean;
  value_inr: number;
  business_criticality: number;
  criticality_breakdown?: Record<string, { normalized_value: number; weight: number; contribution: number }>;
  control_effectiveness: number;
  controls?: AssetControls;
  environment?: 'production' | 'staging' | 'development';
  owner?: Owner;
  lastObserved?: string;
}

// ----------------------------------------------------------------------------
// Findings (legacy snake_case)
// ----------------------------------------------------------------------------
export interface Finding {
  finding_id: string;
  source_type: SourceType;
  source_name: string;
  asset_id: string;
  finding_type: string;
  title: string;
  cve?: string;
  cvss?: number;
  exploited_in_wild?: boolean;
  patch_available?: boolean;
  severity: Severity;
  confidence: number; // 0..1
  first_seen: string;
  last_seen?: string;
  status: FindingStatus;
  owner?: Owner;
  category?: string;
  exposure?: 'INTERNET' | 'INTERNAL' | 'ISOLATED';
  remediation?: string;
}

// ----------------------------------------------------------------------------
// Risk cases (legacy snake_case)
// ----------------------------------------------------------------------------
export interface RiskDriver {
  factor: string;
  points: number;
  direction: 'up' | 'down';
}

export interface LossBreakdown {
  downtime_loss: number;
  ir_cost: number;
  recovery_cost: number;
  data_breach_cost: number;
  regulatory_cost: number;
  reputation_cost: number;
  total_inr: number;
}

export interface RiskCase {
  asset_id: string;
  asset_name: string;
  business_service: string;
  business_criticality: number;
  criticality_breakdown?: Record<string, { normalized_value: number; weight: number; contribution: number }>;
  eal_inr: number;
  eal_lakh: number;
  risk_score: number;
  likelihood: number;
  control_effectiveness_pct: number;
  control_effectiveness_evidence?: {
    source: string;
    formula: string;
    current_posture: Record<string, number | boolean>;
    calculated_effectiveness: number;
  };
  sources: SourceType[];
  confidence_pct: number;
  loss_breakdown: LossBreakdown;
  risk_drivers: RiskDriver[];
  status?: RiskCaseStatus;
  owner?: Owner;
  lastUpdated?: string;
  severity?: Severity;
  exposure?: 'INTERNET' | 'INTERNAL' | 'ISOLATED';
  exploitation_priority?: {
    score?: number | null;
    ranking_score?: number | null;
    tier?: string | null;
    model?: string | null;
    model_version?: string | null;
    semantics: string;
  };
  annual_frequency?: {
    probability: number;
    semantics: string;
    evidence?: Record<string, unknown>;
  };
  model_contributions?: {
    base_value: number;
    note: string;
    top_contributors: Array<{ feature: string; shap_value: number }>;
  } | null;
}

// ----------------------------------------------------------------------------
// Repositories & Code Security (new, camelCase)
// ----------------------------------------------------------------------------
export type RepoProvider = 'github' | 'gitlab' | 'azure_devops' | 'bitbucket';

export interface RepositoryIssuesSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface Repository {
  id: string;
  name: string; // e.g. codesmiths/payments-service
  provider: RepoProvider;
  defaultBranch: string;
  securityScore: number; // 0-100
  lastScan: string;
  criticalIssues: number;
  openVulnerabilities: number;
  secrets: number;
  dependencies: number;
  iacIssues: number;
  owners: Owner[];
  issues: RepositoryIssuesSummary;
  language?: string;
  framework?: string;
}

export interface CodeIssue {
  id: string;
  rule: string;
  issues: number;
  risks: string[]; // icon keys: e.g. 'public', 'privileged', 'secret'
  severity: Severity;
  repository: string;
  branch: string;
  framework?: string;
  status: 'OPEN' | 'FIXED' | 'IN_PROGRESS';
  category: 'iac' | 'secrets' | 'sca' | 'malware' | 'dspm' | 'posture';
}

export interface SCAFinding {
  id: string;
  cve: string;
  severity: Severity;
  component: string;
  version: string;
  fixedVersion?: string;
  reachable: boolean;
  exploitAvailable: boolean;
  status: 'OPEN' | 'FIXED' | 'IN_PROGRESS';
  repository: string;
}

// ----------------------------------------------------------------------------
// Integrations / sources (new, camelCase)
// ----------------------------------------------------------------------------
export type IntegrationCategory =
  | 'code'
  | 'cloud'
  | 'collaboration'
  | 'ticketing'
  | 'siem'
  | 'edr'
  | 'bug_bounty'
  | 'identity'
  | 'sast'
  | 'sca';

export type IntegrationStatus = 'connected' | 'disconnected' | 'connecting' | 'error' | 'syncing';

export interface Integration {
  id: string;
  key: string; // maps into icon/logo registry
  name: string;
  category: IntegrationCategory;
  status: IntegrationStatus;
  lastSync?: string;
  itemsIngested: number;
  errors: number;
  description: string;
}

// ----------------------------------------------------------------------------
// Attack paths (new, camelCase)
// ----------------------------------------------------------------------------
export type AttackNodeType =
  | 'internet'
  | 'api'
  | 'identity'
  | 'compute'
  | 'database'
  | 'storage'
  | 'network'
  | 'user'
  | 'data'
  | 'vulnerability';

export interface AttackPathNode {
  id: string;
  label: string;
  type: AttackNodeType;
  severity?: Severity;
  owner?: string;
  environment?: string;
  description?: string;
  x?: number;
  y?: number;
}

export interface AttackPathEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  risky?: boolean;
}

export interface AttackPath {
  id: string;
  title: string;
  riskCaseId?: string;
  severity: Severity;
  nodes: AttackPathNode[];
  edges: AttackPathEdge[];
  risk_score?: number;
  confidence?: number;
  financial_impact_inr?: number;
  demo?: boolean;
  scenario_summary?: string;
}

// ----------------------------------------------------------------------------
// Remediation scenarios (new, camelCase — separate from legacy "Scenarios" what-if sim)
// ----------------------------------------------------------------------------
export type ScenarioStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'PR_OPENED' | 'BLOCKED' | 'AT_RISK' | 'RESOLVED' | 'VERIFIED';

export interface RemediationScenario {
  id: string;
  title: string;
  finding: string;
  affectedResource: string;
  recommendedFix: string;
  priority: Severity;
  estimatedEffort: string;
  riskReductionInr: number;
  owner?: Owner;
  status: ScenarioStatus;
  repository?: string;
  branch?: string;
  version?: number;
  ticketKey?: string;
  plannedDueAt?: string;
  forecastDueAt?: string;
  capabilityStatus?: 'READY' | 'READY_WITH_REVIEW' | 'TRAINING_REQUIRED' | 'SPECIALIST_REQUIRED' | 'UNKNOWN';
  backupOwner?: Owner;
  realizedRiskReductionInr?: number;
  openDeliveryIssues?: number;
}

// ----------------------------------------------------------------------------
// Timeline / demo engine
// ----------------------------------------------------------------------------
export interface TimelineEvent {
  id: string;
  timestamp: string;
  label: string;
  detail?: string;
  kind: 'info' | 'success' | 'warning' | 'error';
}

export type PipelineStageState = 'idle' | 'processing' | 'completed' | 'warning' | 'failed';

export interface PipelineStage {
  id: string;
  label: string;
  state: PipelineStageState;
  itemCount: number;
  lastExecution?: string;
  durationMs?: number;
}

// ----------------------------------------------------------------------------
// Command palette
// ----------------------------------------------------------------------------
export type CommandResultType =
  | 'asset'
  | 'finding'
  | 'risk_case'
  | 'repository'
  | 'vulnerability'
  | 'report'
  | 'page'
  | 'user';

export interface CommandResult {
  id: string;
  type: CommandResultType;
  title: string;
  subtitle?: string;
  path: string;
}

// ----------------------------------------------------------------------------
// Toasts
// ----------------------------------------------------------------------------
export type ToastKind = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  description?: string;
  ttlMs?: number;
}

// ----------------------------------------------------------------------------
// Global dashboard filters
// ----------------------------------------------------------------------------
export interface DashboardFilters {
  timeRange: '7d' | '30d' | '90d' | '6m' | '1y';
  environment: 'all' | 'production' | 'staging' | 'development';
  severity: 'all' | Severity;
  source: 'all' | SourceType;
  owner: 'all' | string;
}

// ----------------------------------------------------------------------------
// A generic project wrapper (kept for API-parity with spec's requested type list)
// ----------------------------------------------------------------------------
export interface Project {
  id: string;
  name: string;
  organization: string;
  environment: string;
}

// ----------------------------------------------------------------------------
// Vulnerability (generic wrapper distinct from SCAFinding, used by /vulnerabilities page)
// ----------------------------------------------------------------------------
export interface Vulnerability {
  id: string;
  cve: string;
  severity: Severity;
  cvss: number | null;
  component: string;
  affectedAssets: string[];
  exploitAvailable: boolean | null;
  patchAvailable: boolean | null;
  status: FindingStatus;
}
