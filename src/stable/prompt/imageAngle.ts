export interface ImageAngle {
  azimuth: number;
  elevation: number;
  zoom: number;
}
export const defaultImageAngle: ImageAngle = { azimuth: 0, elevation: 0, zoom: 5 };
export const angleDirections = [
  '正面',
  '右前侧',
  '右侧',
  '右后侧',
  '背面',
  '左后侧',
  '左侧',
  '左前侧',
];
export function normalizeImageAngle(value: unknown): ImageAngle {
  const input = value && typeof value === 'object' ? (value as Partial<ImageAngle>) : {};
  const finite = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return {
    azimuth: ((Math.round(finite(input.azimuth, 0)) % 360) + 360) % 360,
    elevation: Math.max(-30, Math.min(60, Math.round(finite(input.elevation, 0)))),
    zoom: Math.max(0, Math.min(10, Math.round(finite(input.zoom, 5) * 10) / 10)),
  };
}
export function imageAngleDescription(value: unknown) {
  const angle = normalizeImageAngle(value);
  return {
    direction: angleDirections[Math.floor((angle.azimuth + 22.5) / 45) % 8],
    elevation:
      angle.elevation < -15
        ? '低机位仰视'
        : angle.elevation < 15
          ? '平视'
          : angle.elevation < 45
            ? '抬高机位俯视'
            : '高机位俯拍',
    distance: angle.zoom < 2 ? '远景' : angle.zoom < 6 ? '中景' : '近景',
  };
}
/** Standard camera semantics; no Qwen-specific LoRA trigger is sent to general image models. */
export function imageAnglePrompt(value: unknown) {
  if (!value || typeof value !== 'object') return '';
  if (
    !['azimuth', 'elevation', 'zoom'].every(
      (key) =>
        typeof (value as Record<string, unknown>)[key] === 'number' &&
        Number.isFinite((value as Record<string, unknown>)[key]),
    )
  )
    return '';
  const settings = normalizeImageAngle(value);
  const angle = imageAngleDescription(settings);
  return `根据参考图片重新呈现同一个主体，目标视角为主体的${angle.direction}，${angle.elevation}，${angle.distance}构图。\n精确相机参数：水平环绕 ${settings.azimuth}°（0°正面、90°主体右侧、180°背面、270°主体左侧），俯仰 ${settings.elevation}°（正值抬高机位向下看、负值降低机位向上看），取景靠近程度 ${settings.zoom.toFixed(1)}/10（0为远景、5为中景、10为特写）。按连续数值调整，不要量化为固定预设。\n只改变相机观察方向、高度和取景距离；保持主体身份、面部特征、服饰、道具、材质和画面风格一致。依据原图合理补全新视角可见的结构。不要用平面旋转、镜像或拉伸原图代替视角变化，不添加多视图拼版、文字或重复主体。以本段目标视角为准，其他内容要求保持不变。`;
}
