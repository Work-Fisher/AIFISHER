const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export class IdentityProfileUnavailableError extends Error {
  constructor() {
    super('Identity profile service is unavailable');
    this.name = 'IdentityProfileUnavailableError';
    this.code = 'IDENTITY_PROFILE_UNAVAILABLE';
  }
}

function validateEndpoint(value) {
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error('Identity profile endpoint is invalid');
  }
  const loopbackHttp = endpoint.protocol === 'http:'
    && LOOPBACK_HOSTNAMES.has(endpoint.hostname.toLowerCase());
  if (
    (endpoint.protocol !== 'https:' && !loopbackHttp)
    || endpoint.pathname !== '/v1/profile'
    || endpoint.username
    || endpoint.password
    || endpoint.search
    || endpoint.hash
  ) throw new Error('Identity profile endpoint must be an exact HTTPS or loopback profile URL');
  return endpoint.href;
}

function parseProfile(payload) {
  if (
    !payload
    || typeof payload !== 'object'
    || Array.isArray(payload)
    || Object.keys(payload).length !== 1
    || !Object.hasOwn(payload, 'displayName')
  ) throw new IdentityProfileUnavailableError();
  if (payload.displayName === null) return Object.freeze({ displayName: null });
  if (typeof payload.displayName !== 'string') throw new IdentityProfileUnavailableError();
  const displayName = payload.displayName.trim().normalize('NFC');
  const length = [...displayName].length;
  if (
    displayName !== payload.displayName
    || length < 1
    || length > 80
    // eslint-disable-next-line no-control-regex -- Deliberately reject or strip control characters.
    || /[\u0000-\u001f\u007f]/u.test(displayName)
  ) throw new IdentityProfileUnavailableError();
  return Object.freeze({ displayName });
}

export function createIdentityProfileClient({
  endpoint,
  fetchImpl = globalThis.fetch,
  timeoutMs = 2_500,
} = {}) {
  const url = validateEndpoint(endpoint);
  if (typeof fetchImpl !== 'function') throw new Error('Identity profile fetch is missing');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000) {
    throw new Error('Identity profile timeout is invalid');
  }

  return Object.freeze({
    async read(accessToken) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
            'Cache-Control': 'no-store',
          },
          redirect: 'error',
          signal: controller.signal,
        });
        if (response.status !== 200) throw new IdentityProfileUnavailableError();
        return parseProfile(await response.json());
      } catch (error) {
        if (error instanceof IdentityProfileUnavailableError) throw error;
        throw new IdentityProfileUnavailableError();
      } finally {
        clearTimeout(timeout);
      }
    },
  });
}
