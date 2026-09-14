import { execFile } from 'node:child_process';

function runFile(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      timeout: 4_000,
      windowsHide: true,
      maxBuffer: 128 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stderr }));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function cleanCsvValue(value) {
  return String(value || '').trim().replace(/^"|"$/g, '');
}

export async function probeNvidiaGpu({ runCommand = runFile } = {}) {
  try {
    const { stdout } = await runCommand('nvidia-smi', [
      '--query-gpu=name,memory.total,memory.free,driver_version',
      '--format=csv,noheader,nounits',
    ]);
    const [name, totalMiB, freeMiB, driverVersion] = String(stdout || '')
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.split(',')
      .map(cleanCsvValue) || [];
    const total = Number(totalMiB);
    const free = Number(freeMiB);
    if (!name || !Number.isFinite(total) || total <= 0 || !Number.isFinite(free)) {
      throw new Error('invalid nvidia-smi output');
    }
    return {
      available: true,
      name,
      vramTotalBytes: total * 1024 ** 2,
      vramFreeBytes: Math.max(0, free) * 1024 ** 2,
      driverVersion,
    };
  } catch {
    return {
      available: false,
      diagnosticCode: 'GPU_NOT_DETECTED',
      message: '未检测到可用的 NVIDIA GPU 或 nvidia-smi。',
      actions: ['安装或更新 NVIDIA 显卡驱动，然后重启 AIFISHER 画布。'],
    };
  }
}

// ComfyUI 刚启动、或正在跑生成时响应很慢：实测 /system_stats 要 5 秒，
// /object_info 有 5.7 MB、要 6 秒。2.5 秒的超时会把「已经起来了」误判成「没起来」。
const READY_TIMEOUT_MS = 10_000;
const DETAIL_TIMEOUT_MS = 20_000;

async function fetchJson(url, timeoutMs = DETAIL_TIMEOUT_MS) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/**
 * 只回答「服务是否可用」，供自动启动的就绪轮询使用。
 * 绝不拉 /object_info——那是几 MB 的节点清单，用来判断存活太贵也太慢。
 */
export async function probeComfyReady(serverUrl, { requestJson = fetchJson } = {}) {
  try {
    const stats = await requestJson(`http://${serverUrl}/system_stats`, READY_TIMEOUT_MS);
    return {
      ok: true,
      version: stats?.system?.comfyui_version || stats?.system?.version || null,
    };
  } catch {
    return { ok: false, diagnosticCode: 'COMFYUI_UNAVAILABLE' };
  }
}

const COMFY_VIRTUAL_MODEL_CHOICES = new Set([
  'pixel_space',
  'taesd',
  'taesdxl',
  'taesd3',
  'taef1',
]);

function comfyChoices(objectInfo, nodeType, field) {
  const specification = objectInfo?.[nodeType]?.input?.required?.[field]
    || objectInfo?.[nodeType]?.input?.optional?.[field];
  const values = Array.isArray(specification?.[0]) ? specification[0] : [];
  return [...new Set(values.filter((value) =>
    typeof value === 'string'
    && value.trim()
    && !COMFY_VIRTUAL_MODEL_CHOICES.has(value.toLowerCase())))]
    .sort();
}

function comfyModels(objectInfo) {
  const models = {
    checkpoints: comfyChoices(objectInfo, 'CheckpointLoaderSimple', 'ckpt_name'),
    diffusionModels: comfyChoices(objectInfo, 'UNETLoader', 'unet_name'),
    textEncoders: comfyChoices(objectInfo, 'CLIPLoader', 'clip_name'),
    vaes: comfyChoices(objectInfo, 'VAELoader', 'vae_name'),
    loras: comfyChoices(objectInfo, 'LoraLoader', 'lora_name'),
  };
  return {
    ...models,
    total: Object.values(models).reduce((total, items) => total + items.length, 0),
  };
}

export async function probeComfyServer(serverUrl, { requestJson = fetchJson } = {}) {
  try {
    const [stats, queue, objectInfo] = await Promise.all([
      requestJson(`http://${serverUrl}/system_stats`),
      requestJson(`http://${serverUrl}/queue`),
      requestJson(`http://${serverUrl}/object_info`),
    ]);
    const running = Array.isArray(queue?.queue_running) ? queue.queue_running.length : 0;
    const pending = Array.isArray(queue?.queue_pending) ? queue.queue_pending.length : 0;
    const nodeTypes = Object.keys(objectInfo || {}).sort();
    return {
      ok: true,
      version: stats?.system?.comfyui_version || stats?.system?.version || null,
      queueRemaining: running + pending,
      nodeTypeCount: nodeTypes.length,
      nodeTypes,
      models: comfyModels(objectInfo),
    };
  } catch {
    return {
      ok: false,
      diagnosticCode: 'COMFYUI_UNAVAILABLE',
      message: '无法连接本机 ComfyUI 服务。',
      actions: [
        '启动 ComfyUI，并确认监听 127.0.0.1。',
        '在设置中检查 ComfyUI 本机地址。',
      ],
    };
  }
}
