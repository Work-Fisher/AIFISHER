export type RuntimeDiagnostic = {
  status: string;
  diagnosticCode?: string;
  message?: string;
  actions?: string[];
};

export type LocalRuntimeStatus = {
  localOnly: true;
  gpu: RuntimeDiagnostic & {
    available: boolean;
    sufficient: boolean;
    name?: string;
    vramTotalBytes?: number;
    vramFreeBytes?: number;
  };
  models: RuntimeDiagnostic & {
    source?: 'fisherai';
    directory: string;
    total: number;
    byType: Record<string, number>;
    items: Array<Record<string, unknown>>;
  };
  comfyui: RuntimeDiagnostic & {
    address: string | null;
    workflowCount: number;
    compatibleWorkflowCount?: number;
    incompatibleWorkflowCount?: number;
    nodeTypeCount?: number;
    version?: string | null;
    models?: {
      total: number;
      checkpoints?: string[];
      diffusionModels?: string[];
      textEncoders?: string[];
      vaes?: string[];
      loras?: string[];
    };
    workflows?: Array<{
      type: string;
      title: string;
      status: 'ready' | 'incompatible';
      missingNodeTypes: string[];
      missingModels: Array<{ type: string; name: string }>;
    }>;
    queueRemaining?: number;
    process?: ComfyProcessState;
  };
  diagnostics: string[];
};

export type ComfyProcessState = {
  phase?: 'unavailable' | 'idle' | 'starting' | 'running' | 'external' | 'failed' | 'error';
  autoStart?: boolean;
  running: boolean;
  owned: boolean;
  startable: boolean;
  pid?: number;
  address?: string | null;
  /** 只返回文件名，安装目录的绝对路径不会离开后端。 */
  pythonName?: string;
  entryName?: string;
  diagnosticCode?: string;
  message?: string;
  actions?: string[];
};

export type ComfyDirectorySelectionResult =
  | { status: 'selected'; root: string }
  | { status: 'cancelled' }
  | {
      status: 'invalid';
      diagnosticCode: string;
      message: string;
      actions?: string[];
    };

export type ComfyLogStream = { available: boolean; lines: string[] };

export type ComfyLogs = {
  state: ComfyProcessState;
  logs: { stdout: ComfyLogStream; stderr: ComfyLogStream };
};

export type ComfyProcessResult = {
  status: 'ready' | 'starting' | 'stopped' | 'not-running' | 'disabled' | 'failed';
  owned?: boolean;
  pid?: number;
  address?: string;
  diagnosticCode?: string;
  message?: string;
  actions?: string[];
};

export type ComfyNodeIdExtensionStatus = {
  id: 'fisherai_node_ids';
  name: string;
  bundledVersion: string;
  installedVersion?: string | null;
  status: 'unavailable' | 'missing' | 'update-available' | 'up-to-date';
  installable: boolean;
  diagnosticCode?: string;
  message?: string;
};

export type ComfyNodeIdExtensionInstallResult = {
  id: 'fisherai_node_ids';
  name: string;
  bundledVersion: string;
  installedVersion: string;
  status: 'installed' | 'updated' | 'up-to-date';
  changed: boolean;
  restartRequired: boolean;
};

async function readComfyProcess<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: unknown; status?: string };
  // 启动失败会返回 409 并带上诊断码，属于正常业务结果，不当作请求异常。
  if (!response.ok && body.status !== 'failed') {
    throw new Error(body.error ? String(body.error) : `本机 ComfyUI 操作失败 (${response.status})`);
  }
  return body;
}

async function readStatus(response: Response): Promise<LocalRuntimeStatus> {
  const body = (await response.json()) as LocalRuntimeStatus & { error?: unknown };
  if (!response.ok) {
    throw new Error(body.error ? String(body.error) : `本地运行环境检测失败 (${response.status})`);
  }
  return body;
}

async function readComfyDirectorySelection(
  response: Response,
): Promise<ComfyDirectorySelectionResult> {
  const body = (await response.json()) as ComfyDirectorySelectionResult & { error?: unknown };
  if (!response.ok && body.status !== 'invalid') {
    throw new Error(body.error ? String(body.error) : `选择 ComfyUI 目录失败 (${response.status})`);
  }
  return body;
}

export function createLocalRuntimeClient(fetcher: typeof fetch = globalThis.fetch) {
  return {
    getStatus(): Promise<LocalRuntimeStatus> {
      return fetcher('/api/local-runtime/status').then(readStatus);
    },
    refresh(): Promise<LocalRuntimeStatus> {
      return fetcher('/api/local-runtime/refresh', { method: 'POST' }).then(readStatus);
    },
    getComfyProcess(): Promise<ComfyProcessState> {
      return fetcher('/api/local-runtime/comfyui').then(readComfyProcess<ComfyProcessState>);
    },
    startComfy(): Promise<ComfyProcessResult> {
      return fetcher('/api/local-runtime/comfyui/start', { method: 'POST' }).then(
        readComfyProcess<ComfyProcessResult>,
      );
    },
    stopComfy(): Promise<ComfyProcessResult> {
      return fetcher('/api/local-runtime/comfyui/stop', { method: 'POST' }).then(
        readComfyProcess<ComfyProcessResult>,
      );
    },
    getComfyLogs(lines = 200): Promise<ComfyLogs> {
      return fetcher(
        `/api/local-runtime/comfyui/logs?lines=${encodeURIComponent(String(lines))}`,
      ).then(readComfyProcess<ComfyLogs>);
    },
    getComfyNodeIdExtension(): Promise<ComfyNodeIdExtensionStatus> {
      return fetcher('/api/local-runtime/comfyui/extensions/node-ids').then(
        readComfyProcess<ComfyNodeIdExtensionStatus>,
      );
    },
    installComfyNodeIdExtension(): Promise<ComfyNodeIdExtensionInstallResult> {
      return fetcher('/api/local-runtime/comfyui/extensions/node-ids/install', {
        method: 'POST',
      }).then(readComfyProcess<ComfyNodeIdExtensionInstallResult>);
    },
    discoverComfy(): Promise<{ candidates: Array<{ root: string; name: string }>; configuredRoot: string; scope: string }> {
      return fetcher('/api/local-runtime/comfyui/discover', { method: 'POST' }).then(readComfyProcess<{ candidates: Array<{ root: string; name: string }>; configuredRoot: string; scope: string }>);
    },
    validateComfyDirectory(root: string): Promise<{ status: 'selected'; root: string }> {
      return fetcher('/api/local-runtime/comfyui/validate-directory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ root }) }).then(readComfyProcess<{ status: 'selected'; root: string }>);
    },
    selectComfyDirectory(): Promise<ComfyDirectorySelectionResult> {
      return fetcher('/api/local-runtime/comfyui/select-directory', { method: 'POST' }).then(
        readComfyDirectorySelection,
      );
    },
    /** 保存已经由后端校验的选择结果：复用既有配置接口，不另建写 .env 的路径。 */
    async adoptComfy(root: string): Promise<void> {
      const response = await fetcher('/api/config/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ COMFYUI_ROOT: root, COMFYUI_AUTO_START: 'true' }),
      });
      if (!response.ok) throw new Error('保存本机 ComfyUI 目录失败。');
    },
  };
}

export type LocalRuntimeClient = ReturnType<typeof createLocalRuntimeClient>;

declare global {
  interface Window {
    __FISHERAI_LOCAL_RUNTIME__?: LocalRuntimeClient;
  }
}

export function installLocalRuntimeClient(client = createLocalRuntimeClient()): LocalRuntimeClient {
  window.__FISHERAI_LOCAL_RUNTIME__ = client;
  return client;
}
