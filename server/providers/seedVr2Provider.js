import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { getWorkspacePaths } from '../workspace/workspacePaths.js';
import { RunningHubWorkflowClient } from '../workflowRuntime/runningHubWorkflowClient.js';
import { createRunningHubWebAppProjection, RUNNINGHUB_WEBAPP_OUTPUT_NODE_ID } from '../workflowRuntime/runningHubWebApp.js';
import { normalizeRunningHubOutputs } from '../workflowRuntime/runningHubWorkflowExecutor.js';
import { matchesRemoteTask, remoteTaskReference } from '../generation/generationTaskRecovery.js';
import { GenerationTaskError } from '../generation/generationExecution.js';

const MAX_BYTES = 30 * 1024 * 1024;
const fail = (message, code = 'SEEDVR2_INVALID_INPUT', status = 400) => new GenerationTaskError({ message, code, status, retryable: false });

// Use the same published-field projection as cloud workflow import. No private
// ComfyUI graph, internal node numbers or guessed size/seed overrides are needed.
export function seedVr2Bindings(webAppId, info, fileName) {
  const { snapshot } = createRunningHubWebAppProjection(webAppId, info);
  const media = snapshot.fields.filter((field) => ['image', 'video', 'audio'].includes(field.kind));
  if (media.length !== 1 || media[0].kind !== 'image')
    throw fail('此云端应用需要多个素材或不支持单张图片，未提交任务。');
  if (info.nodeInfoList.some((field) => field.required === true
      && !(String(field.nodeId) === media[0].nodeId && field.fieldName === media[0].fieldName)
      && (field.fieldValue ?? field.defaultValue ?? field.value) == null))
    throw fail('云端应用还有未提供默认值的必填参数，未提交任务。');
  return [{ nodeId: media[0].nodeId, fieldName: media[0].fieldName, fieldValue: fileName }];
}

export async function readSeedVr2Input(params, libraryRoot = getWorkspacePaths().LIBRARY_DIR) {
  const inputs = params.imageBase64;
  if (!Array.isArray(inputs) || inputs.length !== 1 || typeof inputs[0] !== 'string'
      || !/^[A-Za-z0-9_-]{1,128}$/.test(params.projectId || '')) throw fail('请选择当前项目的一张已保存图片。');
  let decoded;
  try { decoded = decodeURIComponent(inputs[0].split('?')[0]); } catch { throw fail('图片地址无效。'); }
  const prefix = `/library/media/${params.projectId}/images/`;
  const filename = decoded.slice(prefix.length);
  if (!decoded.startsWith(prefix) || !filename || filename.startsWith('.')
      // eslint-disable-next-line no-control-regex -- Reject control characters in decoded local filenames.
      || /[\\/:%?#\x00-\x1f]/.test(filename)) throw fail('只允许当前项目的本机图片，不接受外部地址。');
  const root = await realpath(libraryRoot);
  const expected = path.join(root, 'media', params.projectId, 'images', filename);
  const resolved = await realpath(expected);
  const equal = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  if (!equal(expected, resolved)) throw fail('图片路径不能通过链接指向其他目录。');
  const handle = await open(resolved, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size < 1 || before.size > MAX_BYTES) throw fail('图片文件须不超过 30 MiB。请压缩图片后重新上传，再运行高清放大；本次尚未提交生成任务。');
    const buffer = Buffer.alloc(before.size + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const after = await handle.stat();
    if (bytesRead !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw fail('图片正在变化，请稍后再试。');
    const bytes = buffer.subarray(0, bytesRead);
    const meta = await sharp(bytes, { limitInputPixels: 32_000_000 }).metadata();
    if (!['png', 'jpeg', 'webp'].includes(meta.format) || (meta.pages || 1) !== 1) throw fail('首版支持静态 PNG、JPEG、WebP 图片。');
    return { buffer: bytes, filename };
  } finally { await handle.close(); }
}

function context(params, config) {
  const submitUrl = params.url;
  if (submitUrl !== 'https://www.runninghub.cn/task/openapi/ai-app/run'
      || !/^\d{10,30}$/.test(params.imageModel || '')) throw fail('SeedVR2 云端配置不匹配。');
  // Match runninghubProvider.setting: explicit config first, then the current
  // user's backend environment populated by the existing DPAPI credential loader.
  // An explicitly empty setting must not revive an older environment credential.
  const apiKey = String(config?.RUNNINGHUB_API_KEY ?? process.env.RUNNINGHUB_API_KEY ?? '').trim();
  // HTTP 401 belongs to the canvas session, not to a model credential failure.
  if (!apiKey) throw fail('请先在设置中连接 RunningHub 国内站。', 'PROVIDER_AUTH_FAILED', 502);
  return { providerName: 'SeedVr2ImageProvider', apiKey, modelId: params.imageModel, submitUrl,
    queryUrl: 'https://www.runninghub.cn/task/openapi/outputs' };
}

export function selectSeedVr2Outputs(outputs) {
  // WebApp receipts are application outputs, not a public internal graph.
  // Preserve every returned image instead of guessing a final node or largest file.
  const candidates = normalizeRunningHubOutputs(outputs, {
    [RUNNINGHUB_WEBAPP_OUTPUT_NODE_ID]: { class_type: 'RunningHubWebAppOutput', inputs: {} },
  }, { defaultNodeId: RUNNINGHUB_WEBAPP_OUTPUT_NODE_ID, forceDefaultNodeId: true });
  if (candidates.some((item) => item.mediaKind !== 'image') || candidates.length > 10)
    throw fail('高清放大应用须返回 1–10 张图片，请核对原任务输出。', 'SEEDVR2_OUTPUT_UNCONFIRMED', 502);
  return candidates.map((item) => item.handle);
}

async function downloadImage(client, handle, signal, max) {
  const response = await client.openOutput(handle, { signal });
  if (Number(response.headers.get('content-length')) > max) { await response.body?.cancel(); throw fail('高清结果文件超过 100 MiB 限制。'); }
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > max) throw fail('高清结果文件超过 100 MiB 限制。');
    chunks.push(Buffer.from(chunk));
  }
  const buffer = Buffer.concat(chunks);
  const meta = await sharp(buffer, { limitInputPixels: 32_000_000 }).metadata();
  if (!['png', 'jpeg', 'webp'].includes(meta.format) || (meta.pages || 1) !== 1) throw fail('云端最终输出不是支持的静态图片。');
  return { buffer, format: meta.format === 'jpeg' ? 'jpg' : meta.format };
}

async function downloadResults(client, outputs, signal) {
  const handles = selectSeedVr2Outputs(outputs), results = [];
  let remaining = 100 * 1024 * 1024;
  for (const handle of handles) {
    const result = await downloadImage(client, handle, signal, remaining);
    remaining -= result.buffer.length;
    results.push(result);
  }
  return results;
}

export function createSeedVr2Provider({ clientFactory = (options) => new RunningHubWorkflowClient(options),
  readInput = readSeedVr2Input, wait = (signal) => delay(5000, undefined, { signal }), now = Date.now } = {}) {
  const clientFor = (ctx) => clientFactory({ baseUrl: 'https://www.runninghub.cn', apiKey: ctx.apiKey });
  return {
    canRecoverImage(reference, params, config) {
      try { return matchesRemoteTask(reference, context(params, config)); } catch { return false; }
    },
    async recoverImage(task, params, config, signal) {
      const ctx = context(params, config), reference = task.remoteTasks?.[0];
      if (!reference || !matchesRemoteTask(reference, ctx)) return { status: 'unknown' };
      const client = clientFor(ctx), result = await client.getWebAppTaskOutputs(reference.taskId, { signal });
      if (result.state === 'failed') return { status: 'failed', error: new Error('SeedVR2 原任务失败') };
      if (result.state !== 'success') return { status: 'pending' };
      return { status: 'success', results: await downloadResults(client, result.outputs, signal) };
    },
    async generateImage(params, config) {
      if (params.upscaleConfirmed !== true || Number(params.generateCount) !== 1 || params.imageMode !== 'image-to-image')
        throw fail('请从图片工具栏确认单张 AI 高清放大。');
      const ctx = context(params, config), client = clientFor(ctx), signal = config.generationSignal || params.signal;
      const input = await readInput(params).catch((error) => {
        if (error instanceof GenerationTaskError) throw error;
        throw fail('图片无法读取或格式无效，请重新选择当前项目的图片。');
      });
      // Resolve the current published application fields before any upload/submission.
      const info = await client.getWebAppInfo(ctx.modelId, { signal });
      const bindings = seedVr2Bindings(ctx.modelId, info, '');
      signal?.throwIfAborted();
      const uploaded = await client.uploadBuffer(input.buffer, input.filename, { signal });
      signal?.throwIfAborted();
      config.generationTaskSubmitting?.(0);
      let task;
      try {
        task = await client.createWebAppTask({ webAppId: ctx.modelId,
          nodeInfoList: bindings.map((field) => ({ ...field, fieldValue: uploaded.fileName })), instanceType: 'default', signal });
      } catch (error) {
        if (error.confirmedRejected) throw fail(error.message, 'SEEDVR2_SUBMISSION_REJECTED');
        throw Object.assign(fail('提交结果尚未确认，请核对 RH 任务记录，勿重复点击。', 'GENERATION_SUBMISSION_UNKNOWN', 503), { submissionUncertain: true });
      }
      config.generationTaskSubmitted?.(remoteTaskReference({ ...ctx, taskId: task.taskId }), 0);
      const deadline = now() + 20 * 60_000;
      while (now() < deadline) {
        signal?.throwIfAborted();
        const result = await client.getWebAppTaskOutputs(task.taskId, { signal });
        if (result.state === 'failed') throw Object.assign(new Error('SeedVR2 原任务失败'), { providerTaskFailed: true });
        if (result.state === 'success') return downloadResults(client, result.outputs, signal);
        await wait(signal);
      }
      throw fail('等待超时，正在核对原任务，请勿重复生成。', 'GENERATION_OBSERVATION_INTERRUPTED', 503);
    },
  };
}

export const SeedVr2ImageProvider = createSeedVr2Provider();
