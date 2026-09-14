/** Display aliases keep older English/物品 categories usable without moving stored files. */
export const ASSET_CATEGORIES = ['角色', '场景', '道具', '风格', '音效', '其他'];
const aliases: Record<string, string> = {
  Character: '角色',
  Scene: '场景',
  Item: '道具',
  物品: '道具',
  Style: '风格',
  'Sound Effect': '音效',
  Others: '其他',
};
export function assetCategory(value?: string) {
  return aliases[value || ''] || value?.trim() || '其他';
}

/** Asset labels are independent of generation prompts and are valid before editing. */
export function assetDefaultName(node: { title?: string; prompt?: string; type?: string }) {
  const title = node.title?.replace(/\s+/gu, ' ').trim();
  const prompt = node.prompt?.replace(/\s+/gu, ' ').trim();
  if (title && title !== prompt) {
    const characters = Array.from(title);
    return characters.length > 40 ? characters.slice(0, 39).join('') + '…' : title;
  }
  if (node.type?.toLowerCase().includes('video')) return '视频资产';
  if (node.type?.toLowerCase().includes('audio')) return '音频资产';
  return '图片资产';
}
