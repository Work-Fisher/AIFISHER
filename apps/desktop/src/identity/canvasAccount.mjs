// Account state never controls the local workspace or backend lifetime.
export function createCanvasAccount({ session, device, issuer, fetchImpl }) {
  let displayName = null;
  const listeners = new Set();
  const view = async () => ({ ...await session.status(), userId: session.userId(), displayName });
  session.onChange(snapshot => {
    displayName = null;
    for (const listener of listeners) listener({ ...snapshot, userId: session.userId(), displayName });
  });
  async function request(endpoint, token, body) {
    if (!issuer || !token) throw new Error('云端身份暂不可用，请稍后重试。画布可继续使用。');
    const response = await fetchImpl(new URL(endpoint, issuer).href, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000), redirect: 'error',
    });
    const payload = await response.json();
    return { status: response.status, payload };
  }
  async function refreshProfile() {
    const owner = session.userId();
    if (!owner) return;
    try {
      const token = await session.getAccessToken();
      if (session.userId() !== owner) return;
      const response = await request('v1/profile', token);
      if (session.userId() !== owner || response.status !== 200) return;
      displayName = typeof response.payload.displayName === 'string' ? response.payload.displayName.slice(0, 80) : null;
      const snapshot = await view();
      for (const listener of listeners) listener(snapshot);
    } catch { /* Profile failures do not change account or local workspace state. */ }
  }
  return {
    status: view,
    async restore() { await session.restore(); void refreshProfile(); return view(); },
    async signIn(input) { await session.signIn(input); void refreshProfile(); return view(); },
    async signOut() { await session.signOut(); return view(); },
    register: input => session.register(input),
    recoverPassword: input => session.recoverPassword(input),
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async submitFeedback(body, expectedUserId) {
      // Freeze ownership before any token renewal. Never fall back to another principal.
      if (expectedUserId !== session.userId()) throw new Error('账号状态已变化，请确认后重新提交反馈。');
      const token = expectedUserId === null ? await device.getAccessToken() : await session.getAccessToken();
      if (expectedUserId !== session.userId()) throw new Error('账号状态已变化，请确认后重新提交反馈。');
      if (Buffer.byteLength(JSON.stringify(body), 'utf8') > 9 * 1024 * 1024) throw new Error('反馈附件过大。');
      return request('v1/feedback', token, body);
    },
  };
}
