import { validCanvasControl, projectCanvasResult, type CanvasActionHandler, type CanvasActionRequest, type CanvasResult } from '../../shared/canvasControlProtocol.js';
import { assetNode } from '../canvas/canvasAssetInsertion';
import type { createCanvasControlExecutor } from './canvasControlExecutor';

/** Asset lookup is scoped by the existing authenticated library API. Models see opaque handles only. */
export function createCanvasAssetControl(execute: ReturnType<typeof createCanvasControlExecutor>, fetcher: typeof fetch = globalThis.fetch): CanvasActionHandler {
  const handles = new Map<string, string>();
  const inFlight = new Map<string, { signature: string; promise: Promise<CanvasResult> }>();
  const read = (request: CanvasActionRequest) => execute({ ...request, requestId: crypto.randomUUID(), command: { action: 'read' } });
  async function json(url: string, signal: AbortSignal, body?: unknown) {
    const response = await fetcher(url, { signal, ...(body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }) });
    if (!response.ok) throw new Error('Asset request failed');
    if (!response.body) throw new Error('Missing asset response');
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let content = '', bytes = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 8 * 1024 * 1024 || signal.aborted) throw new Error('Asset response interrupted or too large');
        content += decoder.decode(part.value, { stream: true });
      }
      content += decoder.decode();
    } finally { await reader.cancel().catch(() => {}); }
    return JSON.parse(content);
  }
  async function assets(request: CanvasActionRequest, signal?: AbortSignal): Promise<CanvasResult> {
    const before = read(request);
    if (!before.ok) return before;
    const command = request.command;
    if (command.action !== 'assets' && command.action !== 'importAsset') return { ok: false, code: 'INVALID' };
    const lifetime = Math.min(10000, request.expiresAt - Date.now());
    if (lifetime <= 0) return { ok: false, code: 'UNCONFIRMED' };
    const abort = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(lifetime)]);
    try {
      if (command.action === 'assets') {
        const items = await json('/api/library', abort);
        if (!Array.isArray(items)) return { ok: false, code: 'INVALID' };
        const query = (command.query || '').toLocaleLowerCase(), offset = command.offset || 0;
        const filtered = items.filter(item => item && typeof item.id === 'string' && item.id.length <= 4096
          && ['image', 'video', 'audio'].includes(item.type)
          && `${item.name || ''} ${item.title || ''} ${item.category || ''}`.toLocaleLowerCase().includes(query));
        const next = read(request);
        if (!next.ok || abort.aborted) return { ok: false, code: 'UNAVAILABLE' };
        const results = filtered.slice(offset, offset + 50).map(item => {
          const existing = [...handles].find(([, value]) => value === item.id)?.[0];
          const id = existing || crypto.randomUUID();
          handles.set(id, item.id);
          if (handles.size > 5000) handles.delete(handles.keys().next().value!);
          return { id, name: String(item.name || item.title || '').slice(0, 500), type: `${item.type}s` };
        });
        return projectCanvasResult({ ok: true, revision: next.revision, assets: results, nextOffset: offset + 50 < filtered.length ? offset + 50 : null });
      }
      // Existing receipts are checked before copying a library asset again.
      const prior = execute(request);
      if (prior.ok || prior.code !== 'UNAVAILABLE') return prior;
      if (before.revision !== command.revision) return { ok: false, code: 'CONFLICT' };
      const id = handles.get(command.assetId);
      if (!id) return { ok: false, code: 'NOT_FOUND' };
      const imported = await json('/api/library/import', abort, { id, projectId: request.projectId });
      if (abort.aborted) return { ok: false, code: 'UNCONFIRMED' };
      const asset = imported?.asset;
      if (!asset || !['images', 'videos', 'audios'].includes(asset.type) || typeof asset.url !== 'string') return { ok: false, code: 'INVALID' };
      // The import endpoint returns a protected project-media URL, never a model-provided path.
      const url = new URL(asset.url, window.location.origin);
      const segment = `/media/${encodeURIComponent(request.projectId)}/${asset.type}/`;
      if (url.origin !== window.location.origin || !url.pathname.includes(segment) || url.search || url.hash) return { ok: false, code: 'INVALID' };
      const node = assetNode(asset, {}, request.projectId, { x: command.x, y: command.y }, crypto.randomUUID());
      return execute(request, node); // Rechecks document, revision and expiry after the asynchronous copy.
    } catch {
      return { ok: false, code: command.action === 'importAsset' ? 'UNCONFIRMED' : 'UNAVAILABLE' };
    }
  }
  return (request, signal) => {
    if (signal?.aborted) return { ok: false, code: 'UNAVAILABLE' };
    if (!validCanvasControl(request.command)) return { ok: false, code: 'INVALID' };
    if (!['assets', 'importAsset'].includes(request.command.action)) return execute(request);
    const signature = JSON.stringify([request.projectId, request.sessionId, request.command]);
    const pending = inFlight.get(request.requestId);
    if (pending) return pending.signature === signature ? pending.promise : { ok: false, code: 'INVALID' };
    const promise = assets(request, signal).finally(() => inFlight.delete(request.requestId));
    inFlight.set(request.requestId, { signature, promise });
    return promise;
  };
}
