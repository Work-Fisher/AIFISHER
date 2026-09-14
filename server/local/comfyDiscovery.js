import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { detectComfyInstallation } from './comfyProcess.js';

/** Bounded discovery of conventional installation folders, never a whole-disk crawl. */
export async function discoverComfyInstallations({ roots, configuredRoot = process.env.COMFYUI_ROOT, pythonOverride = process.env.COMFYUI_PYTHON } = {}) {
  const home = os.homedir();
  roots ||= [home, path.join(home, 'Desktop'), path.join(home, 'Downloads'), path.join(home, 'Documents'),
    ...(process.platform === 'win32' ? Array.from({ length: 24 }, (_, i) => `${String.fromCharCode(67 + i)}:/`) : ['/opt', '/Applications'])];
  const queue = [...(configuredRoot ? [{ root: configuredRoot, depth: 2 }] : []), ...roots.map(root => ({ root, depth: 0 }))];
  const seen = new Set(), candidates = [];
  let visited = 0;
  while (queue.length && visited++ < 400 && candidates.length < 20) {
    const { root, depth } = queue.shift();
    const resolved = path.resolve(root), key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) continue; seen.add(key);
    const result = detectComfyInstallation({ root: resolved, pythonOverride });
    if (result.ok) { candidates.push({ root: result.root, name: path.basename(result.root) }); continue; }
    if (depth >= 2) continue;
    const entries = await fs.readdir(resolved, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) if (entry.isDirectory() && !entry.isSymbolicLink() && /comfy|^ai$|^tools$|^apps$|^software$|整合包|绘世|绘图/i.test(entry.name))
      queue.push({ root: path.join(resolved, entry.name), depth: depth + 1 });
  }
  return { candidates, configuredRoot: configuredRoot || '', scope: '常见磁盘与用户目录中的 ComfyUI、整合包和工具目录，最多两层。未找到时可手动选择。' };
}
