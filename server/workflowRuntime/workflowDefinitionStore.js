import crypto from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  analyzeWorkflow,
  compareUiAndApiWorkflows,
  normalizeApiWorkflow,
  parseWorkflowArtifact,
  sha256Json,
} from './workflowFormat.js';
import {
  assertWorkflowStorageIsPrivate,
  resolveWorkflowStorageDirectory,
} from './workflowStoragePaths.js';

const SAFE_ID = /^[a-f\d-]{36}$/i;
const WORKFLOW_COVER_PREFIX = '/library/media/workflow-covers/images/';
const SAFE_COVER_FILENAME = /^(?:[a-f\d-]{36}|[a-f\d]{64})\.(?:avif|gif|jpe?g|png|webp)$/i;

export class WorkflowDefinitionStoreError extends Error {
  constructor(message, code = 'WORKFLOW_DEFINITION_ERROR', status = 400) {
    super(message);
    this.name = 'WorkflowDefinitionStoreError';
    this.code = code;
    this.status = status;
  }
}

function assertId(value, label) {
  const normalized = String(value || '');
  if (!SAFE_ID.test(normalized)) {
    throw new WorkflowDefinitionStoreError(`${label}无效`, 'INVALID_DEFINITION_REFERENCE');
  }
  return normalized;
}

function safeFilename(value) {
  const name = path.basename(String(value || 'workflow.json')).replace(/[\0\r\n]/g, '').slice(0, 255);
  return name.toLowerCase().endsWith('.json') ? name : `${name || 'workflow'}.json`;
}

function displayName(filename) {
  return path.basename(filename, path.extname(filename)).trim().slice(0, 120) || '未命名工作流';
}

function normalizePresentationName(value) {
  const name = String(value ?? '').replace(/[\0\r\n]/g, ' ').trim();
  if (!name || name.length > 120) {
    throw new WorkflowDefinitionStoreError(
      '工作流名称必须为 1 到 120 个字符',
      'INVALID_WORKFLOW_NAME',
    );
  }
  return name;
}

function normalizeCustomCoverUrl(value) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !value.startsWith(WORKFLOW_COVER_PREFIX)) {
    throw new WorkflowDefinitionStoreError(
      '工作流封面必须来自 AIFISHER 工作流封面目录',
      'INVALID_WORKFLOW_COVER',
    );
  }
  const filename = value.slice(WORKFLOW_COVER_PREFIX.length);
  if (!SAFE_COVER_FILENAME.test(filename)) {
    throw new WorkflowDefinitionStoreError(
      '工作流封面地址无效',
      'INVALID_WORKFLOW_COVER',
    );
  }
  return `${WORKFLOW_COVER_PREFIX}${filename}`;
}

async function writeAtomic(filePath, content) {
  const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporaryPath, content, 'utf8');
  await rename(temporaryPath, filePath);
}

function artifactMetadata(parsed, {
  artifactId,
  originalFilename,
  origin,
  originalPathRef,
  importedAt,
}) {
  return {
    id: artifactId,
    role: parsed.format === 'comfy-api' ? 'api' : 'ui',
    format: parsed.format,
    origin,
    originalFilename: safeFilename(originalFilename),
    originalPathRef: originalPathRef || null,
    importedAt,
    byteLength: parsed.byteLength,
    sourceSha256: parsed.sourceSha256,
  };
}

export class WorkflowDefinitionStore {
  constructor({ libraryDirectory, storageDirectory }) {
    this.libraryDirectory = path.resolve(libraryDirectory);
    this.rootDirectory = resolveWorkflowStorageDirectory({ libraryDirectory, storageDirectory });
    this.definitionsDirectory = path.join(this.rootDirectory, 'definitions');
    this.definitionLocks = new Map();
  }

  async init() {
    await mkdir(this.rootDirectory, { recursive: true });
    await assertWorkflowStorageIsPrivate({
      libraryDirectory: this.libraryDirectory,
      storageDirectory: this.rootDirectory,
    });
    await mkdir(this.definitionsDirectory, { recursive: true });
  }

  definitionDirectory(definitionId) {
    return path.join(this.definitionsDirectory, assertId(definitionId, '工作流定义标识'));
  }

  artifactPath(definitionId, artifactId) {
    return path.join(
      this.definitionDirectory(definitionId),
      'artifacts',
      `${assertId(artifactId, '源文件标识')}.json`,
    );
  }

  manifestPath(definitionId) {
    return path.join(this.definitionDirectory(definitionId), 'manifest.json');
  }

  planPath(definitionId, planHash) {
    if (!/^[a-f\d]{64}$/i.test(String(planHash || ''))) {
      throw new WorkflowDefinitionStoreError('执行计划哈希无效', 'INVALID_EXECUTION_PLAN');
    }
    return path.join(this.definitionDirectory(definitionId), 'plans', `${planHash}.json`);
  }

  async createDefinition({
    content,
    originalFilename = 'workflow.json',
    origin = 'upload',
    originalPathRef = null,
    name,
  }) {
    await this.init();
    const parsed = parseWorkflowArtifact(content);
    const definitionId = crypto.randomUUID();
    const artifactId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const definitionDirectory = this.definitionDirectory(definitionId);
    await mkdir(path.join(definitionDirectory, 'artifacts'), { recursive: true });
    await mkdir(path.join(definitionDirectory, 'plans'), { recursive: true });
    await writeFile(this.artifactPath(definitionId, artifactId), parsed.bytes, { flag: 'wx' });

    const sourceArtifact = artifactMetadata(parsed, {
      artifactId,
      originalFilename,
      origin,
      originalPathRef,
      importedAt: createdAt,
    });
    let executionPlan = null;
    if (parsed.format === 'comfy-api') {
      const apiJson = normalizeApiWorkflow(parsed.workflow);
      const executionPlanHash = sha256Json(apiJson);
      await writeFile(this.planPath(definitionId, executionPlanHash), JSON.stringify(apiJson, null, 2), {
        encoding: 'utf8',
        flag: 'wx',
      });
      executionPlan = {
        apiArtifactId: artifactId,
        compiledFromArtifactIds: [artifactId],
        executionPlanHash,
      };
    }

    const manifest = {
      schemaVersion: 1,
      id: definitionId,
      revision: 1,
      name: String(name || displayName(sourceArtifact.originalFilename)).trim().slice(0, 120),
      description: '',
      sourceArtifacts: [sourceArtifact],
      executionPlan,
      analysis: analyzeWorkflow(parsed.workflow, parsed.format),
      createdAt,
      updatedAt: createdAt,
    };
    await writeAtomic(this.manifestPath(definitionId), JSON.stringify(manifest, null, 2));
    return manifest;
  }

  async getDefinition(definitionId) {
    await this.init();
    try {
      return JSON.parse(await readFile(this.manifestPath(definitionId), 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async requireDefinition(definitionId) {
    const definition = await this.getDefinition(definitionId);
    if (!definition) {
      throw new WorkflowDefinitionStoreError('执行工作流模板不存在', 'DEFINITION_NOT_FOUND', 404);
    }
    return definition;
  }

  async listDefinitions() {
    await this.init();
    const entries = await readdir(this.definitionsDirectory, { withFileTypes: true });
    const manifests = await Promise.all(entries
      .filter((entry) => entry.isDirectory() && SAFE_ID.test(entry.name))
      .map((entry) => this.getDefinition(entry.name)));
    return manifests
      .filter((definition) => definition && !definition.deletedAt)
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  }

  async deleteDefinition(definitionId) {
    return this.withDefinitionLock(definitionId, async () => {
      const definition = await this.requireDefinition(definitionId);
      if (definition.deletedAt) {
        return {
          id: definition.id,
          deletedAt: definition.deletedAt,
          alreadyDeleted: true,
        };
      }
      const deletedAt = new Date().toISOString();
      const next = {
        ...definition,
        deletedAt,
        updatedAt: deletedAt,
      };
      // This is intentionally a soft delete. Existing canvas nodes keep their
      // immutable workflow reference, while the saved card disappears from
      // the library and can no longer be selected for new nodes.
      await writeAtomic(this.manifestPath(definitionId), JSON.stringify(next, null, 2));
      return { id: definition.id, deletedAt, alreadyDeleted: false };
    });
  }

  async updatePresentation(definitionId, input = {}) {
    return this.withDefinitionLock(definitionId, async () => {
      const definition = await this.requireDefinition(definitionId);
      const hasName = Object.hasOwn(input, 'name');
      const hasCustomCoverUrl = Object.hasOwn(input, 'customCoverUrl');
      const hasCategoryId = Object.hasOwn(input, 'categoryId');
      const hasDescription = Object.hasOwn(input, 'description');
      if (!hasName && !hasCustomCoverUrl && !hasCategoryId && !hasDescription) {
        throw new WorkflowDefinitionStoreError(
          '没有需要更新的工作流展示信息',
          'EMPTY_WORKFLOW_PRESENTATION_UPDATE',
        );
      }
      const updatedAt = new Date().toISOString();
      const customCoverUrl = hasCustomCoverUrl
        ? normalizeCustomCoverUrl(input.customCoverUrl)
        : definition.presentation?.customCoverUrl || null;
      const categoryId = hasCategoryId
        ? String(input.categoryId || '').trim().replace(/[^A-Za-z0-9._-]/g, '').slice(0, 120)
        : definition.presentation?.categoryId || '';
      const description = hasDescription
        ? String(input.description || '').replace(/[\0\r\n]+/g, ' ').trim().slice(0, 600)
        : definition.description || '';
      const next = {
        ...definition,
        ...(hasName ? { name: normalizePresentationName(input.name) } : {}),
        description,
        presentation: {
          ...(customCoverUrl ? { customCoverUrl } : {}),
          ...(categoryId ? { categoryId } : {}),
          updatedAt,
        },
        updatedAt,
      };
      await writeAtomic(this.manifestPath(definitionId), JSON.stringify(next, null, 2));
      return next;
    });
  }

  async readArtifact(definitionId, artifactId) {
    const definition = await this.requireDefinition(definitionId);
    const artifact = definition.sourceArtifacts.find((item) => item.id === artifactId);
    if (!artifact) {
      throw new WorkflowDefinitionStoreError('源工作流文件不存在', 'ARTIFACT_NOT_FOUND', 404);
    }
    const bytes = await readFile(this.artifactPath(definitionId, artifactId));
    const parsed = parseWorkflowArtifact(bytes);
    if (
      parsed.byteLength !== artifact.byteLength
      || parsed.sourceSha256 !== artifact.sourceSha256
    ) {
      throw new WorkflowDefinitionStoreError(
        '源工作流文件完整性校验失败',
        'ARTIFACT_INTEGRITY_ERROR',
        409,
      );
    }
    return { artifact, ...parsed };
  }

  async readExecutionPlan(definitionId, { executionPlanHash: requestedPlanHash } = {}) {
    const definition = await this.requireDefinition(definitionId);
    const executionPlanHash = requestedPlanHash
      ? String(requestedPlanHash).toLowerCase()
      : definition.executionPlan?.executionPlanHash;
    if (!executionPlanHash) {
      throw new WorkflowDefinitionStoreError(
        '当前工作流还没有可执行的 API Format 计划',
        'EXECUTION_PLAN_NOT_READY',
        409,
      );
    }
    // planPath validates the requested immutable hash. Recovery deliberately
    // does not require it to remain the definition's current plan: an already
    // submitted task must resume against the exact plan persisted at admission.
    const storedPlan = JSON.parse(
      await readFile(this.planPath(definitionId, executionPlanHash), 'utf8'),
    );
    if (sha256Json(storedPlan) !== executionPlanHash) {
      throw new WorkflowDefinitionStoreError(
        '执行计划完整性校验失败',
        'EXECUTION_PLAN_INTEGRITY_ERROR',
        409,
      );
    }
    const apiJson = normalizeApiWorkflow(storedPlan);
    return { definition, apiJson, executionPlanHash };
  }

  async withDefinitionLock(definitionId, operation) {
    const previous = this.definitionLocks.get(definitionId) || Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.definitionLocks.set(definitionId, current);
    try {
      return await current;
    } finally {
      if (this.definitionLocks.get(definitionId) === current) {
        this.definitionLocks.delete(definitionId);
      }
    }
  }

  async addArtifact(definitionId, input) {
    return this.withDefinitionLock(definitionId, () => this.addArtifactUnlocked(definitionId, input));
  }

  async addArtifactUnlocked(definitionId, {
    content,
    originalFilename = 'workflow.json',
    origin = 'upload',
    originalPathRef = null,
  }) {
    const definition = await this.requireDefinition(definitionId);
    const parsed = parseWorkflowArtifact(content);
    const duplicate = definition.sourceArtifacts.find(
      (artifact) => artifact.sourceSha256 === parsed.sourceSha256,
    );
    if (duplicate) return { definition, artifact: duplicate, duplicate: true };

    const artifactId = crypto.randomUUID();
    const importedAt = new Date().toISOString();
    const artifactsDirectory = path.join(this.definitionDirectory(definitionId), 'artifacts');
    await mkdir(artifactsDirectory, { recursive: true });
    await writeFile(this.artifactPath(definitionId, artifactId), parsed.bytes, { flag: 'wx' });
    const artifact = artifactMetadata(parsed, {
      artifactId,
      originalFilename,
      origin,
      originalPathRef,
      importedAt,
    });
    const next = {
      ...definition,
      revision: definition.revision + 1,
      sourceArtifacts: [...definition.sourceArtifacts, artifact],
      updatedAt: importedAt,
    };
    await writeAtomic(this.manifestPath(definitionId), JSON.stringify(next, null, 2));
    return { definition: next, artifact, duplicate: false };
  }

  async pairArtifacts(definitionId, input) {
    return this.withDefinitionLock(definitionId, () => this.pairArtifactsUnlocked(definitionId, input));
  }

  async pairArtifactsUnlocked(definitionId, {
    uiArtifactId,
    apiArtifactId,
  }) {
    const definition = await this.requireDefinition(definitionId);
    const ui = await this.readArtifact(definitionId, uiArtifactId);
    const api = await this.readArtifact(definitionId, apiArtifactId);
    if (ui.artifact.role !== 'ui' || api.artifact.role !== 'api') {
      throw new WorkflowDefinitionStoreError('配对必须选择一个 UI JSON 和一个 API Format JSON', 'INVALID_PAIR');
    }
    const comparison = compareUiAndApiWorkflows(ui.workflow, api.workflow);
    if (comparison.status === 'conflict') {
      throw new WorkflowDefinitionStoreError('UI 与 API 工作流不属于同一节点图', 'PAIR_CONFLICT', 409);
    }
    const apiJson = normalizeApiWorkflow(api.workflow);
    const executionPlanHash = sha256Json(apiJson);
    const planPath = this.planPath(definitionId, executionPlanHash);
    await mkdir(path.dirname(planPath), { recursive: true });
    try {
      await writeFile(planPath, JSON.stringify(apiJson, null, 2), { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
    const updatedAt = new Date().toISOString();
    const next = {
      ...definition,
      revision: definition.revision + 1,
      executionPlan: {
        apiArtifactId,
        compiledFromArtifactIds: [uiArtifactId, apiArtifactId],
        executionPlanHash,
        pairing: comparison,
      },
      analysis: analyzeWorkflow(api.workflow, 'comfy-api'),
      updatedAt,
    };
    await writeAtomic(this.manifestPath(definitionId), JSON.stringify(next, null, 2));
    return { paired: true, comparison, definition: next };
  }

  async analyzeDefinition(definitionId, { artifactId, objectInfo } = {}) {
    const definition = await this.requireDefinition(definitionId);
    const targetArtifactId = artifactId
      || definition.executionPlan?.apiArtifactId
      || definition.sourceArtifacts[0]?.id;
    const parsed = await this.readArtifact(definitionId, targetArtifactId);
    return analyzeWorkflow(parsed.workflow, parsed.format, { objectInfo });
  }
}
