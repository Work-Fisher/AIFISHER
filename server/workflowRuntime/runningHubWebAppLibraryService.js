import { downloadRunningHubCover, coverUrlFromInfo } from './runningHubCover.js';
import crypto from 'node:crypto';
import { OFFICIAL_WORKFLOWS } from './officialWorkflowCatalog.js';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { RunningHubWorkflowClient } from './runningHubWorkflowClient.js';
import { createRunningHubWebAppProjection, RunningHubWebAppError } from './runningHubWebApp.js';

const DEFAULT_CATEGORIES = Object.freeze([
  { id: 'image', name: '图像类', order: 0 },
  { id: 'video', name: '视频类', order: 1 },
  { id: 'audio', name: '声音类', order: 2 },
  { id: 'motion', name: '动作迁移类', order: 3 },
]);
const FIXED_CATEGORY_IDS = new Set(DEFAULT_CATEGORIES.map((category) => category.id));
const LEGACY_CATEGORY_IDS = Object.freeze({
  'image-generation': 'image',
  'video-generation': 'video',
});

function publicCategoryId(value) {
  const normalized = String(value || '');
  if (FIXED_CATEGORY_IDS.has(normalized)) return normalized;
  return LEGACY_CATEGORY_IDS[normalized] || '';
}

export class RunningHubWebAppLibraryError extends Error {
  constructor(message, code = 'RUNNINGHUB_WEBAPP_LIBRARY_ERROR', status = 400) {
    super(message);
    this.name = 'RunningHubWebAppLibraryError';
    this.code = code;
    this.status = status;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseUrlFor(reference) {
  if (reference === 'runninghub-cn') return 'https://www.runninghub.cn';
  if (reference === 'runninghub-global') return 'https://www.runninghub.ai';
  throw new RunningHubWebAppLibraryError(
    'RunningHub 站点无效',
    'INVALID_CREDENTIAL_REFERENCE',
  );
}

function safeCategoryName(value) {
  const name = String(value || '').replace(/[\0\r\n]+/g, ' ').trim().slice(0, 80);
  if (!name) throw new RunningHubWebAppLibraryError('分类名不能为空', 'INVALID_CLOUD_CATEGORY');
  return name;
}

function safeKey(candidate, index, used) {
  const raw = `field_${candidate.nodeId}_${candidate.fieldName}`
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .slice(0, 64);
  const base = /^[A-Za-z]/.test(raw) ? raw : `field_${index + 1}`;
  let key = base;
  let suffix = 2;
  while (used.has(key)) {
    const tail = `_${suffix++}`;
    key = `${base.slice(0, 64 - tail.length)}${tail}`;
  }
  used.add(key);
  return key;
}

export class RunningHubWebAppLibraryService {
  constructor({
    definitionStore,
    configurationStore,
    deploymentService,
    credentialResolver,
    clientFactory = (options) => new RunningHubWorkflowClient(options),
  }) {
    if (!definitionStore || !configurationStore || !deploymentService || !credentialResolver) {
      throw new Error('RunningHubWebAppLibraryService requires workflow runtime dependencies');
    }
    Object.assign(this, {
      definitionStore,
      configurationStore,
      deploymentService,
      credentialResolver,
      clientFactory,
    });
    this.categoriesPath = path.join(
      configurationStore.rootDirectory,
      'runninghub-webapp-categories.json',
    );
    this.categoryLock = Promise.resolve();
    this.officialImports = new Map();
    this.coverAttempts = new Set();
  }

  async listOfficialWorkflows() {
    const [apps, credential] = await Promise.all([this.listApps(), this.credentialResolver('runninghub-cn')]);
    return OFFICIAL_WORKFLOWS.map((item) => ({ ...item, configured: Boolean(credential),
      definitionId: apps.find((app) => app.webAppId === item.webAppId && app.credentialRef === 'runninghub-cn')?.definitionId,
    }));
  }

  async addOfficialWorkflow(id) {
    const item = OFFICIAL_WORKFLOWS.find((entry) => entry.id === id);
    if (!item) throw new RunningHubWebAppLibraryError('官方工作流不存在', 'OFFICIAL_WORKFLOW_NOT_FOUND', 404);
    if (this.officialImports.has(id)) return this.officialImports.get(id);
    const pending = (async () => {
      const existing = (await this.listApps()).find((app) => app.webAppId === item.webAppId && app.credentialRef === 'runninghub-cn');
      if (existing) return existing; // Preserve the user's existing presentation and bindings.
      return this.createApp({ webAppId: item.webAppId, credentialRef: 'runninghub-cn',
        categoryId: item.categoryId, title: item.name, description: item.description });
    })().finally(() => this.officialImports.delete(id));
    this.officialImports.set(id, pending);
    return pending;
  }

  async readCategories() {
    try {
      const parsed = JSON.parse(await readFile(this.categoriesPath, 'utf8'));
      if (!Array.isArray(parsed)) return clone(DEFAULT_CATEGORIES);
      const byId = new Map(parsed.map((category) => [String(category?.id || ''), category]));
      return [
        ...DEFAULT_CATEGORIES.map((category) => byId.get(category.id) || category),
        ...parsed.filter((category) => !DEFAULT_CATEGORIES.some(
          (fixed) => fixed.id === String(category?.id || ''),
        )),
      ];
    } catch (error) {
      if (error?.code === 'ENOENT') return clone(DEFAULT_CATEGORIES);
      throw error;
    }
  }

  async writeCategories(categories) {
    await mkdir(path.dirname(this.categoriesPath), { recursive: true });
    const temporaryPath = `${this.categoriesPath}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(categories, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    await rename(temporaryPath, this.categoriesPath);
  }

  async withCategoryLock(operation) {
    const current = this.categoryLock.catch(() => undefined).then(operation);
    this.categoryLock = current;
    return current;
  }

  async listCategories() {
    return (await this.readCategories())
      .map((category, index) => ({
        id: String(category?.id || ''),
        name: safeCategoryName(category?.name),
        order: Number.isFinite(Number(category?.order)) ? Number(category.order) : index,
      }))
      .filter((category) => /^[A-Za-z0-9._-]{1,120}$/.test(category.id))
      .sort((left, right) => left.order - right.order);
  }

  async createCategory(nameValue) {
    return this.withCategoryLock(async () => {
      const categories = await this.listCategories();
      const name = safeCategoryName(nameValue);
      const duplicate = categories.find(
        (category) => category.name.toLocaleLowerCase('zh-CN') === name.toLocaleLowerCase('zh-CN'),
      );
      if (duplicate) return duplicate;
      const category = { id: crypto.randomUUID(), name, order: categories.length };
      await this.writeCategories([...categories, category]);
      return category;
    });
  }

  async deleteCategory(categoryId) {
    return this.withCategoryLock(async () => {
      const categories = await this.listCategories();
      const next = categories.filter((category) => category.id !== categoryId);
      if (next.length === categories.length) {
        throw new RunningHubWebAppLibraryError('云端分类不存在', 'CLOUD_CATEGORY_NOT_FOUND', 404);
      }
      await this.writeCategories(next.map((category, order) => ({ ...category, order })));
      const definitions = await this.definitionStore.listDefinitions();
      await Promise.all(definitions
        .filter((definition) => definition.presentation?.categoryId === categoryId)
        .map((definition) => this.definitionStore.updatePresentation(definition.id, { categoryId: '' })));
      return { id: categoryId, deleted: true };
    });
  }

  async listApps() {
    const [definitions, storedCategories] = await Promise.all([
      this.definitionStore.listDefinitions(),
      this.listCategories(),
    ]);
    const categories = [...clone(DEFAULT_CATEGORIES), ...storedCategories];
    const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
    const apps = await Promise.all(definitions
      .filter((definition) => definition.sourceArtifacts?.some(
        (artifact) => artifact.origin === 'runninghub-webapp',
      ))
      .map(async (definition) => {
        const [deployments, bindingSets, attestations] = await Promise.all([
          this.configurationStore.listDeployments(definition.id),
          this.configurationStore.listBindingSets(definition.id),
          this.configurationStore.listAttestations(definition.id),
        ]);
        const deployment = deployments
          .filter((candidate) => candidate.runner === 'runninghub-webapp')
          .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0];
        if (!deployment) return null;
        if (!definition.presentation?.customCoverUrl && !this.coverAttempts.has(definition.id)) {
          this.coverAttempts.add(definition.id);
          try {
          const apiKey = await this.credentialResolver(deployment.connection.credentialRef);
          const client = apiKey ? this.clientFactory({ baseUrl: baseUrlFor(deployment.connection.credentialRef), apiKey, timeoutMs: 10000 }) : {};
          if (typeof client.getWebAppCover === 'function') {
            const remoteCover = await client.getWebAppCover(deployment.connection.remoteWebAppId).catch(() => null);
            const coverUrl = await downloadRunningHubCover({ coverUrl: remoteCover }, this.definitionStore.libraryDirectory,
              typeof client.openOutput === 'function' ? async (url) => ({ response: await client.openOutput({ url }) }) : undefined);
            if (coverUrl) {
              const updated = await this.definitionStore.updatePresentation(definition.id, { customCoverUrl: coverUrl });
              definition.presentation = updated.presentation;
            }
          }
          } catch { /* Optional cover recovery must not block the library. */ }
        }

        const bindingSet = bindingSets.sort((left, right) => right.revision - left.revision)[0];
        const attestation = attestations.find((candidate) =>
          candidate.definitionRevision === definition.revision
          && candidate.executionPlanHash === definition.executionPlan?.executionPlanHash
          && candidate.deploymentId === deployment.id);
        const storedCategoryId = String(definition.presentation?.categoryId || '');
        const categoryId = publicCategoryId(storedCategoryId) || storedCategoryId;
        return {
          id: definition.id,
          definitionId: definition.id,
          title: definition.name,
          coverUrl: definition.presentation?.customCoverUrl || '',
          description: definition.description || '',
          categoryId,
          categoryName: categoryNames.get(storedCategoryId)
            || categoryNames.get(categoryId)
            || '未分类',
          webAppId: deployment.connection.remoteWebAppId,
          credentialRef: deployment.connection.credentialRef,
          site: deployment.connection.credentialRef === 'runninghub-global' ? 'global' : 'cn',
          fieldCount: bindingSet?.bindings?.length || 0,
          verified: Boolean(attestation),
          createdAt: definition.createdAt,
          updatedAt: definition.updatedAt,
        };
      }));
    return apps.filter(Boolean).sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  }

  async getLibrary() {
    return { categories: clone(DEFAULT_CATEGORIES), apps: await this.listApps() };
  }

  async validateCredential(credentialRef) {
    const apiKey = await this.credentialResolver(credentialRef);
    if (!apiKey) {
      throw new RunningHubWebAppLibraryError(
        '请先填写并保存当前站点的 RunningHub API Key',
        'RUNNINGHUB_CREDENTIAL_MISSING',
        409,
      );
    }
    const client = this.clientFactory({
      baseUrl: baseUrlFor(credentialRef),
      apiKey,
      timeoutMs: 30_000,
    });
    const validation = await client.validateCredential();
    return {
      valid: true,
      credentialRef,
      site: credentialRef === 'runninghub-global' ? 'global' : 'cn',
      currency: String(validation?.currency || '').slice(0, 16),
      apiType: String(validation?.apiType || '').slice(0, 40),
    };
  }

  async createApp({ webAppId, credentialRef, categoryId = '', title = '', description = '', instanceType = '' }) {
    const [storedCategories, apps] = await Promise.all([this.listCategories(), this.listApps()]);
    if (
      categoryId
      && !FIXED_CATEGORY_IDS.has(categoryId)
      && !storedCategories.some((category) => category.id === categoryId)
    ) {
      throw new RunningHubWebAppLibraryError('云端分类不存在', 'CLOUD_CATEGORY_NOT_FOUND', 404);
    }
    const normalizedWebAppId = String(webAppId || '').trim();
    const replacedApps = apps.filter(
      (app) => app.webAppId === normalizedWebAppId && app.credentialRef === credentialRef,
    );
    const apiKey = await this.credentialResolver(credentialRef);
    if (!apiKey) {
      throw new RunningHubWebAppLibraryError(
        '请先在云端工作流页填写 RunningHub API Key',
        'RUNNINGHUB_CREDENTIAL_MISSING',
        409,
      );
    }
    const baseUrl = baseUrlFor(credentialRef);
    const client = this.clientFactory({ baseUrl, apiKey, timeoutMs: 60_000 });
    const resolved = client.resolveWebAppInfo
      ? await client.resolveWebAppInfo(normalizedWebAppId)
      : { apiProtocol: 'legacy-webapp-v1', info: await client.getWebAppInfo(normalizedWebAppId) };
    const rawInfo = resolved.info;
    const coverSource = coverUrlFromInfo(rawInfo) || (typeof client.getWebAppCover === 'function' ? await client.getWebAppCover(normalizedWebAppId) : null);
    const coverUrl = await downloadRunningHubCover({ coverUrl: coverSource }, this.definitionStore.libraryDirectory, typeof client.openOutput === 'function' ? async (url) => ({ response: await client.openOutput({ url }) }) : undefined);
    const projection = createRunningHubWebAppProjection(normalizedWebAppId, rawInfo);
    const resolvedCategoryId = categoryId || projection.snapshot.categoryId;
    const definition = await this.definitionStore.createDefinition({
      content: JSON.stringify(projection.executionPlan),
      originalFilename: `runninghub-webapp-${projection.snapshot.webAppId}.json`,
      origin: 'runninghub-webapp',
      name: String(title || '').trim() || projection.snapshot.appName,
    });
    try {
      const presented = await this.definitionStore.updatePresentation(definition.id, {
        categoryId: resolvedCategoryId,
        ...(coverUrl ? { customCoverUrl: coverUrl } : {}),
        description,
      });
      const deployed = await this.deploymentService.createDeployment(definition.id, {
        runner: 'runninghub-webapp',
        baseUrl,
        credentialRef,
        remoteWebAppId: projection.snapshot.webAppId,
        webAppInfo: rawInfo,
        apiProtocol: resolved.apiProtocol,
        instanceType,
        timeoutMs: 30 * 60_000,
      });
      const fields = new Map(projection.snapshot.fields.map(
        (field) => [`${field.nodeId}\n${field.fieldName}`, field],
      ));
      const usedKeys = new Set();
      const selections = deployed.candidates.map((candidate, index) => {
        const field = fields.get(`${candidate.nodeId}\n${candidate.fieldName}`);
        return {
          candidateId: candidate.id,
          key: safeKey(candidate, index, usedKeys),
          label: field?.label || candidate.fieldName,
          description: field?.description || '',
          section: candidate.mediaKind ? '输入素材' : '生成参数',
        };
      });
      await this.deploymentService.createBindingSet(definition.id, {
        deploymentId: deployed.dto.id,
        name: '云端应用字段',
        bindings: selections,
      });
      const created = (await this.listApps()).find((app) => app.definitionId === presented.id);
      await Promise.all(replacedApps.map((app) => this.definitionStore.deleteDefinition(app.definitionId)));
      return created;
    } catch (error) {
      await this.definitionStore.deleteDefinition(definition.id).catch(() => undefined);
      if (error instanceof RunningHubWebAppError) throw error;
      throw error;
    }
  }

  async deleteApp(definitionId) {
    const definition = await this.definitionStore.requireDefinition(definitionId);
    if (!definition.sourceArtifacts?.some((artifact) => artifact.origin === 'runninghub-webapp')) {
      throw new RunningHubWebAppLibraryError('云端工作流不存在', 'RUNNINGHUB_WEBAPP_NOT_FOUND', 404);
    }
    return this.definitionStore.deleteDefinition(definitionId);
  }
}
