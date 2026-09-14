import crypto from 'node:crypto';
import { classifyGenerationError, getUpstreamStatus } from '../generation/generationErrors.js';

const TERMINAL_STATUSES = new Set(['success', 'failed', 'timeout', 'cancelled', 'unknown']);
const DEFAULT_MAX_PENDING_EVENTS = 200;

function normalizedId(value, fallback, maximum = 80) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maximum);
  return normalized || fallback;
}

function normalizedProvider(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return normalized || 'UnknownProvider';
}

export function classifyModelSource(providerName, modelName = '') {
  const provider = String(providerName || '').toLowerCase();
  const model = String(modelName || '').toLowerCase();
  if (provider.includes('relay')) return 'aifisher_relay';
  if (provider.includes('runninghub')) {
    return /ai站|global|international/u.test(model) ? 'runninghub_ai' : 'runninghub_cn';
  }
  if (provider.includes('dreamina') || provider.includes('jimengcli')) return 'dreamina_cli';
  if (provider.includes('comfy')) return 'comfyui_local';
  if (provider.includes('doubao') || provider.includes('ark')) return 'volcengine_official';
  if (provider.includes('gemini') || provider.includes('google')) return 'google_official';
  if (provider.includes('deepseek')) return 'deepseek_official';
  if (provider.includes('glm') || provider.includes('zhipu')) return 'zhipu_official';
  if (provider.includes('kimi') || provider.includes('moonshot')) return 'moonshot_official';
  if (provider.includes('openai') || provider.includes('gpt')) return 'openai_official';
  return 'other_official';
}

function terminalStatus(classified) {
  if (classified.code === 'GENERATION_CANCELLED') return 'cancelled';
  if (classified.code === 'GENERATION_TIMEOUT' || classified.status === 504) return 'timeout';
  if (['COMFYUI_SUBMISSION_UNKNOWN', 'WORKFLOW_RUN_UNKNOWN',
    'GENERATION_SUBMISSION_UNKNOWN', 'GENERATION_OBSERVATION_INTERRUPTED'].includes(classified.code)) {
    return 'unknown';
  }
  return 'failed';
}

function safeMessage(classified) {
  const message = String(classified?.message || '').trim();
  return message ? message.slice(0, 300) : null;
}

// Offline, expired-token, throttled and server-side failures may succeed later; any other
// rejection means Identity refused this event and resending it cannot help.
function deliveryMayRecover(error) {
  const status = Number(error?.status);
  return !Number.isInteger(status) || status === 401 || status === 408 || status === 429 || status >= 500;
}

export function createModelCallReporter({
  identityAccountClient,
  getAccessToken,
  clientVersion = '1.0.0',
  now = () => Date.now(),
  createId = crypto.randomUUID,
  logger = console,
  maxPendingEvents = DEFAULT_MAX_PENDING_EVENTS,
} = {}) {
  if (typeof identityAccountClient?.submitCallTelemetry !== 'function') {
    throw new TypeError('Model-call reporter requires the Identity account client');
  }
  if (typeof getAccessToken !== 'function') {
    throw new TypeError('Model-call reporter requires an access-token provider');
  }
  if (typeof now !== 'function' || typeof createId !== 'function') {
    throw new TypeError('Model-call reporter clock is invalid');
  }
  if (!Number.isInteger(maxPendingEvents) || maxPendingEvents < 1) {
    throw new TypeError('Model-call reporter backlog limit is invalid');
  }

  // Events wait here, oldest first, until a delivery has both a token and a network (ADR-0035:
  // offline use continues and telemetry is sent later). The bound drops the oldest records.
  const pending = [];
  let draining = false;
  let deliveryBlocked = false;
  let retryTimer = null;

  function remove(event) {
    const index = pending.indexOf(event);
    if (index >= 0) pending.splice(index, 1);
  }

  async function readAccessToken() {
    try {
      const token = await getAccessToken();
      return typeof token === 'string' && token ? token : null;
    } catch {
      return null;
    }
  }

  function blocked() {
    if (deliveryBlocked) return;
    deliveryBlocked = true;
    logger.warn?.('[Telemetry] Model-call events are queued until Identity is reachable', {
      pending: pending.length,
    });
  }

  async function drain() {
    if (draining || pending.length === 0) return;
    clearTimeout(retryTimer);
    retryTimer = null;
    draining = true;
    try {
      const accessToken = await readAccessToken();
      if (!accessToken) {
        blocked();
        return;
      }
      while (pending.length > 0) {
        const event = pending[0];
        try {
          await identityAccountClient.submitCallTelemetry(accessToken, event);
          remove(event);
          deliveryBlocked = false;
        } catch (error) {
          if (error?.status === 422 && event.diagnostics) {
            // Older Identity versions reject unknown fields; retry telemetry only.
            delete event.diagnostics;
            continue;
          }
          if (deliveryMayRecover(error)) {
            blocked();
            return;
          }
          remove(event);
          logger.warn?.('[Telemetry] Model-call event was rejected', {
            callId: event.callId,
            status: event.status,
          });
        }
      }
    } finally {
      draining = false;
      if (pending.length > 0) {
        // Retry telemetry independently of generation. Do not keep the backend alive for it.
        retryTimer = setTimeout(() => {
          retryTimer = null;
          void drain().catch(() => undefined);
        }, 60_000);
        retryTimer.unref?.();
      }
    }
  }

  function submit(event) {
    pending.push(event);
    if (pending.length > maxPendingEvents) pending.splice(0, pending.length - maxPendingEvents);
    // Never awaited: telemetry must not delay, fail or replay the model call it describes.
    drain().catch(() => undefined);
  }

  function begin({
    category,
    mediaType,
    operation,
    modelName,
    modelId,
    provider,
    source,
    requestId,
  }) {
    const callId = createId();
    const startedAt = now();
    const base = Object.freeze({
      callId,
      category,
      mediaType,
      operation: normalizedId(operation, 'default'),
      modelName: String(modelName || modelId || 'Unknown model').trim().slice(0, 200),
      modelId: String(modelId || modelName || 'unknown-model').trim().slice(0, 200),
      provider: normalizedProvider(provider),
      source: normalizedId(source || classifyModelSource(provider, modelName), 'other_official'),
      clientVersion: String(clientVersion || '').trim().slice(0, 80) || null,
      requestId: /^[A-Za-z0-9_-]{8,80}$/u.test(String(requestId || '')) ? requestId : null,
    });
    let finished = false;
    submit({
      ...base,
      status: 'running',
      durationMs: null,
      upstreamStatus: null,
      errorCode: null,
      errorSummary: null,
      retryable: false,
    });

    function finish(status, details = {}) {
      if (finished || !TERMINAL_STATUSES.has(status)) return false;
      finished = true;
      submit({
        ...base,
        status,
        durationMs: Math.min(604_800_000, Math.max(0, Math.round(now() - startedAt))),
        upstreamStatus: Number.isInteger(details.upstreamStatus)
          && details.upstreamStatus >= 100
          && details.upstreamStatus <= 599
          ? details.upstreamStatus
          : null,
        errorCode: details.errorCode || null,
        errorSummary: details.errorSummary || null,
        retryable: Boolean(details.retryable),
        ...(details.diagnostics ? { diagnostics: details.diagnostics } : {}),
      });
      return true;
    }

    return Object.freeze({
      callId,
      success() { return finish('success'); },
      fail(error) {
        const classified = error?.status && error?.code ? error : classifyGenerationError(error);
        return finish(terminalStatus(classified), {
          upstreamStatus: getUpstreamStatus(error),
          diagnostics: error?.diagnostics,
          errorCode: classified.code,
          errorSummary: safeMessage(classified),
          retryable: classified.retryable,
        });
      },
      finish,
    });
  }

  return Object.freeze({
    begin,
    get pendingCount() { return pending.length; },
  });
}
