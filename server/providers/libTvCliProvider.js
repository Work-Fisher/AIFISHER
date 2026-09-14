import { randomUUID } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { BaseProvider } from './baseProvider.js';
import { materializeInputs } from './cliMediaInputs.js';
import { libTvError } from '../local/libTvCliRuntime.js';
import { matchesRemoteTask, remoteTaskReference } from '../generation/generationTaskRecovery.js';

const endpoint = 'https://www.liblib.tv/';
const values = value => (Array.isArray(value) ? value : value ? [value] : []).filter(value => typeof value === 'string' && value);
const identity = (kind, params, account) => ({
  providerName: kind === 'image' ? 'LibTvCliImageProvider' : 'LibTvCliVideoProvider',
  modelId: kind === 'image' ? params.imageModel : params.videoModel,
  submitUrl: endpoint, apiKey: account.identity,
});
const nodeKey = result => {
  // Commands which create edges return a connection receipt rather than a node.
  const key = result?.nodeKey || result?.focalNodeKey;
  if (!/^[a-zA-Z0-9-]{16,64}$/.test(key || '')) throw libTvError('LibTV 未返回有效节点编号，未提交生成。');
  return key;
};

function settings(kind, params, inputs) {
  const count = Number(params.generateCount || 1);
  if (![1, 2, 4].includes(count)) throw libTvError('LibTV 单次支持生成 1、2 或 4 张。', 'LIBTV_COUNT_INVALID', 400);
  const model = kind === 'image' ? params.imageModel : params.videoModel;
  if (model !== (kind === 'image' ? 'Lib Image 2.5 Fast' : 'Seedance 2.5')) throw libTvError('LibTV 模型配置无效。');
  const ratio = params.aspectRatio || '16:9';
  const ratios = kind === 'image' ? ['1:1','1:2','2:1','9:16','16:9','3:4','4:3','3:2','2:3','5:4','4:5','21:9','9:21'] : ['16:9','4:3','1:1','3:4','9:16','21:9'];
  if (!ratios.includes(ratio)) throw libTvError('LibTV 不支持所选比例。', 'LIBTV_RATIO_INVALID', 400);
  const resolution = params.resolution || (kind === 'image' ? '1K' : '720p');
  if (!(kind === 'image' ? ['1K','2K','4K'] : ['480p','720p','1080p']).includes(resolution)) throw libTvError('LibTV 不支持所选分辨率。', 'LIBTV_RESOLUTION_INVALID', 400);
  const settings = [`model=${model}`, `count=${kind === 'image' ? count : 1}`, `ratio=${ratio}`, `resolution=${resolution}`];
  const { images, videos, audios } = inputs;
  if (kind === 'image') {
    if (videos.length || audios.length || images.length > 14) throw libTvError('LibTV 图像最多接收 14 张参考图。', 'LIBTV_INPUT_INVALID', 400);
    if (params.imageMode === 'image-to-image' && !images.length) throw libTvError('请先连接参考图片。', 'LIBTV_INPUT_REQUIRED', 400);
    settings.push(`modeType=${images.length ? 'image2image' : 'text2image'}`);
  } else {
    const modes = { 'text-to-video':'text2video', 'first-frame':'singleImage2video', 'i2v-first-last-frame':'frames2video', multimodal:'mixed2video' };
    const mode = modes[params.videoMode || 'text-to-video'];
    if (!mode || (mode === 'text2video' && images.length + videos.length + audios.length)
      || (mode === 'singleImage2video' && (images.length !== 1 || videos.length || audios.length))
      || (mode === 'frames2video' && (images.length !== 2 || videos.length || audios.length))
      || (mode === 'mixed2video' && (!images.length && !videos.length && !audios.length))
      || images.length > 30 || videos.length > 10 || audios.length > 10) throw libTvError('LibTV 模式与连接素材不匹配，请检查首帧、首尾帧或全能参考。', 'LIBTV_INPUT_INVALID', 400);
    const duration = Number(params.duration ?? 5);
    if (!Number.isInteger(duration) || duration < 4 || duration > 30) throw libTvError('LibTV 视频时长须为 4–30 秒。', 'LIBTV_DURATION_INVALID', 400);
    settings.push(`modeType=${mode}`, `duration=${duration}`, `enableSound=${params.generate_audio === false || params.enableSound === false || params.enableSound === 'off' ? 'off' : 'on'}`);
  }
  return settings.flatMap(value => ['-s', value]);
}

async function readResult(runtime, project, key, kind, signal) {
  const node = await runtime.execute(['node', key, '-p', project], { signal });
  if (node.nodeKey !== key) return { status: 'unknown' };
  const urls = values(node.data?.url);
  if (!urls.length) return { status: 'pending' };
  const results = [];
  for (const value of urls) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) throw libTvError('LibTV 返回了无效素材地址。');
    const buffer = await BaseProvider.asyncDownloadToBuffer(url.href, false, { signal });
    if (!buffer.length) throw libTvError('LibTV 返回了空素材。');
    const format = kind === 'image' ? (await sharp(buffer).metadata()).format : path.extname(url.pathname).slice(1).toLowerCase();
    if (!(kind === 'image' ? ['png','jpeg','webp'] : ['mp4','mov','webm']).includes(format)) throw libTvError('LibTV 输出格式无法识别。');
    results.push({ buffer, format: format === 'jpeg' ? 'jpg' : format });
  }
  return kind === 'image' ? { status: 'success', results } : { status: 'success', ...results[0] };
}

async function generate(kind, params, config) {
  const runtime = config.LIBTV_CLI;
  if (!runtime) throw libTvError('LibTV 运行组件不可用，请更新画布。', 'LIBTV_CLI_UNAVAILABLE', 503);
  const inputs = { images: values(params.images || params.imageBase64), videos: values(params.videos || params.videoUrl), audios: values(params.audios || params.audioBase64) };
  const args = settings(kind, params, inputs);
  const lease = await runtime.acquireAccount();
  let directory, submitted = false;
  try {
    directory = await runtime.createTaskDirectory();
    const project = await runtime.getProject(lease.account, params.projectId);
    const references = [];
    for (const [field, type] of [['images','image'], ['videos','video'], ['audios','audio']]) {
      let files;
      try { files = await materializeInputs(inputs[field], type, directory); }
      catch (error) { throw libTvError(error.message.replaceAll('即梦', 'LibTV'), 'LIBTV_INPUT_INVALID', 400); }
      for (const file of files) {
        const uploaded = await runtime.execute(['upload', `AIFISHER ${type} ${randomUUID()}`, '-p', project, '-t', type, '--resource', file], { signal: params.signal });
        references.push(nodeKey(uploaded));
      }
    }
    // Always create a fresh node, so an old cloud output can never satisfy a new request.
    const name = `AIFISHER ${kind} ${randomUUID()}`;
    await runtime.execute(['node', 'create', name, '-p', project, '-t', kind,
      '--prompt', String(params.prompt || ''), ...args, ...references.flatMap(key => ['--left', key])], { signal: params.signal });
    // Creation with edges has a different receipt envelope. Read the unique draft
    // back to verify the actual stored model, inputs and node identity before payment.
    const draft = await runtime.execute(['node', name, '-p', project], { signal: params.signal });
    const key = nodeKey(draft);
    if (draft.data?.params?.model !== (kind === 'image' ? params.imageModel : params.videoModel)) throw libTvError('LibTV 云端模型与请求不一致，未提交生成。');
    if (references.length) {
      const draftParams = draft.data?.params || {};
      const connected = [draftParams.imageList, draftParams.videoList, draftParams.audioList].flatMap(items => Array.isArray(items) ? items.map(item => item.nodeId) : []);
      if (draft.nodeKey !== key || references.some(ref => !connected.includes(ref))) throw libTvError('LibTV 参考素材未完整连接，未提交生成。', 'LIBTV_REFERENCE_NOT_CONNECTED', 400);
      const imageOrder = draftParams.imageListOrder || (draftParams.imageList || []).map(item => item.nodeId);
      if (references.slice(0, inputs.images.length).some((ref, index) => imageOrder[index] !== ref)) throw libTvError('LibTV 参考图顺序不一致，未提交生成。', 'LIBTV_REFERENCE_ORDER_INVALID', 400);
    }
    const current = await runtime.getAccount({ fresh: true });
    if (current?.identity !== lease.account.identity) throw libTvError('LibTV 账号已改变，未提交生成。');
    config.generationTaskSubmitting?.(); submitted = true;
    let receipt = false;
    await runtime.execute(['node', key, '-p', project, '--run'], {
      signal: params.signal, timeoutMs: 0,
      onProgress(line) {
        if (!receipt && /\[run\]\s+task=\S+/.test(line)) {
          receipt = true;
          config.generationTaskSubmitted?.(remoteTaskReference({ ...identity(kind, params, lease.account), taskId: `${project}:${key}` }));
        }
      },
    });
    // Successful --run is also an explicit receipt, even if this CLI version omitted progress.
    if (!receipt) config.generationTaskSubmitted?.(remoteTaskReference({ ...identity(kind, params, lease.account), taskId: `${project}:${key}` }));
    const result = await readResult(runtime, project, key, kind, params.signal);
    if (result.status !== 'success') throw libTvError('LibTV 原任务结果仍待核对，请勿重复生成。');
    if ((await runtime.getAccount({ fresh: true }))?.identity !== lease.account.identity) throw libTvError('LibTV 账号已改变，请切回原账号核对结果。');
    return kind === 'image' ? result.results.length === 1 ? result.results[0] : result.results : { buffer: result.buffer, format: result.format };
  } catch (error) {
    if (submitted) error.submissionUncertain = true;
    throw error;
  } finally {
    if (directory) await runtime.cleanupTaskDirectory(directory).catch(() => {});
    lease.release();
  }
}
async function canRecover(kind, ref, params, config) {
  const account = await config.LIBTV_CLI?.getAccount({ fresh: true });
  return Boolean(account && matchesRemoteTask(ref, identity(kind, params, account)));
}
async function recover(kind, task, params, config, signal) {
  const refs = kind === 'image' ? task.remoteTasks : [task];
  if (refs?.length !== 1 || !config.LIBTV_CLI) return { status: 'unknown' };
  const lease = await config.LIBTV_CLI.acquireAccount();
  try {
    if (!matchesRemoteTask(refs[0], identity(kind, params, lease.account))) return { status: 'unknown', reason: 'settings_changed' };
    const [project, key, extra] = refs[0].taskId.split(':');
    if (extra || !/^[a-zA-Z0-9-]{16,64}$/.test(project) || !/^[a-zA-Z0-9-]{16,64}$/.test(key)) return { status: 'unknown' };
    const result = await readResult(config.LIBTV_CLI, project, key, kind, signal);
    if (!(await canRecover(kind, refs[0], params, config))) return { status: 'unknown', reason: 'settings_changed' };
    if (kind === 'image' && result.status === 'success' && result.results.length < task.requestedCount) result.status = 'partial';
    return result;
  } finally { lease.release(); }
}
export const LibTvCliImageProvider = {
  generateImage: (params, config) => generate('image', params, config),
  canRecoverImage: (ref, params, config) => canRecover('image', ref, params, config),
  recoverImage: (task, params, config, signal) => recover('image', task, params, config, signal),
};
export const LibTvCliVideoProvider = {
  generateVideo: (params, config) => generate('video', params, config),
  canRecoverVideo: (ref, params, config) => canRecover('video', ref, params, config),
  recoverVideo: (task, params, config, signal) => recover('video', task, params, config, signal),
};
