import crypto from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

const EXTENSION_DIRECTORY = 'fisherai_node_ids';
const EXTENSION_FILES = Object.freeze([
  '__init__.py',
  'manifest.json',
  'README.md',
  'web/fisherai-node-ids.js',
]);

export class ComfyExtensionInstallError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.name = 'ComfyExtensionInstallError';
    this.code = code;
    this.status = status;
  }
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function optionalLstat(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function readPackage(sourceDirectory) {
  const manifestPath = path.join(sourceDirectory, 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    throw new ComfyExtensionInstallError(
      'COMFYUI_EXTENSION_BUNDLE_INVALID',
      'AIFISHER 节点编号扩展包不完整，请重新安装 AIFISHER 画布。',
      500,
    );
  }
  if (
    manifest?.id !== EXTENSION_DIRECTORY
    || typeof manifest.version !== 'string'
    || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(manifest.version)
  ) {
    throw new ComfyExtensionInstallError(
      'COMFYUI_EXTENSION_BUNDLE_INVALID',
      'AIFISHER 节点编号扩展包版本信息无效。',
      500,
    );
  }

  const files = new Map();
  for (const relativePath of EXTENSION_FILES) {
    const sourcePath = path.join(sourceDirectory, ...relativePath.split('/'));
    const stats = await optionalLstat(sourcePath);
    if (!stats?.isFile() || stats.isSymbolicLink()) {
      throw new ComfyExtensionInstallError(
        'COMFYUI_EXTENSION_BUNDLE_INVALID',
        'AIFISHER 节点编号扩展包不完整，请重新安装 AIFISHER 画布。',
        500,
      );
    }
    files.set(relativePath, await readFile(sourcePath));
  }
  return { manifest, files };
}

function packageHash(files) {
  const hash = crypto.createHash('sha256');
  for (const relativePath of EXTENSION_FILES) {
    hash.update(relativePath);
    hash.update('\0');
    hash.update(files.get(relativePath));
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function readInstalledFiles(targetDirectory) {
  const files = new Map();
  for (const relativePath of EXTENSION_FILES) {
    const targetPath = path.join(targetDirectory, ...relativePath.split('/'));
    const stats = await optionalLstat(targetPath);
    if (!stats?.isFile() || stats.isSymbolicLink()) return null;
    files.set(relativePath, await readFile(targetPath));
  }
  return files;
}

async function resolveTarget(detectInstallation) {
  const installation = await Promise.resolve(detectInstallation());
  if (!installation?.ok) {
    throw new ComfyExtensionInstallError(
      installation?.diagnosticCode || 'COMFYUI_ROOT_NOT_CONFIGURED',
      installation?.message || '请先在“本机服务”中选择 ComfyUI 安装目录。',
    );
  }
  const comfyDirectory = path.resolve(installation.cwd || path.dirname(installation.entry));
  const customNodesDirectory = path.join(comfyDirectory, 'custom_nodes');
  const targetDirectory = path.join(customNodesDirectory, EXTENSION_DIRECTORY);
  if (!isInside(comfyDirectory, customNodesDirectory) || !isInside(customNodesDirectory, targetDirectory)) {
    throw new ComfyExtensionInstallError(
      'COMFYUI_EXTENSION_TARGET_INVALID',
      'ComfyUI 扩展安装目录无效。',
    );
  }
  return { customNodesDirectory, targetDirectory };
}

async function assertWritableTarget(targetDirectory) {
  const stats = await optionalLstat(targetDirectory);
  if (!stats) return;
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new ComfyExtensionInstallError(
      'COMFYUI_EXTENSION_TARGET_UNSAFE',
      '节点编号扩展目录不是普通文件夹，请手动检查后重试。',
    );
  }
}

async function writePackage(targetDirectory, files) {
  await mkdir(targetDirectory, { recursive: true });
  for (const relativePath of EXTENSION_FILES) {
    const targetPath = path.join(targetDirectory, ...relativePath.split('/'));
    await mkdir(path.dirname(targetPath), { recursive: true });
    const temporaryPath = `${targetPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, files.get(relativePath), { flag: 'wx' });
      await rename(temporaryPath, targetPath);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => {});
    }
  }
}

export function createComfyExtensionInstaller({
  sourceDirectory,
  detectInstallation,
  getProcessState = async () => ({ running: false }),
} = {}) {
  if (!sourceDirectory || typeof detectInstallation !== 'function') {
    throw new Error('sourceDirectory and detectInstallation are required');
  }
  let pendingInstall = null;

  async function inspect() {
    const bundle = await readPackage(path.resolve(sourceDirectory));
    let target;
    try {
      target = await resolveTarget(detectInstallation);
    } catch (error) {
      if (!(error instanceof ComfyExtensionInstallError)) throw error;
      return {
        id: EXTENSION_DIRECTORY,
        name: bundle.manifest.name,
        bundledVersion: bundle.manifest.version,
        status: 'unavailable',
        installable: false,
        diagnosticCode: error.code,
        message: error.message,
      };
    }
    await assertWritableTarget(target.targetDirectory);
    const installedFiles = await readInstalledFiles(target.targetDirectory);
    if (!installedFiles) {
      return {
        id: EXTENSION_DIRECTORY,
        name: bundle.manifest.name,
        bundledVersion: bundle.manifest.version,
        status: 'missing',
        installable: true,
      };
    }
    let installedVersion = null;
    try {
      const installedManifest = JSON.parse(installedFiles.get('manifest.json').toString('utf8'));
      installedVersion = typeof installedManifest?.version === 'string'
        ? installedManifest.version
        : null;
    } catch { /* 损坏的旧清单按“可更新”处理，由安装器修复。 */ }
    const upToDate = packageHash(installedFiles) === packageHash(bundle.files);
    return {
      id: EXTENSION_DIRECTORY,
      name: bundle.manifest.name,
      bundledVersion: bundle.manifest.version,
      installedVersion,
      status: upToDate ? 'up-to-date' : 'update-available',
      installable: true,
    };
  }

  async function installNow() {
    const bundle = await readPackage(path.resolve(sourceDirectory));
    const target = await resolveTarget(detectInstallation);
    await mkdir(target.customNodesDirectory, { recursive: true });
    await assertWritableTarget(target.targetDirectory);
    const installedFiles = await readInstalledFiles(target.targetDirectory);
    const previousHash = installedFiles ? packageHash(installedFiles) : null;
    const nextHash = packageHash(bundle.files);
    const changed = previousHash !== nextHash;
    if (changed) {
      await writePackage(target.targetDirectory, bundle.files);
      const verifiedFiles = await readInstalledFiles(target.targetDirectory);
      if (!verifiedFiles || packageHash(verifiedFiles) !== nextHash) {
        throw new ComfyExtensionInstallError(
          'COMFYUI_EXTENSION_VERIFY_FAILED',
          '节点编号扩展写入后校验失败，请检查 ComfyUI 目录权限。',
          500,
        );
      }
    }
    const processState = await Promise.resolve(getProcessState()).catch(() => ({ running: false }));
    return {
      id: EXTENSION_DIRECTORY,
      name: bundle.manifest.name,
      bundledVersion: bundle.manifest.version,
      installedVersion: bundle.manifest.version,
      status: changed ? (previousHash ? 'updated' : 'installed') : 'up-to-date',
      changed,
      restartRequired: changed && Boolean(processState?.running),
    };
  }

  return {
    inspect,
    install() {
      if (pendingInstall) return pendingInstall;
      pendingInstall = installNow().finally(() => { pendingInstall = null; });
      return pendingInstall;
    },
  };
}

export const COMFY_NODE_ID_EXTENSION_FILES = EXTENSION_FILES;
