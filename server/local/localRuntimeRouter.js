import { discoverComfyInstallations } from './comfyDiscovery.js';
import crypto from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { normalizeLocalComfyServer } from '../comfyui/comfyServerAddress.js';
import { loadWorkflowRequirements } from '../comfyui/workflowRequirements.js';
import { selectDirectoryWithSystemDialog } from '../workflowRuntime/directoryGrantStore.js';
import { ComfyExtensionInstallError } from './comfyExtensionInstaller.js';
import { detectComfyInstallation } from './comfyProcess.js';
import { DreaminaCliInstallError } from './dreaminaCliInstaller.js';

const MODEL_EXTENSIONS = new Set(['.safetensors', '.pt', '.ckpt', '.bin', '.pth']);
const MODEL_DIRECTORIES = Object.freeze({
  checkpoints: 'image',
  loras: 'lora',
  controlnet: 'controlnet',
  video: 'video',
});
const MINIMUM_VRAM_BYTES = 8 * 1024 ** 3;
const LOCAL_MODEL_REGISTRY = Object.freeze({
  version: 1,
  directories: MODEL_DIRECTORIES,
  extensions: [...MODEL_EXTENSIONS],
  architectures: {
    sd15: { label: 'Stable Diffusion 1.5', minimumVramGb: 6 },
    sdxl: { label: 'Stable Diffusion XL', minimumVramGb: 8 },
    flux: { label: 'FLUX', minimumVramGb: 12 },
    animatediff: { label: 'AnimateDiff', minimumVramGb: 8 },
    unknown: { label: '未识别架构', minimumVramGb: 8 },
  },
});

function architecture(filename) {
  const value = filename.toLowerCase();
  if (value.includes('sdxl') || value.includes('sd_xl')) return 'sdxl';
  if (value.includes('sd15') || value.includes('sd_1.5') || value.includes('sd-1-5')) return 'sd15';
  if (value.includes('flux')) return 'flux';
  if (value.includes('animatediff')) return 'animatediff';
  return 'unknown';
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${Number((bytes / 1024 ** index).toFixed(2))} ${units[index]}`;
}

async function scanModels(modelsDirectory) {
  const items = [];
  for (const [directory, type] of Object.entries(MODEL_DIRECTORIES)) {
    const root = path.join(modelsDirectory, directory);
    const visit = async (current) => {
      let entries;
      try {
        entries = await readdir(current, { withFileTypes: true });
      } catch (error) {
        if (error?.code === 'ENOENT') return;
        throw error;
      }
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          await visit(fullPath);
          continue;
        }
        if (!entry.isFile() || !MODEL_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          continue;
        }
        const fileStats = await stat(fullPath);
        const relativePath = path.relative(modelsDirectory, fullPath).split(path.sep).join('/');
        items.push({
          id: crypto.createHash('sha256').update(relativePath).digest('hex').slice(0, 16),
          name: path.basename(entry.name, path.extname(entry.name)),
          type,
          architecture: architecture(entry.name),
          sizeBytes: fileStats.size,
          sizeLabel: formatBytes(fileStats.size),
          relativePath,
          lastModified: fileStats.mtime.toISOString(),
        });
      }
    };
    await visit(root);
  }
  return items.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function summarizeModels(items) {
  const byType = { image: 0, lora: 0, controlnet: 0, video: 0 };
  for (const item of items) byType[item.type] += 1;
  const result = {
    status: items.length ? 'ready' : 'empty',
    source: 'fisherai',
    directory: 'models',
    total: items.length,
    byType,
    items,
  };
  if (!items.length) {
    Object.assign(result, {
      diagnosticCode: 'LOCAL_MODELS_MISSING',
      message: '没有发现本地模型文件。',
      actions: [
        '把模型文件放入 models/checkpoints 等对应目录。',
        '如果使用 ComfyUI，请确认模型已安装在 ComfyUI 自己的模型目录。',
      ],
    });
  }
  return result;
}

function summarizeGpu(gpu) {
  if (!gpu?.available) {
    return {
      status: 'unavailable',
      available: false,
      sufficient: false,
      minimumVramBytes: MINIMUM_VRAM_BYTES,
      diagnosticCode: gpu?.diagnosticCode || 'GPU_NOT_DETECTED',
      message: gpu?.message || '未检测到可用的 NVIDIA GPU。',
      actions: gpu?.actions || ['确认已安装 NVIDIA 驱动，并重启 AIFISHER 画布。'],
    };
  }
  const sufficient = Number(gpu.vramTotalBytes) >= MINIMUM_VRAM_BYTES;
  return {
    status: sufficient ? 'ready' : 'insufficient',
    available: true,
    sufficient,
    name: String(gpu.name || 'NVIDIA GPU'),
    vramTotalBytes: Number(gpu.vramTotalBytes) || 0,
    vramFreeBytes: Number(gpu.vramFreeBytes) || 0,
    driverVersion: String(gpu.driverVersion || ''),
    minimumVramBytes: MINIMUM_VRAM_BYTES,
    ...(sufficient ? {} : {
      diagnosticCode: 'GPU_VRAM_INSUFFICIENT',
      message: '显存低于建议的 8 GB，本地工作流可能无法运行。',
      actions: ['降低分辨率或批次数量。', '关闭占用显存的其他程序。'],
    }),
  };
}

function summarizeComfy(probe, serverUrl, workflowRegistry) {
  const workflowCount = Object.keys(workflowRegistry || {}).length;
  if (!probe?.ok) {
    return {
      status: 'unavailable',
      address: serverUrl,
      workflowCount,
      diagnosticCode: probe?.diagnosticCode || 'COMFYUI_UNAVAILABLE',
      message: probe?.message || '本机 ComfyUI 服务不可用。',
      actions: probe?.actions || ['启动 ComfyUI，并确认监听 127.0.0.1。', '在设置中检查 ComfyUI 本机地址。'],
    };
  }
  const installedNodeTypes = new Set(probe.nodeTypes || []);
  const workflows = Object.entries(workflowRegistry || {}).map(([type, configuration]) => {
    const requirements = configuration.requirements || {};
    const missingNodeTypes = [...new Set(requirements.nodeTypes || [])]
      .filter((nodeType) => !installedNodeTypes.has(nodeType))
      .sort();
    const missingModels = (requirements.models || [])
      .filter(({ type: modelType, name }) =>
        !Array.isArray(probe.models?.[modelType]) || !probe.models[modelType].includes(name))
      .map(({ type: modelType, name }) => ({ type: modelType, name }));
    return {
      type,
      title: configuration.title || type,
      status: missingNodeTypes.length || missingModels.length ? 'incompatible' : 'ready',
      missingNodeTypes,
      missingModels,
    };
  });
  const compatibleWorkflowCount = workflows.filter(({ status }) => status === 'ready').length;
  const incompatibleWorkflowCount = workflowCount - compatibleWorkflowCount;
  const status = incompatibleWorkflowCount
    ? (compatibleWorkflowCount ? 'partial' : 'incompatible')
    : 'ready';
  return {
    status,
    address: serverUrl,
    workflowCount,
    compatibleWorkflowCount,
    incompatibleWorkflowCount,
    workflows,
    version: probe.version || null,
    queueRemaining: Number(probe.queueRemaining) || 0,
    nodeTypeCount: Number(probe.nodeTypeCount) || installedNodeTypes.size,
    models: probe.models || {
      checkpoints: [],
      diffusionModels: [],
      textEncoders: [],
      vaes: [],
      loras: [],
      total: 0,
    },
    ...(incompatibleWorkflowCount ? {
      diagnosticCode: 'COMFYUI_WORKFLOWS_INCOMPATIBLE',
      message: `${compatibleWorkflowCount}/${workflowCount} 个 ComfyUI 工作流可用。`,
      actions: ['查看缺失节点与模型后，只安装当前需要使用的工作流依赖。'],
    } : {}),
  };
}

function localComfyAddress(value) {
  try {
    return normalizeLocalComfyServer(value);
  } catch {
    return null;
  }
}

function invalidComfyConfiguration(workflowRegistry) {
  return {
    status: 'invalid-configuration',
    address: null,
    workflowCount: Object.keys(workflowRegistry || {}).length,
    diagnosticCode: 'NON_LOCAL_COMFY_SERVER',
    message: 'ComfyUI 只允许使用本机回环地址。',
    actions: ['把 ComfyUI 地址改为 127.0.0.1:8188。'],
  };
}

export function createLocalRuntimeRouter({
  modelsDirectory,
  workflowRegistry = {},
  getComfyServerUrl = () => '127.0.0.1:8188',
  probeGpu,
  probeComfy,
  comfyProcess = null,
  selectComfyDirectory = () => selectDirectoryWithSystemDialog({
    description: '选择 ComfyUI 目录',
  }),
  getComfyPython = () => process.env.COMFYUI_PYTHON,
  comfyExtensionInstaller = null,
  dreaminaCliInstaller = null,
  cacheTtlMs = 30_000,
}) {
  if (!modelsDirectory || !probeGpu || !probeComfy) {
    throw new Error('modelsDirectory, probeGpu, and probeComfy are required');
  }
  const router = express.Router();
  const workflowRegistryWithRequirements = loadWorkflowRequirements(workflowRegistry);
  let cachedStatus = null;
  let cachedAt = 0;

  // 只回传探测结论与文件名，不把 ComfyUI 安装的绝对路径暴露给前端或诊断包。
  const publicProcessState = (state) => {
    const { installedPython, installedEntry, ...rest } = state || {};
    return {
      ...rest,
      ...(installedPython ? { pythonName: path.basename(installedPython) } : {}),
      ...(installedEntry ? { entryName: path.basename(installedEntry) } : {}),
    };
  };

  const comfyProcessState = async () => {
    try {
      return publicProcessState(await comfyProcess.getState());
    } catch (error) {
      console.error('[Local Runtime] ComfyUI process state failed:', error?.code || error?.name || 'UNKNOWN');
      return {
        phase: 'error',
        running: false,
        owned: false,
        startable: false,
        diagnosticCode: 'COMFYUI_PROCESS_STATE_FAILED',
      };
    }
  };

  const requireComfyProcess = (response) => {
    if (comfyProcess) return true;
    response.status(503).json({
      error: '本机 ComfyUI 进程管理不可用。',
      code: 'COMFYUI_PROCESS_UNAVAILABLE',
    });
    return false;
  };

  const requireComfyExtensionInstaller = (response) => {
    if (comfyExtensionInstaller) return true;
    response.status(503).json({
      error: 'ComfyUI 节点编号扩展安装器不可用。',
      code: 'COMFYUI_EXTENSION_INSTALLER_UNAVAILABLE',
    });
    return false;
  };

  const requireDreaminaCliInstaller = (response) => {
    if (dreaminaCliInstaller) return true;
    response.status(503).json({
      error: '即梦 CLI 本机安装器不可用。',
      code: 'DREAMINA_CLI_INSTALLER_UNAVAILABLE',
    });
    return false;
  };

  const sendComfyExtensionError = (response, error) => {
    if (error instanceof ComfyExtensionInstallError) {
      response.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    console.error('[Local Runtime] ComfyUI extension operation failed:', error?.code || error?.name || 'UNKNOWN');
    response.status(500).json({
      error: 'ComfyUI 节点编号扩展操作失败，请查看本机日志。',
      code: 'COMFYUI_EXTENSION_OPERATION_FAILED',
    });
  };

  const sendDreaminaCliError = (response, error) => {
    if (error instanceof DreaminaCliInstallError) {
      response.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    console.error('[Local Runtime] Dreamina CLI operation failed:', error?.code || error?.name || 'UNKNOWN');
    response.status(500).json({
      error: '即梦 CLI 本机操作失败，请稍后重试。',
      code: 'DREAMINA_CLI_OPERATION_FAILED',
    });
  };

  const getStatus = async (force = false) => {
    if (!force && cachedStatus && Date.now() - cachedAt < cacheTtlMs) return cachedStatus;
      const serverUrl = localComfyAddress(getComfyServerUrl());
      const [modelItems, gpuProbe, comfyProbe, resolvedWorkflowRegistry] = await Promise.all([
        scanModels(modelsDirectory),
        probeGpu(),
        serverUrl ? probeComfy(serverUrl) : Promise.resolve(null),
        workflowRegistryWithRequirements,
      ]);
      let models = summarizeModels(modelItems);
      const gpu = summarizeGpu(gpuProbe);
      const comfyui = serverUrl
        ? summarizeComfy(comfyProbe, serverUrl, resolvedWorkflowRegistry)
        : invalidComfyConfiguration(resolvedWorkflowRegistry);
      if (comfyProcess) comfyui.process = await comfyProcessState();
      if (!modelItems.length && comfyProbe?.ok && Number(comfyProbe.models?.total) > 0) {
        const { diagnosticCode: _diagnosticCode, ...optionalModels } = models;
        models = {
          ...optionalModels,
          status: 'optional-empty',
          message: 'AIFISHER 模型目录为空；当前模型由 ComfyUI 管理。',
          actions: ['如需使用 AIFISHER 内置模型运行时，再把模型放入 models 目录。'],
        };
      }
      const diagnostics = [gpu, models, comfyui]
        .filter((item) => item.status !== 'ready')
        .map((item) => item.diagnosticCode)
        .filter(Boolean);
      cachedStatus = {
        localOnly: true,
        gpu,
        models,
        comfyui,
        diagnostics,
      };
      cachedAt = Date.now();
      return cachedStatus;
  };

  const sendStatusError = (response, error) => {
    console.error('[Local Runtime] Status failed:', error?.code || error?.name || 'UNKNOWN');
    response.status(500).json({
      error: '本地运行环境检测失败，请查看本机日志。',
      code: 'LOCAL_RUNTIME_STATUS_FAILED',
    });
  };

  router.get('/local-runtime/status', async (_request, response) => {
    try {
      response.json(await getStatus());
    } catch (error) {
      sendStatusError(response, error);
    }
  });

  router.post('/local-runtime/refresh', async (_request, response) => {
    try {
      response.json(await getStatus(true));
    } catch (error) {
      sendStatusError(response, error);
    }
  });

  router.get('/local-runtime/dreamina-cli', async (_request, response) => {
    if (!requireDreaminaCliInstaller(response)) return;
    try {
      response.json(await dreaminaCliInstaller.inspect({ refreshAuthentication: true }));
    } catch (error) {
      sendDreaminaCliError(response, error);
    }
  });

  router.post('/local-runtime/dreamina-cli/install', async (_request, response) => {
    if (!requireDreaminaCliInstaller(response)) return;
    try {
      response.json(await dreaminaCliInstaller.install());
    } catch (error) {
      sendDreaminaCliError(response, error);
    }
  });

  router.post('/local-runtime/dreamina-cli/login', async (request, response) => {
    if (!requireDreaminaCliInstaller(response)) return;
    try {
      response.json(await dreaminaCliInstaller.startLogin({ force: request.body?.force ?? false, browser: request.body?.browser ?? 'default' }));
    } catch (error) {
      sendDreaminaCliError(response, error);
    }
  });

  router.post('/local-runtime/dreamina-cli/login/check', async (_request, response) => {
    if (!requireDreaminaCliInstaller(response)) return;
    try {
      response.json(await dreaminaCliInstaller.checkLogin());
    } catch (error) {
      sendDreaminaCliError(response, error);
    }
  });

  router.get('/local-runtime/comfyui', async (_request, response) => {
    if (!requireComfyProcess(response)) return;
    response.json(await comfyProcessState());
  });

  // 画布上的日志面板靠它。只在回环地址上给用户本人看，密钥与用户名已脱敏，
  // 但保留其余路径——「模型没找到，路径是 X」正是排错最需要的信息。
  router.get('/local-runtime/comfyui/logs', async (request, response) => {
    if (!requireComfyProcess(response)) return;
    try {
      const lines = Number(request.query?.lines) || 200;
      const [state, logs] = await Promise.all([
        comfyProcessState(),
        Promise.resolve(comfyProcess.readLogs({ lines })),
      ]);
      response.json({ state, logs });
    } catch (error) {
      console.error('[Local Runtime] ComfyUI log read failed:', error?.code || error?.name || 'UNKNOWN');
      response.status(500).json({
        error: '读取本机 ComfyUI 日志失败。',
        code: 'COMFYUI_LOG_READ_FAILED',
      });
    }
  });

  router.get('/local-runtime/comfyui/extensions/node-ids', async (_request, response) => {
    if (!requireComfyExtensionInstaller(response)) return;
    try {
      response.json(await comfyExtensionInstaller.inspect());
    } catch (error) {
      sendComfyExtensionError(response, error);
    }
  });

  router.post('/local-runtime/comfyui/extensions/node-ids/install', async (_request, response) => {
    if (!requireComfyExtensionInstaller(response)) return;
    try {
      response.json(await comfyExtensionInstaller.install());
    } catch (error) {
      sendComfyExtensionError(response, error);
    }
  });

  // 只复用系统目录选择器，不创建工作流发现或 input 清理授权。
  // 选择结果先由现有安装探测器校验；成功后仍由前端走既有 /api/config/keys 保存。
  router.post('/local-runtime/comfyui/discover', async (_request, response) => {
    try { response.json(await discoverComfyInstallations({ pythonOverride: getComfyPython() })); }
    catch { response.status(500).json({ error: '自动查找失败，请手动选择 ComfyUI 目录。' }); }
  });
  router.post('/local-runtime/comfyui/validate-directory', (request, response) => {
    const root = request.body?.root;
    if (typeof root !== 'string' || !root.trim() || root.length > 2048) return response.status(400).json({ error: '请填写 ComfyUI 安装目录。' });
    const result = detectComfyInstallation({ root, pythonOverride: getComfyPython() });
    if (!result.ok) return response.status(422).json({ error: result.message });
    response.json({ status: 'selected', root: result.root });
  });

  router.post('/local-runtime/comfyui/select-directory', async (_request, response) => {
    try {
      const root = await selectComfyDirectory();
      const installation = detectComfyInstallation({
        root,
        pythonOverride: getComfyPython(),
      });
      if (!installation.ok) {
        response.status(422).json({
          status: 'invalid',
          diagnosticCode: installation.diagnosticCode,
          message: installation.message,
          actions: installation.actions,
        });
        return;
      }
      response.json({ status: 'selected', root: installation.root });
    } catch (error) {
      if (error?.code === 'DIRECTORY_PICKER_CANCELLED') {
        response.json({ status: 'cancelled' });
        return;
      }
      if (error?.code === 'DIRECTORY_PICKER_UNAVAILABLE') {
        response.status(Number(error.status) || 501).json({
          error: error.message,
          code: error.code,
        });
        return;
      }
      console.error('[Local Runtime] ComfyUI directory selection failed:', error?.code || error?.name || 'UNKNOWN');
      response.status(500).json({
        error: '选择 ComfyUI 目录失败，请稍后重试。',
        code: 'COMFYUI_DIRECTORY_SELECTION_FAILED',
      });
    }
  });

  router.post('/local-runtime/comfyui/start', async (_request, response) => {
    if (!requireComfyProcess(response)) return;
    try {
      const result = await comfyProcess.start();
      cachedStatus = null;
      response.status(result.status === 'failed' ? 409 : 200).json(result);
    } catch (error) {
      console.error('[Local Runtime] ComfyUI start failed:', error?.code || error?.name || 'UNKNOWN');
      response.status(500).json({
        error: '启动本机 ComfyUI 失败，请查看本机日志。',
        code: 'COMFYUI_START_FAILED',
      });
    }
  });

  router.post('/local-runtime/comfyui/stop', async (_request, response) => {
    if (!requireComfyProcess(response)) return;
    try {
      const result = await comfyProcess.stop();
      cachedStatus = null;
      response.status(result.status === 'failed' ? 409 : 200).json(result);
    } catch (error) {
      console.error('[Local Runtime] ComfyUI stop failed:', error?.code || error?.name || 'UNKNOWN');
      response.status(500).json({
        error: '停止本机 ComfyUI 失败，请查看本机日志。',
        code: 'COMFYUI_STOP_FAILED',
      });
    }
  });

  router.get('/local-models/gpu', async (_request, response) => {
    try {
      response.json((await getStatus()).gpu);
    } catch (error) {
      sendStatusError(response, error);
    }
  });

  router.get('/local-models/registry', (_request, response) => {
    response.json(LOCAL_MODEL_REGISTRY);
  });

  router.get('/local-models/architecture/:key', (request, response) => {
    const configuration = LOCAL_MODEL_REGISTRY.architectures[request.params.key];
    if (!configuration) {
      response.status(404).json({
        error: 'Model architecture not found',
        available: Object.keys(LOCAL_MODEL_REGISTRY.architectures),
      });
      return;
    }
    response.json({ key: request.params.key, ...configuration });
  });

  router.post('/local-models/refresh', async (_request, response) => {
    try {
      response.json((await getStatus(true)).models.items);
    } catch (error) {
      sendStatusError(response, error);
    }
  });

  router.get('/local-models', async (request, response) => {
    try {
      const items = (await getStatus()).models.items;
      response.json(request.query.type
        ? items.filter((item) => item.type === request.query.type)
        : items);
    } catch (error) {
      sendStatusError(response, error);
    }
  });

  router.get('/local-models/:id', async (request, response) => {
    try {
      const item = (await getStatus()).models.items
        .find((model) => model.id === request.params.id);
      if (!item) {
        response.status(404).json({ error: 'Local model not found' });
        return;
      }
      response.json(item);
    } catch (error) {
      sendStatusError(response, error);
    }
  });

  return router;
}
