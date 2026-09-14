export type AgentVision = 'supported' | 'unsupported' | 'unknown';
export const agentVisionLabels: Record<AgentVision, string> = {
  supported: '有视觉', unsupported: '无视觉', unknown: '视觉未确认',
};
export const agentVisionHints: Record<AgentVision, string> = {
  supported: '有视觉：可分析发送或引用的图片；不会自动实时观看整个画布。',
  unsupported: '当前模型无视觉，无法直接看懂画布图片、截图或视频画面，只能依据文字和节点信息判断，可能影响画面分析。需要看图时，请切换有视觉模型并引用图片。',
  unknown: '当前来源的视觉能力尚未确认，不能保证看懂画布图片。需要分析画面时，请选择已标记“有视觉”的模型并引用图片。',
};
