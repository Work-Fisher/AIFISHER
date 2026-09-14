import express from 'express';
import { normalizeLocalComfyServer } from '../comfyui/comfyServerAddress.js';
import {
  DirectoryGrantError,
  DirectoryGrantStore,
  selectDirectoryWithSystemDialog,
} from './directoryGrantStore.js';
import {
  WorkflowDefinitionStore,
  WorkflowDefinitionStoreError,
} from './workflowDefinitionStore.js';
import {
  WorkflowFormatError,
  WORKFLOW_LIMITS,
} from './workflowFormat.js';

const OBJECT_INFO_LIMIT = 64 * 1024 * 1024;
export const WORKFLOW_IMPORT_REQUEST_LIMIT = Math.ceil(WORKFLOW_LIMITS.maxBytes * 4 / 3)
  + 2 * 1024 * 1024;
const workflowActionJson = express.json({ limit: 4 * 1024 * 1024 });
const workflowImportJson = express.json({ limit: WORKFLOW_IMPORT_REQUEST_LIMIT });
const SAFE_ROUTER_CODES = new Set([
  'NON_LOCAL_COMFY_SERVER',
  'COMFYUI_UNAVAILABLE',
  'OBJECT_INFO_SIZE_LIMIT',
  'INVALID_WORKFLOW_BASE64',
  'WORKFLOW_SIZE_LIMIT',
]);

function objectInfoSizeError() {
  const error = new Error('ComfyUI 节点定义超过大小限制');
  error.code = 'OBJECT_INFO_SIZE_LIMIT';
  return error;
}

export async function readResponseTextWithLimit(response, maximumBytes = OBJECT_INFO_LIMIT) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw objectInfoSizeError();
  }
  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maximumBytes) throw objectInfoSizeError();
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw objectInfoSizeError();
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total));
}

function decodeBase64Artifact(value) {
  if (typeof value !== 'string' || value.length === 0) {
    const error = new Error('工作流源文件 Base64 无效');
    error.code = 'INVALID_WORKFLOW_BASE64';
    throw error;
  }
  const normalized = value.trim();
  const validShape = normalized.length % 4 === 0
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized);
  if (!validShape) {
    const error = new Error('工作流源文件 Base64 无效');
    error.code = 'INVALID_WORKFLOW_BASE64';
    throw error;
  }
  const bytes = Buffer.from(normalized, 'base64');
  if (bytes.length === 0 || bytes.length > WORKFLOW_LIMITS.maxBytes) {
    const error = new Error('工作流文件大小无效或超过限制');
    error.code = 'WORKFLOW_SIZE_LIMIT';
    throw error;
  }
  return bytes;
}

export async function fetchObjectInfo(serverUrl) {
  try {
    const normalized = normalizeLocalComfyServer(serverUrl);
    const response = await fetch(`http://${normalized}/object_info`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`ComfyUI object_info HTTP ${response.status}`);
    const content = await readResponseTextWithLimit(response);
    return JSON.parse(content);
  } catch (cause) {
    if (cause?.code === 'NON_LOCAL_COMFY_SERVER') throw cause;
    const error = new Error('无法读取本机 ComfyUI 节点定义', { cause });
    error.code = cause?.code || 'COMFYUI_UNAVAILABLE';
    error.status = 503;
    throw error;
  }
}

function sendError(response, error, logger) {
  const isDomainError = error instanceof WorkflowFormatError
    || error instanceof WorkflowDefinitionStoreError
    || error instanceof DirectoryGrantError;
  const isSafeError = isDomainError || SAFE_ROUTER_CODES.has(error?.code);
  const status = isSafeError
    ? Number(error?.status) || (error?.code === 'NON_LOCAL_COMFY_SERVER' ? 403 : 400)
    : 500;
  if (status >= 500) logger.error('Workflow library internal error', {
    code: isSafeError ? error?.code : 'WORKFLOW_LIBRARY_INTERNAL_ERROR',
    errorType: error?.name || 'Error',
  });
  response.status(status).json({
    error: isSafeError ? error?.message : '执行工作流内部错误',
    code: isSafeError ? error?.code : 'WORKFLOW_LIBRARY_INTERNAL_ERROR',
    ...(isDomainError && error?.details !== undefined ? { details: error.details } : {}),
  });
}

export function createWorkflowLibraryRouter({
  libraryDirectory,
  storageDirectory,
  definitionStore = new WorkflowDefinitionStore({ libraryDirectory, storageDirectory }),
  directoryGrantStore = new DirectoryGrantStore({ libraryDirectory, storageDirectory }),
  selectDirectory = selectDirectoryWithSystemDialog,
  loadObjectInfo = fetchObjectInfo,
  logger = console,
}) {
  const router = express.Router();

  router.get('/workflow-library', async (_request, response) => {
    try {
      response.json(await definitionStore.listDefinitions());
    } catch (error) {
      sendError(response, error, logger);
    }
  });

  router.post('/workflow-library/directory-grants', workflowActionJson, async (request, response) => {
    try {
      const purpose = request.body?.purpose || 'workflow-discovery';
      const selectedDirectory = await selectDirectory({ purpose });
      const grant = await directoryGrantStore.createGrant(selectedDirectory, { purpose });
      response.status(201).json({
        id: grant.id,
        label: grant.label,
        purpose: grant.purpose,
        access: grant.access,
        createdAt: grant.createdAt,
      });
    } catch (error) {
      sendError(response, error, logger);
    }
  });

  router.post('/workflow-library/discover', workflowActionJson, async (request, response) => {
    try {
      response.json(await directoryGrantStore.discover(request.body?.grantId));
    } catch (error) {
      sendError(response, error, logger);
    }
  });

  router.post('/workflow-library/import', workflowImportJson, async (request, response) => {
    try {
      let content = request.body?.contentBase64 != null
        ? decodeBase64Artifact(request.body.contentBase64)
        : request.body?.content;
      let originalFilename = request.body?.originalFilename || 'workflow.json';
      let origin = 'upload';
      let originalPathRef = null;
      if (request.body?.grantId || request.body?.relativePath) {
        const granted = await directoryGrantStore.readGrantedFile(
          request.body?.grantId,
          request.body?.relativePath,
        );
        content = granted.bytes;
        originalFilename = request.body?.relativePath?.split(/[\\/]/).at(-1) || originalFilename;
        origin = 'discovered';
        originalPathRef = granted.originalPathRef;
      }

      if (request.body?.definitionId) {
        const result = await definitionStore.addArtifact(request.body.definitionId, {
          content,
          originalFilename,
          origin,
          originalPathRef,
        });
        response.status(result.duplicate ? 200 : 201).json(result);
        return;
      }
      const definition = await definitionStore.createDefinition({
        content,
        originalFilename,
        origin,
        originalPathRef,
        name: request.body?.name,
      });
      response.status(201).json(definition);
    } catch (error) {
      sendError(response, error, logger);
    }
  });

  router.get('/workflow-library/built-ins', (_request, response) => {
    response.status(404).json({
      error: '该内置工作流目录已移除，请导入自己的 JSON 工作流。',
      code: 'BUILT_IN_WORKFLOWS_REMOVED',
    });
  });

  router.get('/workflow-library/:id', async (request, response) => {
    try {
      const definition = await definitionStore.requireDefinition(request.params.id);
      response.json(definition);
    } catch (error) {
      sendError(response, error, logger);
    }
  });

  router.delete('/workflow-library/:id', async (request, response) => {
    try {
      response.json(await definitionStore.deleteDefinition(request.params.id));
    } catch (error) {
      sendError(response, error, logger);
    }
  });

  router.patch('/workflow-library/:id/presentation', workflowActionJson, async (request, response) => {
    try {
      response.json(await definitionStore.updatePresentation(request.params.id, {
        ...(Object.hasOwn(request.body || {}, 'name') ? { name: request.body.name } : {}),
        ...(Object.hasOwn(request.body || {}, 'customCoverUrl')
          ? { customCoverUrl: request.body.customCoverUrl }
          : {}),
      }));
    } catch (error) {
      sendError(response, error, logger);
    }
  });

  router.post('/workflow-library/:id/pair', workflowActionJson, async (request, response) => {
    try {
      const result = await definitionStore.pairArtifacts(request.params.id, {
        uiArtifactId: request.body?.uiArtifactId,
        apiArtifactId: request.body?.apiArtifactId,
      });
      response.json(result);
    } catch (error) {
      sendError(response, error, logger);
    }
  });

  router.post('/workflow-library/:id/analyze', workflowActionJson, async (request, response) => {
    try {
      const objectInfo = request.body?.serverUrl
        ? await loadObjectInfo(request.body.serverUrl)
        : undefined;
      const analysis = await definitionStore.analyzeDefinition(request.params.id, {
        artifactId: request.body?.artifactId,
        objectInfo,
      });
      response.json(analysis);
    } catch (error) {
      sendError(response, error, logger);
    }
  });

  router.use((error, _request, response, next) => {
    if (error?.type === 'entity.too.large') {
      response.status(413).json({
        error: '工作流请求体超过大小限制',
        code: 'WORKFLOW_REQUEST_SIZE_LIMIT',
      });
      return;
    }
    if (error instanceof SyntaxError && error?.type === 'entity.parse.failed') {
      response.status(400).json({
        error: '请求 JSON 格式无效',
        code: 'INVALID_REQUEST_JSON',
      });
      return;
    }
    next(error);
  });

  return router;
}
