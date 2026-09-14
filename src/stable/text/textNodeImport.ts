import { agentDocumentAccept, isAgentDocument } from '../../shared/agentDocumentFormats.js';
import { readAgentDocument } from '../agent/agentDocuments';

export const TEXT_NODE_FILE_ACCEPT = agentDocumentAccept;

/** Extract complete text with the existing local parser. DOCX layout, embedded
 * objects and links are not imported; no model, saved file or source path is needed. */
export async function readTextNodeFile(
  file: File,
  signal: AbortSignal,
): Promise<{ name: string; text: string }> {
  if (signal.aborted) throw new DOMException('已取消', 'AbortError');
  if (!isAgentDocument(file.name)) {
    throw new Error(
      '支持 DOCX、TXT、Markdown、CSV、TSV、JSON、YAML、XML、LOG、SRT 和 VTT。旧版 DOC 请另存为 DOCX。',
    );
  }
  if (!file.name.trim() || file.name.length > 160 || /[\\/\0\r\n]/.test(file.name)) {
    throw new Error('文件名无效，请选择本机文档文件。');
  }
  if (!file.size) throw new Error('文件为空，请选择有正文的文档。');
  const document = await readAgentDocument(file, signal, { preserveWhitespace: true });
  if (signal.aborted) throw new DOMException('已取消', 'AbortError');
  if (!document.text.trim()) throw new Error('文档中没有可导入的正文。');
  return { name: document.name, text: document.text };
}
