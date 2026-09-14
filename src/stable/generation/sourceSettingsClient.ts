import {
  requestSettingsJson,
  LEGACY_RUNNINGHUB_FIELDS,
  type SettingsRequestOptions,
} from './sourceSettingsRequests';
export type MediaKind = 'image' | 'video' | 'text' | 'audio';

export type SourceSecret = { key: string; configured: boolean };

export type SourceModel = {
  name: string;
  vision?: 'supported' | 'unsupported' | 'unknown';
  customModelId?: string;
  modelIds?: string[];
  tier: string;
  variantLabel: string | null;
  requiredSecrets: string[];
  configured: boolean;
};

export type SourceMedia = { kind: MediaKind; models: SourceModel[] };

export type SourceBlock = {
  source: string;
  label: string;
  /** 真表示密钥由当前 AIFISHER 账号在 Identity 统一管理，前端不再重复输入。 */
  accountManaged?: boolean;
  /** 只有键名和「填没填」，密钥值永远不离开后端。 */
  secrets: SourceSecret[];
  /** 真表示一个密钥点亮全站，界面只画一个输入框。 */
  singleKey: boolean;
  media: SourceMedia[];
};

export type ModelVariant = {
  name: string;
  source: string;
  sourceLabel: string;
  variantLabel?: string | null;
  tier: string;
  /** 同站已有更便宜的等价渠道，这条只是贵一档的官方稳定版。默认折起来。 */
  premium: boolean;
  price: number | null;
  /** 当前视频参数对应的可读任务价，例如「≈¥4.39/5秒」。 */
  priceLabel?: string | null;
  /** 视频最低价固定上浮 20% 后的单位最高价；仅用于展示区间。 */
  priceMaximum?: number;
  /** 视频当前参数的「最低–最高」任务价。 */
  priceRangeLabel?: string | null;
  priceNote: string | null;
  /** 假表示这是历史估价或其它非精确价；具体语义见 priceNote。 */
  priceExact: boolean;
  /** 中转服务端发布的官方价对比折扣；展示用，price 已是当前可计费估价。 */
  discountPercent?: number | null;
  promotionLabel?: string;
  promotionEndsAt?: string;
  /** 供应商强制的任务时长；存在时覆盖节点遗留时长和请求参数。 */
  fixedDuration?: number | null;
  /** 当前来源可执行的时长范围，价格合成会把旧节点遗留值收进该范围。 */
  durationRange?: { default: number; min: number; max: number } | null;
  /** 本次价格实际采用的时长（已应用 fixedDuration 或 durationRange）。 */
  effectiveDuration?: number | null;
  configured: boolean;
  requiredSecrets: string[];
};

export type ModelGroup = {
  canonicalModel: string;
  /** 下拉的一级。同品牌的多个版本折在一起，见后端 brandOf()。 */
  brand: string;
  /** 这个版本能干什么（文生视频/首尾帧/视频编辑…），也是顶部筛选的取值。 */
  capabilities: string[];
  available: boolean;
  variants: ModelVariant[];
};

export type ModelPricingContext = {
  aspectRatio?: string | null;
  duration?: number | null;
  speed?: string | null;
  generateAudio?: boolean | null;
  inputImageCount?: number | null;
};

export type DreaminaLoginOptions = SettingsRequestOptions & { force?: boolean; browser?: 'default' | 'edge' | 'chrome' };

export type LibTvCliStatus = {
  installed: boolean;
  authenticated: boolean;
  accountName: string;
  loginRunning: boolean;
  message?: string;
};

export type DreaminaCliStatus = {
  account?: { uid: string; nickname: string } | null;
  status: 'missing' | 'installed' | 'invalid' | 'unsupported';
  installable: boolean;
  loginRunning: boolean;
  version?: string;
  installedAt?: string;
  changed?: boolean;
  message?: string;
  login?: DreaminaLoginStatus;
};

export type DreaminaLoginStatus = {
  status: 'idle' | 'awaiting-authorization' | 'authenticated' | 'expired' | 'failed';
  loginRunning: boolean;
  retryable: boolean;
  message: string;
  verificationUri?: string;
  userCode?: string;
  expiresAt?: string;
  pollAfterMs?: number;
  browserOpened?: boolean;
};

type SourceSettingsClientOptions = {
  modelRequestTimeoutMs?: number;
  sourceRequestTimeoutMs?: number;
};

const withTimeout = <T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  controller: AbortController,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      controller.abort();
      reject(new Error(message));
    }, timeoutMs);
    promise.then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        globalThis.clearTimeout(timer);
        reject(error);
      },
    );
  });

export function createSourceSettingsClient(
  fetcher: typeof fetch = globalThis.fetch,
  { modelRequestTimeoutMs = 2_000, sourceRequestTimeoutMs = 25_000 }: SourceSettingsClientOptions = {},
) {
  const modelGroupsByQuery = new Map<string, ModelGroup[]>();
  const pendingModelGroupsByQuery = new Map<string, Promise<ModelGroup[]>>();

  const readModelGroups = (url: string): Promise<ModelGroup[]> => {
    const cached = modelGroupsByQuery.get(url);
    if (cached) return Promise.resolve(cached);
    const pending = pendingModelGroupsByQuery.get(url);
    if (pending) return pending;
    const request = (async () => {
      const controller = new AbortController();
      const groups = await withTimeout(
        (async () => {
          // Availability depends on the current account's provider keys. Do not
          // let the browser reuse a response captured before a key was saved.
          const response = await fetcher(url, {
            signal: controller.signal,
            cache: 'no-store',
          });
          const body = (await response.json()) as { groups?: ModelGroup[]; error?: unknown };
          if (!response.ok)
            throw new Error(
              body.error ? String(body.error) : `读取模型可用性失败 (${response.status})`,
            );
          return body.groups ?? [];
        })(),
        modelRequestTimeoutMs,
        '模型目录响应超时，请确认本机服务已启动后重试。',
        controller,
      );
      modelGroupsByQuery.set(url, groups);
      return groups;
    })().finally(() => pendingModelGroupsByQuery.delete(url));
    pendingModelGroupsByQuery.set(url, request);
    return request;
  };

  const clearModelGroups = () => {
    modelGroupsByQuery.clear();
  };

  return {
    async getBlocks(options: SettingsRequestOptions = {}): Promise<SourceBlock[]> {
      const body = await requestSettingsJson<{ blocks?: SourceBlock[] }>(
        fetcher,
        '/api/generation/sources',
        '读取生成来源失败',
        options,
        {},
        sourceRequestTimeoutMs, // Source discovery waits for the bounded CLI authentication probe.
      );
      return body.blocks ?? [];
    },
    async getLegacyRunningHubSettings(
      options: SettingsRequestOptions = {},
    ): Promise<Record<string, string>> {
      const body = await requestSettingsJson<Record<string, unknown>>(
        fetcher,
        '/api/config/keys',
        '读取旧版工作流配置失败',
        options,
      );
      return Object.fromEntries(
        LEGACY_RUNNINGHUB_FIELDS.map(([key]) => [
          key,
          typeof body[key] === 'string' ? body[key] : '',
        ]),
      );
    },
    /**
     * 画布下拉的切法：一级 canonicalModel、二级来源。
     * resolution 与 mode 都带上——视频模型会按文生、参考、编辑分档计费。
     */
    async getModelGroups(
      resolution: string | null,
      mode: string | null = null,
      context: ModelPricingContext = {},
    ): Promise<ModelGroup[]> {
      const search = new URLSearchParams();
      if (resolution) search.set('resolution', resolution);
      if (mode) search.set('mode', mode);
      if (context.aspectRatio) search.set('aspectRatio', context.aspectRatio);
      if (context.duration != null) search.set('duration', String(context.duration));
      if (context.speed) search.set('speed', context.speed);
      if (typeof context.generateAudio === 'boolean') {
        search.set('generateAudio', String(context.generateAudio));
      }
      if (context.inputImageCount != null) {
        search.set('inputImageCount', String(context.inputImageCount));
      }
      const query = search.size ? `?${search.toString()}` : '';
      return readModelGroups(`/api/generation/model-availability${query}`);
    },
    /**
     * 复用设置中心既有的写入接口，不另建一条写 .env 的路径——
     * 两条路径就会有两套白名单和两套原子写，迟早漂移。
     */
    async saveKeys(
      values: Record<string, string>,
      options: SettingsRequestOptions = {},
    ): Promise<void> {
      const body = await requestSettingsJson<{ success?: boolean }>(
        fetcher,
        '/api/config/keys',
        '保存密钥失败',
        options,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(values),
        },
      );
      if (body?.success !== true) throw new Error('未收到保存成功回执，请核对配置后重试。');
      clearModelGroups();
    },
    async getLibTvCliStatus(options: SettingsRequestOptions = {}): Promise<LibTvCliStatus> {
      const result = await requestSettingsJson<LibTvCliStatus>(fetcher, '/api/local-runtime/libtv-cli', '检测 LibTV CLI 失败', options, {}, 20_000);
      clearModelGroups();
      return result;
    },
    async loginLibTvCli(options: SettingsRequestOptions = {}): Promise<LibTvCliStatus> {
      const result = await requestSettingsJson<LibTvCliStatus>(fetcher, '/api/local-runtime/libtv-cli/login', '启动 LibTV 登录失败', options, { method: 'POST' });
      clearModelGroups();
      return result;
    },
    getDreaminaCliStatus(options: SettingsRequestOptions = {}): Promise<DreaminaCliStatus> {
      return requestSettingsJson(
        fetcher,
        '/api/local-runtime/dreamina-cli',
        '检测即梦 CLI 失败',
        options, {}, 20_000,
      );
    },
    async installDreaminaCli(options: SettingsRequestOptions = {}): Promise<DreaminaCliStatus> {
      const body = await requestSettingsJson<DreaminaCliStatus>(
        fetcher,
        '/api/local-runtime/dreamina-cli/install',
        '安装即梦 CLI 失败',
        options,
        { method: 'POST' },
        120_000,
      );
      clearModelGroups();
      return body;
    },
    async loginDreaminaCli(options: DreaminaLoginOptions = {}): Promise<DreaminaLoginStatus> {
      const body = await requestSettingsJson<DreaminaLoginStatus>(
        fetcher,
        '/api/local-runtime/dreamina-cli/login',
        '启动即梦登录失败',
        options,
        { method: 'POST', ...(options.force !== undefined || options.browser !== undefined ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force: options.force ?? false, browser: options.browser ?? 'default' }),
        } : {}) },
        25_000, // The local CLI command may legitimately take up to 20 seconds.
      );
      clearModelGroups();
      return body;
    },
    async checkDreaminaCliLogin(
      options: SettingsRequestOptions = {},
    ): Promise<DreaminaLoginStatus> {
      const body = await requestSettingsJson<DreaminaLoginStatus>(
        fetcher,
        '/api/local-runtime/dreamina-cli/login/check',
        '检测即梦登录失败',
        options,
        { method: 'POST' },
        25_000,
      );
      if (body.status === 'authenticated') clearModelGroups();
      return body;
    },
  };
}

export type SourceSettingsClient = ReturnType<typeof createSourceSettingsClient>;

export function scopeSourceSettingsClient(
  client: SourceSettingsClient,
  signal: AbortSignal,
): SourceSettingsClient {
  return {
    ...client,
    getBlocks: () => client.getBlocks({ signal }),
    getLegacyRunningHubSettings: () => client.getLegacyRunningHubSettings({ signal }),
    saveKeys: (values) => client.saveKeys(values, { signal }),
    getDreaminaCliStatus: () => client.getDreaminaCliStatus({ signal }),
    getLibTvCliStatus: () => client.getLibTvCliStatus({ signal }),
    loginLibTvCli: () => client.loginLibTvCli({ signal }),
    installDreaminaCli: () => client.installDreaminaCli({ signal }),
    loginDreaminaCli: (options: DreaminaLoginOptions = {}) => client.loginDreaminaCli({ ...options, signal }),
    checkDreaminaCliLogin: () => client.checkDreaminaCliLogin({ signal }),
  };
}
