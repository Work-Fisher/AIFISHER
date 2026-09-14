import { fileUploadBody, localFilePath } from '../desktop/localFileUpload';

export type OfficialWorkflow = {
  id: string; name: string; description: string; categoryId: string; inputs: string[];
  output: string; skillSlug: string; version: string; configured: boolean; definitionId?: string; sourceUrl?: string;
};

export interface WorkflowDefinition {
  id: string;
  name: string;
  revision: number;
  sourceArtifacts: Array<{
    id: string;
    format: string;
    role: 'ui' | 'api';
    originalFilename: string;
    origin?: string;
  }>;
  executionPlan: null | { executionPlanHash: string };
  presentation?: {
    customCoverUrl?: string;
    categoryId?: string;
    updatedAt?: string;
  };
  description?: string;
  analysis?: { warnings?: Array<{ code: string; nodeId?: string }> };
}

export interface BindingCandidate {
  id: string;
  nodeId: string;
  classType: string;
  nodeTitle: string;
  fieldName: string;
  valueType: string;
  required: boolean;
  control: string;
  mediaKind?: string;
  hasDefault: boolean;
  optionCount: number;
  minimum?: number;
  maximum?: number;
  step?: number;
  minimumItems?: number;
  maximumItems?: number;
  capacity?: number;
}

export interface BindingSet {
  id: string;
  previousBindingSetId?: string | null;
  name: string;
  revision: number;
  bindings: Array<{
    id: string;
    key: string;
    label: string;
    description?: string;
    control: {
      kind: string;
      mediaKind?: string;
      required: boolean;
      minimum?: number;
      maximum?: number;
      step?: number;
      multiple?: boolean;
      minimumItems?: number;
      maximumItems?: number;
      capacity?: number;
      options: Array<{ id: string; label: string }>;
      hasDefault: boolean;
      defaultValue?: unknown;
    };
  }>;
}

export interface WorkflowRun {
  runId: string;
  runner?: 'local-comfyui' | 'runninghub-workflow' | 'runninghub-webapp';
  status: 'loading' | 'success' | 'failed' | 'cancelled' | 'unknown';
  phase: string;
  promptId?: string;
  code?: string;
  error?: string;
  remoteMayContinue?: boolean;
  createdAt?: string;
  updatedAt?: string;
  observationPausedAt?: string;
  observationWindowMs?: number;
  observationElapsedMs?: number;
  availableOutputs?: Array<{
    nodeId: string;
    classType: string;
    outputKey: string;
    outputIndex: number;
    mediaKind: string;
    kind: string;
  }>;
  currentNodeId?: string;
  progress?: {
    value: number;
    maximum: number;
    currentNodeId?: string;
  };
  realtimeChannel?: 'websocket' | 'history-fallback';
  cachedNodeIds?: string[];
  nodeErrors?: Array<{
    nodeId: string;
    errorType: string;
    message: string;
  }>;
  resolvedSeeds?: Array<{
    bindingKey: string;
    seedPolicy: 'fixed' | 'random' | 'increment' | 'decrement';
    resolvedSeed: number;
  }>;
  seedAdvancements?: WorkflowSeedAdvancement[];
  definitionId?: string;
  deploymentId?: string;
  bindingSetId?: string;
  projectId?: string;
  inputCleanup?: {
    state: string;
    totalBytes: number;
    retryable: boolean;
    updatedAt?: string;
  };
  receipt?: {
    receiptHash: string;
    succeededAt: string;
    seeds?: Array<{
      bindingKey: string;
      seedPolicy: 'fixed' | 'random' | 'increment' | 'decrement';
      resolvedSeed: number;
    }>;
    outputs: Array<Record<string, unknown>>;
  };
}

export interface WorkflowSeedAdvancement {
  bindingKey: string;
  mode: 'increment' | 'decrement';
  previousValue: number;
  nextValue: number;
  step: number;
}

export interface WorkflowDeploymentDto {
  id: string;
  runner?: 'local-comfyui' | 'runninghub-workflow' | 'runninghub-webapp';
  serverUrl?: string;
  comfyuiVersion?: string;
  baseUrl?: string;
  credentialRef?: 'runninghub-cn' | 'runninghub-global';
  remoteWorkflowId?: string;
  remoteWebAppId?: string;
  instanceType?: string;
  includeWorkflowJson?: boolean;
  apiRevision?: string;
  supportsCancellation?: boolean;
  timeoutMs?: number;
  nodeTypeCount: number;
  createdAt: string;
}

export interface OutputCandidate {
  id: string;
  nodeId: string;
  classType: string;
  outputKey: string;
  outputIndex: number;
  mediaKind: string;
  kind?: 'file' | 'inline';
  category?: 'result' | 'metadata';
  selectable?: boolean;
  displayName?: string;
  description?: string;
  valuePreview?: string;
  assetId?: string;
}

export interface WorkflowOutputBindingSet {
  id: string;
  sourceRunId: string;
  outputs: Array<{
    key: string;
    label: string;
    primary: boolean;
    mediaKind: string;
    selector: { nodeId: string; outputKey: string; outputIndex: number };
  }>;
}

export interface WorkflowAttestation {
  id: string;
  definitionId: string;
  definitionRevision: number;
  executionPlanHash: string;
  bindingSetId: string;
  outputBindingSetId: string;
  deploymentId: string;
  runId: string;
  attestationHash: string;
  succeededAt: string;
  createdAt: string;
}

export interface WorkflowEditorSnapshot {
  definition: WorkflowDefinition;
  deployment: WorkflowDeploymentDto | null;
  candidates: BindingCandidate[];
  bindingSet: BindingSet | null;
  attestation: WorkflowAttestation | null;
  verifiedRun: WorkflowRun | null;
  verifiedOutputCandidates: OutputCandidate[];
  outputBindingSet: WorkflowOutputBindingSet | null;
}

export type WorkflowCanvasMediaKind = 'image' | 'mask' | 'video' | 'audio' | 'text' | 'json';
export type RunningHubInstanceType = 'default' | 'plus';

export interface WorkflowCanvasBlueprint {
  coverUrl?: string | null;
  schemaVersion: 1;
  kind: 'workflow';
  type: 'Workflow';
  title: string;
  subtitle: string;
  executionTarget?: 'local' | 'cloud';
  runningHubInstanceType?: RunningHubInstanceType;
  canvasNodeHash: string;
  workflowRef: {
    verificationStatus?: 'draft' | 'verified';
    definitionId: string;
    definitionRevision: number;
    executionPlanHash: string;
    bindingSetId: string;
    bindingSetHash: string;
    outputBindingSetId?: string;
    outputBindingSetHash?: string;
    deploymentId: string;
    deploymentSnapshotHash: string;
    relevantCapabilityHash: string;
    attestationId?: string;
    attestationHash?: string;
  };
  inputPorts: Array<{
    id: string;
    bindingId: string;
    label: string;
    mediaKind: WorkflowCanvasMediaKind;
    required: boolean;
    multiple: boolean;
    maximumItems: number;
    portIndex: number;
  }>;
  outputPorts: Array<{
    id: string;
    label: string;
    mediaKind: WorkflowCanvasMediaKind;
    primary: boolean;
    portIndex: number;
    selector: { nodeId: string; outputKey: string; outputIndex: number };
  }>;
  parameterSchema: Array<{
    key: string;
    bindingId: string;
    label: string;
    description?: string;
    control: {
      kind: string;
      required: boolean;
      minimum?: number;
      maximum?: number;
      step?: number;
      options: Array<{ id: string; label: string }>;
      hasDefault: boolean;
      defaultValue?: unknown;
    };
    presentation?: { section?: string; order?: number; advanced?: boolean };
  }>;
  parameterValues: Record<string, unknown>;
  executionState: { status: 'idle' };
  ui: { width: number; height: number; collapsed: boolean };
}

export interface WorkflowManagerClient {
  listDefinitions(): Promise<WorkflowDefinition[]>;
  getDefinition(definitionId: string): Promise<WorkflowDefinition>;
  getEditorSnapshot(definitionId: string): Promise<WorkflowEditorSnapshot>;
  deleteDefinition(definitionId: string): Promise<{
    id: string;
    deletedAt: string;
    alreadyDeleted: boolean;
  }>;
  updateDefinitionPresentation(
    definitionId: string,
    input: { name?: string; customCoverUrl?: string | null },
  ): Promise<WorkflowDefinition>;
  importArtifact(input: { file: File; definitionId?: string }): Promise<WorkflowDefinition>;
  chooseDirectory(purpose?: 'comfy-input-cleanup'): Promise<{
    id: string;
    label: string;
    purpose: string;
  }>;
  pairArtifacts(
    definitionId: string,
    uiArtifactId: string,
    apiArtifactId: string,
  ): Promise<{
    definition: WorkflowDefinition;
  }>;
  createDeployment(
    definitionId: string,
    input: {
      runner?: 'local-comfyui' | 'runninghub-workflow' | 'runninghub-webapp';
      serverUrl?: string;
      baseUrl?: string;
      credentialRef?: 'runninghub-cn' | 'runninghub-global';
      remoteWorkflowId?: string;
      remoteWebAppId?: string;
      includeWorkflowJson?: boolean;
      instanceType?: string;
      timeoutMs: number;
      inputCleanupGrantId?: string;
    },
  ): Promise<{
    deployment: WorkflowDeploymentDto;
    candidates: BindingCandidate[];
    outputs: unknown[];
  }>;
  listDeployments(definitionId: string): Promise<WorkflowDeploymentDto[]>;
  listBindingCandidates(definitionId: string, deploymentId: string): Promise<BindingCandidate[]>;
  createBindingSet(
    definitionId: string,
    input: {
      deploymentId: string;
      previousBindingSetId?: string;
      name: string;
      bindings: Array<{ candidateId: string; key: string; label: string }>;
    },
  ): Promise<BindingSet>;
  listBindingSets(definitionId: string): Promise<BindingSet[]>;
  preflight(
    definitionId: string,
    input: Record<string, unknown>,
  ): Promise<{
    ok: boolean;
    checks: Array<{ code: string; status: string; message: string }>;
    compiledPromptHash: string;
  }>;
  startRun(definitionId: string, input: Record<string, unknown>): Promise<WorkflowRun>;
  getRun(runId: string): Promise<WorkflowRun>;
  cancelRun(runId: string): Promise<WorkflowRun>;
  continueObservation(runId: string): Promise<WorkflowRun>;
  retryInputCleanup(
    runId: string,
    input?: { confirmRemoteStopped?: boolean },
  ): Promise<{
    runId: string;
    state: string;
    totalBytes: number;
    updatedAt?: string;
  }>;
  listOutputCandidates(definitionId: string, runId: string): Promise<OutputCandidate[]>;
  listOutputBindingSets(definitionId: string): Promise<WorkflowOutputBindingSet[]>;
  createOutputBindingSet(
    definitionId: string,
    input: Record<string, unknown>,
  ): Promise<{
    id: string;
    outputBindingSetHash: string;
  }>;
  createAttestation(
    definitionId: string,
    input: Record<string, unknown>,
  ): Promise<WorkflowAttestation>;
  listAttestations(definitionId: string): Promise<WorkflowAttestation[]>;
  createCanvasNode(
    definitionId: string,
    input: {
      attestationId?: string;
      deploymentId?: string;
      bindingSetId?: string;
      title?: string;
    },
  ): Promise<WorkflowCanvasBlueprint>;
  startCanvasRun(
    definitionId: string,
    input: {
      attestationId?: string;
      deploymentId?: string;
      bindingSetId?: string;
      canvasNodeHash: string;
      projectId: string;
      values: Record<string, unknown>;
      confirmExecution: true;
      confirmPaidExecution?: true;
      instanceType?: RunningHubInstanceType;
    },
  ): Promise<WorkflowRun>;
  listProjects(): Promise<Array<{ id: string; title: string; updatedAt: string }>>;
  listAssets(
    projectId: string,
    mediaKind: string,
  ): Promise<
    Array<{
      id: string;
      filename?: string;
      url?: string;
      type: string;
    }>
  >;
  uploadAsset(
    projectId: string,
    mediaKind: string,
    file: File,
  ): Promise<{
    id: string;
    filename?: string;
    url?: string;
    type: string;
  }>;
  trashAsset(
    projectId: string,
    mediaKind: string,
    assetId: string,
  ): Promise<{
    success: true;
    deletedCount: number;
    batchId: string;
    recoverable: true;
  }>;
  getRunningHubCredentialStatus(): Promise<{
    cnConfigured: boolean;
    globalConfigured: boolean;
  }>;
  saveRunningHubCredentials(input: { cnApiKey?: string; globalApiKey?: string }): Promise<void>;
  validateRunningHubCredential(
    credentialRef: 'runninghub-cn' | 'runninghub-global',
  ): Promise<{
    valid: true;
    credentialRef: 'runninghub-cn' | 'runninghub-global';
    site: 'cn' | 'global';
    currency: string;
    apiType: string;
  }>;
  listOfficialWorkflows(): Promise<OfficialWorkflow[]>;
  addOfficialWorkflow(id: string): Promise<RunningHubWebAppCard>;
  listRunningHubWebApps(): Promise<RunningHubWebAppLibrary>;
  createRunningHubWebApp(input: {
    webAppId: string;
    credentialRef: 'runninghub-cn' | 'runninghub-global';
    categoryId?: string;
    title?: string;
    description?: string;
    instanceType?: string;
  }): Promise<RunningHubWebAppCard>;
  deleteRunningHubWebApp(definitionId: string): Promise<unknown>;
  createRunningHubWebAppCategory(name: string): Promise<RunningHubWebAppCategory>;
  deleteRunningHubWebAppCategory(categoryId: string): Promise<unknown>;
}

export type WorkflowCanvasClient = Pick<
  WorkflowManagerClient,
  | 'createCanvasNode'
  | 'startCanvasRun'
  | 'getRun'
  | 'cancelRun'
  | 'continueObservation'
  | 'listBindingSets'
>;

export type RunningHubWebAppClient = Pick<
  WorkflowManagerClient,
  | 'getRunningHubCredentialStatus'
  | 'saveRunningHubCredentials'
  | 'validateRunningHubCredential'
  | 'listRunningHubWebApps'
  | 'createRunningHubWebApp'
  | 'deleteRunningHubWebApp'
  | 'createRunningHubWebAppCategory'
  | 'deleteRunningHubWebAppCategory'
>;

export interface RunningHubWebAppCategory {
  id: string;
  name: string;
  order: number;
}

export interface RunningHubWebAppCard {
  coverUrl?: string;
  id: string;
  definitionId: string;
  title: string;
  description: string;
  categoryId: string;
  categoryName: string;
  webAppId: string;
  credentialRef: 'runninghub-cn' | 'runninghub-global';
  site: 'cn' | 'global';
  fieldCount: number;
  verified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RunningHubWebAppLibrary {
  categories: RunningHubWebAppCategory[];
  apps: RunningHubWebAppCard[];
}

interface ApiErrorBody {
  error?: string;
  code?: string;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const response = await fetcher(path, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw Object.assign(new Error(body.error || `请求失败（HTTP ${response.status}）`), {
      code: body.code || 'WORKFLOW_MANAGER_REQUEST_FAILED',
      status: response.status,
    });
  }
  return response.json() as Promise<T>;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('无法读取工作流文件'));
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}

function mediaAssetType(mediaKind: string) {
  return mediaKind === 'audio' ? 'audios' : mediaKind === 'video' ? 'videos' : 'images';
}

function mediaContentType(file: File, mediaKind: string) {
  if (file.type) return file.type;
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  const byExtension: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    bmp: 'image/bmp',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    m4v: 'video/x-m4v',
    mkv: 'video/x-matroska',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    ogg: 'audio/ogg',
    aac: 'audio/aac',
    flac: 'audio/flac',
  };
  if (extension === 'webm') return mediaKind === 'audio' ? 'audio/webm' : 'video/webm';
  return byExtension[extension]
    || (mediaKind === 'audio' ? 'audio/mpeg' : mediaKind === 'video' ? 'video/mp4' : 'image/png');
}

export function createWorkflowManagerClient(fetcher: typeof fetch = fetch): WorkflowManagerClient {
  const api = <T>(path: string, init: RequestInit = {}) => request<T>(path, init, fetcher);
  const libraryPath = (definitionId: string, suffix = '') =>
    `/api/workflow-library/${encodeURIComponent(definitionId)}${suffix}`;
  const pendingRunKeys = new Map<string, string>();
  async function startIdempotentRun(
    path: string,
    logicalNamespace: string,
    definitionId: string,
    input: Record<string, unknown>,
  ): Promise<WorkflowRun> {
    const logicalRequest = `${logicalNamespace}\n${definitionId}\n${JSON.stringify(input)}`;
    const idempotencyKey = pendingRunKeys.get(logicalRequest) || crypto.randomUUID();
    pendingRunKeys.set(logicalRequest, idempotencyKey);
    try {
      const run = await api<WorkflowRun>(path, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(input),
      });
      pendingRunKeys.delete(logicalRequest);
      return run;
    } catch (error) {
      const status = (error as { status?: unknown })?.status;
      // A received 4xx is a definitive server-side rejection. A transport
      // error, invalid 202 body, or 5xx may have happened after admission, so
      // keep the same key for the user's retry and let the server reconcile.
      if (typeof status === 'number' && status >= 400 && status < 500) {
        pendingRunKeys.delete(logicalRequest);
      }
      throw error;
    }
  }
  return {
    listDefinitions: () => api('/api/workflow-library'),
    getDefinition: (definitionId) => api(libraryPath(definitionId)),
    getEditorSnapshot: (definitionId) => api(libraryPath(definitionId, '/editor-snapshot')),
    deleteDefinition: (definitionId) => api(libraryPath(definitionId), {
      method: 'DELETE',
    }),
    updateDefinitionPresentation: (definitionId, input) =>
      api(libraryPath(definitionId, '/presentation'), {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    async importArtifact({ file, definitionId }) {
      const result = await api<WorkflowDefinition | { definition: WorkflowDefinition }>(
        '/api/workflow-library/import',
        {
          method: 'POST',
          body: JSON.stringify({
            contentBase64: await fileToBase64(file),
            originalFilename: file.name,
            ...(definitionId ? { definitionId } : {}),
          }),
        },
      );
      return 'definition' in result ? result.definition : result;
    },
    chooseDirectory: (purpose = 'comfy-input-cleanup') =>
      api('/api/workflow-library/directory-grants', {
        method: 'POST',
        body: JSON.stringify({ purpose }),
      }),
    pairArtifacts: (definitionId, uiArtifactId, apiArtifactId) =>
      api(libraryPath(definitionId, '/pair'), {
        method: 'POST',
        body: JSON.stringify({ uiArtifactId, apiArtifactId }),
      }),
    createDeployment: (definitionId, input) =>
      api(libraryPath(definitionId, '/deployments'), {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    listDeployments: (definitionId) => api(libraryPath(definitionId, '/deployments')),
    listBindingCandidates: (definitionId, deploymentId) =>
      api(
        `${libraryPath(definitionId, '/binding-candidates')}?deploymentId=${encodeURIComponent(deploymentId)}`,
      ),
    createBindingSet: (definitionId, input) =>
      api(libraryPath(definitionId, '/binding-sets'), {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    listBindingSets: (definitionId) => api(libraryPath(definitionId, '/binding-sets')),
    preflight: (definitionId, input) =>
      api(libraryPath(definitionId, '/preflight'), {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    startRun: (definitionId, input) =>
      startIdempotentRun(
        libraryPath(definitionId, '/test-runs'),
        'workflow-test',
        definitionId,
        input,
      ),
    getRun: (runId) => api(`/api/workflow-runs/${encodeURIComponent(runId)}`),
    cancelRun: (runId) =>
      api(`/api/workflow-runs/${encodeURIComponent(runId)}/cancel`, {
        method: 'POST',
        body: '{}',
      }),
    continueObservation: (runId) =>
      api(`/api/workflow-runs/${encodeURIComponent(runId)}/continue-observation`, {
        method: 'POST',
        body: '{}',
      }),
    retryInputCleanup: (runId, input = {}) =>
      api(`/api/workflow-runs/${encodeURIComponent(runId)}/retry-input-cleanup`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    listOutputCandidates: (definitionId, runId) =>
      api(
        libraryPath(definitionId, `/workflow-runs/${encodeURIComponent(runId)}/output-candidates`),
      ),
    listOutputBindingSets: (definitionId) =>
      api(libraryPath(definitionId, '/output-binding-sets')),
    createOutputBindingSet: (definitionId, input) =>
      api(libraryPath(definitionId, '/output-binding-sets'), {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    createAttestation: (definitionId, input) =>
      api(libraryPath(definitionId, '/attestations'), {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    listAttestations: (definitionId) => api(libraryPath(definitionId, '/attestations')),
    createCanvasNode: (definitionId, input) =>
      api(libraryPath(definitionId, '/canvas-nodes'), {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    startCanvasRun: (definitionId, input) =>
      startIdempotentRun(
        libraryPath(definitionId, '/canvas-runs'),
        'workflow-node',
        definitionId,
        input,
      ),
    listProjects: () => api('/api/workflows'),
    listAssets: async (projectId, mediaKind) => {
      const type = mediaAssetType(mediaKind);
      const result = await api<
        Array<{ id: string; type: string }> | { assets: Array<{ id: string; type: string }> }
      >(`/api/assets/${type}?projectId=${encodeURIComponent(projectId)}`);
      return Array.isArray(result) ? result : result.assets;
    },
    async uploadAsset(projectId, mediaKind, file) {
      const type = mediaAssetType(mediaKind);
      const path = localFilePath(file);
      const result = await api<{
        asset: { id: string; filename?: string; url?: string; type: string };
      }>(
        path ? `/api/assets/import/${type}` : `/api/assets/upload/${type}`,
        path
          ? { method: 'POST', body: JSON.stringify({ path, projectId, filename: file.name }) }
          : {
              method: 'POST',
              headers: {
                'Content-Type': mediaContentType(file, mediaKind),
                'X-Filename': encodeURIComponent(file.name),
                'X-Project-Id': projectId,
              },
              ...fileUploadBody(file),
            },
      );
      return result.asset;
    },
    trashAsset: (projectId, mediaKind, assetId) => {
      const type = mediaAssetType(mediaKind);
      return api(
        `/api/assets/${type}/${encodeURIComponent(assetId)}/trash?projectId=${encodeURIComponent(projectId)}`,
        {
          method: 'POST',
          body: JSON.stringify({}),
        },
      );
    },
    async getRunningHubCredentialStatus() {
      const keys = await api<Record<string, string>>('/api/config/keys');
      return {
        cnConfigured: keys.RUNNINGHUB_API_KEY === '********',
        globalConfigured: keys.RUNNINGHUB_GLOBAL_API_KEY === '********',
      };
    },
    async saveRunningHubCredentials(input) {
      const keys: Record<string, string> = {};
      if (input.cnApiKey?.trim()) keys.RUNNINGHUB_API_KEY = input.cnApiKey.trim();
      if (input.globalApiKey?.trim()) {
        keys.RUNNINGHUB_GLOBAL_API_KEY = input.globalApiKey.trim();
      }
      if (!Object.keys(keys).length) return;
      await api('/api/config/keys', { method: 'POST', body: JSON.stringify(keys) });
    },
    validateRunningHubCredential: (credentialRef) => api('/api/runninghub-credentials/validate', {
      method: 'POST',
      body: JSON.stringify({ credentialRef }),
    }),
    listRunningHubWebApps: () => api('/api/runninghub-webapps'),
    listOfficialWorkflows: async () => (await api<{ workflows: OfficialWorkflow[] }>('/api/official-workflows')).workflows,
    addOfficialWorkflow: (id) => api(`/api/official-workflows/${encodeURIComponent(id)}/add`, { method: 'POST', body: '{}' }),
    createRunningHubWebApp: (input) => api('/api/runninghub-webapps', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
    deleteRunningHubWebApp: (definitionId) =>
      api(`/api/runninghub-webapps/${encodeURIComponent(definitionId)}`, {
        method: 'DELETE',
      }),
    createRunningHubWebAppCategory: (name) => api('/api/runninghub-webapp-categories', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
    deleteRunningHubWebAppCategory: (categoryId) =>
      api(`/api/runninghub-webapp-categories/${encodeURIComponent(categoryId)}`, {
        method: 'DELETE',
      }),
  };
}
