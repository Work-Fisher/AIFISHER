const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,79}$/u;

export class IdentityAccountRequestError extends Error {
  constructor({ status = 503, code = 'IDENTITY_ACCOUNT_UNAVAILABLE', retryAfterSeconds = null } = {}) {
    super('Identity account request failed');
    this.name = 'IdentityAccountRequestError';
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function validateOrigin(value) {
  let origin;
  try { origin = new URL(value); } catch { throw new Error('Identity account origin is invalid'); }
  const loopbackHttp = origin.protocol === 'http:' && LOOPBACK_HOSTNAMES.has(origin.hostname.toLowerCase());
  if (
    (origin.protocol !== 'https:' && !loopbackHttp)
    || origin.pathname !== '/'
    || origin.search
    || origin.hash
    || origin.username
    || origin.password
    || origin.origin + '/' !== origin.href
  ) throw new Error('Identity account origin must be an exact HTTPS or loopback origin');
  return origin;
}

function boundedInteger(value) {
  return Number.isInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

function parseDate(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new IdentityAccountRequestError();
  return value;
}

function parseFeedbackReceipt(payload) {
  if (!payload || typeof payload.id !== 'string') throw new IdentityAccountRequestError();
  return Object.freeze({ id: payload.id, createdAt: parseDate(payload.createdAt), ...(Number.isInteger(payload.attachmentCount) ? { attachmentCount: payload.attachmentCount } : {}) });
}

function parseCallTelemetryReceipt(payload) {
  if (
    !payload
    || typeof payload.callId !== 'string'
    || !['running', 'success', 'failed', 'timeout', 'cancelled', 'unknown'].includes(payload.status)
  ) throw new IdentityAccountRequestError();
  return Object.freeze({
    callId: payload.callId,
    status: payload.status,
    updatedAt: parseDate(payload.updatedAt),
  });
}

function parseAdminSession(payload) {
  if (
    payload?.administrator !== true
    || !Array.isArray(payload.roles)
    || !payload.roles.includes('admin')
    || payload.roles.some((role) => !['admin', 'support', 'analyst'].includes(role))
  ) throw new IdentityAccountRequestError();
  return Object.freeze({ administrator: true, roles: Object.freeze([...payload.roles]) });
}

function parseOverview(payload) {
  const keys = ['totalUsers', 'newUsers24h', 'activeSessions', 'activeUsers24h', 'relayBoundUsers', 'totalFeedback', 'newFeedback'];
  if (!payload || keys.some((key) => !boundedInteger(payload[key]))) throw new IdentityAccountRequestError();
  parseDate(payload.generatedAt);
  return Object.freeze(Object.fromEntries([...keys.map((key) => [key, payload[key]]), ['generatedAt', payload.generatedAt]]));
}

function parseItems(payload) {
  if (!payload || !Array.isArray(payload.items) || payload.items.length > 500) {
    throw new IdentityAccountRequestError();
  }
  return Object.freeze({ items: Object.freeze(payload.items.map((item) => Object.freeze({ ...item }))) });
}

function parseAdminMonitor(payload) {
  const arrayKeys = [
    'modelHealth',
    'errorBreakdown',
    'sourceDistribution',
    'hourlyTrend',
    'topUsers',
    'recentCalls',
  ];
  if (
    !payload
    || typeof payload.summary !== 'object'
    || payload.summary === null
    || typeof payload.runtime !== 'object'
    || payload.runtime === null
    || arrayKeys.some((key) => !Array.isArray(payload[key]) || payload[key].length > 500)
  ) throw new IdentityAccountRequestError();
  parseDate(payload.generatedAt);
  return Object.freeze({
    summary: Object.freeze({ ...payload.summary }),
    runtime: Object.freeze({ ...payload.runtime }),
    ...Object.fromEntries(arrayKeys.map((key) => [
      key,
      Object.freeze(payload[key].map((item) => Object.freeze({ ...item }))),
    ])),
    generatedAt: payload.generatedAt,
  });
}

function parseStatusReceipt(payload) {
  if (!payload || typeof payload.id !== 'string' || !['new', 'read', 'closed'].includes(payload.status)) {
    throw new IdentityAccountRequestError();
  }
  return Object.freeze({ id: payload.id, status: payload.status, updatedAt: parseDate(payload.updatedAt) });
}

export function createIdentityAccountClient({
  origin,
  fetchImpl = globalThis.fetch,
  timeoutMs = 4_000,
} = {}) {
  const identityOrigin = validateOrigin(origin);
  if (typeof fetchImpl !== 'function') throw new Error('Identity account fetch is missing');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 15_000) {
    throw new Error('Identity account timeout is invalid');
  }

  async function request(accessToken, pathname, { method = 'GET', body, attachmentTransfer = false } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), attachmentTransfer ? 60_000 : timeoutMs);
    try {
      const response = await fetchImpl(new URL(pathname, identityOrigin).href, {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'Cache-Control': 'no-store',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error',
        signal: controller.signal,
      });
      let payload;
      try { payload = await response.json(); } catch { throw new IdentityAccountRequestError(); }
      if (!response.ok) {
        const status = [400, 401, 403, 404, 413, 422, 429].includes(response.status) ? response.status : 503;
        const code = ERROR_CODE_PATTERN.test(payload?.code || '') ? payload.code : 'IDENTITY_ACCOUNT_UNAVAILABLE';
        const retryHeader = Number(response.headers.get('retry-after'));
        throw new IdentityAccountRequestError({
          status,
          code,
          retryAfterSeconds: Number.isInteger(retryHeader) && retryHeader >= 1 ? retryHeader : null,
        });
      }
      return payload;
    } catch (error) {
      if (error instanceof IdentityAccountRequestError) throw error;
      throw new IdentityAccountRequestError();
    } finally { clearTimeout(timeout); }
  }

  return Object.freeze({
    async submitFeedback(accessToken, submission) {
      return parseFeedbackReceipt(await request(accessToken, '/v1/feedback', { method: 'POST', body: submission, attachmentTransfer: Boolean(submission?.attachments?.length) }));
    },
    async submitCallTelemetry(accessToken, event) {
      return parseCallTelemetryReceipt(await request(accessToken, '/v1/call-telemetry', {
        method: 'POST', body: event,
      }));
    },
    async readAdminSession(accessToken) {
      return parseAdminSession(await request(accessToken, '/v1/admin/session'));
    },
    async readAdminOverview(accessToken) {
      return parseOverview(await request(accessToken, '/v1/admin/overview'));
    },
    async readAdminMonitor(accessToken) {
      return parseAdminMonitor(await request(accessToken, '/v1/admin/monitor'));
    },
    async listAdminFeedback(accessToken, { status = null, limit = 100 } = {}) {
      const url = new URL('/v1/admin/feedback', identityOrigin);
      if (status) url.searchParams.set('status', status);
      url.searchParams.set('limit', String(limit));
      return parseItems(await request(accessToken, `${url.pathname}${url.search}`));
    },
    async readFeedbackAttachment(accessToken, feedbackId, index) {
      return request(accessToken, `/v1/admin/feedback/${encodeURIComponent(feedbackId)}/attachments/${encodeURIComponent(index)}`, { attachmentTransfer: true });
    },
    async listAdminUsers(accessToken, { limit = 100 } = {}) {
      return parseItems(await request(accessToken, `/v1/admin/users?limit=${encodeURIComponent(limit)}`));
    },
    async updateFeedbackStatus(accessToken, feedbackId, status) {
      return parseStatusReceipt(await request(accessToken, `/v1/admin/feedback/${encodeURIComponent(feedbackId)}`, {
        method: 'PATCH', body: { status },
      }));
    },
  });
}
