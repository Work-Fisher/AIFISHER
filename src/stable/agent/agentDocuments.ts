export interface AgentDocument { id: string; name: string; text: string }
export async function readAgentDocument(file: File, signal: AbortSignal, options: { preserveWhitespace?: boolean } = {}): Promise<AgentDocument> {
  const contentBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => { reader.abort(); reject(new DOMException('已取消', 'AbortError')); };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    reader.onload = () => { signal.removeEventListener('abort', abort); resolve(String(reader.result).split(',')[1]); };
    reader.onerror = () => { signal.removeEventListener('abort', abort); reject(new Error('文档读取失败')); };
    reader.readAsDataURL(file);
  });
  if (signal.aborted) throw new DOMException('已取消', 'AbortError');
  const response = await fetch('/api/agent/drama/script', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: file.name, contentBase64, ...(options.preserveWhitespace === true ? { preserveWhitespace: true } : {}) }), signal });
  const result = await response.json();
  if (signal.aborted) throw new DOMException('已取消', 'AbortError');
  if (!response.ok || typeof result.script?.text !== 'string') throw new Error(result.error || '文档解析失败');
  return { id: crypto.randomUUID(), name: file.name, text: result.script.text };
}
export function agentMessageWithDocuments(prompt: string, documents: readonly AgentDocument[]) {
  if (!documents.length) return prompt;
  return [prompt, '以下是本轮上传的文档资料，请结合当前要求和已选技能处理：',
    ...documents.map(document => `【文档：${document.name}】\n${document.text}\n【文档结束】`)].filter(Boolean).join('\n\n');
}

/** Display projection only. The stored message and model input retain the full documents. */
export function splitAgentDocumentMessage(content: string): { prompt: string; documents: AgentDocument[] } {
  const marker = '以下是本轮上传的文档资料，请结合当前要求和已选技能处理：\n\n';
  const start = content.indexOf(marker);
  const plain = { prompt: content, documents: [] };
  if (start < 0 || start > 0 && content.slice(start - 2, start) !== '\n\n') return plain;
  const documents: AgentDocument[] = [];
  let remaining = content.slice(start + marker.length);
  while (remaining) {
    const match = remaining.match(/^【文档：([^\n]+)】\n([\s\S]*?)\n【文档结束】(?=\n\n【文档：|$)/);
    if (!match) return plain;
    documents.push({ id: String(documents.length), name: match[1], text: match[2] });
    remaining = remaining.slice(match[0].length).replace(/^\n\n/, '');
  }
  return documents.length ? { prompt: content.slice(0, start).trimEnd(), documents } : plain;
}
