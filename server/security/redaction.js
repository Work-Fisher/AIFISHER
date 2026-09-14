const SENSITIVE_KEY = /(authorization|api[-_]?key|access[-_]?key|secret|token|password|signature|credential|cookie)/i;
const USER_PATH_PATTERNS = [
  /([a-z]:\\Users\\)[^\\/]+/gi,
  /(\/Users\/)[^/]+/g,
  /(\/home\/)[^/]+/g,
];
const ABSOLUTE_PATH_PATTERNS = [
  /\b[a-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*/gi,
  /\/(?:private|var|tmp|opt|srv|mnt|Volumes|workspace)(?:\/[^\s"'<>]+)*/g,
];

function redactUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.username) url.username = '[REDACTED]';
    if (url.password) url.password = '[REDACTED]';
    for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, '[REDACTED]');
    return url.href;
  } catch {
    return rawUrl;
  }
}

function redactString(value) {
  let result = String(value);
  result = result.replace(/https?:\/\/[^\s"'<>]+/gi, (url) => redactUrl(url));
  result = result.replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]');
  result = result.replace(
    /\b(api[-_]?key|access[-_]?key|secret|token|password|signature|authorization)\b(\s*[:=]\s*)([^\s,;&]+)/gi,
    '$1$2[REDACTED]',
  );
  for (const pattern of USER_PATH_PATTERNS) {
    result = result.replace(pattern, '$1[USER]');
  }
  for (const pattern of ABSOLUTE_PATH_PATTERNS) {
    result = result.replace(pattern, '[PATH]');
  }
  return result;
}

export function redactSensitive(value, seen = new WeakSet(), depth = 0) {
  if (typeof value === 'string') return redactString(value);
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (depth > 8) return '[TRUNCATED]';
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      code: value.code,
      stack: value.stack ? redactString(value.stack) : undefined,
    };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => redactSensitive(item, seen, depth + 1));
  }
  const result = {};
  for (const [key, child] of Object.entries(value).slice(0, 100)) {
    result[key] = SENSITIVE_KEY.test(key)
      ? '[REDACTED]'
      : redactSensitive(child, seen, depth + 1);
  }
  return result;
}

/**
 * 面向用户的实时日志专用：去掉密钥、令牌与本机用户名，但保留其余路径。
 * 完整脱敏会把每个绝对路径都换成 [PATH]，而“模型没找到，路径是 X”恰恰是排错最需要的信息。
 * 仅用于回环地址上给用户本人查看，不得用于 /api/diagnostics/export 等可分享输出。
 */
export function redactSecretsOnly(value) {
  let result = String(value);
  result = result.replace(/https?:\/\/[^\s"'<>]+/gi, (url) => redactUrl(url));
  result = result.replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]');
  result = result.replace(
    /\b(api[-_]?key|access[-_]?key|secret|token|password|signature|authorization)\b(\s*[:=]\s*)([^\s,;&]+)/gi,
    '$1$2[REDACTED]',
  );
  for (const pattern of USER_PATH_PATTERNS) {
    result = result.replace(pattern, '$1[USER]');
  }
  return result;
}

export { redactString };
