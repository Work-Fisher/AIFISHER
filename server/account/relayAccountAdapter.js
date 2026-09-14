const DEFAULT_BASE_URL = 'https://api.work-fisher.com';
const DEFAULT_TIMEOUT_MS = 5_000;

export const RELAY_ACCOUNT_CAPABILITIES = Object.freeze({
  walletBalance: true,
  taskReference: true,
  finalSettlementReceipt: true,
  userProvisioning: false,
  perUserKey: false,
  userRevocation: false,
  selfServiceBinding: false,
});

export class RelayAccountAdapterError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'RelayAccountAdapterError';
    this.code = code;
    this.retryable = Boolean(options.retryable);
  }
}

function canonicalBaseUrl(value, allowedOrigins) {
  const parsed = new URL(String(value || DEFAULT_BASE_URL));
  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || !['/', '/v1/relay/proxy'].includes(parsed.pathname.replace(/\/$/u, '') || '/')
    || parsed.search
    || parsed.hash
    || !allowedOrigins.has(parsed.origin)
  ) {
    throw new RelayAccountAdapterError(
      'RELAY_ACCOUNT_ORIGIN_REJECTED',
      '中转账户接口来源不在显式允许列表中',
    );
  }
  return parsed.pathname === '/'
    ? parsed.origin
    : `${parsed.origin}${parsed.pathname.replace(/\/$/u, '')}`;
}

function walletPayload(body) {
  const data = body?.data;
  const amount = Number(data?.amount);
  const displayType = String(data?.display_type || '').trim().toUpperCase();
  if (
    body?.code !== true
    || data?.object !== 'wallet_balance'
    || !Number.isFinite(amount)
    || amount < 0
    || (displayType !== 'CUSTOM' && !/^[A-Z]{3}$/.test(displayType))
  ) {
    throw new RelayAccountAdapterError(
      'RELAY_WALLET_RESPONSE_INVALID',
      '中转钱包返回了无法识别的数据',
    );
  }
  return { amount, currency: displayType === 'CUSTOM' ? null : displayType };
}

export function createRelayAccountAdapter({
  apiKey,
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = () => new Date(),
  allowedOrigins = [new URL(DEFAULT_BASE_URL).origin],
} = {}) {
  const readApiKey = typeof apiKey === 'function'
    ? () => String(apiKey() || '').trim()
    : () => String(apiKey || '').trim();
  const endpoint = canonicalBaseUrl(baseUrl, new Set(allowedOrigins));
  const requestScopedCredential = endpoint !== new URL(endpoint).origin;
  const bindingEndpoint = requestScopedCredential
    ? endpoint.replace(/\/v1\/relay\/proxy$/u, '/v1/relay/binding')
    : null;
  if (typeof fetchImpl !== 'function') throw new Error('Relay account adapter requires fetch');

  const unsupported = async () => {
    throw new RelayAccountAdapterError(
      'RELAY_CAPABILITY_UNSUPPORTED',
      '中转站没有公开、受支持的服务端账户管理契约',
    );
  };

  async function bindingRequest(method, { accessToken, apiKey } = {}) {
    if (!bindingEndpoint) {
      throw new RelayAccountAdapterError(
        'RELAY_CAPABILITY_UNSUPPORTED',
        '当前运行方式不支持自助绑定中转 API Key',
      );
    }
    const credential = String(accessToken || '').trim();
    if (!credential) {
      throw new RelayAccountAdapterError('RELAY_ACCOUNT_UNAUTHORIZED', '登录已经失效');
    }
    const response = await fetchImpl(bindingEndpoint, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${credential}`,
        ...(method === 'PUT' ? { 'Content-Type': 'application/json' } : {}),
      },
      body: method === 'PUT' ? JSON.stringify({ apiKey }) : undefined,
    });
    if (!response.ok) {
      let code = 'RELAY_BINDING_UNAVAILABLE';
      let message = '中转绑定暂时不可用';
      try {
        const failure = await response.json();
        if (/^[A-Z][A-Z0-9_]{2,63}$/u.test(String(failure?.code || ''))) code = failure.code;
        if (typeof failure?.error === 'string' && failure.error.length <= 160) message = failure.error;
      } catch {
        // Keep the stable public fallback.
      }
      throw new RelayAccountAdapterError(code, message, {
        retryable: response.status === 408 || response.status === 429 || response.status >= 500,
      });
    }
    return response.status === 204 ? null : response.json();
  }

  return Object.freeze({
    capabilities: Object.freeze({
      ...RELAY_ACCOUNT_CAPABILITIES,
      selfServiceBinding: Boolean(bindingEndpoint),
    }),
    provisionUser: unsupported,
    issueUserKey: unsupported,
    revokeUser: unsupported,
    isConfigured() {
      return requestScopedCredential || Boolean(readApiKey());
    },
    bindApiKey({ accessToken, apiKey } = {}) {
      return bindingRequest('PUT', { accessToken, apiKey });
    },
    async getBindingStatus({ accessToken } = {}) {
      const payload = await bindingRequest('GET', { accessToken });
      const status = String(payload?.status || '');
      if (status !== 'bound' && status !== 'unbound') {
        throw new RelayAccountAdapterError(
          'RELAY_BINDING_RESPONSE_INVALID',
          '中转绑定返回了无法识别的状态',
        );
      }
      return Object.freeze({
        status,
        bound: status === 'bound',
        verifiedAt: typeof payload.verifiedAt === 'string' ? payload.verifiedAt : null,
        updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : null,
      });
    },
    unbindApiKey({ accessToken } = {}) {
      return bindingRequest('DELETE', { accessToken });
    },

    async fetchWallet({ accessToken } = {}) {
      const credential = requestScopedCredential
        ? String(accessToken || '').trim()
        : readApiKey();
      if (!credential) {
        throw new RelayAccountAdapterError(
          'RELAY_ACCOUNT_NOT_CONFIGURED',
          '当前用户尚未配置中转 API Key',
        );
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      timeout.unref?.();
      try {
        const response = await fetchImpl(`${endpoint}/api/usage/wallet/`, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${credential}`,
          },
          signal: controller.signal,
        });
        if (!response.ok) {
          let publicCode = null;
          if (response.status === 403) {
            try {
              const failure = await response.json();
              publicCode = failure?.code === 'RELAY_ACCOUNT_NOT_BOUND'
                ? 'RELAY_ACCOUNT_NOT_BOUND'
                : null;
            } catch {
              /* A non-JSON upstream failure remains a generic unavailable state. */
            }
          }
          throw new RelayAccountAdapterError(
            publicCode || (response.status === 401
              ? 'RELAY_ACCOUNT_UNAUTHORIZED'
              : 'RELAY_WALLET_UNAVAILABLE'),
            publicCode
              ? '当前 AIFISHER 账号尚未开通中转服务'
              : '中转钱包暂时不可用',
            { retryable: response.status === 408 || response.status === 429 || response.status >= 500 },
          );
        }
        const wallet = walletPayload(await response.json());
        return Object.freeze({
          ...wallet,
          observedAt: now().toISOString(),
          source: 'relay-wallet-api',
        });
      } catch (error) {
        if (error instanceof RelayAccountAdapterError) throw error;
        throw new RelayAccountAdapterError(
          error?.name === 'AbortError' ? 'RELAY_WALLET_TIMEOUT' : 'RELAY_WALLET_OFFLINE',
          '无法连接中转钱包，已保留上次可信余额',
          { retryable: true, cause: error },
        );
      } finally {
        clearTimeout(timeout);
      }
    },
  });
}
