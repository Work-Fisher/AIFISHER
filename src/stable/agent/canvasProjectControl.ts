import { createDashboardClient } from '../navigation/projectDashboardData';
import { validCanvasControl, projectCanvasResult, type CanvasActionHandler, type CanvasActionRequest, type CanvasResult, type ProjectCommand } from '../../shared/canvasControlProtocol.js';

interface Runtime {
  projectId: string;
  folderId?: string | null;
  save(): Promise<boolean>;
  rename(title: string): Promise<boolean>;
  move(folderId: string | null): void;
  open(id: string): Promise<void>;
  exit(): Promise<void>;
  importFile(): void;
  download(id: string): void;
}
export type ProjectRequest = { id: string; sessionId: string; label: string; kind: 'delete' | 'deleteFolder' | 'export' | 'import'; state: 'pending' | 'running' | 'completed' | 'unconfirmed' | 'cancelled' };
export function createCanvasProjectControl(execute: CanvasActionHandler, getRuntime: () => Runtime | null, fetcher: typeof fetch = globalThis.fetch) {
  const client = createDashboardClient(fetcher);
  const receipts = new Map<string, { signature: string; promise: Promise<CanvasResult> }>();
  const pending = new Map<string, { item: ProjectRequest; request: CanvasActionRequest; command: ProjectCommand }>();
  const listeners = new Set<() => void>();
  let snapshot: ProjectRequest[] = [];
  const publish = () => { snapshot = [...pending.values()].map(({ item }) => ({ ...item })); listeners.forEach(listener => listener()); };
  const active = (request: CanvasActionRequest, signal?: AbortSignal) => !signal?.aborted && request.expiresAt > Date.now() && getRuntime()?.projectId === request.projectId;
  const read = (request: CanvasActionRequest) => execute({ ...request, requestId: crypto.randomUUID(), command: { action: 'read' } });
  const catalog = (projects: Array<{ id: string; title: string; folderId?: string | null }>) => projects.map(({ id, title, folderId }) => ({ id, title, folderId: folderId ?? null }));
  async function handle(request: CanvasActionRequest, signal?: AbortSignal): Promise<CanvasResult> {
    if (!active(request, signal)) return { ok: false, code: 'UNAVAILABLE' };
    const before = await read(request), command = request.command;
    if (!before.ok) return before;
    if (command.action !== 'projects' && command.action !== 'project') return { ok: false, code: 'INVALID' };
    if (command.action === 'project' && command.revision !== before.revision) return { ok: false, code: 'CONFLICT' };
    let mutating = false;
    try {
      const data = await client.load(signal);
      if (!active(request, signal)) return { ok: false, code: 'UNAVAILABLE' };
      if (command.action === 'projects') {
        const query = (command.query || '').toLocaleLowerCase(), offset = command.offset || 0;
        const filtered = data.projects.filter(project => project.title.toLocaleLowerCase().includes(query));
        return projectCanvasResult({ ok: true, revision: before.revision, projects: catalog(filtered.slice(offset, offset + 50)),
          folders: data.folders.filter(folder => folder.name.toLocaleLowerCase().includes(query)).slice(offset, offset + 50).map(folder => ({ id: folder.id, title: folder.name, folderId: folder.parentId ?? null })),
          projectNextOffset: offset + 50 < Math.max(filtered.length, data.folders.filter(folder => folder.name.toLocaleLowerCase().includes(query)).length) ? offset + 50 : null });
      }
      const current = await read(request);
      if (!current.ok || current.revision !== command.revision) return { ok: false, code: 'CONFLICT' };
      const runtime = getRuntime()!;
      const target = 'projectId' in command ? data.projects.find(project => project.id === command.projectId) : undefined;
      if ('projectId' in command && !target) return { ok: false, code: 'NOT_FOUND' };
      const folder = 'folderId' in command && command.folderId ? data.folders.find(folder => folder.id === command.folderId) : undefined;
      if ('folderId' in command && command.folderId && !folder) return { ok: false, code: 'NOT_FOUND' };
      if (['delete', 'deleteFolder', 'export', 'import'].includes(command.operation)) {
        if (pending.size >= 20) for (const [id, entry] of pending) {
          if (entry.item.state === 'running' || entry.item.state === 'pending' && active(entry.request)) continue;
          pending.delete(id);
          if (pending.size < 20) break;
        }
        if (pending.size >= 20) return { ok: false, code: 'UNAVAILABLE' };
        const labels = { delete: `删除项目“${target?.title}”`, deleteFolder: `删除文件夹“${folder?.name}”`, export: `导出项目“${target?.title}”`, import: '选择并导入项目文件' };
        const kind = command.operation as ProjectRequest['kind'], id = crypto.randomUUID();
        pending.set(id, { item: { id, sessionId: request.sessionId, label: labels[kind], kind, state: 'pending' }, request: { ...request, expiresAt: Date.now() + 600000 }, command });
        publish();
        return { ok: true, revision: current.revision, projectState: 'awaiting-user', projectRequestId: id };
      }
      if (command.operation === 'open') {
        const navigationRequest = { ...request, expiresAt: Date.now() + 600000 };
        let claimed = false;
        // Send the receipt and let the current answer finish before changing its project scope.
        return { ok: true, revision: current.revision, projectState: 'ready-to-open', projects: catalog([target!]), afterTurn: async () => {
          if (claimed) return;
          claimed = true;
          if (!active(navigationRequest) || !await runtime.save() || !active(navigationRequest)) throw Error('项目切换未完成，请核对保存状态。');
          await runtime.open(command.projectId);
        } };
      }
      mutating = true;
      if (command.operation === 'save') {
        if (!await runtime.save()) return { ok: false, code: 'UNCONFIRMED' };
      } else if (command.operation === 'rename') {
        if (command.projectId === runtime.projectId) {
          if (!await runtime.rename(command.title)) return { ok: false, code: 'UNCONFIRMED' };
        } else await client.renameProject(command.projectId, command.title, signal);
      } else if (command.operation === 'move') {
        if (command.projectId === runtime.projectId && !await runtime.save()) return { ok: false, code: 'UNCONFIRMED' };
        if (!active(request, signal)) return { ok: false, code: 'UNCONFIRMED' };
        await client.moveProject(command.projectId, command.folderId, signal);
        if (active(request) && command.projectId === runtime.projectId) runtime.move(command.folderId);
      } else if (command.operation === 'createFolder') {
        const created = await client.createFolder(command.folderId ?? null, signal);
        await client.renameFolder(created, command.title, signal);
      } else if (command.operation === 'renameFolder') {
        await client.renameFolder(folder!, command.title, signal);
      } else if (command.operation === 'create' || command.operation === 'duplicate') {
        let response: Response;
        if (command.operation === 'duplicate') {
          if (command.projectId === runtime.projectId && !await runtime.save()) return { ok: false, code: 'UNCONFIRMED' };
          if (!active(request, signal)) return { ok: false, code: 'UNCONFIRMED' };
          // The backend backs up and restores the copy itself; no archive passes through the page.
          response = await fetcher(`/api/workflows/${encodeURIComponent(command.projectId)}/duplicate`, { method: 'POST', signal });
        } else if (command.operation === 'create') {
          response = await fetcher('/api/workflows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
            body: JSON.stringify({ id: crypto.randomUUID(), title: command.title, folderId: command.folderId ?? null, revision: 0, nodes: [], groups: [], viewport: { x: 0, y: 0, zoom: 1 } }) });
        } else return { ok: false, code: 'INVALID' };
        if (!response.ok) throw Error('Project creation unconfirmed');
        const created = await response.json();
        if (typeof created.id !== 'string') throw Error('Invalid project receipt');
        const actual = (await client.load(signal)).projects.find(project => project.id === created.id);
        if (!actual) throw Error('Created project not found');
        return projectCanvasResult({ ok: true, revision: current.revision, projectState: 'created', projects: catalog([actual]) });
      }
      const after = await read(request);
      return after.ok ? { ok: true, revision: after.revision, projectState: command.operation === 'save' ? 'saved' : 'updated' } : { ok: false, code: 'UNCONFIRMED' };
    } catch { return { ok: false, code: mutating ? 'UNCONFIRMED' : 'UNAVAILABLE' }; }
  }
  const control: CanvasActionHandler = (request, signal) => {
    if (!validCanvasControl(request.command)) return { ok: false, code: 'INVALID' };
    if (!['projects', 'project'].includes(request.command.action)) return execute(request, signal);
    const signature = JSON.stringify(request), old = receipts.get(request.requestId);
    if (old) return old.signature === signature ? old.promise : { ok: false, code: 'INVALID' };
    if (receipts.size >= 500) return { ok: false, code: 'UNAVAILABLE' };
    const promise = handle(request, signal); receipts.set(request.requestId, { signature, promise }); return promise;
  };
  async function approve(id: string) {
    const entry = pending.get(id);
    if (!entry || entry.item.state !== 'pending') return;
    entry.item.state = 'running'; publish();
    const { request, command } = entry, runtime = getRuntime();
    try {
      if (!runtime || !active(request)) throw Error('Expired');
      if (command.operation === 'import') {
        if (!await runtime.save() || !active(request)) throw Error('Save failed');
        runtime.importFile(); entry.item.state = 'completed'; return;
      }
      if (command.operation === 'export') {
        if (command.projectId === runtime.projectId && !await runtime.save()) throw Error('Save failed');
        if (!active(request)) throw Error('Expired');
        runtime.download(command.projectId); entry.item.state = 'completed'; return;
      }
      const current = await read(request);
      if (!current.ok || current.revision !== command.revision) throw Error('Changed');
      if (command.operation === 'delete') {
        if (command.projectId === runtime.projectId) {
          if (!await runtime.save() || !active(request)) throw Error('Save failed');
          await runtime.exit();
        }
        await client.deleteProject(command.projectId);
        entry.item.state = 'completed';
      } else if (command.operation === 'deleteFolder') {
        if (!await runtime.save() || !active(request)) throw Error('Save failed');
        await client.deleteFolder(command.folderId); entry.item.state = 'completed';
        if (active(request)) {
          const actual = (await client.load()).projects.find(project => project.id === runtime.projectId);
          if (actual) runtime.move(actual.folderId ?? null);
        }
      }
    } catch { entry.item.state = 'unconfirmed'; }
    finally { publish(); }
  }
  return { control, approve, getSnapshot: () => snapshot,
    cancelSession(sessionId: string) { for (const entry of pending.values()) if (entry.item.sessionId === sessionId && entry.item.state === 'pending') entry.item.state = 'cancelled'; publish(); },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    cancel: (id: string) => { const entry = pending.get(id); if (entry?.item.state === 'pending') { entry.item.state = 'cancelled'; publish(); } },
  };
}
export type CanvasProjectControl = ReturnType<typeof createCanvasProjectControl>;
