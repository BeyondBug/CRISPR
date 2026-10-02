import { useState, useRef, useEffect } from 'react';
import { Bot, Send, Sparkles } from 'lucide-react';
import { queryAssistant } from '../../services/api';
import AIMessageMarkdown from './AIMessageMarkdown';

interface Message {
  role: 'user' | 'assistant';
  text: string;
}

interface Props {
  theme: 'security' | 'financial';
  suggestions: string[];
}

const unavailableAnswer =
  'The AI Advisor cannot reach the deterministic risk engine right now. Start the backend and try again; no financial figures are shown without API data.';

export default function AIAdvisorChat({ theme, suggestions }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!messages.length && !loading) return;
    const container = messagesRef.current;
    if (container) container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const accent = theme === 'security' ? 'var(--color-primary-blue)' : 'var(--color-success)';

  const send = async (question: string) => {
    if (!question.trim() || loading) return;
    setMessages((m) => [...m, { role: 'user', text: question }]);
    setInput('');
    setLoading(true);
    try {
      const res = await queryAssistant(question);
      const answer = res?.data?.answer || res?.data?.response || unavailableAnswer;
      setMessages((m) => [...m, { role: 'assistant', text: answer }]);
    } catch {
      setMessages((m) => [...m, { role: 'assistant', text: unavailableAnswer }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Bot size={18} color={accent} />
          <span style={{ fontWeight: 500, fontSize: '0.9375rem', color: 'var(--color-text-primary)' }}>
            CRISPR {theme === 'security' ? 'Security' : 'Financial'} Advisor
          </span>
        </div>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontSize: '0.6875rem',
            fontWeight: 600,
            padding: '3px 8px',
            borderRadius: 9999,
            background: 'var(--color-light-blue)',
            color: 'var(--color-primary-blue)',
          }}
        >
          <Sparkles size={10} /> Powered by AI
        </span>
      </div>

      <div
        ref={messagesRef}
        style={{
          minHeight: 140,
          maxHeight: 320,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          marginBottom: 12,
          padding: messages.length ? '4px 4px' : 0,
        }}
      >
        {messages.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', padding: '8px 0' }}>
            Ask me anything about the organization’s cyber risk posture — try one of the suggestions below.
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: m.role === 'assistant' ? '100%' : '78%',
              minWidth: 0,
              background: m.role === 'user' ? accent : 'var(--bg-elevated)',
              color: m.role === 'user' ? '#fff' : 'var(--text-primary)',
              borderLeft: m.role === 'assistant' ? `3px solid ${accent}` : 'none',
              borderRadius: 8,
              padding: '10px 14px',
              fontSize: '0.8125rem',
              lineHeight: 1.5,
            }}
          >
            {m.role === 'assistant' ? <AIMessageMarkdown text={m.text} /> : m.text}
          </div>
        ))}
        {loading && (
          <div
            style={{
              alignSelf: 'flex-start',
              borderLeft: `3px solid ${accent}`,
              background: 'var(--bg-elevated)',
              borderRadius: 8,
              padding: '10px 14px',
              fontSize: '0.8125rem',
              color: 'var(--text-muted)',
            }}
          >
            Analyzing<span className="dots-anim">...</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {suggestions.map((s) => (
          <button key={s} className="chip" onClick={() => send(s)} disabled={loading}>
            {s}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        style={{ display: 'flex', gap: 8 }}
      >
        <input
          className="input-field"
          style={{ flex: 1 }}
          placeholder="Ask the AI advisor a question..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" className="btn-primary" disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Send size={14} /> Send
        </button>
      </form>
    </div>
  );
}
