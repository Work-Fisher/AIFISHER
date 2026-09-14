import express from 'express';
import { CodexError } from './codexProcess.js';

export function createCodexRouter(service) {
  const router = express.Router();
  const errorBody = (error) => error instanceof CodexError
    ? { error: error.message, code: error.code }
    : { error: 'Codex 操作未完成，请检查连接后重试。', code: 'CODEX_OPERATION_FAILED' };
  const route = (work) => async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    try { response.json(await work(request)); }
    catch (error) { response.status(error instanceof CodexError ? error.status : 500).json(errorBody(error)); }
  };
  router.post('/setup', route(() => service.prepareSetup()));
  router.post('/actions/:id', route(request => service.completeCanvasAction(request.params.id, request.body)));
  router.get('/status', route(() => service.status()));
  router.post('/login', route(() => service.login()));
  router.post('/login/open', route(() => service.openLogin()));
  router.post('/disconnect', route(async () => { await service.disconnect(); return { success: true }; }));
  router.get('/sessions', route((request) => service.list(request.query.projectId)));
  router.get('/sessions/:id', route(async (request) => {
    const session = await service.recover(request.params.id, request.query.projectId);
    if (!session) throw new CodexError('对话不存在。', 'CODEX_SESSION_MISSING', 404);
    return session;
  }));
  router.post('/turn', async (request, response) => {
    const controller = new AbortController();
    response.on('close', () => controller.abort());
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.flushHeaders();
    const emit = (event, data) => {
      if (!response.destroyed) response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const heartbeat = setInterval(() => { if (!response.destroyed) response.write(': heartbeat\n\n'); }, 15000);
    try { await service.runTurn(request.body, emit, controller.signal); }
    catch (error) { emit('error', errorBody(error)); }
    finally { clearInterval(heartbeat); response.end(); }
  });
  return router;
}
