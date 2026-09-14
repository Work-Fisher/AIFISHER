import { memo } from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const plugins = [remarkGfm];
function safeUrl(url: string) {
  return url.startsWith('locate://') ? url : defaultUrlTransform(url);
}

/** Only the changing answer is parsed again. Raw HTML remains inert text. */
export const AgentMarkdown = memo(function AgentMarkdown({ content, onLocateNode }: {
  content: string;
  onLocateNode?(id: string): void;
}) {
  return <div className="af-agent-markdown">
    <Markdown remarkPlugins={plugins} urlTransform={safeUrl} components={{
      a: ({ href, children }) => href?.startsWith('locate://')
        ? <button type="button" className="af-agent-node-link" onClick={() => onLocateNode?.(href.slice(9))}>{children}</button>
        : href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
      // Generated prose must not automatically load arbitrary remote images.
      img: ({ alt }) => <span>{alt || '图片'}</span>,
      table: ({ children }) => <div className="af-agent-table"><table>{children}</table></div>,
    }}>{content}</Markdown>
  </div>;
});
