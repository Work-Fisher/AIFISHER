export interface DashboardProject {
  id: string;
  title: string;
  folderId?: string | null;
  coverUrl?: string;
  nodeCount?: number;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}
export interface DashboardFolder {
  id: string;
  name: string;
  projectCount?: number;
  parentId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}
export interface DashboardData {
  projects: DashboardProject[];
  folders: DashboardFolder[];
}
export type DashboardFilter = 'all' | 'folders' | 'projects';
export type DashboardSort = 'recent' | 'created' | 'name';
export type DashboardOrder = 'newest' | 'oldest';
export function dashboardBreadcrumb(
  folders: readonly DashboardFolder[],
  id: string | null,
): DashboardFolder[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder])),
    seen = new Set<string>(),
    result: DashboardFolder[] = [];
  let next = id;
  while (next && !seen.has(next)) {
    seen.add(next);
    const folder = byId.get(next);
    if (!folder) break;
    result.unshift(folder);
    next = folder.parentId || null;
  }
  return result;
}
export function visibleDashboard(
  data: DashboardData,
  folderId: string | null,
  query: string,
  filter: DashboardFilter,
  sort: DashboardSort,
  order: DashboardOrder,
) {
  const known = new Set(data.folders.map((folder) => folder.id)),
    matches = (value: string) => value.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  const parent = (id: string | null | undefined) => (id && known.has(id) ? id : null);
  const compare = (
    left: DashboardFolder | DashboardProject,
    right: DashboardFolder | DashboardProject,
  ) => {
    let result: number;
    if (sort === 'name')
      result = String('title' in left ? left.title : left.name).localeCompare(
        String('title' in right ? right.title : right.name),
      );
    else {
      const field = sort === 'created' ? 'createdAt' : 'updatedAt';
      result = (Date.parse(String(right[field])) || 0) - (Date.parse(String(left[field])) || 0);
    }
    return order === 'newest' ? result : -result;
  };
  return {
    folders:
      filter === 'projects'
        ? []
        : data.folders
            .filter((folder) => parent(folder.parentId) === folderId && matches(folder.name))
            .sort(compare),
    projects:
      filter === 'folders'
        ? []
        : data.projects
            .filter((project) => parent(project.folderId) === folderId && matches(project.title))
            .sort(compare),
  };
}
export function createDashboardClient(fetcher: typeof fetch = fetch) {
  const request = async (path: string, init: RequestInit = {}) => {
    let response: Response;
    try {
      response = await fetcher(path, init);
    } catch (error) {
      if (init.signal?.aborted) throw error;
      throw Error(
        init.method && init.method !== 'GET'
          ? '操作结果未确认，请先刷新列表核对'
          : '项目列表读取失败，请刷新重试',
        { cause: error },
      );
    }
    if (response.status === 204) return null;
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw Error(response.ok ? '项目服务返回了无效数据' : '项目服务暂时不可用');
    }
    if (!response.ok) {
      const message =
        body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
          ? body.error
          : '项目操作失败，请重试';
      throw Error(message);
    }
    return body;
  };
  const write = (path: string, method: string, body: unknown, signal?: AbortSignal) =>
    request(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
    });
  const idPath = (type: string, id: string) => `/api/${type}/${encodeURIComponent(id)}`;
  return {
    async load(signal?: AbortSignal): Promise<DashboardData> {
      const [projects, folders] = await Promise.all([
        request('/api/workflows', { signal }),
        request('/api/folders', { signal }),
      ]);
      if (!Array.isArray(projects) || !Array.isArray(folders)) throw Error('项目列表数据无效');
      if (
        projects.some(
          (item) => !item || typeof item.id !== 'string' || typeof item.title !== 'string',
        ) ||
        folders.some(
          (item) => !item || typeof item.id !== 'string' || typeof item.name !== 'string',
        )
      )
        throw Error('项目或文件夹信息无效');
      return { projects, folders };
    },
    async createFolder(parentId: string | null, signal?: AbortSignal): Promise<DashboardFolder> {
      const result = await write(
        '/api/folders',
        'POST',
        { name: '未命名文件夹', parentId },
        signal,
      );
      if (
        !result ||
        typeof result !== 'object' ||
        !('id' in result) ||
        typeof result.id !== 'string'
      )
        throw Error('文件夹创建结果无效，请刷新列表核对');
      return result as DashboardFolder;
    },
    renameFolder: (folder: DashboardFolder, name: string, signal?: AbortSignal) =>
      write('/api/folders', 'POST', { ...folder, name }, signal),
    renameProject: (id: string, title: string, signal?: AbortSignal) =>
      write(idPath('workflows', id) + '/rename', 'PUT', { title }, signal),
    deleteProject: (id: string, signal?: AbortSignal) =>
      write(idPath('workflows', id), 'DELETE', undefined, signal),
    deleteFolder: (id: string, signal?: AbortSignal) =>
      write(idPath('folders', id), 'DELETE', undefined, signal),
    moveProject: (id: string, folderId: string | null, signal?: AbortSignal) =>
      write(idPath('workflows', id) + '/move', 'PUT', { folderId }, signal),
    async previewCleanup(id: string, signal?: AbortSignal): Promise<string[]> {
      const result = await write(
        idPath('workflows', id) + '/cleanup',
        'POST',
        { preview: true },
        signal,
      );
      if (
        !result ||
        typeof result !== 'object' ||
        !('pendingDelete' in result) ||
        !Array.isArray(result.pendingDelete) ||
        result.pendingDelete.some((file) => typeof file !== 'string')
      )
        throw Error('清理预览数据无效');
      return result.pendingDelete;
    },
    cleanupProject: (id: string, signal?: AbortSignal) =>
      write(idPath('workflows', id) + '/cleanup', 'POST', { preview: false }, signal),
  };
}
