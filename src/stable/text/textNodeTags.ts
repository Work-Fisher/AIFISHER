export const TEXT_TAG_COLORS = ['gray', 'blue', 'green', 'amber', 'rose', 'violet'] as const;
export type TextTagColor = (typeof TEXT_TAG_COLORS)[number];

/** Tags describe this node only; they are never prompt text or generation instructions. */
export interface TextNodeTag {
  id: string;
  label: string;
  color: TextTagColor;
}

export const MAX_TEXT_NODE_TAGS = 16;
export const MAX_TEXT_TAG_LABEL_LENGTH = 40;
export const TEXT_NODE_TAG_PRESETS: readonly TextNodeTag[] = [
  { id: 'preset:character', label: '人物', color: 'blue' },
  { id: 'preset:scene', label: '场景', color: 'green' },
  { id: 'preset:prop', label: '道具', color: 'amber' },
  { id: 'preset:style-reference', label: '风格参考', color: 'violet' },
  { id: 'preset:storyboard', label: '分镜图', color: 'rose' },
  { id: 'preset:reference-image', label: '参考图', color: 'blue' },
  { id: 'preset:other', label: '其他', color: 'gray' },
];

export const TEXT_TAG_COLOR_LABELS: Record<TextTagColor, string> = {
  gray: '灰色',
  blue: '蓝色',
  green: '绿色',
  amber: '黄色',
  rose: '粉色',
  violet: '紫色',
};

export function textTagLabelError(label: string): string {
  if (!label.trim()) return '请输入标签名称。';
  if (Array.from(label.trim()).length > MAX_TEXT_TAG_LABEL_LENGTH)
    return `标签名称不能超过 ${MAX_TEXT_TAG_LABEL_LENGTH} 个字符。`;
  if (
    Array.from(label).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    return '标签名称不能包含换行或控制字符。';
  return '';
}

export function textTagLabelKey(label: string): string {
  return label.trim().normalize('NFKC').toLowerCase();
}

function readTag(value: unknown): TextNodeTag | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const tag = value as Record<string, unknown>;
  if (
    typeof tag.id !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,79}$/u.test(tag.id) ||
    typeof tag.label !== 'string' ||
    textTagLabelError(tag.label) ||
    typeof tag.color !== 'string' ||
    !TEXT_TAG_COLORS.includes(tag.color as TextTagColor)
  )
    return null;
  const preset = TEXT_NODE_TAG_PRESETS.find((item) => item.id === tag.id);
  if (tag.id.startsWith('preset:') && !preset) return null;
  return preset
    ? { ...preset }
    : { id: tag.id, label: tag.label.trim(), color: tag.color as TextTagColor };
}

/** Read an untrusted project field into a small plain-data view without rewriting the project. */
export function normalizeTextNodeTags(value: unknown): TextNodeTag[] {
  if (!Array.isArray(value)) return [];
  const tags: TextNodeTag[] = [];
  const ids = new Set<string>();
  const labels = new Set<string>();
  for (const entry of value) {
    const tag = readTag(entry);
    if (!tag || ids.has(tag.id) || labels.has(textTagLabelKey(tag.label))) continue;
    ids.add(tag.id);
    labels.add(textTagLabelKey(tag.label));
    tags.push(tag);
    if (tags.length === MAX_TEXT_NODE_TAGS) break;
  }
  return tags;
}

/** Tell the UI when the safe view omits malformed data instead of silently truncating it. */
export function textNodeTagsReadError(value: unknown): string {
  if (value == null) return '';
  if (!Array.isArray(value)) return '已保存的标签格式无效；原数据尚未修改。';
  if (value.length > MAX_TEXT_NODE_TAGS)
    return `已保存的标签超过 ${MAX_TEXT_NODE_TAGS} 个，暂仅显示有效的前 ${MAX_TEXT_NODE_TAGS} 个；原数据尚未修改。`;
  if (normalizeTextNodeTags(value).length !== value.length)
    return '部分已保存标签无效或重复，暂未显示；原数据尚未修改。';
  return '';
}
