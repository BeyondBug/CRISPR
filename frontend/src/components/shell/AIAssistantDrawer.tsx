import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Bot, Send, Sparkles, ShieldAlert, Globe, TrendingUp, ScrollText } from 'lucide-react';
import { useUiStore, closeAIDrawer } from '../../lib/uiStore';
import { queryAssistant } from '../../services/api';
import AIMessageMarkdown from '../common/AIMessageMarkdown';

interface Message {
  role: 'user' | 'assistant';
  text: string;
  references?: Array<{ label: string; path: string }>;
}

const SUGGESTED_PROMPTS = [
  { icon: ShieldAlert, text: 'Explain my highest-risk finding' },
  { icon: Globe, text: 'Show exposed assets' },
  { icon: TrendingUp, text: 'Why did risk increase?' },
  { icon: ScrollText, text: "Summarize today's security activity" },
];

const NETWORK_FALLBACKS = [
  {
    matches: ['rosi', 'return on security investment'],
    text: 'ROSI means Return on Security Investment. Formula: (expected annual risk reduction − implementation cost) ÷ implementation cost × 100. CRISPR uses traceable risk-reduction and cost inputs and accounts for overlapping controls.',
    references: [{ label: 'Open Optimizer', path: '/investments' }],
  },
  {
    matches: ['fair', 'factor analysis of information risk'],
    text: 'FAIR means Factor Analysis of Information Risk. It quantifies risk using event frequency and loss magnitude. CRISPR keeps approved annual incident-frequency evidence separate from CVE exploitation priority.',
    references: [{ label: 'View Risk Cases', path: '/risks' }],
  },
  {
    matches: ['expected annual loss', ' eal'],
    text: 'Expected Annual Loss (EAL) is annual incident probability × loss magnitude. It is the modeled average annual loss, not a guaranteed loss for one year.',
    references: [{ label: 'View Financial Dashboard', path: '/financial' }],
  },
  {
    matches: ['p95', 'p99', 'value at risk', 'var', 'expected shortfall', 'tail var'],
    text: 'P95 and P99 Cyber VaR are annual-loss percentiles from the simulated loss distribution. Expected Shortfall is the average loss beyond the selected VaR threshold. These are tail-risk measures, not confidence labels.',
    references: [{ label: 'View Financial Dashboard', path: '/financial' }],
  },
  {
    matches: ['epss', 'kev', 'cvss', 'shap'],
    text: 'CVSS describes technical severity; EPSS estimates near-term exploitation probability; CISA KEV records known exploitation; SHAP explains model feature contributions. CRISPR uses these for CVE prioritization, not directly as annual incident probability or financial loss.',
    references: [{ label: 'View Findings', path: '/findings' }],
  },
  {
    matches: ['attack path'],
    text: 'An attack path is an evidence-backed sequence from an entry point through vulnerabilities, identities, permissions, and services to a valuable target. Controls should interrupt the earliest high-confidence transition.',
    references: [{ label: 'View Attack Paths', path: '/attack-paths' }],
  },
  {
    matches: ['control effectiveness', 'residual risk', 'asset criticality', 'business criticality'],
    text: 'Asset criticality expresses business importance. Control effectiveness measures evidence-backed risk reduction. Residual risk is what remains after controls; multiple controls require marginal, overlap-aware recalculation.',
    references: [{ label: 'View Risk Cases', path: '/risks' }],
  },
  {
    matches: ['siem', 'iam', 'edr', 'xdr', 'cspm', 'cmdb', 'nvd'],
    text: 'CRISPR correlates security and asset evidence: SIEM provides events, IAM provides identity context, EDR/XDR provides detection telemetry, CSPM provides cloud-control gaps, CMDB provides asset context, and NVD provides CVE metadata.',
    references: [{ label: 'View Integrations', path: '/integrations' }],
  },
  {
    matches: ['highest-risk', 'highest risk', 'top risk', 'biggest risk'],
    text: 'Live risk analysis is temporarily unavailable. Open Risk Cases and sort by Expected Annual Loss; review the highest item’s incident-frequency evidence, loss magnitude, asset criticality, and control gaps before prioritizing it.',
    references: [{ label: 'View Risk Cases', path: '/risks' }],
  },
  {
    matches: ['exposed asset', 'internet-facing', 'internet facing', 'public-facing'],
    text: 'Live asset analysis is temporarily unavailable. Open Assets and filter for internet-facing resources, then review exploitable findings, privileged access, missing controls, business criticality, and evidence freshness.',
    references: [{ label: 'View Assets', path: '/assets' }],
  },
  {
    matches: ['risk increase', 'risk increased', 'exposure increase', 'why did risk'],
    text: 'Live trend analysis is temporarily unavailable. Check dated risk snapshots for new findings, newly exposed assets, threat-intelligence changes, weakened controls, stale evidence, and overdue remediation before attributing the increase.',
    references: [{ label: 'View Risk Cases', path: '/risks' }],
  },
  {
    matches: ['security activity', 'activity summary', "today's activity", 'todays activity'],
    text: "Live activity analysis is temporarily unavailable. Review Findings for newly detected critical or high items and the Developer Queue for assignments, status changes, overdue work, and remediation-verification results.",
    references: [{ label: 'View Findings', path: '/findings' }, { label: 'View Queue', path: '/remediation-queue' }],
  },
  {
    matches: ['mfa', 'multi-factor', 'multifactor'],
    text: 'The scenario service is temporarily unavailable. MFA normally reduces credential and privileged-access risk, but CRISPR will not estimate financial reduction until the deterministic scenario engine reconnects.',
    references: [{ label: 'Open Scenarios', path: '/scenarios' }],
  },
  {
    matches: ['budget', 'invest', 'spend', 'optimiz'],
    text: 'The optimization service is temporarily unavailable. Review Recommendations by verified marginal risk reduction, implementation cost, overlap with other controls, and delivery constraints; no investment value will be estimated offline.',
    references: [{ label: 'View Recommendations', path: '/recommendations' }],
  },
  {
    matches: ['full dashboard', 'entire dashboard', 'complete executive', 'complete technical'],
    text: 'The complete live analysis is temporarily unavailable. Dashboard data remains visible; review top financial exposures, critical findings, exposed assets, overdue remediation, control gaps, and evidence freshness. CRISPR will not fabricate a summary while disconnected.',
    references: [{ label: 'View Risk Cases', path: '/risks' }, { label: 'View Findings', path: '/findings' }],
  },
];

const formatOfflineInr = (value: number) => `₹${Math.round(value).toLocaleString('en-IN')}`;

function offlineMoneyValues(question: string): number[] {
  const values: number[] = [];
  const pattern = /(?:₹\s*)?(\d[\d,]*(?:\.\d+)?)\s*(crores?|cr|lakhs?|l)\b|₹\s*(\d[\d,]*(?:\.\d+)?)/gi;
  for (const match of question.matchAll(pattern)) {
    let value = Number((match[1] ?? match[3]).replace(/,/g, ''));
    const unit = (match[2] ?? '').toLowerCase();
    if (['crore', 'crores', 'cr'].includes(unit)) value *= 10_000_000;
    if (['lakh', 'lakhs', 'l'].includes(unit)) value *= 100_000;
    values.push(value);
  }
  return values;
}

function offlineCalculation(question: string): Pick<Message, 'text' | 'references'> | null {
  const normalized = question.toLowerCase();
  if (!normalized.includes('calculate') && !normalized.includes('compute') && !normalized.includes('work out')) return null;
  const money = offlineMoneyValues(question);
  const percentages = [...question.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((match) => Number(match[1]));
  const reference = [{ label: 'Open Scenarios', path: '/scenarios' }];

  if (normalized.includes('rosi')) {
    if (money.length < 2) return { text: 'Provide expected annual risk reduction and implementation cost, for example: Calculate ROSI for ₹24 lakh risk reduction and ₹10 lakh cost.', references: reference };
    if (money[1] <= 0) return { text: 'Implementation cost must be greater than zero.', references: reference };
    const ratio = (money[0] - money[1]) / money[1];
    return { text: `Offline deterministic calculation: ROSI = (${formatOfflineInr(money[0])} − ${formatOfflineInr(money[1])}) ÷ ${formatOfflineInr(money[1])} = ${(ratio * 100).toFixed(1)}% (${ratio.toFixed(2)}×).`, references: reference };
  }
  if (normalized.includes('delay')) {
    const days = Number(normalized.match(/(\d+(?:\.\d+)?)\s*days?/)?.[1]);
    if (!percentages.length || !money.length || !days) return { text: 'Provide annual incident probability, delay days, and loss magnitude, for example: Calculate delay impact for 20%, 30 days, and ₹1 crore loss.', references: reference };
    const probability = percentages[0] / 100;
    const delayed = 1 - (1 - probability) ** (1 + days / 365);
    const before = probability * money[0];
    const after = delayed * money[0];
    return { text: `Offline deterministic calculation: delayed probability is ${(delayed * 100).toFixed(2)}%. EAL changes from ${formatOfflineInr(before)} to ${formatOfflineInr(after)}, an increase of ${formatOfflineInr(after - before)}.`, references: reference };
  }
  if (normalized.includes('residual')) {
    if (!money.length || !percentages.length) return { text: 'Provide original financial risk and control effectiveness, for example: Calculate residual risk for ₹50 lakh at 40% effectiveness.', references: reference };
    const residual = money[0] * (1 - percentages[0] / 100);
    return { text: `Offline deterministic calculation: residual risk = ${formatOfflineInr(money[0])} × (1 − ${percentages[0]}%) = ${formatOfflineInr(residual)}. This assumes one independent control.`, references: reference };
  }
  if (normalized.includes('risk reduction')) {
    if (money.length < 2) return { text: 'Provide before and after EAL, for example: Calculate risk reduction from ₹80 lakh to ₹50 lakh.', references: reference };
    const reduction = money[0] - money[1];
    const percent = money[0] ? reduction / money[0] * 100 : 0;
    return { text: `Offline deterministic calculation: risk reduction = ${formatOfflineInr(money[0])} − ${formatOfflineInr(money[1])} = ${formatOfflineInr(reduction)} (${percent.toFixed(1)}%).`, references: reference };
  }
  if (normalized.includes('eal') || normalized.includes('expected annual loss')) {
    if (!money.length || !percentages.length) return { text: 'Provide annual incident probability and loss magnitude, for example: Calculate EAL for 20% annual probability and ₹1 crore loss.', references: reference };
    const eal = percentages[0] / 100 * money[0];
    return { text: `Offline deterministic calculation: EAL = ${percentages[0]}% × ${formatOfflineInr(money[0])} = ${formatOfflineInr(eal)} per year.`, references: reference };
  }
  return { text: 'Offline calculator supports EAL, ROSI, risk reduction, residual risk, and remediation-delay impact. Name one calculation and provide its inputs with units.', references: reference };
}

function networkFallback(question: string): Pick<Message, 'text' | 'references'> {
  const normalized = question.toLowerCase();
  const calculation = offlineCalculation(question);
  if (calculation) return calculation;
  if (/^(hi+|hello|hey|good (morning|afternoon|evening)|how are you|who are you)[!.?\s]*$/i.test(question.trim())) {
    return {
      text: 'Hello! I’m CRISPR AI. The live analysis service is temporarily unavailable, but I can still explain CRISPR terminology and calculate EAL, ROSI, risk reduction, residual risk, and delay impact from the inputs you provide.',
    };
  }
  const match = NETWORK_FALLBACKS.find((entry) => entry.matches.some((term) => normalized.includes(term)));
  return match ?? {
    text: 'CRISPR AI cannot reach the analysis service because of a network or provider issue. Core dashboards remain available. Retry shortly or use Risk Cases, Findings, Scenarios, and Recommendations directly; no financial values will be invented while disconnected.',
    references: [{ label: 'View Risk Cases', path: '/risks' }, { label: 'View Findings', path: '/findings' }],
  };
}

/**
 * Global, always-available AI assistant. It lives in the application shell, is reachable from
 * any page via the header's "Ask CRISPR AI" button or Ctrl+/ shortcut area,
 * and answers using the same live demo-engine state (risk score, run count)
 * so its responses are grounded in real, current application state rather
 * than being a static transcript.
 */
export default function AIAssistantDrawer() {
  const open = useUiStore((s) => s.aiDrawerOpen);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 150);
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (!open) return;
    const onEscape = (e: KeyboardEvent) => e.key === 'Escape' && closeAIDrawer();
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [open]);

  const send = async (question: string) => {
    if (!question.trim() || loading) return;
    setMessages((m) => [...m, { role: 'user', text: question }]);
    setInput('');
    setLoading(true);
    try {
      const res = await queryAssistant(question);
      const fallback = networkFallback(question);
      const answer = res?.data?.answer || res?.data?.response || fallback.text;
      const evidence = res?.data?.data ?? {};
      const risk = evidence.top_risk ?? evidence.risk_case ?? evidence.summary?.top_risk;
      const references = risk?.asset_id ? [
        { label: `Risk ${risk.finding_id ?? risk.asset_id}`, path: `/risks?asset=${encodeURIComponent(risk.asset_id)}` },
        ...(risk.finding_id ? [{ label: `Finding ${risk.finding_id}`, path: `/findings?finding=${encodeURIComponent(risk.finding_id)}` }] : []),
      ] : (!res?.data?.answer && !res?.data?.response ? fallback.references : []);
      setMessages((m) => [...m, { role: 'assistant', text: answer, references }]);
    } catch {
      const fallback = networkFallback(question);
      setMessages((m) => [...m, { role: 'assistant', ...fallback }]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const runPrompt = (event: Event) => {
      const question = (event as CustomEvent<string>).detail;
      if (typeof question === 'string' && question.trim()) void send(question);
    };
    window.addEventListener('crispr:ai-prompt', runPrompt);
    return () => window.removeEventListener('crispr:ai-prompt', runPrompt);
  });

  if (!open) return null;

  return (
    <>
      <div className="drawer-overlay" onClick={closeAIDrawer} />
      <div className="ai-drawer" role="dialog" aria-modal="true" aria-label="CRISPR AI Assistant">
        <div className="ai-drawer-header">
          <div className="ai-drawer-title">
            <Bot size={18} color="var(--color-primary-blue)" />
            <span>CRISPR AI</span>
            <span className="ai-drawer-badge">
              <Sparkles size={10} /> Beta
            </span>
          </div>
          <button className="icon-btn" onClick={closeAIDrawer} aria-label="Close AI assistant">
            <X size={16} />
          </button>
        </div>

        <div className="ai-drawer-body">
          {messages.length === 0 && (
            <div className="ai-drawer-empty">
              <Bot size={28} color="var(--color-primary-blue)" />
              <p>Ask me anything about the organization’s current security or financial risk posture.</p>
              <div className="ai-drawer-suggestions">
                {SUGGESTED_PROMPTS.map((p) => {
                  const Icon = p.icon;
                  return (
                    <button key={p.text} className="ai-drawer-suggestion" onClick={() => send(p.text)}>
                      <Icon size={14} />
                      <span>{p.text}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`ai-drawer-message ${m.role}`}>
              {m.role === 'assistant' ? <AIMessageMarkdown text={m.text} /> : m.text}
              {!!m.references?.length && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {m.references.map((reference) => (
                    <button key={reference.path} className="btn-secondary" style={{ padding: '3px 7px', fontSize: '0.6875rem' }} onClick={() => { closeAIDrawer(); navigate(reference.path); }}>
                      {reference.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {loading && <div className="ai-drawer-message assistant">Analyzing…</div>}
          <div ref={bottomRef} />
        </div>

        <form
          className="ai-drawer-input-row"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <input
            ref={inputRef}
            className="input-field"
            style={{ flex: 1 }}
            placeholder="Ask CRISPR AI a question..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button type="submit" className="btn-primary" disabled={loading} aria-label="Send">
            <Send size={14} />
          </button>
        </form>

        {messages.length > 0 && (
          <div className="ai-drawer-footer-actions">
            <button className="btn-secondary" style={{ fontSize: '0.75rem', padding: '5px 10px' }} onClick={() => navigate('/risks')}>
              View Risk Cases
            </button>
            <button className="btn-secondary" style={{ fontSize: '0.75rem', padding: '5px 10px' }} onClick={() => navigate('/findings')}>
              View Findings
            </button>
          </div>
        )}
      </div>
    </>
  );
}
