import { useEffect, useState } from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';
import Drawer from '../common/Drawer';
import SeverityBadge from '../common/SeverityBadge';
import SourcePill from '../common/SourcePill';
import RiskScoreBadge from '../common/RiskScoreBadge';
import AttackPathGraph from '../attackpath/AttackPathGraph';
import { formatLakh, formatRupees, riskColor } from '../../utils/format';
import { ATTACK_PATHS } from '../../demo/fixtures';
import { toast } from '../../lib/toastStore';
import type { RiskCase } from '../../types';
import { getRiskCase } from '../../lib/api';

interface Props {
  riskCase: RiskCase | null;
  open: boolean;
  onClose: () => void;
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'attack-path', label: 'Attack Path' },
  { id: 'related', label: 'Related' },
  { id: 'timeline', label: 'Timeline' },
];

function severityFromScore(score: number): 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' {
  if (score >= 80) return 'CRITICAL';
  if (score >= 60) return 'HIGH';
  if (score >= 40) return 'MEDIUM';
  return 'LOW';
}

export default function RiskCaseDrawer({ riskCase, open, onClose }: Props) {
  const [tab, setTab] = useState('overview');
  const [explainedRisk, setExplainedRisk] = useState<RiskCase | null>(null);
  const [explanationLoading, setExplanationLoading] = useState(false);

  useEffect(() => {
    if (!open || !riskCase) return;
    let active = true;
    setExplainedRisk(null);
    setExplanationLoading(true);
    getRiskCase(riskCase.asset_id)
      .then((value) => { if (active && value) setExplainedRisk(value); })
      .finally(() => { if (active) setExplanationLoading(false); });
    return () => { active = false; };
  }, [open, riskCase?.asset_id]);

  if (!riskCase) return null;

  const detail = explainedRisk ?? riskCase;

  const severity = riskCase.severity ?? severityFromScore(riskCase.risk_score);
  const matchingPath = ATTACK_PATHS.find((p) => p.riskCaseId === riskCase.asset_id);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={riskCase.asset_name}
      subtitle={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SeverityBadge severity={severity} />
          <span>{riskCase.business_service}</span>
        </span>
      }
      headerExtra={<RiskScoreBadge score={riskCase.risk_score} size={40} />}
      tabs={TABS}
      activeTab={tab}
      onTabChange={setTab}
      footer={
        <>
          <button className="btn-primary" onClick={() => toast.success('Assigned', `${riskCase.asset_name} assigned to the owning team.`)}>
            Assign
          </button>
          <button className="btn-secondary" onClick={() => toast.warning('Risk case suppressed')}>
            Suppress
          </button>
          <button className="btn-secondary" onClick={() => toast.success('Scenario created', 'Opened in the Scenarios simulator.')}>
            Create Scenario
          </button>
          <button className="btn-secondary" onClick={() => toast.success('Marked resolved', riskCase.asset_name)}>
            Mark Resolved
          </button>
          <button className="btn-secondary" onClick={() => toast.info('Export started', `${riskCase.asset_id}-risk-case.pdf`)}>
            Export
          </button>
        </>
      }
    >
      {tab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
            <div className="card" style={{ padding: 12 }}>
              <div style={{ fontSize: '0.625rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Expected Annual Loss</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 500, color: riskColor(riskCase.risk_score) }}>{formatLakh(riskCase.eal_lakh)}</div>
            </div>
            <div className="card" style={{ padding: 12 }}>
              <div style={{ fontSize: '0.625rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Likelihood</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 500, color: 'var(--text-primary)' }}>{Math.round(riskCase.likelihood * 100)}%</div>
            </div>
            <div className="card" style={{ padding: 12 }}>
              <div style={{ fontSize: '0.625rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Confidence</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 500, color: 'var(--text-primary)' }}>{riskCase.confidence_pct}%</div>
            </div>
          </div>

          <div>
            <div className="card-title">Business Impact</div>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
              {riskCase.asset_name} supports <strong style={{ color: 'var(--text-primary)' }}>{riskCase.business_service}</strong> with a business
              criticality of {riskCase.business_criticality}/100. Current control effectiveness is {riskCase.control_effectiveness_pct}%, leaving a
              residual exposure of {formatRupees(riskCase.loss_breakdown.total_inr)} per incident.
            </p>
          </div>

          <div>
            <div className="card-title">Risk Drivers</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {riskCase.risk_drivers.map((d, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem' }}>
                  {d.direction === 'up' ? <ArrowUp size={13} color="var(--sev-critical)" /> : <ArrowDown size={13} color="var(--sev-low)" />}
                  <span style={{ fontWeight: 600, color: d.direction === 'up' ? 'var(--sev-critical)' : 'var(--sev-low)', width: 36 }}>
                    {d.points > 0 ? '+' : ''}
                    {d.points}
                  </span>
                  <span style={{ color: 'var(--text-muted)' }}>{d.factor}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="card-title">Correlated Sources</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(riskCase.sources ?? []).map((s) => (
                <SourcePill key={s} source={s} />
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'evidence' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="terminal-window" style={{ height: 'auto' }}>
            <div className="terminal-line-info">// source findings backing this risk case</div>
            {(riskCase.sources ?? []).map((s, i) => (
              <div key={i} className="terminal-line-ok">[OK] {s} — corroborating evidence validated</div>
            ))}
            <div className="terminal-line-result">Confidence: {riskCase.confidence_pct}%</div>
          </div>

          <div className="card" style={{ padding: 14 }}>
            <div className="card-title">Financial Frequency Evidence</div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Annual incident probability: <strong style={{ color: 'var(--text-primary)' }}>{Math.round((detail.annual_frequency?.probability ?? detail.likelihood) * 1000) / 10}%</strong><br />
              Semantics: {detail.annual_frequency?.semantics ?? 'Frequency evidence not returned'}
              {detail.annual_frequency?.evidence && Object.entries(detail.annual_frequency.evidence).map(([key, value]) => value == null || typeof value === 'object' ? null : (
                <div key={key}><span style={{ textTransform: 'capitalize' }}>{key.replace(/_/g, ' ')}</span>: <strong style={{ color: 'var(--text-primary)' }}>{String(value)}</strong></div>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: 14 }}>
            <div className="card-title">Asset Criticality Components</div>
            {Object.entries(detail.criticality_breakdown ?? {}).map(([key, item]) => (
              <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0', fontSize: '0.8125rem' }}>
                <span style={{ color: 'var(--text-muted)', textTransform: 'capitalize' }}>{key.replace(/_/g, ' ')} ({Math.round(item.weight * 100)}%)</span>
                <strong>+{item.contribution.toFixed(1)}</strong>
              </div>
            ))}
          </div>

          <div className="card" style={{ padding: 14 }}>
            <div className="card-title">Control Effectiveness Evidence</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 8 }}>{detail.control_effectiveness_evidence?.source}</div>
            {Object.entries(detail.control_effectiveness_evidence?.current_posture ?? {}).map(([key, value]) => (
              <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '3px 0', fontSize: '0.8125rem' }}>
                <span style={{ textTransform: 'capitalize' }}>{key.replace(/_/g, ' ')}</span><strong>{typeof value === 'boolean' ? (value ? 'Enabled' : 'Disabled') : `${Math.round(value * 100)}%`}</strong>
              </div>
            ))}
            {detail.control_effectiveness_evidence?.formula && <div style={{ marginTop: 8, fontSize: '0.6875rem', color: 'var(--text-subtle)' }}>{detail.control_effectiveness_evidence.formula}</div>}
          </div>

          <div className="card" style={{ padding: 14 }}>
            <div className="card-title">CVE Exploitation Prioritization · SHAP</div>
            {explanationLoading && <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Loading explanation…</div>}
            {!explanationLoading && detail.model_contributions?.top_contributors?.map((item) => (
              <div key={item.feature} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '5px 0', fontSize: '0.8125rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>{item.feature.replace(/_/g, ' ')}</span>
                <strong style={{ color: item.shap_value >= 0 ? 'var(--sev-critical)' : 'var(--sev-low)' }}>
                  {item.shap_value >= 0 ? '+' : ''}{item.shap_value.toFixed(4)}
                </strong>
              </div>
            ))}
            {!explanationLoading && !detail.model_contributions && (
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>No deployed-model explanation is available for this record.</div>
            )}
            {detail.model_contributions?.note && <div style={{ marginTop: 8, fontSize: '0.6875rem', color: 'var(--text-subtle)' }}>{detail.model_contributions.note}</div>}
          </div>
        </div>
      )}

      {tab === 'attack-path' && (
        matchingPath ? (
          <AttackPathGraph path={matchingPath} height={280} />
        ) : (
          <div className="empty-state">No attack path has been mapped for this risk case yet.</div>
        )
      )}

      {tab === 'related' && (
        <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>
            Related asset: <strong style={{ color: 'var(--text-primary)' }}>{riskCase.asset_id}</strong>
          </div>
          <div>
            Business service: <strong style={{ color: 'var(--text-primary)' }}>{riskCase.business_service}</strong>
          </div>
        </div>
      )}

      {tab === 'timeline' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { label: 'Risk case opened by correlation engine', at: '2026-08-01' },
            { label: `Confidence elevated to ${riskCase.confidence_pct}% after multi-source correlation`, at: '2026-08-10' },
            { label: 'Last updated', at: riskCase.lastUpdated ?? '2026-08-24' },
          ].map((h, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, fontSize: '0.8125rem' }}>
              <span style={{ color: 'var(--text-subtle)', width: 90, flexShrink: 0 }}>{h.at}</span>
              <span style={{ color: 'var(--text-muted)' }}>{h.label}</span>
            </div>
          ))}
        </div>
      )}
    </Drawer>
  );
}
