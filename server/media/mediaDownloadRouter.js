import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import {
  access,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import express from 'express';
import { getAuthenticatedRequest } from '../security/localAuthentication.js';
import {
  DirectoryGrantError,
  selectDirectoryWithSystemDialog,
} from '../workflowRuntime/directoryGrantStore.js';

const execFileAsync = promisify(execFile);
const SETTINGS_FILE = 'download-settings.json';
const MEDIA_EXTENSION = new Set([
  '.aac', '.avif', '.bmp', '.flac', '.gif', '.heic', '.heif', '.jpeg', '.jpg', '.m4a',
  '.m4v', '.mkv', '.mov', '.mp3', '.mp4', '.ogg', '.png', '.tif', '.tiff', '.wav',
  '.webm', '.webp',
]);
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu;

class MediaDownloadError extends Error {
  constructor(message, code = 'DOWNLOAD_FAILED', status = 400) {
    super(message);
    this.name = 'MediaDownloadError';
    this.code = code;
    this.status = status;
  }
}

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function safeDialogText(value) {
  return String(value || '').replace(/[\r\n\0]/gu, ' ').slice(0, 240).replaceAll("'", "''");
}

export function sanitizeDownloadFileName(value, actualExtension) {
  const raw = String(value || '').trim();
  if (!raw || raw.includes('\0') || /(^|[\\/])\.\.([\\/]|$)/u.test(raw)) {
    throw new MediaDownloadError('下载文件名无效', 'DOWNLOAD_FILENAME_INVALID');
  }
  const extension = String(actualExtension || '').toLowerCase();
  if (!MEDIA_EXTENSION.has(extension)) {
    throw new MediaDownloadError('素材扩展名不受支持', 'DOWNLOAD_MEDIA_UNSUPPORTED', 415);
  }
  const requestedExtension = path.extname(raw).toLowerCase();
  const withoutExtension = requestedExtension ? raw.slice(0, -requestedExtension.length) : raw;
  const cleaned = Array.from(withoutExtension
    .replace(/\|/gu, '丨')
    .replace(/:/gu, '：')
    .replace(/[\\/]/gu, '-')
    .replace(/[<>"?*]/gu, ''))
    .filter((character) => (character.codePointAt(0) ?? 0) >= 32)
    .join('')
    .replace(/\s+/gu, ' ')
    .replace(/[. ]+$/gu, '')
    .slice(0, 150)
    .replace(/[. ]+$/gu, '');
  if (!cleaned) throw new MediaDownloadError('下载文件名无效', 'DOWNLOAD_FILENAME_INVALID');
  const base = WINDOWS_RESERVED_NAME.test(cleaned) ? `_${cleaned}` : cleaned;
  return `${base}${extension}`;
}

async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
  await rename(temporary, filePath);
}

function settingsPath(scope) {
  return path.join(scope.configDirectory, SETTINGS_FILE);
}

async function readSettings(scope) {
  try {
    const value = JSON.parse(await readFile(settingsPath(scope), 'utf8'));
    return {
      customDirectory: typeof value.customDirectory === 'string' ? value.customDirectory : null,
      askEachTime: value.askEachTime === true,
      lastDownloadDirectory:
        typeof value.lastDownloadDirectory === 'string' ? value.lastDownloadDirectory : null,
      lastDownloadedFile:
        typeof value.lastDownloadedFile === 'string' ? value.lastDownloadedFile : null,
    };
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) {
      return {
        customDirectory: null,
        askEachTime: false,
        lastDownloadDirectory: null,
        lastDownloadedFile: null,
      };
    }
    throw error;
  }
}

async function saveSettings(scope, settings) {
  await writeJsonAtomic(settingsPath(scope), {
    schemaVersion: 1,
    customDirectory: settings.customDirectory || null,
    askEachTime: settings.askEachTime === true,
    lastDownloadDirectory: settings.lastDownloadDirectory || null,
    lastDownloadedFile: settings.lastDownloadedFile || null,
  });
}

async function validateDirectory(directory, { create = false } = {}) {
  const candidate = path.resolve(String(directory || ''));
  if (!directory || !path.isAbsolute(candidate)) {
    throw new MediaDownloadError('下载目录无效，请重新选择', 'DOWNLOAD_DIRECTORY_INVALID');
  }
  if (create) await mkdir(candidate, { recursive: true });
  const info = await lstat(candidate).catch(() => null);
  if (!info?.isDirectory() || info.isSymbolicLink()) {
    throw new MediaDownloadError('下载目录不存在或不可用，请重新选择', 'DOWNLOAD_DIRECTORY_UNAVAILABLE', 409);
  }
  const resolved = await realpath(candidate).catch(() => null);
  if (!resolved) {
    throw new MediaDownloadError('下载目录不可访问，请重新选择', 'DOWNLOAD_DIRECTORY_UNAVAILABLE', 409);
  }
  const probe = path.join(resolved, `.aifisher-write-${crypto.randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(probe, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
  } catch (error) {
    if (['EACCES', 'EPERM', 'EROFS'].includes(error?.code)) {
      throw new MediaDownloadError('下载目录不可写，请重新选择', 'DOWNLOAD_DIRECTORY_UNWRITABLE', 409);
    }
    throw error;
  } finally {
    await handle?.close();
    await rm(probe, { force: true }).catch(() => undefined);
  }
  return resolved;
}

async function resolveMediaSource(scope, sourceUrl) {
  const raw = String(sourceUrl || '').trim();
  let parsed;
  try {
    parsed = new URL(raw, 'http://aifisher.local');
  } catch {
    throw new MediaDownloadError('下载地址无效', 'DOWNLOAD_SOURCE_INVALID');
  }
  if (
    parsed.origin !== 'http://aifisher.local'
    || !raw.startsWith('/library/')
    || !parsed.pathname.startsWith('/library/')
  ) {
    throw new MediaDownloadError('只允许下载当前账号的本机素材', 'DOWNLOAD_SOURCE_INVALID');
  }
  let relative;
  try {
    relative = decodeURIComponent(parsed.pathname.slice('/library/'.length));
  } catch {
    throw new MediaDownloadError('下载地址编码无效', 'DOWNLOAD_SOURCE_INVALID');
  }
  if (!relative || relative.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new MediaDownloadError('下载地址无效', 'DOWNLOAD_SOURCE_INVALID');
  }
  const libraryRoot = await realpath(scope.libraryDirectory).catch(() => null);
  if (!libraryRoot) {
    throw new MediaDownloadError('当前素材库不可访问', 'DOWNLOAD_SOURCE_FORBIDDEN', 403);
  }
  const candidate = path.resolve(libraryRoot, ...relative.split('/'));
  if (!isInside(libraryRoot, candidate)) {
    throw new MediaDownloadError('下载地址超出当前素材库', 'DOWNLOAD_SOURCE_INVALID', 403);
  }
  const info = await lstat(candidate).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) {
    throw new MediaDownloadError('素材文件不存在，请重新生成或重新导入', 'DOWNLOAD_SOURCE_MISSING', 404);
  }
  const resolved = await realpath(candidate).catch(() => null);
  if (!resolved || !isInside(libraryRoot, resolved)) {
    throw new MediaDownloadError('素材访问权限失效', 'DOWNLOAD_SOURCE_FORBIDDEN', 403);
  }
  const extension = path.extname(resolved).toLowerCase();
  if (!MEDIA_EXTENSION.has(extension)) {
    throw new MediaDownloadError('素材格式不支持下载', 'DOWNLOAD_MEDIA_UNSUPPORTED', 415);
  }
  return { path: resolved, extension };
}

async function uniqueDestination(directory, fileName) {
  const extension = path.extname(fileName);
  const base = fileName.slice(0, -extension.length);
  for (let index = 0; index < 10_000; index += 1) {
    const candidate = path.join(directory, index === 0 ? fileName : `${base} (${index})${extension}`);
    try {
      await access(candidate, constants.F_OK);
    } catch (error) {
      if (error?.code === 'ENOENT') return candidate;
      throw error;
    }
  }
  throw new MediaDownloadError('同名下载文件过多，请更换文件名', 'DOWNLOAD_NAME_EXHAUSTED', 409);
}

async function resolveLastDownloadedFile(directory, candidate) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) return null;
  const info = await lstat(candidate).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) return null;
  const resolved = await realpath(candidate).catch(() => null);
  if (!resolved || !isInside(directory, resolved)) return null;
  const relative = path.relative(directory, resolved);
  if (!relative || path.dirname(relative) !== '.') return null;
  return resolved;
}

export async function selectSavePathWithSystemDialog({
  suggestedFileName,
  initialDirectory,
  runCommand = execFileAsync,
  platform = process.platform,
} = {}) {
  if (platform !== 'win32') {
    throw new MediaDownloadError('当前系统暂不支持保存位置选择', 'DOWNLOAD_DIALOG_UNAVAILABLE', 501);
  }
  const safeName = safeDialogText(suggestedFileName);
  const safeDirectory = safeDialogText(initialDirectory);
  const extension = safeDialogText(path.extname(suggestedFileName).slice(1) || '*');
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$owner = New-Object System.Windows.Forms.Form',
    '$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen',
    '$owner.ShowInTaskbar = $false',
    '$owner.TopMost = $true',
    "$owner.Text = 'AIFISHER 画布'",
    '$owner.Width = 1',
    '$owner.Height = 1',
    '$dialog = New-Object System.Windows.Forms.SaveFileDialog',
    `$dialog.FileName = '${safeName}'`,
    `$dialog.InitialDirectory = '${safeDirectory}'`,
    `$dialog.Filter = '媒体文件|*.${extension}|所有文件|*.*'`,
    '$dialog.CheckPathExists = $true',
    '$dialog.OverwritePrompt = $false',
    '$owner.Show()',
    '$owner.Activate()',
    '$result = $dialog.ShowDialog($owner)',
    '$owner.Close()',
    '$owner.Dispose()',
    'if ($result -eq [System.Windows.Forms.DialogResult]::OK) {',
    '  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '  Write-Output $dialog.FileName',
    '}',
  ].join('\n');
  const { stdout } = await runCommand('powershell.exe', [
    '-NoProfile', '-WindowStyle', 'Hidden', '-STA', '-Command', script,
  ], { windowsHide: true, timeout: 2 * 60_000, maxBuffer: 64 * 1024 });
  const selected = String(stdout || '').trim();
  return selected || null;
}

export async function openDirectoryWithExplorer(
  directory,
  selectedFile = null,
  { runCommand = execFileAsync, platform = process.platform } = {},
) {
  if (platform !== 'win32') {
    throw new MediaDownloadError('当前系统暂不支持打开下载目录', 'DOWNLOAD_OPEN_UNAVAILABLE', 501);
  }
  const encodedDirectory = Buffer.from(directory, 'utf8').toString('base64');
  const encodedSelectedFile = selectedFile
    ? Buffer.from(selectedFile, 'utf8').toString('base64')
    : null;
  const script = [
    '$ErrorActionPreference = \'Stop\'',
    `$directory = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedDirectory}'))`,
    encodedSelectedFile
      ? `$selectedFile = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedSelectedFile}'))`
      : '$selectedFile = $null',
    '$source = @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class AIFisherDownloadShell {',
    '  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr window, int command);',
    '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);',
    '  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr window, IntPtr insertAfter, int x, int y, int width, int height, uint flags);',
    '}',
    '"@',
    'Add-Type -TypeDefinition $source',
    '$shell = New-Object -ComObject Shell.Application',
    '$target = [IO.Path]::GetFullPath($directory).TrimEnd([IO.Path]::DirectorySeparatorChar)',
    '$targetWindow = $null',
    'foreach ($window in @($shell.Windows())) {',
    '  try {',
    '    $candidate = [IO.Path]::GetFullPath([string]$window.Document.Folder.Self.Path).TrimEnd([IO.Path]::DirectorySeparatorChar)',
    '    if ([StringComparer]::OrdinalIgnoreCase.Equals($candidate, $target)) {',
    '      $targetWindow = $window',
    '      break',
    '    }',
    '  } catch { }',
    '}',
    'if ($targetWindow) {',
    '  if ($selectedFile) {',
    '    $item = $targetWindow.Document.Folder.ParseName([IO.Path]::GetFileName($selectedFile))',
    '    if ($item) { $targetWindow.Document.SelectItem($item, 29) }',
    '  }',
    '} elseif ($selectedFile) {',
    '  Start-Process -FilePath "explorer.exe" -ArgumentList (\'/select,"\' + $selectedFile + \'"\')',
    '} else {',
    '  $shell.Open($directory)',
    '}',
    '$seen = $false',
    '$foreground = $false',
    'for ($attempt = 0; $attempt -lt 30 -and -not $foreground; $attempt += 1) {',
    '  $candidateWindows = if ($targetWindow) { @($targetWindow) } else { @($shell.Windows()) }',
    '  foreach ($window in $candidateWindows) {',
    '    try {',
    '      $candidate = [IO.Path]::GetFullPath([string]$window.Document.Folder.Self.Path).TrimEnd([IO.Path]::DirectorySeparatorChar)',
    '      if ([StringComparer]::OrdinalIgnoreCase.Equals($candidate, $target)) {',
    '        $seen = $true',
    '        $handle = [IntPtr][int64]$window.HWND',
    '        [void][AIFisherDownloadShell]::ShowWindowAsync($handle, 9)',
    '        $foreground = [AIFisherDownloadShell]::SetForegroundWindow($handle)',
    '        if ($foreground) { break }',
    '      }',
    '    } catch { }',
    '  }',
    '  if (-not $foreground) { Start-Sleep -Milliseconds 100 }',
    '}',
    'if ($seen -and -not $foreground) {',
    '  $flags = 0x0001 -bor 0x0002 -bor 0x0040',
    '  [void][AIFisherDownloadShell]::SetWindowPos($handle, [IntPtr](-1), 0, 0, 0, 0, $flags)',
    '  Start-Sleep -Milliseconds 80',
    '  [void][AIFisherDownloadShell]::SetWindowPos($handle, [IntPtr](-2), 0, 0, 0, 0, $flags)',
    '}',
    'if (-not $seen) { throw "资源管理器没有打开目标目录" }',
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    'Write-Output $(if ($foreground) { "foreground" } else { "background" })',
  ].join('\n');
  let stdout;
  try {
    ({ stdout } = await runCommand('powershell.exe', [
      '-NoProfile', '-WindowStyle', 'Hidden', '-STA', '-Command', script,
    ], { windowsHide: true, timeout: 15_000, maxBuffer: 64 * 1024 }));
  } catch {
    throw new MediaDownloadError(
      '无法打开下载目录，请稍后重试',
      'DOWNLOAD_OPEN_FAILED',
      500,
    );
  }
  const result = String(stdout || '').trim().split(/\r?\n/u).filter(Boolean).at(-1);
  if (!['foreground', 'background'].includes(result)) {
    throw new MediaDownloadError(
      '下载目录打开结果无效，请稍后重试',
      'DOWNLOAD_OPEN_FAILED',
      500,
    );
  }
  return { foreground: result === 'foreground' };
}

function publicSettings(settings, defaults, directoryAvailable = true) {
  const directory = settings.customDirectory || defaults;
  return {
    directory,
    defaultDirectory: defaults,
    customDirectory: Boolean(settings.customDirectory),
    askEachTime: settings.askEachTime,
    directoryAvailable,
  };
}

function sendError(response, error) {
  const known = error instanceof MediaDownloadError || error instanceof DirectoryGrantError;
  const status = known
    ? Number(error.status || 400)
    : error?.code === 'ENOSPC'
      ? 507
      : ['EACCES', 'EPERM', 'EROFS'].includes(error?.code)
        ? 409
        : 500;
  const code = known
    ? error.code
    : error?.code === 'ENOSPC'
      ? 'DOWNLOAD_DISK_FULL'
      : ['EACCES', 'EPERM', 'EROFS'].includes(error?.code)
        ? 'DOWNLOAD_SAVE_FORBIDDEN'
        : 'DOWNLOAD_SAVE_FAILED';
  const message = known
    ? error.message
    : code === 'DOWNLOAD_DISK_FULL'
      ? '磁盘空间不足，无法保存文件'
      : code === 'DOWNLOAD_SAVE_FORBIDDEN'
        ? '文件保存失败，请重新选择可写目录'
        : '文件保存失败，请稍后重试';
  response.status(status).json({ error: message, code });
}

export function createMediaDownloadRouter({
  resolveScope = (request) => getAuthenticatedRequest(request).scope,
  defaultDirectory = () => path.join(os.homedir(), 'Downloads'),
  selectDirectory = () => selectDirectoryWithSystemDialog({ description: '选择 AIFISHER 下载目录' }),
  selectSavePath = selectSavePathWithSystemDialog,
  openDirectory = openDirectoryWithExplorer,
} = {}) {
  const router = express.Router();

  router.get('/settings', async (request, response) => {
    try {
      const scope = resolveScope(request);
      const settings = await readSettings(scope);
      const defaults = path.resolve(defaultDirectory());
      const directory = settings.customDirectory || defaults;
      const available = Boolean(await lstat(directory).catch(() => null));
      response.json(publicSettings(settings, defaults, available));
    } catch (error) {
      sendError(response, error);
    }
  });

  router.patch('/settings', async (request, response) => {
    try {
      if (typeof request.body?.askEachTime !== 'boolean') {
        throw new MediaDownloadError('下载设置无效', 'DOWNLOAD_SETTINGS_INVALID');
      }
      const scope = resolveScope(request);
      const settings = await readSettings(scope);
      settings.askEachTime = request.body.askEachTime;
      await saveSettings(scope, settings);
      response.json(publicSettings(settings, path.resolve(defaultDirectory())));
    } catch (error) {
      sendError(response, error);
    }
  });

  router.post('/settings/directory', async (request, response) => {
    try {
      const scope = resolveScope(request);
      let selected;
      try {
        selected = await selectDirectory();
      } catch (error) {
        if (error?.code === 'DIRECTORY_PICKER_CANCELLED') {
          response.json({ status: 'cancelled' });
          return;
        }
        throw error;
      }
      if (!selected) {
        response.json({ status: 'cancelled' });
        return;
      }
      const directory = await validateDirectory(selected);
      const settings = await readSettings(scope);
      settings.customDirectory = directory;
      await saveSettings(scope, settings);
      response.json({ status: 'selected', ...publicSettings(settings, path.resolve(defaultDirectory())) });
    } catch (error) {
      sendError(response, error);
    }
  });

  router.delete('/settings/directory', async (request, response) => {
    try {
      const scope = resolveScope(request);
      const settings = await readSettings(scope);
      settings.customDirectory = null;
      await saveSettings(scope, settings);
      response.json(publicSettings(settings, path.resolve(defaultDirectory())));
    } catch (error) {
      sendError(response, error);
    }
  });

  router.post('/save', async (request, response) => {
    try {
      const scope = resolveScope(request);
      const source = await resolveMediaSource(scope, request.body?.sourceUrl);
      let fileName = sanitizeDownloadFileName(request.body?.fileName, source.extension);
      const settings = await readSettings(scope);
      const defaults = path.resolve(defaultDirectory());
      let directory;
      let requestedPath = null;
      if (settings.askEachTime) {
        requestedPath = await selectSavePath({
          suggestedFileName: fileName,
          initialDirectory: settings.customDirectory || defaults,
        });
        if (!requestedPath) {
          response.json({ status: 'cancelled' });
          return;
        }
        directory = await validateDirectory(path.dirname(path.resolve(requestedPath)));
        fileName = sanitizeDownloadFileName(path.basename(requestedPath), source.extension);
      } else {
        directory = await validateDirectory(settings.customDirectory || defaults, {
          create: !settings.customDirectory,
        });
      }
      let destination = await uniqueDestination(directory, fileName);
      try {
        await copyFile(source.path, destination, constants.COPYFILE_EXCL);
      } catch (error) {
        if (error?.code === 'EEXIST') {
          destination = await uniqueDestination(directory, fileName);
          await copyFile(source.path, destination, constants.COPYFILE_EXCL);
        } else {
          throw error;
        }
      }
      fileName = path.basename(destination);
      settings.lastDownloadDirectory = directory;
      settings.lastDownloadedFile = destination;
      await saveSettings(scope, settings).catch(() => undefined);
      response.json({ status: 'saved', fileName, directory });
    } catch (error) {
      sendError(response, error);
    }
  });

  router.post('/open-directory', async (request, response) => {
    try {
      const scope = resolveScope(request);
      const settings = await readSettings(scope);
      const defaults = path.resolve(defaultDirectory());
      const directory = await validateDirectory(
        settings.lastDownloadDirectory || settings.customDirectory || defaults,
        { create: !settings.lastDownloadDirectory && !settings.customDirectory },
      );
      const selectedFile = await resolveLastDownloadedFile(
        directory,
        settings.lastDownloadedFile,
      );
      const opened = await openDirectory(directory, selectedFile);
      response.json({
        status: 'opened',
        foreground: opened?.foreground !== false,
        fileName: selectedFile ? path.basename(selectedFile) : null,
        directory,
      });
    } catch (error) {
      sendError(response, error);
    }
  });

  return router;
}
