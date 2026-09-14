// Only error metadata belongs in telemetry; never request bodies, headers or media URLs.
const STAGES = new Set(['upload', 'submit', 'poll', 'download', 'stream', 'local']);
export function safeDiagnosticId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(value)
    && !/^(?:sk-|apikey-)/iu.test(value) ? value : null;
}
export function safeUpstreamMessage(value, requestBody) {
  if (typeof value !== 'string') return null;
  let message = value;
  if (typeof requestBody === 'string') { try { requestBody = JSON.parse(requestBody); } catch { requestBody = null; } }
  function redact(input) {
    if (typeof input === 'string' && input.length >= 4) message = message.split(input).join('[input]');
    else if (Array.isArray(input)) input.forEach(redact);
    else if (input && typeof input === 'object') Object.values(input).forEach(redact);
  }
  if (requestBody && typeof requestBody === 'object') redact(requestBody);
  return message
    .replace(/Bearer\s+\S+/giu, 'Bearer [redacted]')
    .replace(/(?:sk-|apikey-)[A-Za-z0-9_-]+/giu, '[redacted]')
    .replace(/\b(?:api[_ -]?key|secret|token|password)\b\s*[:=]\s*\S+/giu, '[credential redacted]')
    .replace(/https?:\/\/\S+|data:[^\s]+/giu, '[resource]')
    .replace(/`[^`]*`|"[^"\n]*"|'[^'\n]*'/gu, '[quoted content]')
    .replace(/(?:[A-Za-z]:[\\/]|\/(?:home|Users|tmp|var)\/)[^\s]+/gu, '[local path]')
    .replace(/[A-Za-z0-9+/=]{128,}/gu, '[data]')
    .replace(/[\r\n\t]+/gu, ' ').trim().slice(0, 300) || null;
}
export function annotateProviderError(error, { stage, response, payload, taskId, requestBody } = {}) {
  if (!error || typeof error !== 'object') return error;
  const previous = error.diagnostics || {};
  const status = response?.status ?? error.upstreamStatus ?? previous.httpStatus;
  const httpStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
  const headers = response?.headers;
  const upstreamRequestId = safeDiagnosticId(headers?.get?.('x-request-id'))
    || safeDiagnosticId(headers?.get?.('request-id')) || safeDiagnosticId(headers?.get?.('x-tt-logid'))
    || safeDiagnosticId(payload?.request_id) || previous.upstreamRequestId || null;
  const providerCode = payload?.error?.code || payload?.code || error.upstreamCode;
  // Upload endpoints use FastAPI's string detail; structured validation detail can
  // contain the submitted file/input, so never serialize that object into telemetry.
  const providerMessage = payload?.error?.message || payload?.message || payload?.fail_reason
    || (typeof payload?.detail === 'string' ? payload.detail : null) || error.upstreamMessage;
  error.diagnostics = {
    stage: STAGES.has(stage) ? stage : previous.stage || 'local', httpStatus,
    upstreamRequestId,
    upstreamTaskId: safeDiagnosticId(taskId) || previous.upstreamTaskId || null,
    upstreamCode: safeDiagnosticId(providerCode) || previous.upstreamCode || null,
    upstreamMessage: safeUpstreamMessage(providerMessage || previous.upstreamMessage, requestBody),
  };
  if (httpStatus) error.upstreamStatus = httpStatus;
  return error;
}
