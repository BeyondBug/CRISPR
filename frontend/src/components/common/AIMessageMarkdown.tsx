import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function AIMessageMarkdown({ text }: { text: string }) {
  return <div className="ai-message-markdown">
    <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={['img']} components={{
      a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
      table: ({ node: _node, ...props }) => <div className="ai-markdown-table"><table {...props} /></div>,
    }}>{text}</ReactMarkdown>
  </div>;
}
