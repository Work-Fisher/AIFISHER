import type { ModelGroup } from './sourceSettingsClient';

/**
 * 新建画布节点只提供用户确认的常用模型。
 *
 * 中转后台的普通/宽审核线路在 AIFISHER 中是同一 canonicalModel 下的来源，
 * 普通/宽审核线路按 canonicalModel 归并。
 * 模型运行目录仍保留完整，
 * 旧画布已保存的其它模型也继续由稳定版和后端按原配置加载、执行。
 */
export const COMMON_CANVAS_MODEL_NAMES = [
  // 图片：同一模型的不同中转来源归为一个模型组。
  'GPT Image 2',
  'GPT Image 2.5',
  'Grok 2',
  'Nano Banana Pro',
  'Nano Banana 2',
  'Nano Banana 2 Lite',
  'Nano Banana Flash',
  'Midjourney Imagine',
  'Seedream v5 Pro',

  // 视频：中转常用入口外加现有可灵 V3、O3 与 Grok，四组 Seedance 普通/宽审核分别归并。
  'MiniMax H3',
  'Kling V3.0',
  'Kling O3',
  'Seedance 2.0 Fast',
  'Seedance 2.0 Mini',
  'Seedance 2.0',
  'Seedance 2.5',
  'Grok',
  'Veo 3.1 Fast',
  'Veo 3.1 Lite',

  // 文本。
  '豆包大语言2.0-mini',
  '豆包大语言2.0-lite',
  '豆包大语言2.0-pro',
  '豆包 Seed Evolving',
  'DeepSeek-V4-Flash',
  'DeepSeek-V4.1-Flash',
  'DeepSeek-V4-Pro',
  'DeepSeek-V4-Flash-Vision-Exp',
  'GLM 5.3',
  'GLM 5.3 Flash',
  'Kimi K3',

  // 音频；Mureka 按用户确认不进入新选择列表。
  '豆包 Seed Audio 1.0',
  'MiniMax Voice Clone',
  'Qwen3 TTS Flash',
  'Suno Generation',
  'Suno Stems',
] as const;

const COMMON_CANVAS_MODELS = new Set<string>(COMMON_CANVAS_MODEL_NAMES);

export type ModelGroupFilter = (groups: ModelGroup[]) => ModelGroup[];

/** 只裁剪选择器视图，不克隆、删除或改写产品目录中的模型与来源。 */
export const filterCanvasModelGroups: ModelGroupFilter = (groups) =>
  groups.filter((group) => COMMON_CANVAS_MODELS.has(group.canonicalModel));
