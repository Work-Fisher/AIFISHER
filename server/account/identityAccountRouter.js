import express from 'express';
import { getAuthenticatedRequest } from '../security/localAuthentication.js';
import { IdentityAccountRequestError } from '../security/identityAccountClient.js';

function secureHeaders(response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
}

function accountError(response, error, fallbackCode, fallbackMessage) {
  secureHeaders(response);
  if (error instanceof IdentityAccountRequestError) {
    if (error.retryAfterSeconds) response.setHeader('Retry-After', String(error.retryAfterSeconds));
    // A remote credential expiry is not a failure of the local canvas. Keep it scoped to
    // this remote operation.
    response.status(error.status === 401 ? 503 : error.status).json({
      error: fallbackMessage,
      code: error.status === 401 ? 'REMOTE_AUTHENTICATION_UNAVAILABLE' : error.code,
    });
    return;
  }
  response.status(503).json({ error: fallbackMessage, code: fallbackCode });
}

/** Account features that call Identity with the token held by the desktop main process. */
export function createIdentityAccountRouter({
  identityProfileClient,
  identityAccountClient,
  getAuthenticated = getAuthenticatedRequest,
} = {}) {
  const router = express.Router();
  const feedbackJson = express.json({ limit: '9mb', strict: true });
  const adminJson = express.json({ limit: '4kb', strict: true });

  async function requireAccessToken(request) {
    const accessToken = await getAuthenticated(request).getAccessToken();
    // Signed out or offline: report it like a remote expiry instead of sending no credential.
    if (!accessToken) {
      throw new IdentityAccountRequestError({ status: 401, code: 'AUTHENTICATION_REQUIRED' });
    }
    return accessToken;
  }

  function adminRoute(read) {
    return async (request, response) => {
      try {
        const payload = await read(await requireAccessToken(request), request);
        secureHeaders(response);
        response.json(payload);
      } catch (error) {
        accountError(response, error, 'ADMIN_UNAVAILABLE', '管理后台暂不可用');
      }
    };
  }

  router.get('/api/auth/profile', async (request, response) => {
    secureHeaders(response);
    try {
      if (typeof identityProfileClient?.read !== 'function') throw new Error('Identity profile unavailable');
      response.json(await identityProfileClient.read(await requireAccessToken(request)));
    } catch {
      response.status(503).json({
        error: '账号资料暂不可用',
        code: 'IDENTITY_PROFILE_UNAVAILABLE',
      });
    }
  });

  router.post('/api/auth/feedback', feedbackJson, async (request, response) => {
    if (typeof identityAccountClient?.submitFeedback !== 'function') {
      accountError(response, null, 'FEEDBACK_UNAVAILABLE', '意见反馈服务暂不可用');
      return;
    }
    try {
      const receipt = await identityAccountClient.submitFeedback(
        await requireAccessToken(request),
        request.body,
      );
      secureHeaders(response);
      response.status(201).json(receipt);
    } catch (error) {
      accountError(response, error, 'FEEDBACK_UNAVAILABLE', '意见反馈服务暂不可用');
    }
  });

  router.get('/api/auth/admin/session', async (request, response) => {
    try {
      const session = await identityAccountClient.readAdminSession(await requireAccessToken(request));
      secureHeaders(response);
      response.json(session);
    } catch (error) {
      if (
        error instanceof IdentityAccountRequestError
        && error.status === 403
        && error.code === 'ADMIN_REQUIRED'
      ) {
        secureHeaders(response);
        response.json({ administrator: false, roles: [] });
        return;
      }
      accountError(response, error, 'ADMIN_UNAVAILABLE', '管理后台暂不可用');
    }
  });

  router.get('/api/auth/admin/overview', adminRoute((accessToken) =>
    identityAccountClient.readAdminOverview(accessToken)));

  router.get('/api/auth/admin/monitor', adminRoute((accessToken) =>
    identityAccountClient.readAdminMonitor(accessToken)));

  router.get('/api/auth/admin/feedback', adminRoute((accessToken, request) =>
    identityAccountClient.listAdminFeedback(accessToken, {
      status: typeof request.query.status === 'string' ? request.query.status : null,
      limit: request.query.limit,
    })));

  router.get('/api/auth/admin/feedback/:feedbackId/attachments/:index', adminRoute((accessToken, request) =>
    identityAccountClient.readFeedbackAttachment(accessToken, request.params.feedbackId, request.params.index)));
  router.get('/api/auth/admin/users', adminRoute((accessToken, request) =>
    identityAccountClient.listAdminUsers(accessToken, { limit: request.query.limit })));

  router.patch('/api/auth/admin/feedback/:feedbackId', adminJson, adminRoute((accessToken, request) =>
    identityAccountClient.updateFeedbackStatus(
      accessToken,
      request.params.feedbackId,
      request.body?.status,
    )));

  router.use((requestError, _request, response, next) => {
    if (response.headersSent) return next(requestError);
    secureHeaders(response);
    if (requestError?.type === 'entity.too.large') {
      response.status(413).json({ error: '请求内容过大', code: 'PAYLOAD_TOO_LARGE' });
      return;
    }
    if (requestError?.type === 'entity.parse.failed') {
      response.status(400).json({ error: '请求格式无效', code: 'MALFORMED_JSON' });
      return;
    }
    response.status(500).json({ error: '本机请求处理失败', code: 'LOCAL_REQUEST_FAILED' });
  });

  return router;
}
