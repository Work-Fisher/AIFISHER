import { removeMidjourneyPreview } from '../../shared/midjourneyPrompt.js';
import type { CreativePreset } from './creativePresets';

export const mjCategoryGroups = [
  {
    name: '东方古风',
    categories: [
      '东方古风·武侠',
      '东方神话·仙侠奇观',
      '东方古装·史诗',
      '古风室内·殿堂楼阁',
      '古镇村落·俯瞰',
      '仙侠天宫·奇观',
      '古建·祠庙宫殿',
    ],
  },
  {
    name: '现代影像',
    categories: [
      '现代都市·电影人文',
      '现代写实人像·生活流',
      '时尚编辑·商业广告',
      '日韩系·影像',
      '现代都市·街景',
      '现代室内·生活空间',
    ],
  },
  {
    name: '科幻幻想',
    categories: [
      '科幻·机甲',
      '游戏CG·动漫角色',
      '东方赛博·武侠朋克',
      '西方奇幻·神话史诗',
      '科幻·未来场景',
      '西幻·城堡秘境',
    ],
  },
  { name: '自然氛围', categories: ['自然奇观·山水云海', '光影空镜·氛围', '风格化与实验'] },
  {
    name: '暗黑废墟',
    categories: ['国风暗黑·志怪恐怖', '废墟·古代战场', '废墟末世·战场', '暗黑异兽·克苏鲁'],
  },
  {
    name: '巨物传说',
    categories: [
      '巨物·尺度压迫',
      '巨型机甲·超级机器人',
      '怪兽特摄·哥斯拉系',
      '超尺度奇观·巨物崇拜',
      '东方神龙·仙兽',
      '西方巨龙·翼兽',
      '深海巨兽·海怪',
      '上古神祇·泰坦巨人',
    ],
  },
];

export interface MjStyle {
  id: string;
  group: string;
  category: string;
  name: string;
  mixed: boolean;
  medium: string;
  codes: string;
  parameters: string;
  prompt: string;
  vibe: string;
  thumbnail: string;
  preview: string;
}
export type MjInsertMode = 'style' | 'parameters' | 'full' | 'vibe';
export function mjStyleText(item: MjStyle, mode: MjInsertMode) {
  const text =
    mode === 'full'
      ? item.prompt
      : mode === 'vibe'
        ? item.vibe
        : [item.vibe, mode === 'parameters' ? item.parameters : item.codes]
            .filter(Boolean)
            .join('\n');
  return removeMidjourneyPreview(text);
}
export function mjStylePreset(item: MjStyle, text: string): CreativePreset {
  return {
    id: `mj-${item.id}`,
    kind: 'style',
    category: item.category,
    name: `MJ · ${item.name}`,
    description: item.vibe,
    prompt: removeMidjourneyPreview(text),
    preview: item.thumbnail,
  };
}
export function filterMjStyles(
  items: MjStyle[],
  group: string,
  category: string,
  query: string,
  codeKind: string,
) {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return items.filter(
    (item) =>
      (group === 'all' || item.group === group) &&
      (category === '全部' || item.category === category) &&
      (codeKind === 'all' || item.mixed === (codeKind === 'mixed')) &&
      words.every((word) =>
        [item.id, item.name, item.category, item.codes, item.vibe, item.medium, item.prompt]
          .join(' ')
          .toLowerCase()
          .includes(word),
      ),
  );
}
