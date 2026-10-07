import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AIMessageMarkdown from '../src/components/common/AIMessageMarkdown';

const render = (text: string) => renderToStaticMarkup(createElement(AIMessageMarkdown, { text }));

test('AI answers render headings, emphasis, ordered lists and code blocks', () => {
  const html = render('## Priorities\n\n**Protect access** and *verify evidence*.\n\n1. Rotate the key\n2. Review permissions\n\n```json\n{"status":"review"}\n```');
  assert.match(html, /<h2>Priorities<\/h2>/);
  assert.match(html, /<strong>Protect access<\/strong>/);
  assert.match(html, /<em>verify evidence<\/em>/);
  assert.match(html, /<ol>/);
  assert.match(html, /<li>Rotate the key<\/li>/);
  assert.match(html, /<pre><code class="language-json">/);
});

test('tables preserve financial figures and task lists render disabled checkboxes', () => {
  const html = render('| Risk | Exposure |\n| --- | --- |\n| API | ₹7.85 crore |\n\n- [x] Reviewed\n- [ ] Pending');
  assert.match(html, /class="ai-markdown-table"><table>/);
  assert.match(html, /<th>Exposure<\/th>/);
  assert.match(html, /<td>₹7\.85 crore<\/td>/);
  assert.match(html, /type="checkbox"[^>]*disabled=""/);
});

test('plain text and new paragraphs remain readable', () => {
  const html = render('The model is unavailable.\n\nCurrent evidence is still available.');
  assert.match(html, /<p>The model is unavailable\.<\/p>/);
  assert.match(html, /<p>Current evidence is still available\.<\/p>/);
});

test('markdown cannot inject HTML, executable links or remote images', () => {
  const html = render('<script>alert(1)</script>\n\n[Unsafe](javascript:alert%281%29)\n\n![tracking](https://example.com/track.png)\n\n[Source](https://example.com/report)');
  assert.doesNotMatch(html, /<script|<img|href="javascript:/);
  assert.match(html, /href="https:\/\/example.com\/report" target="_blank" rel="noopener noreferrer"/);
});
