import type { PromptProposal } from './codexClient';

export function applyCanvasPromptProposal<T extends { id: string; prompt?: string }>(
  nodes: T[],
  proposal: PromptProposal,
  update: (id: string, patch: { prompt: string }) => void,
): string | null {
  const node = nodes.find((item) => item.id === proposal.nodeId);
  if (!node) return '节点已删除，请重新引用节点后再修改。';
  if ((node.prompt || '') !== proposal.before)
    return '节点提示词已经变化，请让助手基于最新内容重新修改。';
  if (typeof proposal.after !== 'string') return '建议内容无效。';
  update(node.id, { prompt: proposal.after });
  return null;
}
