import crypto from 'node:crypto';

function externalAlias(opaqueUserId, namespaceSecret) {
  return `aifisher-${crypto
    .createHmac('sha256', namespaceSecret)
    .update(opaqueUserId)
    .digest('hex')
    .slice(0, 24)}`;
}

export class RelayAccountService {
  constructor({
    store,
    adapter,
    namespaceSecret,
    bindingStatusTtlMs = 15_000,
    clock = () => Date.now(),
  } = {}) {
    if (!store || !adapter) throw new Error('RelayAccountService requires store and adapter');
    if (
      adapter.capabilities?.userProvisioning
      && (typeof namespaceSecret !== 'string' || namespaceSecret.length < 32)
    ) {
      throw new Error('Relay account provisioning requires a private namespace secret');
    }
    this.store = store;
    this.adapter = adapter;
    this.namespaceSecret = namespaceSecret || null;
    this.refreshPromise = null;
    this.bindingStatusPromise = null;
    this.bindingStatusCheckedAt = 0;
    this.bindingStatusTtlMs = Math.max(1_000, Number(bindingStatusTtlMs) || 15_000);
    this.clock = clock;
  }

  initialize() {
    if (this.adapter.isConfigured?.()) {
      this.store.setSelfServiceMapping(true);
      return this.store.publicSnapshot();
    }
    if (
      !this.adapter.capabilities?.userProvisioning
      && !this.adapter.capabilities?.selfServiceBinding
    ) this.store.ensureUnsupportedMapping();
    return this.store.publicSnapshot();
  }

  assertUser(opaqueUserId) {
    this.store.assertUser(opaqueUserId);
  }

  observeGenerationTask(task) {
    return this.store.recordGenerationTask(task);
  }

  observeUpstreamTask(task) {
    return this.store.recordUpstreamTask(task);
  }

  applyFinalReceipt(receipt) {
    return this.store.applyFinalReceipt(receipt);
  }

  removeActivity(activityId) {
    if (!this.store.removeActivity(activityId)) {
      throw Object.assign(new Error('Relay activity was not found'), {
        code: 'RELAY_ACTIVITY_NOT_FOUND',
      });
    }
    return Object.freeze({
      ...this.store.publicSnapshot(20),
      capabilities: Object.freeze({ ...this.adapter.capabilities }),
    });
  }

  async refreshBalance(accessToken) {
    if (!this.refreshPromise) {
      this.refreshPromise = this.adapter.fetchWallet({ accessToken })
        .then((wallet) => {
          if (
            this.adapter.capabilities?.selfServiceBinding
            || this.adapter.isConfigured?.()
          ) this.store.setSelfServiceMapping(true);
          return this.store.recordBalance(wallet);
        })
        .catch((error) => {
          if (
            !this.adapter.capabilities?.selfServiceBinding
            && error?.code === 'RELAY_ACCOUNT_NOT_CONFIGURED'
          ) {
            this.store.setSelfServiceMapping(false);
            return this.store.clearBalance(error.code);
          }
          if (
            this.adapter.capabilities?.selfServiceBinding
            && error?.code === 'RELAY_ACCOUNT_NOT_BOUND'
          ) {
            this.store.setSelfServiceMapping(false);
            return this.store.clearBalance(error.code);
          }
          return this.store.markBalanceUnavailable(error?.code || 'RELAY_WALLET_UNAVAILABLE');
        })
        .finally(() => { this.refreshPromise = null; });
    }
    return this.refreshPromise;
  }

  async getSnapshot({ refresh = true, accessToken } = {}) {
    if (refresh) await this.refreshBalance(accessToken);
    return Object.freeze({
      ...this.store.publicSnapshot(20),
      capabilities: Object.freeze({ ...this.adapter.capabilities }),
    });
  }

  /**
   * 网关模式下，Identity 里的账号绑定是 AIFISHER API 的唯一配置真相。
   * 短缓存只是为了避免模型选择器每改一个参数就打一次远端请求；
   * 绑定/解绑成功会立即刷新这个状态。
   */
  async getBindingConfiguration({ accessToken, refresh = true } = {}) {
    if (!this.adapter.capabilities?.selfServiceBinding) {
      return Object.freeze({ relayAccountManaged: false, relayAccountBound: false });
    }

    const canReadRemote = typeof this.adapter.getBindingStatus === 'function';
    const now = Number(this.clock());
    const cacheExpired = !this.bindingStatusCheckedAt
      || now - this.bindingStatusCheckedAt >= this.bindingStatusTtlMs;
    if (refresh && canReadRemote && cacheExpired && !this.bindingStatusPromise) {
      this.bindingStatusPromise = this.adapter.getBindingStatus({ accessToken })
        .then(({ bound }) => {
          const snapshot = this.store.publicSnapshot();
          const wasBound = snapshot.mappingStatus === 'linked';
          if (wasBound !== bound) this.store.setSelfServiceMapping(bound);
          if (!bound && (
            snapshot.balance.amount != null
            || snapshot.balance.errorCode !== 'RELAY_ACCOUNT_NOT_BOUND'
          )) this.store.clearBalance('RELAY_ACCOUNT_NOT_BOUND');
        })
        .catch(() => {
          // 身份服务短暂离线时保留上次可信状态，不把已绑定误报为未绑定。
        })
        .finally(() => {
          this.bindingStatusCheckedAt = Number(this.clock());
          this.bindingStatusPromise = null;
        });
    }
    if (refresh && this.bindingStatusPromise) await this.bindingStatusPromise;
    return Object.freeze({
      relayAccountManaged: true,
      relayAccountBound: this.store.publicSnapshot().mappingStatus === 'linked',
    });
  }

  async bindApiKey({ accessToken, apiKey } = {}) {
    if (!this.adapter.capabilities?.selfServiceBinding) {
      throw Object.assign(new Error('Self-service relay binding is unavailable'), {
        code: 'RELAY_CAPABILITY_UNSUPPORTED',
      });
    }
    const result = await this.adapter.bindApiKey({ accessToken, apiKey });
    this.store.setSelfServiceMapping(true);
    this.bindingStatusCheckedAt = Number(this.clock());
    if (result?.wallet) {
      this.store.recordBalance({
        ...result.wallet,
        observedAt: result.verifiedAt,
      });
    }
    return this.getSnapshot({ refresh: false, accessToken });
  }

  async unbindApiKey({ accessToken } = {}) {
    if (!this.adapter.capabilities?.selfServiceBinding) {
      throw Object.assign(new Error('Self-service relay binding is unavailable'), {
        code: 'RELAY_CAPABILITY_UNSUPPORTED',
      });
    }
    await this.adapter.unbindApiKey({ accessToken });
    this.store.setSelfServiceMapping(false);
    this.bindingStatusCheckedAt = Number(this.clock());
    this.store.clearBalance('RELAY_ACCOUNT_NOT_BOUND');
    return this.getSnapshot({ refresh: false, accessToken });
  }

  async ensureExternalAccount() {
    const key = `provision:${this.store.opaqueUserId}`;
    if (!this.adapter.capabilities?.userProvisioning) {
      return this.store.ensureUnsupportedMapping();
    }
    const current = this.store.enqueueOutbox({
      type: 'provision-user',
      idempotencyKey: key,
      status: 'pending',
    });
    if (current.status === 'completed') return current;

    const alias = externalAlias(this.store.opaqueUserId, this.namespaceSecret);
    const provisioned = await this.adapter.provisionUser({
      idempotencyKey: `provision:${alias}`,
      externalAlias: alias,
    });
    this.store.updateOutbox(key, {
      status: 'compensation-required',
      payload: { externalUserRef: provisioned.externalUserRef },
    });
    try {
      const issued = this.adapter.capabilities?.perUserKey
        ? await this.adapter.issueUserKey({
          externalUserRef: provisioned.externalUserRef,
          idempotencyKey: `issue-key:${alias}`,
        })
        : null;
      this.store.linkMapping({
        externalUserRef: provisioned.externalUserRef,
        externalKeyRef: issued?.externalKeyRef || null,
      });
      return this.store.updateOutbox(key, { status: 'completed', payload: null, errorCode: null });
    } catch (error) {
      this.store.updateOutbox(key, {
        status: 'compensation-required',
        errorCode: 'RELAY_MAPPING_PERSIST_FAILED',
      });
      throw error;
    }
  }

  async drainCompensations() {
    const entries = this.store.listOutbox('compensation-required');
    const results = [];
    for (const entry of entries) {
      const externalUserRef = entry.payload?.externalUserRef;
      if (!externalUserRef || !this.adapter.capabilities?.userRevocation) {
        results.push(this.store.updateOutbox(entry.idempotencyKey, {
          status: 'blocked',
          errorCode: 'RELAY_REVOCATION_UNSUPPORTED',
        }));
        continue;
      }
      try {
        const alias = externalAlias(this.store.opaqueUserId, this.namespaceSecret);
        await this.adapter.revokeUser({
          externalUserRef,
          idempotencyKey: `revoke:${alias}`,
        });
        results.push(this.store.updateOutbox(entry.idempotencyKey, {
          status: 'compensated',
          payload: null,
          errorCode: null,
          attempts: entry.attempts + 1,
        }));
      } catch {
        results.push(this.store.updateOutbox(entry.idempotencyKey, {
          status: 'compensation-required',
          errorCode: 'RELAY_REVOCATION_FAILED',
          attempts: entry.attempts + 1,
        }));
      }
    }
    return results;
  }
}
