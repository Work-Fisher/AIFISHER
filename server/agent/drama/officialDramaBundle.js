import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { RUNTIME_PATHS } from '../../workspace/runtimePaths.js';
import { OFFICIAL_PRODUCTION_PROFILES, productionProfileForBundle } from '../../../src/shared/officialProductionProfiles.js';

function deepFreeze(value) {
  Object.values(value).forEach((child) => {
    if (child && typeof child === 'object') deepFreeze(child);
  });
  return Object.freeze(value);
}

const field = (nodeId, fieldName) => ({ nodeId, fieldName });

// This is a routing contract, not an execution receipt or a source of model prices.
export const OFFICIAL_DRAMA_BUNDLE = deepFreeze({
  id: 'minimax-drama',
  version: '1.0.0',
  skillSlug: 'minimax-drama-prompt',
  source: 'official',
  characters: {
    provider: 'runninghub-cn',
    webAppId: '2052744677727715329',
    fields: {
      prompt: field('49', 'text'),
      width: field('60', 'value'),
      height: field('61', 'value'),
    },
  },
  scenes: { provider: 'relay', model: 'Seedream 5.0 Pro · API' },
  drama: {
    provider: 'runninghub-cn',
    webAppId: '2094859983199498241',
    fields: {
      prompt: field('528', 'prompt'),
      duration: field('529', 'value'),
      ratio: field('456', 'aspect_ratio'),
      megapixels: field('456', 'megapixels'),
      steps: field('324', 'value'),
    },
    images: ['526', '527', '525', '515', '475', '469'].map((nodeId, index) => ({
      name: `image${index + 1}`, ...field(nodeId, 'image'),
    })),
    audio: ['522', '523', '473'].map((nodeId, index) => ({
      name: `audio${index + 1}`, ...field(nodeId, 'audio'),
    })),
  },
});

export const OFFICIAL_DRAMA_SKILL_METADATA = Object.freeze({
  slug: OFFICIAL_DRAMA_BUNDLE.skillSlug,
  name: '剧本文戏',
  description: '官方推荐：剧本资产、即梦 5 场景、角色参考与 MiniMax H3 低配文戏。生成需逐阶段确认。',
  source: 'official',
  readOnly: true,
  version: OFFICIAL_DRAMA_BUNDLE.version,
  bundleId: OFFICIAL_DRAMA_BUNDLE.id,
  fileCount: 9,
  updatedAt: '',
});

// Verified against RH's public inputNodes: high edition has different node IDs.
// The fight app labels 529/value as steps, so never treat it as duration.
const HIGH_VIDEO_ROUTE = deepFreeze({ provider: 'runninghub-cn', webAppId: '2094860545999593474',
  fields: { prompt: field('167', 'prompt'), duration: field('163', 'value'), ratio: field('164', 'aspect_ratio'), megapixels: field('164', 'megapixels') },
  images: ['238', '237', '230', '218', '227', '217'].map((nodeId, index) => ({ name: `image${index + 1}`, ...field(nodeId, 'image') })),
  audio: ['225', '223', '222'].map((nodeId, index) => ({ name: `audio${index + 1}`, ...field(nodeId, 'audio') })),
});
const FIGHT_VIDEO_ROUTE = deepFreeze({ ...OFFICIAL_DRAMA_BUNDLE.drama, webAppId: '2094873524119883778',
  fields: { prompt: field('528', 'prompt'), ratio: field('456', 'aspect_ratio'), megapixels: field('456', 'megapixels'), steps: field('324', 'value') },
});
export function officialProductionBundle(bundleId = OFFICIAL_DRAMA_BUNDLE.id) {
  const profile = productionProfileForBundle(bundleId);
  if (!profile) throw new Error('官方制作组合不存在');
  if (profile.id === OFFICIAL_DRAMA_BUNDLE.id) return OFFICIAL_DRAMA_BUNDLE;
  return { ...OFFICIAL_DRAMA_BUNDLE, id: profile.id, version: profile.version, skillSlug: profile.slug,
    drama: profile.mode === 'assets' ? FIGHT_VIDEO_ROUTE : HIGH_VIDEO_ROUTE };
}
export const OFFICIAL_PRODUCTION_SKILLS = Object.freeze(OFFICIAL_PRODUCTION_PROFILES.map((profile) => Object.freeze({
  ...OFFICIAL_DRAMA_SKILL_METADATA, slug: profile.slug, name: profile.name, bundleId: profile.id,
  version: profile.version, fileCount: profile.mode === 'assets' ? 1 : 9,
  description: profile.id === 'minimax-drama' ? OFFICIAL_DRAMA_SKILL_METADATA.description
    : profile.mode === 'assets' ? '无需剧本：描述人物与场景，确认生成资产后连接 RH 武戏节点。视频单独运行。'
      : '与剧本文戏相同的制作流程，使用 RH 高配文戏应用。资产与视频逐阶段确认。',
})));

export const SKILL_INSTRUCTION_LIMITS = Object.freeze({
  rootBytes: Infinity,
  referenceBytes: Infinity,
  manifestBytes: Infinity,
  referenceCount: Infinity,
  totalBytes: Infinity,
});

// In production this module is folded into server/index.js, so module-relative
// paths are not stable. Use the same configured app root as the model catalog.
const officialDirectory = path.join(RUNTIME_PATHS.SERVER_DIR, 'agent', 'builtin', 'minimax-drama-prompt');

function instructionError(message) {
  return Object.assign(new Error(message), { code: 'INVALID_AGENT_SKILL_INSTRUCTIONS' });
}

export function parseSkillInstructionManifest(text) {
  if (text === undefined || text === null) return [];
  if (Buffer.byteLength(text, 'utf8') > SKILL_INSTRUCTION_LIMITS.manifestBytes) {
    throw instructionError('SKILL 参考清单超过大小限制');
  }
  let manifest;
  try { manifest = JSON.parse(text); } catch { throw instructionError('SKILL 参考清单不是有效 JSON'); }
  const references = manifest?.instructionReferences;
  if (!Array.isArray(references) || references.length > SKILL_INSTRUCTION_LIMITS.referenceCount) {
    throw instructionError('SKILL 参考清单必须显式声明文本文件');
  }
  for (const reference of references) {
    if (
      typeof reference !== 'string' || reference.length > 240 ||
      !/^references\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:md|txt)$/.test(reference)
    ) {
      throw instructionError('SKILL 只允许 references/ 内明确声明的 Markdown 或文本参考');
    }
  }
  if (new Set(references.map((reference) => reference.toLowerCase())).size !== references.length) {
    throw instructionError('SKILL 参考清单不能包含重复文件');
  }
  return references;
}

async function readBoundedFile(directory, relative, limit, { optional = false } = {}) {
  const rootStat = await fs.lstat(directory);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw instructionError('SKILL 根目录不能是链接');
  }
  const realRoot = await fs.realpath(directory);
  let filename = directory;
  let expectedStat;
  const parts = relative.split('/');
  for (let index = 0; index < parts.length; index += 1) {
    filename = path.join(filename, parts[index]);
    let stat;
    try { stat = await fs.lstat(filename); } catch (error) {
      if (optional && error?.code === 'ENOENT') return null;
      throw instructionError('SKILL 声明的指令文件不存在或无法读取');
    }
    if (stat.isSymbolicLink() || (index < parts.length - 1 && !stat.isDirectory())) {
      throw instructionError('SKILL 指令文件不能经过符号链接');
    }
    if (index === parts.length - 1 && (!stat.isFile() || stat.size > limit)) {
      throw instructionError('SKILL 指令文件不是常规文本或超过大小限制');
    }
    expectedStat = stat;
  }
  const realFilename = await fs.realpath(filename);
  const contained = path.relative(realRoot, realFilename);
  if (!contained || contained === '..' || contained.startsWith(`..${path.sep}`) || path.isAbsolute(contained)) {
    throw instructionError('SKILL 指令文件不能越出技能目录');
  }
  // Validate the opened file identity as well as its path. A concurrent replacement
  // must not turn a checked reference into a read through an outside symlink.
  const handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const openedStat = await handle.stat();
    if (
      !openedStat.isFile() || openedStat.size > limit ||
      openedStat.ino !== expectedStat.ino || openedStat.dev !== expectedStat.dev ||
      await fs.realpath(filename) !== realFilename
    ) throw instructionError('SKILL 指令文件在读取期间发生变化');
    const readLimit = Math.min(limit, openedStat.size);
    const buffer = Buffer.alloc(readLimit + 1);
    let bytes = 0;
    while (bytes <= readLimit) {
      const result = await handle.read(buffer, bytes, buffer.length - bytes, null);
      if (!result.bytesRead) break;
      bytes += result.bytesRead;
    }
    const content = buffer.subarray(0, bytes);
    if (bytes !== openedStat.size || content.includes(0)) {
      throw instructionError('SKILL 指令文件不是有效文本或超过大小限制');
    }
    return content.toString('utf8');
  } finally {
    await handle.close();
  }
}

// No recursive discovery, Markdown-link following, shell evaluation, or script execution.
export async function readSkillInstructionFiles(directory) {
  const limits = SKILL_INSTRUCTION_LIMITS;
  const root = await readBoundedFile(directory, 'SKILL.md', limits.rootBytes);
  if (!root.trim()) throw instructionError('SKILL.md 不能为空');
  const manifest = await readBoundedFile(directory, 'agent-skill.json', limits.manifestBytes, { optional: true });
  const references = parseSkillInstructionManifest(manifest);
  const sections = [root];
  let totalBytes = Buffer.byteLength(root, 'utf8');
  for (const reference of references) {
    const text = await readBoundedFile(directory, reference, limits.referenceBytes);
    totalBytes += Buffer.byteLength(text, 'utf8');
    if (totalBytes > limits.totalBytes) throw instructionError('SKILL 指令与参考合计超过 128 KB');
    sections.push(`### 参考文件：${reference}\n${text}`);
  }
  return sections.join('\n\n');
}

export async function readOfficialDramaInstructions(bundleId = 'minimax-drama') {
  const profile = productionProfileForBundle(bundleId);
  if (!profile) throw instructionError('官方制作组合不存在');
  const assets = "";
  if (profile.mode === 'assets') return (await readSkillInstructionFiles(path.join(RUNTIME_PATHS.SERVER_DIR, 'agent', 'builtin', 'minimax-fight-assets'))) + '\n\n' + assets;
  const instructions = (await readSkillInstructionFiles(officialDirectory)) + '\n\n' + assets;
  return profile.id === 'minimax-drama' ? instructions : instructions.replaceAll('2094859983199498241', profile.webAppId).replaceAll('低配文戏', '高配文戏');
}

