import { OFFICIAL_DRAMA_BUNDLE, officialProductionBundle } from '../agent/drama/officialDramaBundle.js';
import { OFFICIAL_PRODUCTION_PROFILES } from '../../src/shared/officialProductionProfiles.js';

// The recommended workflows and official skills share the same trusted routes.
export const OFFICIAL_WORKFLOWS = Object.freeze([
  Object.freeze({ id: 'official-character', name: '短剧最佳拍档-角色资产', categoryId: 'image',
    sourceUrl: `https://www.runninghub.cn/ai-detail/${OFFICIAL_DRAMA_BUNDLE.characters.webAppId}?inviteCode=cn-v1078`,
    description: '将人物描述变成角色参考图，供文戏与武戏继续使用。',
    inputs: ['人物描述'], output: '角色参考图', skillSlug: 'minimax-drama-prompt',
    webAppId: OFFICIAL_DRAMA_BUNDLE.characters.webAppId, version: OFFICIAL_DRAMA_BUNDLE.version }),
  ...OFFICIAL_PRODUCTION_PROFILES.map((profile) => Object.freeze({
    id: profile.id, name: profile.id === 'minimax-drama' ? '低配文戏' : profile.id === 'minimax-drama-high' ? '高配文戏' : '打斗武戏',
    categoryId: 'video', skillSlug: profile.slug, version: profile.version,
    description: profile.mode === 'assets' ? '把人物与场景参考连接成动作片段，适合对抗、追逐与打斗。'
      : profile.id === 'minimax-drama-high' ? '沿用人物、场景与对白，使用高配文戏应用制作片段。'
        : '用人物、场景和对白提示词制作文戏片段，适合先验证镜头。',
    inputs: ['镜头提示词', '参考图片', '音频（可选）'], output: '视频片段',
    webAppId: officialProductionBundle(profile.id).drama.webAppId,
  })),
]);
