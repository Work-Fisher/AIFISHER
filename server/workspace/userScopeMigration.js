import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { setTimeout as wait } from 'node:timers/promises';

const MANIFEST_NAME = '.aifisher-user-scope-migration.json';
const MIGRATION_VERSION = 1;
const LEGACY_ROOTS = Object.freeze(['library', 'private']);
const TRANSIENT_RENAME_CODES = new Set(['EACCES', 'EBUSY', 'EPERM']);
const RENAME_RETRY_DELAYS_MS = Object.freeze([10, 25, 50, 100, 200]);

export class UserScopeMigrationError extends Error {
  constructor(message, code = 'USER_SCOPE_MIGRATION_FAILED') {
    super(message);
    this.name = 'UserScopeMigrationError';
    this.code = code;
  }
}

function slash(value) {
  return value.split(path.sep).join('/');
}

function contained(rootDirectory, candidate) {
  const root = path.resolve(rootDirectory);
  const target = path.resolve(candidate);
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function assertContained(rootDirectory, candidate, code = 'MIGRATION_PATH_ESCAPE') {
  if (!contained(rootDirectory, candidate)) {
    throw new UserScopeMigrationError('迁移路径越出预期根目录', code);
  }
  return path.resolve(candidate);
}

async function sha256(filePath) {
  return crypto.createHash('sha256').update(await readFile(filePath)).digest('hex');
}

async function renameDirectoryWithRetry(source, target) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, target);
      return;
    } catch (error) {
      if (!TRANSIENT_RENAME_CODES.has(error?.code) || attempt >= RENAME_RETRY_DELAYS_MS.length) {
        throw error;
      }
      await wait(RENAME_RETRY_DELAYS_MS[attempt]);
    }
  }
}

async function inventoryDirectory(rootDirectory, prefix, entries, directories) {
  if (!fs.existsSync(rootDirectory)) return;
  const rootStats = await lstat(rootDirectory);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new UserScopeMigrationError('旧资源根目录必须是普通目录', 'MIGRATION_UNSAFE_SOURCE');
  }
  directories.push(prefix);
  const children = await readdir(rootDirectory, { withFileTypes: true });
  children.sort((left, right) => left.name.localeCompare(right.name));
  for (const child of children) {
    const sourcePath = path.join(rootDirectory, child.name);
    const relativePath = `${prefix}/${child.name}`;
    if (child.isSymbolicLink()) {
      throw new UserScopeMigrationError('迁移源包含符号链接或目录联接', 'MIGRATION_UNSAFE_SOURCE');
    }
    if (child.isDirectory()) {
      await inventoryDirectory(sourcePath, relativePath, entries, directories);
      continue;
    }
    if (!child.isFile()) {
      throw new UserScopeMigrationError('迁移源包含不支持的文件类型', 'MIGRATION_UNSAFE_SOURCE');
    }
    const fileStats = await stat(sourcePath);
    entries.push({
      relativePath: slash(relativePath),
      size: fileStats.size,
      sha256: await sha256(sourcePath),
    });
  }
}

function planFingerprint(plan) {
  return crypto.createHash('sha256').update(JSON.stringify({
    version: plan.version,
    opaqueUserId: plan.opaqueUserId,
    directories: plan.directories,
    entries: plan.entries,
  })).digest('hex');
}

function assertPlanIntegrity(plan) {
  if (!plan || plan.version !== MIGRATION_VERSION || plan.planId !== planFingerprint(plan)) {
    throw new UserScopeMigrationError('迁移计划已损坏或被篡改', 'MIGRATION_PLAN_INVALID');
  }
  for (const relativePath of [
    ...plan.directories,
    ...plan.entries.map((entry) => entry.relativePath),
  ]) {
    const normalized = path.posix.normalize(String(relativePath || ''));
    if (!normalized || normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/')) {
      throw new UserScopeMigrationError('迁移计划包含越界路径', 'MIGRATION_PLAN_INVALID');
    }
  }
}

async function listTargetEntries(rootDirectory, prefix = '') {
  if (!fs.existsSync(rootDirectory)) return [];
  const rootStats = await lstat(rootDirectory);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new UserScopeMigrationError('迁移目标根不是普通目录', 'MIGRATION_UNSAFE_TARGET');
  }
  const results = [];
  const children = await readdir(rootDirectory, { withFileTypes: true });
  children.sort((left, right) => left.name.localeCompare(right.name));
  for (const child of children) {
    const relativePath = prefix ? `${prefix}/${child.name}` : child.name;
    const candidate = path.join(rootDirectory, child.name);
    if (child.isSymbolicLink()) {
      throw new UserScopeMigrationError('迁移目标包含符号链接或目录联接', 'MIGRATION_UNSAFE_TARGET');
    }
    if (child.isDirectory()) {
      results.push({ relativePath: slash(relativePath), type: 'directory' });
      results.push(...await listTargetEntries(candidate, relativePath));
    } else if (child.isFile()) results.push({ relativePath: slash(relativePath), type: 'file' });
    else throw new UserScopeMigrationError('迁移目标包含不支持的文件类型', 'MIGRATION_UNSAFE_TARGET');
  }
  return results;
}

async function resolveProspectiveRealPath(candidate) {
  let existingAncestor = path.resolve(candidate);
  const missingSegments = [];
  while (!fs.existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) {
      throw new UserScopeMigrationError('无法解析迁移路径', 'MIGRATION_FIXTURE_ONLY');
    }
    missingSegments.unshift(path.basename(existingAncestor));
    existingAncestor = parent;
  }
  return path.join(await realpath(existingAncestor), ...missingSegments);
}

async function assertFixtureOnly(sourceRoot, targetRoot) {
  const temporaryRoot = await realpath(os.tmpdir());
  const resolvedSource = await resolveProspectiveRealPath(sourceRoot);
  const resolvedTarget = await resolveProspectiveRealPath(targetRoot);
  if (!contained(temporaryRoot, resolvedSource) || !contained(temporaryRoot, resolvedTarget)) {
    throw new UserScopeMigrationError(
      'G3 只允许在系统临时目录的夹具上执行 apply/rollback',
      'MIGRATION_FIXTURE_ONLY',
    );
  }
}

export function createUserScopeMigrator({ sourceRoot, userScopeResolver }) {
  if (!sourceRoot || !userScopeResolver?.resolve) {
    throw new UserScopeMigrationError('迁移源或用户作用域解析器缺失', 'MIGRATION_CONFIG_INVALID');
  }
  const legacyRoot = path.resolve(sourceRoot);

  function scopeFor(authenticationContext) {
    return userScopeResolver.resolve(authenticationContext);
  }

  async function plan(authenticationContext) {
    const scope = scopeFor(authenticationContext);
    const legacyRootStats = await lstat(legacyRoot);
    if (legacyRootStats.isSymbolicLink() || !legacyRootStats.isDirectory()) {
      throw new UserScopeMigrationError('迁移源根必须是普通目录', 'MIGRATION_UNSAFE_SOURCE');
    }
    const entries = [];
    const directories = [];
    for (const rootName of LEGACY_ROOTS) {
      await inventoryDirectory(path.join(legacyRoot, rootName), rootName, entries, directories);
    }
    entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    directories.sort((left, right) => left.localeCompare(right));
    const migrationPlan = {
      version: MIGRATION_VERSION,
      opaqueUserId: scope.opaqueUserId,
      sourceRoot: legacyRoot,
      targetRoot: scope.rootDirectory,
      publicLibraryUrl: '/library',
      directories,
      entries,
      manualReview: fs.existsSync(path.join(legacyRoot, '.env'))
        ? [{ resource: 'mixed-runtime-config', action: 'split-provider-secrets-before-cutover' }]
        : [],
    };
    migrationPlan.planId = planFingerprint(migrationPlan);
    return Object.freeze(migrationPlan);
  }

  async function verify(migrationPlan, authenticationContext) {
    assertPlanIntegrity(migrationPlan);
    const scope = scopeFor(authenticationContext);
    if (scope.opaqueUserId !== migrationPlan.opaqueUserId || scope.rootDirectory !== migrationPlan.targetRoot) {
      throw new UserScopeMigrationError('认证用户与迁移目标不一致', 'MIGRATION_IDENTITY_MISMATCH');
    }
    const failures = [];
    const manifestPath = path.join(scope.rootDirectory, MANIFEST_NAME);
    if (!fs.existsSync(manifestPath)) {
      return { ok: false, planId: migrationPlan.planId, failures: ['manifest-missing'] };
    }
    let manifest;
    try {
      const manifestStats = await lstat(manifestPath);
      if (manifestStats.isSymbolicLink() || !manifestStats.isFile()) throw new Error('unsafe manifest');
      manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    } catch {
      return { ok: false, planId: migrationPlan.planId, failures: ['manifest-invalid'] };
    }
    if (manifest.planId !== migrationPlan.planId || manifest.opaqueUserId !== scope.opaqueUserId) {
      failures.push('manifest-mismatch');
    }
    for (const entry of migrationPlan.entries) {
      const targetPath = assertContained(scope.rootDirectory, path.join(
        scope.rootDirectory,
        ...entry.relativePath.split('/'),
      ));
      if (!fs.existsSync(targetPath)) {
        failures.push(`missing:${entry.relativePath}`);
        continue;
      }
      const targetStats = await lstat(targetPath);
      if (
        targetStats.isSymbolicLink()
        || !targetStats.isFile()
        || targetStats.size !== entry.size
        || await sha256(targetPath) !== entry.sha256
      ) {
        failures.push(`content:${entry.relativePath}`);
      }
    }
    const expectedFiles = new Set([MANIFEST_NAME, ...migrationPlan.entries.map((entry) => entry.relativePath)]);
    const expectedDirectories = new Set(migrationPlan.directories);
    for (const targetEntry of await listTargetEntries(scope.rootDirectory)) {
      const expected = targetEntry.type === 'file' ? expectedFiles : expectedDirectories;
      if (!expected.has(targetEntry.relativePath)) failures.push(`unexpected:${targetEntry.relativePath}`);
    }
    return { ok: failures.length === 0, planId: migrationPlan.planId, failures };
  }

  async function apply(migrationPlan, authenticationContext, options = {}) {
    assertPlanIntegrity(migrationPlan);
    const scope = scopeFor(authenticationContext);
    if (scope.opaqueUserId !== migrationPlan.opaqueUserId || scope.rootDirectory !== migrationPlan.targetRoot) {
      throw new UserScopeMigrationError('认证用户与迁移目标不一致', 'MIGRATION_IDENTITY_MISMATCH');
    }
    if (!options.execute) {
      return { status: 'dry-run', planId: migrationPlan.planId, fileCount: migrationPlan.entries.length };
    }
    await assertFixtureOnly(legacyRoot, scope.rootDirectory);
    if (fs.existsSync(scope.rootDirectory)) {
      const verification = await verify(migrationPlan, authenticationContext);
      if (verification.ok) return { status: 'already-applied', planId: migrationPlan.planId };
      throw new UserScopeMigrationError('迁移目标已存在且不匹配，拒绝覆盖', 'MIGRATION_TARGET_CONFLICT');
    }

    const usersRoot = path.dirname(scope.rootDirectory);
    const stagingRoot = assertContained(
      usersRoot,
      path.join(
        usersRoot,
        `.migration-${scope.opaqueUserId}-${migrationPlan.planId.slice(0, 12)}-${crypto.randomUUID()}`,
      ),
    );
    await mkdir(usersRoot, { recursive: true });
    let copied = 0;
    try {
      await mkdir(stagingRoot, { recursive: false });
      for (const relativeDirectory of migrationPlan.directories) {
        const targetDirectory = assertContained(stagingRoot, path.join(
          stagingRoot,
          ...relativeDirectory.split('/'),
        ));
        await mkdir(targetDirectory, { recursive: true });
      }
      for (const entry of migrationPlan.entries) {
        if (copied >= (options.failAfterCopies ?? Number.POSITIVE_INFINITY)) {
          throw new UserScopeMigrationError('注入的迁移中途失败', 'MIGRATION_FAILURE_INJECTED');
        }
        const sourcePath = assertContained(legacyRoot, path.join(legacyRoot, ...entry.relativePath.split('/')));
        const sourceStats = await lstat(sourcePath);
        if (
          sourceStats.isSymbolicLink()
          || !sourceStats.isFile()
          || sourceStats.size !== entry.size
          || await sha256(sourcePath) !== entry.sha256
        ) {
          throw new UserScopeMigrationError('迁移源在计划后发生变化', 'MIGRATION_SOURCE_CHANGED');
        }
        const targetPath = assertContained(stagingRoot, path.join(stagingRoot, ...entry.relativePath.split('/')));
        await mkdir(path.dirname(targetPath), { recursive: true });
        await copyFile(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
        if ((await stat(targetPath)).size !== entry.size || await sha256(targetPath) !== entry.sha256) {
          throw new UserScopeMigrationError('迁移复制校验失败', 'MIGRATION_COPY_VERIFY_FAILED');
        }
        copied += 1;
      }
      await writeFile(path.join(stagingRoot, MANIFEST_NAME), `${JSON.stringify({
        version: MIGRATION_VERSION,
        planId: migrationPlan.planId,
        opaqueUserId: scope.opaqueUserId,
        fileCount: migrationPlan.entries.length,
      }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      await renameDirectoryWithRetry(stagingRoot, scope.rootDirectory);
    } catch (error) {
      await rm(stagingRoot, { recursive: true, force: true });
      if (error instanceof UserScopeMigrationError) throw error;
      throw new UserScopeMigrationError(`迁移应用失败：${error.message}`, 'MIGRATION_APPLY_FAILED');
    }
    const verification = await verify(migrationPlan, authenticationContext);
    if (!verification.ok) {
      throw new UserScopeMigrationError('迁移后校验失败，目标保留以供显式回滚', 'MIGRATION_VERIFY_FAILED');
    }
    return { status: 'applied', planId: migrationPlan.planId, fileCount: copied };
  }

  async function rollback(migrationPlan, authenticationContext, options = {}) {
    assertPlanIntegrity(migrationPlan);
    const scope = scopeFor(authenticationContext);
    if (scope.opaqueUserId !== migrationPlan.opaqueUserId || scope.rootDirectory !== migrationPlan.targetRoot) {
      throw new UserScopeMigrationError('认证用户与回滚目标不一致', 'MIGRATION_IDENTITY_MISMATCH');
    }
    if (!options.execute) return { status: 'dry-run', planId: migrationPlan.planId };
    await assertFixtureOnly(legacyRoot, scope.rootDirectory);
    if (!fs.existsSync(scope.rootDirectory)) {
      return { status: 'already-rolled-back', planId: migrationPlan.planId };
    }
    const manifestPath = path.join(scope.rootDirectory, MANIFEST_NAME);
    let manifest;
    try {
      const rootStats = await lstat(scope.rootDirectory);
      if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) throw new Error('unsafe target');
      const manifestStats = await lstat(manifestPath);
      if (manifestStats.isSymbolicLink() || !manifestStats.isFile()) throw new Error('unsafe manifest');
      manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    } catch {
      throw new UserScopeMigrationError('回滚清单缺失或损坏', 'MIGRATION_ROLLBACK_REFUSED');
    }
    if (manifest.planId !== migrationPlan.planId || manifest.opaqueUserId !== scope.opaqueUserId) {
      throw new UserScopeMigrationError('回滚清单与目标不匹配', 'MIGRATION_ROLLBACK_REFUSED');
    }
    const expectedFiles = new Set([MANIFEST_NAME, ...migrationPlan.entries.map((entry) => entry.relativePath)]);
    const expectedDirectories = new Set(migrationPlan.directories);
    const unexpected = (await listTargetEntries(scope.rootDirectory)).filter((targetEntry) => {
      const expected = targetEntry.type === 'file' ? expectedFiles : expectedDirectories;
      return !expected.has(targetEntry.relativePath);
    });
    if (unexpected.length > 0) {
      throw new UserScopeMigrationError('目标包含迁移后新增文件，拒绝删除', 'MIGRATION_ROLLBACK_REFUSED');
    }
    await rm(scope.rootDirectory, { recursive: true, force: false });
    return { status: 'rolled-back', planId: migrationPlan.planId };
  }

  return Object.freeze({ plan, apply, verify, rollback });
}
