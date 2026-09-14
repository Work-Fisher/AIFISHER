import { prepareMiniMaxH3T2VAWorkflow } from './workflows/MiniMax-H3-T2VA.js';

/**
 * AIFISHER 唯一保留的专用 ComfyUI 工作流。
 * 其他工作流由用户在“通用工作流”中导入 ComfyUI API JSON，不再随应用内置。
 */
export const WORKFLOW_REGISTRY = Object.freeze({
  'minimax-h3-t2va': Object.freeze({
    handler: prepareMiniMaxH3T2VAWorkflow,
    templateFile: 'MiniMax-H3-T2VA-api.json',
    timeout: 1_800_000,
    outputNodeId: '303',
    title: 'MiniMax H3 本地音视频',
  }),
});
