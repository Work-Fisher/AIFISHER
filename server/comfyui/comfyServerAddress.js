const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function normalizeLocalComfyServer(value = '127.0.0.1:8188') {
  const raw = String(value || '').trim() || '127.0.0.1:8188';
  try {
    const parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`);
    if (
      parsed.protocol !== 'http:'
      || !LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())
      || (parsed.pathname && parsed.pathname !== '/')
      || parsed.username
      || parsed.password
    ) throw new Error('not a loopback HTTP address');
    return parsed.host;
  } catch (cause) {
    const error = new Error('ComfyUI 只允许使用本机回环地址。', { cause });
    error.code = 'NON_LOCAL_COMFY_SERVER';
    throw error;
  }
}
