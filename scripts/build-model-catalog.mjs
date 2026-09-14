/**
 * 用项目既有 TypeScript 工具链求值 modelConfig.ts，并一次产出：
 * 1. 便携包后端读取的运行快照；
 * 2. 同一次求值得到的结构化模型列表，供稳定 bundle 注入使用。
 *
 * 第二份只是构建中间件，写入已被 Git 忽略的 node_modules/.cache；
 * 便携包仍只读 server/config/modelCatalog.generated.json。
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createModelCatalog } from '../server/config/modelCatalog.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'src', 'config', 'modelConfig.ts');
const OUTPUT = path.join(ROOT, 'server', 'config', 'modelCatalog.generated.json');
const ENTRIES_CACHE = path.join(
  ROOT,
  'node_modules',
  '.cache',
  'aifisher',
  'modelCatalog.entries.generated.json',
);
const MODEL_LIST_NAMES = ['TEXT_MODELS', 'IMAGE_MODELS', 'AUDIO_MODELS', 'VIDEO_MODELS'];

const source = readFileSync(SOURCE, 'utf8');
const compiled = await build({
  entryPoints: [SOURCE],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'silent',
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(
  compiled.outputFiles[0].contents,
).toString('base64')}`;
const evaluated = await import(moduleUrl);
const modelLists = Object.fromEntries(
  MODEL_LIST_NAMES.map((name) => [name, evaluated[name]]),
);

for (const [name, entries] of Object.entries(modelLists)) {
  if (!Array.isArray(entries)) throw new Error(`${name} 没有求值为数组。`);
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string' || !entry.name) {
      throw new Error(`${name} 包含缺少 name 的模型条目。`);
    }
  }
}

const totalEntries = Object.values(modelLists).reduce((sum, entries) => sum + entries.length, 0);
const catalog = createModelCatalog(modelLists);
const names = Object.keys(catalog);
if (names.length !== totalEntries) {
  throw new Error(
    `模型列表共 ${totalEntries} 条，运行快照只有 ${names.length} 条；`
    + '请检查空名或重名条目。',
  );
}

mkdirSync(path.dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
mkdirSync(path.dirname(ENTRIES_CACHE), { recursive: true });
writeFileSync(ENTRIES_CACHE, `${JSON.stringify({
  sourceSha256: createHash('sha256').update(source).digest('hex'),
  modelLists,
}, null, 2)}\n`, 'utf8');

console.log(`[ModelCatalog] 已写出 ${names.length} 个模型 → server/config/modelCatalog.generated.json`);
