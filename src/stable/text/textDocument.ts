/** JSON only: the plain mirror remains authoritative for older canvas/Agent consumers. */
export interface TextDocumentNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string }[];
  content?: TextDocumentNode[];
}

export interface TextRichContent {
  version: 1;
  sourceText: string;
  document: TextDocumentNode;
}

const blocks = new Set([
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'table',
]);
const marks = new Set(['bold', 'italic', 'underline', 'strike', 'code']);
// Reject the entire rich representation on malformed/unreasonable nesting. Never
// truncate body text to fit these structural limits; resolve falls back to its mirror.
const maxDepth = 128;
const maxNodes = 1_000_000;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalid(): never {
  throw new Error('文本格式无效，请保留正文后重试。');
}

function positiveInteger(value: unknown, maximum: number, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= maximum
    ? value
    : fallback;
}

function safeAttributes(type: string, value: unknown): Record<string, unknown> | undefined {
  const attrs = record(value) ? value : {};
  if (type === 'heading') return { level: positiveInteger(attrs.level, 3, 1) };
  if (type === 'orderedList') return { start: positiveInteger(attrs.start, 1_000_000_000, 1) };
  if (type === 'tableCell' || type === 'tableHeader') {
    return {
      colspan: positiveInteger(attrs.colspan, 1000, 1),
      rowspan: positiveInteger(attrs.rowspan, 1000, 1),
    };
  }
  return undefined;
}

function allowedChild(parent: string, child: string, index: number): boolean {
  if (parent === 'paragraph' || parent === 'heading')
    return child === 'text' || child === 'hardBreak';
  if (parent === 'codeBlock') return child === 'text';
  if (parent === 'bulletList' || parent === 'orderedList') return child === 'listItem';
  if (parent === 'table') return child === 'tableRow';
  if (parent === 'tableRow') return child === 'tableCell' || child === 'tableHeader';
  if (parent === 'listItem' && index === 0) return child === 'paragraph';
  return blocks.has(child);
}

/** Copy only the editor schema. HTML, links, events, style and unknown attributes
 * cannot enter the persisted rich document; unsupported body nodes reject it whole. */
function safeDocument(value: unknown): TextDocumentNode {
  type Frame = {
    input: Record<string, unknown>;
    output: TextDocumentNode;
    children: unknown[];
    index: number;
  };
  const active = new WeakSet<object>();
  let count = 0;
  const enter = (input: unknown, parent?: string, index = 0): Frame => {
    if (!record(input) || active.has(input) || ++count > maxNodes) return invalid();
    const type = input.type;
    if (typeof type !== 'string' || (parent ? !allowedChild(parent, type, index) : type !== 'doc'))
      return invalid();
    if (input.content !== undefined && !Array.isArray(input.content)) return invalid();
    const children: unknown[] = Array.isArray(input.content) ? input.content : [];
    if (children.length > maxNodes - count) return invalid();
    const leaf = type === 'text' || type === 'hardBreak' || type === 'horizontalRule';
    if (leaf && children.length) return invalid();
    if (type !== 'text' && input.text !== undefined) return invalid();
    if (!leaf && !['doc', 'paragraph', 'heading', 'codeBlock'].includes(type) && !children.length)
      return invalid();
    const output: TextDocumentNode = { type };
    if (type === 'text') {
      if (typeof input.text !== 'string' || !input.text) return invalid();
      output.text = input.text;
    } else if (!leaf) output.content = [];
    const attrs = safeAttributes(type, input.attrs);
    if (attrs) output.attrs = attrs;
    if (
      (type === 'text' || type === 'hardBreak') &&
      parent !== 'codeBlock' &&
      input.marks !== undefined
    ) {
      if (!Array.isArray(input.marks) || input.marks.length > 32) return invalid();
      const selected = new Set<string>();
      for (const mark of input.marks) {
        if (record(mark) && typeof mark.type === 'string' && marks.has(mark.type))
          selected.add(mark.type);
      }
      if (selected.size) output.marks = [...selected].map((type) => ({ type }));
    }
    active.add(input);
    return { input, output, children, index: 0 };
  };
  const root = enter(value);
  const stack = [root];
  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (frame.index === frame.children.length) {
      active.delete(frame.input);
      stack.pop();
      continue;
    }
    if (stack.length >= maxDepth) return invalid();
    const child = enter(frame.children[frame.index], frame.output.type, frame.index++);
    frame.output.content!.push(child.output);
    stack.push(child);
  }
  if (!root.output.content!.length) root.output.content!.push({ type: 'paragraph', content: [] });
  return root.output;
}

/** Split only LF so even legacy CR/CRLF values round-trip without losing a character. */
export function textDocumentFromPlainText(text: string): TextDocumentNode {
  return {
    type: 'doc',
    content: text.split('\n').map((line) => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : [],
    })),
  };
}

function plainText(document: TextDocumentNode): string {
  const output: string[] = [];
  const stack = [{ node: document, index: 0 }];
  while (stack.length) {
    const frame = stack[stack.length - 1];
    const { node } = frame;
    if (node.type === 'text') output.push(node.text!);
    else if (node.type === 'hardBreak') output.push('\n');
    else if (frame.index < (node.content?.length ?? 0)) {
      if (frame.index > 0) {
        if (node.type === 'tableRow') output.push('\t');
        else if (!['paragraph', 'heading', 'codeBlock'].includes(node.type)) output.push('\n');
      }
      stack.push({ node: node.content![frame.index++], index: 0 });
      continue;
    }
    stack.pop();
  }
  return output.join('');
}

/** Block boundaries stay readable to models; table columns are separated by tabs. */
export function textDocumentToPlainText(document: TextDocumentNode): string {
  return plainText(safeDocument(document));
}

export function resolveTextDocument(textContent: string, rich: unknown): TextDocumentNode {
  try {
    if (record(rich) && rich.version === 1 && rich.sourceText === textContent) {
      const document = safeDocument(rich.document);
      if (plainText(document) === textContent) return document;
    }
  } catch {
    // Old, malformed or stale formatting must never replace the authoritative text.
  }
  return textDocumentFromPlainText(textContent);
}

export function createTextDocumentPatch(document: TextDocumentNode): {
  textContent: string;
  textRichContent: TextRichContent;
} {
  const safe = safeDocument(document);
  const textContent = plainText(safe);
  return { textContent, textRichContent: { version: 1, sourceText: textContent, document: safe } };
}
