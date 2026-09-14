import { copyFile, lstat, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getWorkspacePaths } from '../workspace/workspacePaths.js';
import { resolveLocalPath } from '../utils/imageHelpers.js';
const INPUT_LIMITS = Object.freeze({
  image: 25 * 1024 * 1024,
  video: 512 * 1024 * 1024,
  audio: 100 * 1024 * 1024,
});
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mpeg', '.mpg']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac']);

class DreaminaCliProviderError extends Error {
  constructor(code, message, { status = 500, retryable = false } = {}) {
    super(message);
    this.name = 'DreaminaCliProviderError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.expose = true;
  }
}

function within(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function extensionForMime(mime, kind) {
  const known = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
  };
  const extension = known[String(mime || '').toLowerCase()];
  if (extension && allowedExtensions(kind).has(extension)) return extension;
  throw new DreaminaCliProviderError(
    'DREAMINA_INPUT_UNSUPPORTED',
    `即梦 CLI 不支持当前${kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频'}格式。`,
    { status: 400 },
  );
}

function allowedExtensions(kind) {
  if (kind === 'image') return IMAGE_EXTENSIONS;
  if (kind === 'video') return VIDEO_EXTENSIONS;
  return AUDIO_EXTENSIONS;
}

async function materializeInput(value, kind, inputDirectory, index) {
  const dataMatch = String(value).match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/u);
  if (dataMatch) {
    const encoded = dataMatch[2].replace(/\s+/g, '');
    const inputLimit = INPUT_LIMITS[kind];
    // 先按 Base64 理论长度拒绝明显超限输入，避免先分配一整块过大的 Buffer。
    if (encoded.length > Math.ceil(inputLimit / 3) * 4) {
      throw new DreaminaCliProviderError(
        'DREAMINA_INPUT_INVALID',
        '即梦 CLI 输入素材为空或超过本机安全上限。',
        { status: 400 },
      );
    }
    const buffer = Buffer.from(encoded, 'base64');
    if (!buffer.length || buffer.length > inputLimit) {
      throw new DreaminaCliProviderError(
        'DREAMINA_INPUT_INVALID',
        '即梦 CLI 输入素材为空或超过本机安全上限。',
        { status: 400 },
      );
    }
    const target = path.join(inputDirectory, `${kind}-${index}${extensionForMime(dataMatch[1], kind)}`);
    await writeFile(target, buffer, { flag: 'wx', mode: 0o600 });
    return target;
  }

  const candidate = resolveLocalPath(String(value));
  if (!candidate) {
    throw new DreaminaCliProviderError(
      'DREAMINA_INPUT_NOT_LOCAL',
      '即梦 CLI 只接收已保存到本机素材库的参考素材。请先导入素材后重试。',
      { status: 400 },
    );
  }
  const libraryRoot = await realpath(getWorkspacePaths().LIBRARY_DIR);
  const resolved = await realpath(candidate).catch(() => null);
  if (!resolved || !within(libraryRoot, resolved)) {
    throw new DreaminaCliProviderError(
      'DREAMINA_INPUT_NOT_LOCAL',
      '即梦 CLI 参考素材不在当前用户的本机素材库中。',
      { status: 400 },
    );
  }
  const stats = await lstat(resolved);
  const extension = path.extname(resolved).toLowerCase();
  if (
    !stats.isFile()
    || stats.isSymbolicLink()
    || stats.size <= 0
    || stats.size > INPUT_LIMITS[kind]
    || !allowedExtensions(kind).has(extension)
  ) {
    throw new DreaminaCliProviderError(
      'DREAMINA_INPUT_UNSUPPORTED',
      '即梦 CLI 参考素材格式无效或路径不安全。',
      { status: 400 },
    );
  }
  const target = path.join(inputDirectory, `${kind}-${index}${extension}`);
  await copyFile(resolved, target);
  return target;
}

export async function materializeInputs(values, kind, inputDirectory) {
  const result = [];
  for (let index = 0; index < values.length; index += 1) {
    result.push(await materializeInput(values[index], kind, inputDirectory, index));
  }
  return result;
}
