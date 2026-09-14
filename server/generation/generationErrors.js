const NETWORK_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENETUNREACH',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

const TRANSIENT_RESPONSE_CODES = new Set(['EMPTY_RESPONSE']);

// `status` is also used for local validation and normalized client responses.
// Only a status captured at an upstream HTTP boundary belongs in telemetry.
export function getUpstreamStatus(error) {
  const value = error?.upstreamStatus ?? error?.response?.status;
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

function getStatus(error) {
  const value = error?.status ?? error?.statusCode ?? error?.response?.status;
  const status = Number(value);
  return Number.isFinite(status) ? status : 0;
}

function formatQuotaAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount.toFixed(2) : null;
}

export function classifyGenerationError(error) {
  const status = getStatus(error);
  const code = String(error?.code || error?.cause?.code || '');
  const upstreamCode = String(error?.upstreamCode || error?.response?.data?.error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  const normalizedMessage = message.replace(/[_-]+/g, ' ');
  if (/midjourney/iu.test(message) && /提示词过长|prompt.{0,20}too long/iu.test(message)) {
    const limit = message.match(/(?:支持|最多)\s*(\d{1,6})\s*(?:以下)?\s*(?:个)?字符/u)?.[1];
    return {
      code: 'INVALID_INPUT_MJ_PROMPT_TOO_LONG', status: 422, retryable: false,
      message: `MJ 提示词超过当前线路的长度限制${limit ? `（${limit} 字符以下）` : ''}。请精简提示词后手动重新生成；系统不会自动截断或重提。`,
    };
  }
  if (/个性化代码无效或与\s*version\s*不兼容/u.test(message)) {
    return {
      code: 'MJ_PROFILE_INCOMPATIBLE', status: 422, retryable: false,
      message: 'MJ 个性化码无效或不支持所选版本。请更换个性化码，或手动选择该码支持的版本。',
    };
  }

  if (error?.name === 'AbortError' || code === 'ABORT_ERR' || code === 'GENERATION_CANCELLED') {
    return {
      code: 'GENERATION_CANCELLED',
      status: 499,
      retryable: true,
      message: '生成任务已取消。',
    };
  }
  const missingCredential =
    code === 'PROVIDER_CREDENTIAL_MISSING' ||
    (!status && /(?:api key|access key|secret key|credential)/u.test(normalizedMessage)
      && /(?:未配置|not configured|missing)/u.test(normalizedMessage));
  if (missingCredential) {
    return {
      code: 'PROVIDER_CREDENTIAL_MISSING',
      status: 400,
      retryable: false,
      message: error?.credentialSource === 'aifisher_relay'
        ? '尚未配置 AIFISHER API Key。请打开画布右上角「余额与活动」，填写自己的密钥并点击「保存 Key」，再手动生成。'
        : '尚未配置当前模型服务的密钥。请到「设置」中连接对应服务并保存自己的密钥，再手动生成。',
    };
  }
  if (
    error?.expose === true
    && (code.startsWith('DREAMINA_') || code.startsWith('LIBTV_'))
    && status >= 400
    && status <= 599
    && error?.message
    && String(error.message).length <= 300
  ) {
    return {
      code,
      status,
      retryable: Boolean(error.retryable),
      message: String(error.message),
    };
  }
  if (code === 'ETIMEDOUT' || message.includes('timeout') || message.includes('超时')) {
    return {
      code: 'GENERATION_TIMEOUT',
      status: 504,
      retryable: true,
      message: '等待模型响应超时，当前未确认生成结果。请先核对任务记录，避免重复提交。',
    };
  }
  const contentRejected =
    code.toUpperCase() === 'CONTENT_SECURITY_AUDIT_FAILED'
    || normalizedMessage.includes('the generated content was filtered by the safety system')
    || /(?:content security audit (?:did not|does not) pass|内容安全(?:审查|审核)未通过)/iu.test(normalizedMessage);
  if (contentRejected) {
    return {
      code: 'PROVIDER_CONTENT_REJECTED',
      status: 422,
      retryable: false,
      message: '当前线路内容审核未通过。请调整提示词或参考素材；若使用的是普通 API 线路，也可切换到同模型审核更宽松的“API宽审核”线路后手动重试。',
    };
  }
  const tokenQuotaInsufficient =
    ['INSUFFICIENT_TOKEN_QUOTA', 'TOKEN_QUOTA_INSUFFICIENT'].includes(code.toUpperCase())
    || /(?:token quota (?:is )?not enough|insufficient token quota|token quota (?:is )?insufficient|token quota exhausted)/iu.test(normalizedMessage);
  if (tokenQuotaInsufficient) {
    const quotaAmounts = message.match(
      /token remain quota:\s*[¥￥]?\s*(\d+(?:\.\d+)?).*?need quota:\s*[¥￥]?\s*(\d+(?:\.\d+)?)/iu,
    );
    const remaining = formatQuotaAmount(quotaAmounts?.[1]);
    const required = formatQuotaAmount(quotaAmounts?.[2]);
    return {
      code: 'PROVIDER_TOKEN_QUOTA_INSUFFICIENT',
      status: 402,
      retryable: false,
      message: remaining && required
        ? `API Key可用额度不足：Key 剩余 ¥${remaining}，本次需要约 ¥${required}。该限制独立于钱包余额，请到中转站提高或取消这把 Key 的额度限制。`
        : 'API Key可用额度不足。该限制独立于钱包余额，请到中转站提高或取消这把 Key 的额度限制。',
    };
  }
  const insufficientBalance =
    status === 402 ||
    ['INSUFFICIENT_BALANCE', 'INSUFFICIENT_QUOTA', 'PAYMENT_REQUIRED'].includes(code.toUpperCase()) ||
    /(?:余额不足|用户额度不足|(?:token )?quota (?:is )?not enough|insufficient (?:quota|balance|funds)|not enough wallet)/iu.test(normalizedMessage) ||
    (normalizedMessage.includes('remain quota') && normalizedMessage.includes('need quota'));
  if (insufficientBalance) {
    return {
      code: 'PROVIDER_BALANCE_INSUFFICIENT',
      status: 402,
      retryable: false,
      message: '当前模型服务账号的余额或可用额度不足。请到对应服务商检查余额和 API Key 额度，补足后再手动生成。',
    };
  }
  if (status === 429 || code === 'RATE_LIMITED' || code === 'MODEL_CONCURRENCY_LIMIT') {
    return {
      code: 'PROVIDER_RATE_LIMIT',
      status: 429,
      retryable: true,
      message: '当前模型触发请求频率或并发限制。请等待已有任务结束，或稍后手动重试。',
    };
  }
  if (code === 'REFERENCE_UPLOAD_FAILED' && (status === 401 || status === 403)) {
    return {
      code: 'PROVIDER_AUTH_FAILED', status: 502, retryable: false,
      message: `参考素材上传鉴权失败（HTTP ${status}），尚未提交生成任务。请在设置中检查对应服务商的 API Key 是否有效、是否具有素材上传权限。登录画布账号不能替代服务商 API Key。`,
    };
  }
  if (code === 'REFERENCE_READ_FAILED' || code === 'REFERENCE_UPLOAD_FAILED') {
    return {
      code, status: 502, retryable: true,
      message: code === 'REFERENCE_READ_FAILED'
        ? '无法读取参考素材，尚未提交生成任务。请确认图片仍可预览，或重新上传后重试。'
        : `参考素材上传失败${status >= 400 && status <= 599 ? `（HTTP ${status}）` : ''}，尚未提交生成任务。请检查网络和素材后重试。`,
    };
  }
  const modelNotAvailable =
    ['MODEL_NOT_OPEN', 'MODEL_NOT_AVAILABLE', 'MODELNOTOPEN'].includes(code.toUpperCase())
    || ['MODEL_NOT_OPEN', 'MODEL_NOT_AVAILABLE', 'MODELNOTOPEN'].includes(upstreamCode.toUpperCase())
    || (status === 404 && /(?:modelnotopen|not activated|model .*?(?:not found|not available))/iu.test(message));
  if (modelNotAvailable) {
    return {
      code: 'PROVIDER_MODEL_NOT_AVAILABLE',
      status: 400,
      retryable: false,
      message: '当前账号尚未开通这个模型，请在火山方舟控制台开通模型服务，或切换到已开通的模型后重试。',
    };
  }
  if (status === 400 || code === 'INVALID_ARGUMENT') {
    return {
      code: 'INVALID_GENERATION_REQUEST',
      status: 400,
      retryable: false,
      message: '生成参数未通过校验。请检查必填内容、参考素材格式和所选模型支持的参数。',
    };
  }
  if (status === 401 || status === 403 || code === 'PERMISSION_DENIED') {
    return {
      code: 'PROVIDER_AUTH_FAILED',
      status: 502,
      retryable: false,
      message: '模型服务未接受当前密钥。请在「设置」中检查密钥是否有效，以及是否有该模型的调用权限，再手动重试。',
    };
  }
  if (code === 'INVALID_JSON_RESPONSE') {
    return {
      code: 'UPSTREAM_INVALID_RESPONSE',
      status: 503,
      retryable: true,
      message: '模型服务返回了无法解析的响应。请核对任务记录和服务状态，再决定是否重试。',
    };
  }
  if (
    NETWORK_CODES.has(code) ||
    TRANSIENT_RESPONSE_CODES.has(code) ||
    status === 502 ||
    status === 503
  ) {
    return {
      code: 'PROVIDER_NETWORK_ERROR',
      status: 503,
      retryable: true,
      message: '连接模型服务失败，可能是网络中断或上游暂时不可用。请检查网络并核对任务记录后再重试。',
    };
  }
  return {
    code: 'GENERATION_FAILED',
    status: 500,
    retryable: false,
    message: '生成失败，当前信息不足以确定原因。请在意见反馈中附上报错截图或日志；本地 ComfyUI 请同时上传报错工作流 JSON。',
  };
}

// Only use after a provider has confirmed a terminal failure. Never expose raw
// upstream errors (which may contain credentials or signed resource URLs).
export function confirmedGenerationFailure(error) {
  const classified = classifyGenerationError(error);
  const temporary = /temporary problem completing your request/iu.test(String(error?.message || ''));
  return {
    code: 'PROVIDER_TASK_FAILED', status: 502, retryable: false,
    message: temporary
      ? '上游临时故障，原生成任务已失败。请核对任务记录后决定是否手动重新生成。'
      : classified.code === 'GENERATION_FAILED'
        ? '服务商已确认原生成任务失败，请核对任务记录后决定是否重新生成。'
        : `原生成任务已失败。${classified.message}`,
  };
}
