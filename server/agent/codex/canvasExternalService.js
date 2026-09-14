import crypto from 'node:crypto';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { getAuthenticatedRequest } from '../../security/localAuthentication.js';
import { createCanvasControlBridge } from './canvasControlBridge.js';
import { findCodexCommand } from './codexProcess.js';
import { validCanvasControl } from '../../../src/shared/canvasControlProtocol.js';

const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const key = identity => `${identity.opaqueUserId}:${identity.sessionId}`;
const denied = () => Object.assign(Error('连接已失效、窗口未就绪或操作超出授权。请回到画布核对连接。'), { status: 403 });
const quote = value => `'${value.replaceAll("'", "''")}'`;

/** Independent loopback transport; neither login cookies nor provider credentials leave the browser boundary. */
export function createCanvasExternalService({ now = Date.now, timeout = 120000, onRevokeSession = () => {} } = {}) {
  const clients = new Map(), pairs = new Map(), grants = new Map(), owners = new Map(), busy = new Set(), internalClaims = new Map();
  const bridge = createCanvasControlBridge({ timeout });
  let server, opening;
  const scopeKey = client => `${client.identity.opaqueUserId}:${client.projectId}`;
  const alive = client => client && client.lastSeen + 30000 > now() && client.identity.expiresAt * 1000 > now();
  function clientFor(identity, clientId) {
    const client = clients.get(clientId);
    if (!client || key(client.identity) !== key(identity) || !alive(client)) throw denied();
    return client;
  }
  function revoke(grant) {
    if (grant.revoked) return;
    grant.revoked = true;
    const client = clients.get(grant.clientId), sessionId = `external-${grant.id}`;
    const sessionCancellation = { revokeSessionId: sessionId };
    if (client?.waiter) client.waiter([sessionCancellation]); else if (client) client.queue.push(sessionCancellation);
    grant.revocation = Promise.resolve(onRevokeSession(grant.projectId, sessionId));
    grant.revocation.catch(() => {});
    if (grant.run) {
      grant.run.cancelled = true;
      if (client?.pending) {
        const cancellation = { cancelRequestId: client.pending.requestId };
        if (client.waiter) client.waiter([cancellation]); else client.queue.push(cancellation);
      }
      bridge.cancel(grant.run);
    }
  }
  function prune() {
    for (const [scope, claim] of internalClaims) if (claim.expiresAt <= now() || !alive(clients.get(claim.clientId))) { internalClaims.delete(scope); busy.delete(scope); }
    for (const [code, pair] of pairs) if (pair.expiresAt <= now()) pairs.delete(code);
    for (const [token, grant] of grants) if (grant.expiresAt <= now() || grant.revoked) { revoke(grant); grants.delete(token); }
    for (const [clientId, client] of clients) if (!alive(client)) {
      for (const grant of grants.values()) if (grant.clientId === clientId) revoke(grant);
      client.waiter?.([]); clients.delete(clientId);
      if (owners.get(scopeKey(client)) === clientId) owners.delete(scopeKey(client));
    }
  }
  function register(identity, body) {
    prune();
    if (!id(body?.clientId) || !id(body?.projectId)) throw denied();
    const existing = clients.get(body.clientId);
    if (existing && (key(existing.identity) !== key(identity) || existing.projectId !== body.projectId)) throw denied();
    if (!existing && clients.size >= 100) throw denied();
    const client = existing || { identity, projectId: body.projectId, clientId: body.clientId, queue: [] };
    client.identity = identity; client.lastSeen = now(); clients.set(body.clientId, client);
    return client;
  }
  function activate(identity, body) {
    const client = register(identity, body), scope = scopeKey(client);
    if (busy.has(scope)) throw denied();
    owners.set(scope, client.clientId);
    return { success: true };
  }
  function poll(identity, body) {
    const client = register(identity, body);
    if (client.waiter) throw denied();
    if (client.queue.length) return Promise.resolve(client.queue.splice(0));
    return new Promise(resolve => {
      const timer = setTimeout(() => finish([]), 20000);
      const finish = commands => { clearTimeout(timer); client.waiter = null; resolve(commands); };
      client.waiter = finish;
    });
  }
  function redeem(code) {
    prune();
    const pair = pairs.get(code);
    if (!pair || !alive(clients.get(pair.clientId))) throw denied();
    pairs.delete(code);
    const token = crypto.randomBytes(32).toString('base64url');
    const grant = { ...pair, id: crypto.randomUUID(), expiresAt: pair.grantExpiresAt, revoked: false, receipts: new Map() };
    grants.set(token, grant);
    return { token, projectId: grant.projectId, expiresAt: grant.expiresAt };
  }
  async function control(token, body) {
    prune();
    const grant = grants.get(token), client = clients.get(grant?.clientId);
    if (!grant || grant.revoked || !alive(client) || owners.get(scopeKey(client)) !== client.clientId || !id(body?.requestId) || !validCanvasControl(body?.command)) throw denied();
    const command = body.command;
    if (['projects', 'project'].includes(command.action) && !grant.manageProjects) throw denied();
    const signature = JSON.stringify(command), previous = grant.receipts.get(body.requestId);
    if (previous) { if (previous.signature !== signature) throw denied(); return previous.promise; }
    const scope = scopeKey(client);
    if (busy.has(scope) || grant.receipts.size >= 1000) throw denied();
    busy.add(scope);
    const run = { projectId: grant.projectId, sessionId: `external-${grant.id}`, canvasControl: true, canvasCalls: 0, cancelled: false,
      emit(_event, action) {
        client.pending = action;
        if (client.waiter) client.waiter([action]); else client.queue.push(action);
      } };
    grant.run = run;
    const promise = bridge.dispatch(run, command).finally(() => {
      busy.delete(scope); client.queue = client.queue.filter(item => item.requestId !== client.pending?.requestId); client.pending = null; grant.run = null;
    });
    grant.receipts.set(body.requestId, { signature, promise });
    return promise;
  }
  function complete(identity, body) {
    const client = clientFor(identity, body?.clientId);
    if (!client.pending || client.pending.requestId !== body.requestId || owners.get(scopeKey(client)) !== client.clientId) throw denied();
    return bridge.complete(body.requestId, { projectId: client.projectId, sessionId: client.pending.sessionId, result: body.result });
  }
  function claim(identity, body) {
    prune();
    const client = register(identity, body), scope = scopeKey(client), owner = owners.get(scope);
    if (!id(body.requestId) || owner && owner !== client.clientId) throw denied();
    if (client.pending?.requestId === body.requestId && busy.has(scope)) return { external: true };
    if (busy.has(scope)) throw denied();
    owners.set(scope, client.clientId); busy.add(scope);
    internalClaims.set(scope, { clientId: client.clientId, requestId: body.requestId, expiresAt: now() + timeout });
    return { external: false };
  }
  function finish(identity, body) {
    const client = clientFor(identity, body.clientId), scope = scopeKey(client), current = internalClaims.get(scope);
    if (!current || current.clientId !== client.clientId || current.requestId !== body.requestId) throw denied();
    internalClaims.delete(scope); busy.delete(scope); return { success: true };
  }
  async function listen() {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const app = express();
      app.use((request, response, next) => {
        const expected = `127.0.0.1:${server.address()?.port}`;
        if (request.headers.host !== expected || request.socket.remoteAddress !== '127.0.0.1' || request.headers.origin || Object.keys(request.headers).some(name => name === 'forwarded' || name.startsWith('x-forwarded-'))) return response.sendStatus(403);
        response.setHeader('Cache-Control', 'no-store'); next();
      });
      app.use(express.json({ limit: Infinity }));
      app.post('/pair', async (request, response) => { try { response.json(redeem(request.body?.code)); } catch { response.sendStatus(403); } });
      app.post('/control', async (request, response) => {
        try { response.json(await control(request.headers.authorization?.replace(/^Bearer /, ''), request.body)); }
        catch (error) { response.status(error.status || 500).json({ ok: false, code: 'UNAVAILABLE' }); }
      });
      app.use((_error, _request, response, _next) => response.status(400).json({ ok: false, code: 'INVALID' }));
      server = http.createServer(app);
      server.requestTimeout = timeout + 5000;
      server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });
    return opening;
  }
  async function pair(identity, body) {
    const client = clientFor(identity, body?.clientId);
    if (owners.get(scopeKey(client)) !== client.clientId || typeof body.manageProjects !== 'boolean') throw denied();
    prune(); if (pairs.size + grants.size >= 100) throw denied();
    const port = await listen(), code = crypto.randomBytes(24).toString('base64url');
    const expiresAt = now() + 120000;
    pairs.set(code, { identity, clientId: client.clientId, projectId: client.projectId, manageProjects: body.manageProjects,
      expiresAt, grantExpiresAt: Math.min(now() + 3600000, identity.expiresAt * 1000) });
    const helper = fileURLToPath(new URL('./canvasMcpClient.mjs', import.meta.url));
    let codexCommand;
    try {
      const [executable, prefix] = await findCodexCommand();
      const launch = Buffer.from(JSON.stringify({ executable, prefix })).toString('base64url');
      codexCommand = `& ${quote(process.execPath)} ${quote(helper)} --codex-launch ${launch} --port ${port} --pair ${code}`;
    } catch { /* Other MCP clients can use the standalone command. */ }
    return { expiresAt, command: `& ${quote(process.execPath)} ${quote(helper)} --port ${port} --pair ${code}`, codexCommand,
      desktopCommand: `& ${quote(process.execPath)} ${quote(helper)} --desktop-setup --port ${port} --pair ${code}` };
  }
  function list(identity, clientId) {
    prune(); const client = clientFor(identity, clientId);
    return [...grants.values()].filter(grant => key(grant.identity) === key(identity) && grant.projectId === client.projectId)
      .map(({ id, expiresAt, manageProjects, revoked, clientId: owner }) => ({ id, expiresAt, manageProjects, revoked, thisWindow: owner === clientId }));
  }
  const router = express.Router();
  const route = work => async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    try { response.json(await work(getAuthenticatedRequest(request).identity, request.body || {})); }
    catch (error) { response.status(error.status || 500).json({ error: '外部连接操作未确认，请回到目标项目窗口重新配对。' }); }
  };
  router.post('/activate', route(activate)); router.post('/poll', route(poll)); router.post('/pair', route(pair)); router.post('/complete', route(complete));
  router.post('/heartbeat', route((identity, body) => { register(identity, body); return { success: true }; }));
  router.post('/claim', route(claim)); router.post('/finish', route(finish));
  router.post('/release', route((identity, body) => {
    const client = clients.get(body.clientId);
    if (client && key(client.identity) === key(identity)) { client.lastSeen = 0; prune(); }
    return { success: true };
  }));
  router.post('/list', route((identity, body) => list(identity, body.clientId)));
  router.post('/revoke', route(async (identity, body) => {
    clientFor(identity, body.clientId);
    for (const grant of grants.values()) if (grant.id === body.id && key(grant.identity) === key(identity)) { revoke(grant); await grant.revocation; }
    for (const [code, pending] of pairs) if (pending.clientId === body.clientId) pairs.delete(code);
    return { success: true };
  }));
  const sweep = setInterval(prune, 5000); sweep.unref();
  return { router, activate, poll, pair, redeem, control, complete, list, claim, finish,
    isSessionActive(sessionId) {
      if (!sessionId.startsWith('external-')) return true;
      return [...grants.values()].some(grant => `external-${grant.id}` === sessionId && !grant.revoked && grant.expiresAt > now() && alive(clients.get(grant.clientId)) && owners.get(scopeKey(clients.get(grant.clientId))) === grant.clientId);
    },
    revokeSession(identity) {
      for (const grant of grants.values()) if (key(grant.identity) === key(identity)) revoke(grant);
      for (const [code, pending] of pairs) if (key(pending.identity) === key(identity)) pairs.delete(code);
      for (const client of clients.values()) if (key(client.identity) === key(identity)) client.lastSeen = 0;
      prune();
    },
    async close() { clearInterval(sweep); for (const grant of grants.values()) revoke(grant); for (const client of clients.values()) client.waiter?.([]); server?.closeAllConnections(); if (server?.listening) await new Promise(resolve => server.close(resolve)); },
  };
}
