const ENDPOINT_BY_KIND = Object.freeze({
  image: '/api/generate-image',
  video: '/api/generate-video',
  audio: '/api/generate-audio',
  text: '/api/generate-text',
});

const MODEL_FIELD_BY_KIND = Object.freeze({
  image: 'imageModel',
  video: 'videoModel',
  audio: 'audioModel',
  text: 'textModel',
});

class LiveSmokeGuardError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LiveSmokeGuardError';
    this.code = code;
  }
}

function refuse(code, message) {
  throw new LiveSmokeGuardError(code, message);
}

export function validateLiveSmokeRequest({ consent, baseUrl, maxCost, scenario }) {
  if (consent !== 'I_ACCEPT_REAL_COST') {
    refuse('LIVE_SMOKE_CONSENT_REQUIRED', '真实生成需要显式确认可能产生费用。');
  }

  let parsedBaseUrl;
  try {
    parsedBaseUrl = new URL(baseUrl);
  } catch {
    refuse('LIVE_SMOKE_LOOPBACK_ONLY', 'Live smoke 只能连接本机 AIFISHER 服务。');
  }
  if (
    !['127.0.0.1', 'localhost', '::1'].includes(parsedBaseUrl.hostname) ||
    parsedBaseUrl.username ||
    parsedBaseUrl.password
  ) {
    refuse('LIVE_SMOKE_LOOPBACK_ONLY', 'Live smoke 只能连接本机 AIFISHER 服务。');
  }

  const expectedEndpoint = ENDPOINT_BY_KIND[scenario?.kind];
  if (!expectedEndpoint || scenario?.endpoint !== expectedEndpoint) {
    refuse('LIVE_SMOKE_ENDPOINT_DENIED', '场景 endpoint 不属于允许的生成接口。');
  }
  if (!String(scenario?.body?.nodeId || '').startsWith('live-smoke-')) {
    refuse('LIVE_SMOKE_NODE_ID_REQUIRED', 'Live smoke 节点 ID 必须使用 live-smoke- 前缀。');
  }
  const modelField = MODEL_FIELD_BY_KIND[scenario.kind];
  if (!String(scenario?.body?.[modelField] || '').trim()) {
    refuse('LIVE_SMOKE_MODEL_REQUIRED', `场景缺少 ${modelField}。`);
  }

  const estimatedCost = Number(scenario.body.cost || 0);
  const allowedCost = Number(maxCost);
  if (
    !Number.isFinite(estimatedCost) ||
    estimatedCost < 0 ||
    !Number.isFinite(allowedCost) ||
    allowedCost < 0 ||
    estimatedCost > allowedCost
  ) {
    refuse('LIVE_SMOKE_COST_LIMIT', '场景估算费用超过本次允许上限。');
  }

  return {
    url: new URL(expectedEndpoint, parsedBaseUrl).toString(),
    kind: scenario.kind,
    nodeId: scenario.body.nodeId,
    estimatedCost,
  };
}
