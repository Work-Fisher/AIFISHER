import dns from 'node:dns/promises';
import net from 'node:net';

export class ExternalUrlPolicyError extends Error {
  constructor(message, status = 400, code = 'UNSAFE_EXTERNAL_URL') {
    super(message);
    this.name = 'ExternalUrlPolicyError';
    this.status = status;
    this.code = code;
  }
}

function privateIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [first, second] = parts;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || first >= 224;
}

function privateIpv6(address) {
  const normalized = address.toLowerCase().split('%')[0];
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8')
    || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) {
    return true;
  }
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  return mapped ? privateIpv4(mapped[1]) : false;
}

export function isPrivateNetworkAddress(address) {
  const version = net.isIP(String(address || ''));
  if (version === 4) return privateIpv4(address);
  if (version === 6) return privateIpv6(address);
  return true;
}

async function defaultResolveHost(hostname) {
  return dns.lookup(hostname, { all: true, verbatim: true });
}

export async function validateExternalUrl(value, { resolveHost = defaultResolveHost } = {}) {
  let url;
  try {
    url = value instanceof URL ? new URL(value.href) : new URL(String(value || ''));
  } catch {
    throw new ExternalUrlPolicyError('外部 URL 无效');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new ExternalUrlPolicyError('外部 URL 只允许无凭据的 HTTP 或 HTTPS');
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new ExternalUrlPolicyError('外部 URL 不允许访问本机或内网', 400, 'PRIVATE_NETWORK_URL');
  }
  const literalVersion = net.isIP(hostname);
  const addresses = literalVersion ? [{ address: hostname }] : await resolveHost(hostname);
  const normalized = Array.isArray(addresses) ? addresses : [addresses];
  if (!normalized.length || normalized.some((entry) => isPrivateNetworkAddress(entry?.address || entry))) {
    throw new ExternalUrlPolicyError('外部 URL 不允许访问本机或内网', 400, 'PRIVATE_NETWORK_URL');
  }
  return url;
}

export async function fetchExternalUrl(value, {
  fetchImpl = globalThis.fetch,
  resolveHost = defaultResolveHost,
  method = 'GET',
  timeoutMs = 30_000,
  maxRedirects = 3,
} = {}) {
  let current = await validateExternalUrl(value, { resolveHost });
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const response = await fetchImpl(current, {
      method,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status < 300 || response.status >= 400 || !response.headers.get('location')) {
      return { response, url: current };
    }
    if (redirectCount === maxRedirects) {
      throw new ExternalUrlPolicyError('外部 URL 重定向次数过多', 502, 'TOO_MANY_REDIRECTS');
    }
    current = await validateExternalUrl(
      new URL(response.headers.get('location'), current),
      { resolveHost },
    );
  }
  throw new ExternalUrlPolicyError('外部 URL 请求失败', 502);
}
