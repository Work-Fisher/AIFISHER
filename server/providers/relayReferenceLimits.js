import { loadModelCatalog } from '../config/modelCatalog.js';

/** Use the same mode limits as the canvas; reject excess before uploading any files. */
export function assertRelayReferenceCounts(modelId, kind, assets, mode) {
  const modesKey = `${kind}Modes`;
  const matches = Object.values(loadModelCatalog()).flatMap(model => {
    if (model.source !== 'relay') return [];
    return (model[modesKey] || []).filter(definition =>
      model.endpoint?.[definition.value]?.model === modelId
      && (!mode || definition.value === mode));
  });
  if (!matches.length) return;
  for (const [key, label] of [['image', '图片'], ['video', '视频'], ['audio', '音频']]) {
    const maximum = Math.max(...matches.map(definition => definition.allowedInputs?.[key] || 0));
    const count = (assets[`${key}s`] || []).length;
    if (count > maximum) throw Object.assign(new Error(`参考${label}数量超限：当前模型${mode ? '模式' : ''}最多支持 ${maximum} 个，当前为 ${count} 个，请调整后重试。`),
      { code: 'REFERENCE_COUNT_EXCEEDED', status: 400 });
  }
}
