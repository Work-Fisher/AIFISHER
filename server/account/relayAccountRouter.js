import express from 'express';
import { getAuthenticatedRequest } from '../security/localAuthentication.js';

export function createRelayAccountRouter({
  service,
  getAuthenticated = getAuthenticatedRequest,
} = {}) {
  if (!service || typeof service.getSnapshot !== 'function') {
    throw new Error('Relay account router requires service');
  }
  const router = express.Router();
  const bindingJson = express.json({ limit: '4kb', strict: true });
  router.get('/api/account/relay', async (request, response) => {
    try {
      const authenticated = getAuthenticated(request);
      service.assertUser(authenticated.identity.opaqueUserId);
      const refresh = request.query.refresh !== '0';
      // A cached read must not wait on the desktop main process for a token it will not use.
      const snapshot = await service.getSnapshot(refresh
        ? { refresh, accessToken: await authenticated.getAccessToken() }
        : { refresh });
      response.setHeader('Cache-Control', 'no-store');
      response.json(snapshot);
    } catch (error) {
      const status = error?.code === 'USER_SCOPE_MISMATCH' ? 403 : 503;
      response.status(status).json({
        error: status === 403 ? '当前账号无权访问此账户状态' : '账户状态暂不可用',
        code: status === 403 ? 'USER_SCOPE_MISMATCH' : 'RELAY_ACCOUNT_UNAVAILABLE',
      });
    }
  });
  router.put(
    '/api/account/relay/binding',
    (request, response, next) => {
      if (!request.is('application/json')) {
        response.status(415).json({
          error: '请求格式必须是 JSON',
          code: 'UNSUPPORTED_MEDIA_TYPE',
        });
        return;
      }
      bindingJson(request, response, next);
    },
    async (request, response) => {
      try {
        const authenticated = getAuthenticated(request);
        service.assertUser(authenticated.identity.opaqueUserId);
        if (
          !request.body
          || Object.keys(request.body).length !== 1
          || typeof request.body.apiKey !== 'string'
        ) {
          response.status(422).json({ error: '请输入有效的中转 API Key', code: 'RELAY_BINDING_INVALID' });
          return;
        }
        const snapshot = await service.bindApiKey({
          accessToken: await authenticated.getAccessToken(),
          apiKey: request.body.apiKey,
        });
        response.setHeader('Cache-Control', 'no-store');
        response.json(snapshot);
      } catch (error) {
        const code = String(error?.code || 'RELAY_BINDING_UNAVAILABLE');
        const status = code === 'USER_SCOPE_MISMATCH'
          ? 403
          : code === 'RELAY_API_KEY_ALREADY_BOUND'
            ? 409
            : ['RELAY_API_KEY_INVALID', 'RELAY_API_KEY_REJECTED'].includes(code)
              ? 422
              : 503;
        response.status(status).json({
          error: status === 409
            ? '该中转 API Key 已绑定其他 AIFISHER 账号'
            : status === 422
              ? '中转 API Key 无效或已失效'
              : status === 403
                ? '当前账号无权修改此绑定'
                : '中转绑定暂时不可用',
          code,
        });
      }
    },
  );
  router.delete('/api/account/relay/binding', async (request, response) => {
    try {
      const authenticated = getAuthenticated(request);
      service.assertUser(authenticated.identity.opaqueUserId);
      const snapshot = await service.unbindApiKey({
        accessToken: await authenticated.getAccessToken(),
      });
      response.setHeader('Cache-Control', 'no-store');
      response.json(snapshot);
    } catch (error) {
      const status = error?.code === 'USER_SCOPE_MISMATCH' ? 403 : 503;
      response.status(status).json({
        error: status === 403 ? '当前账号无权修改此绑定' : '中转解绑暂时不可用',
        code: status === 403 ? 'USER_SCOPE_MISMATCH' : 'RELAY_BINDING_UNAVAILABLE',
      });
    }
  });
  router.delete('/api/account/relay/activities/:activityId', async (request, response) => {
    try {
      const authenticated = getAuthenticated(request);
      service.assertUser(authenticated.identity.opaqueUserId);
      const snapshot = service.removeActivity(request.params.activityId);
      response.setHeader('Cache-Control', 'no-store');
      response.json(snapshot);
    } catch (error) {
      const status = error?.code === 'USER_SCOPE_MISMATCH'
        ? 403
        : error?.code === 'RELAY_ACTIVITY_NOT_FOUND'
          ? 404
          : 503;
      response.status(status).json({
        error: status === 403
          ? '当前账号无权删除此活动记录'
          : status === 404
            ? '活动记录不存在或已经删除'
            : '活动记录暂时无法删除',
        code: status === 403
          ? 'USER_SCOPE_MISMATCH'
          : status === 404
            ? 'RELAY_ACTIVITY_NOT_FOUND'
            : 'RELAY_ACTIVITY_DELETE_UNAVAILABLE',
      });
    }
  });
  return router;
}
