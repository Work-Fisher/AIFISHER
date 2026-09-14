export function agentPanelWidthLimits(viewportWidth: number) {
  const viewport = Number.isFinite(viewportWidth) ? Math.max(1, viewportWidth) : 1280;
  const max = Math.max(1, Math.min(1200, viewport - (viewport >= 800 ? 280 : 16)));
  return { min: Math.min(320, max), max };
}

export function clampAgentPanelWidth(width: number, viewportWidth: number) {
  const { min, max } = agentPanelWidthLimits(viewportWidth);
  return Math.min(max, Math.max(min, Number.isFinite(width) ? width : 400));
}
