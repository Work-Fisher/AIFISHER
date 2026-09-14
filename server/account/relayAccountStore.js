import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { assertCanonicalOpaqueUserId } from '../workspace/userScopeResolver.js';

const TASK_STATUSES = new Set(['loading', 'success', 'failed', 'cancelled', 'unknown', 'conflict']);
const BILLING_CLASSES = new Set(['actual', 'estimate', 'preauthorization', 'pending', 'unknown']);
const CURRENCIES = /^[A-Z]{3}$/;
const RECEIPT_ID = /^[A-Za-z0-9._:-]{8,160}$/;
const FAILURE_MESSAGES = Object.freeze({
  GENERATION_CANCELLED: '生成已取消；费用状态需以最终账单为准。',
  GENERATION_FAILED: '生成失败；失败不等于零费用。',
  GENERATION_INTERRUPTED: '生成服务曾中断；费用状态尚未确认。',
  GENERATION_LEASE_EXPIRED: '生成任务超时；费用状态尚未确认。',
  WORKFLOW_RUN_TIMEOUT: '任务超时；费用状态尚未确认。',
  RELAY_RECEIPT_CONFLICT: '结算凭据冲突，金额已降级为未知。',
});

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function initialState() {
  return {
    version: 1,
    mapping: {
      status: 'unlinked',
      externalUserRef: null,
      externalKeyRef: null,
      updatedAt: null,
    },
    balance: null,
    activities: [],
    receipts: {},
    outbox: [],
  };
}

function atomicWrite(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

function safeText(value, maximum = 120) {
  return String(value || '')
    .normalize('NFKC')
    // eslint-disable-next-line no-control-regex -- Deliberately reject or strip control characters.
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, maximum);
}

function safeCode(value, fallback = 'GENERATION_FAILED') {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z][A-Z0-9_]{2,63}$/.test(code) ? code : fallback;
}

export function sanitizeRelayFailure(value) {
  const code = safeCode(value?.code);
  return Object.freeze({
    code,
    message: FAILURE_MESSAGES[code] || FAILURE_MESSAGES.GENERATION_FAILED,
    retryable: Boolean(value?.retryable),
  });
}

function normalizedDate(value, fallback) {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback;
}

function normalizedAmount(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 && amount <= 1_000_000 ? amount : null;
}

function publicBilling(value) {
  if (!BILLING_CLASSES.has(value?.classification)) {
    return { classification: 'unknown', amount: null, currency: null, evidence: 'invalid-state' };
  }
  const currency = String(value.currency || '').toUpperCase();
  return {
    classification: value.classification,
    amount: normalizedAmount(value.amount),
    currency: CURRENCIES.test(currency) ? currency : null,
    evidence: safeText(value.evidence, 80) || 'unknown',
  };
}

function maskedTaskReference(value) {
  const taskId = safeText(value, 180);
  if (!taskId) return null;
  return taskId.length <= 8 ? '••••' : `••••${taskId.slice(-6)}`;
}

function activityId(localTaskId) {
  return `generation:${safeText(localTaskId, 180)}`;
}

function receiptHash(receipt) {
  return crypto.createHash('sha256').update(JSON.stringify({
    receiptId: receipt.receiptId,
    localTaskId: receipt.localTaskId,
    upstreamTaskId: receipt.upstreamTaskId || null,
    amount: receipt.amount,
    currency: receipt.currency,
    occurredAt: receipt.occurredAt,
    final: receipt.final,
  })).digest('hex');
}

function applyReceiptToActivity(activity, receipt, updatedAt) {
  activity.status = 'success';
  activity.billing = {
    classification: 'actual',
    amount: receipt.amount,
    currency: receipt.currency,
    evidence: 'final-settlement-receipt',
    receiptId: receipt.receiptId,
  };
  activity.failure = null;
  activity.latestReceiptAt = receipt.occurredAt;
  activity.updatedAt = updatedAt;
}

export class RelayAccountStore {
  constructor({
    privateDirectory,
    opaqueUserId,
    now = () => new Date(),
    writeState = atomicWrite,
    maxActivities = 200,
  } = {}) {
    if (!privateDirectory) throw new Error('RelayAccountStore requires privateDirectory');
    this.opaqueUserId = assertCanonicalOpaqueUserId(opaqueUserId);
    this.filePath = path.join(path.resolve(privateDirectory), 'relay-account', 'state.json');
    this.now = now;
    this.writeState = writeState;
    this.maxActivities = Math.max(20, Number(maxActivities) || 200);
    this.state = initialState();
    this.load();
  }

  load() {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (parsed?.version !== 1 || !Array.isArray(parsed.activities) || !Array.isArray(parsed.outbox)) {
        throw new Error('invalid relay account state');
      }
      this.state = {
        ...initialState(),
        ...parsed,
        activities: parsed.activities.map((activity) => ({
          ...activity,
          taskObserved: activity.taskObserved !== false,
        })),
      };
    } catch {
      const quarantinePath = `${this.filePath}.corrupt-${this.now().getTime()}`;
      fs.renameSync(this.filePath, quarantinePath);
      this.state = initialState();
    }
  }

  transaction(mutator) {
    const next = clone(this.state);
    const result = mutator(next);
    next.activities = next.activities
      .sort((left, right) => String(left.updatedAt).localeCompare(String(right.updatedAt)))
      .slice(-this.maxActivities);
    this.writeState(this.filePath, next);
    this.state = next;
    return clone(result);
  }

  assertUser(opaqueUserId) {
    if (assertCanonicalOpaqueUserId(opaqueUserId) !== this.opaqueUserId) {
      throw Object.assign(new Error('Relay account user scope mismatch'), {
        code: 'USER_SCOPE_MISMATCH',
      });
    }
  }

  enqueueOutbox({ type, idempotencyKey, status = 'pending', payload = null, errorCode = null }) {
    const key = safeText(idempotencyKey, 200);
    if (!key) throw new Error('Relay outbox idempotencyKey is required');
    return this.transaction((state) => {
      const existing = state.outbox.find((entry) => entry.idempotencyKey === key);
      if (existing) return existing;
      const timestamp = this.now().toISOString();
      const entry = {
        id: crypto.randomUUID(),
        type: safeText(type, 80),
        idempotencyKey: key,
        status,
        attempts: 0,
        payload: payload ? clone(payload) : null,
        errorCode: errorCode ? safeCode(errorCode, 'RELAY_OPERATION_FAILED') : null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      state.outbox.push(entry);
      return entry;
    });
  }

  updateOutbox(idempotencyKey, patch) {
    return this.transaction((state) => {
      const entry = state.outbox.find((candidate) => candidate.idempotencyKey === idempotencyKey);
      if (!entry) throw new Error('Relay outbox entry was not found');
      Object.assign(entry, clone(patch), { updatedAt: this.now().toISOString() });
      return entry;
    });
  }

  listOutbox(status) {
    return clone(this.state.outbox.filter((entry) => !status || entry.status === status));
  }

  ensureUnsupportedMapping() {
    const entry = this.enqueueOutbox({
      type: 'provision-user',
      idempotencyKey: `provision:${this.opaqueUserId}`,
      status: 'blocked',
      errorCode: 'RELAY_CAPABILITY_UNSUPPORTED',
    });
    this.transaction((state) => {
      state.mapping.status = 'unsupported';
      state.mapping.updatedAt = this.now().toISOString();
    });
    return entry;
  }

  linkMapping({ externalUserRef, externalKeyRef = null }) {
    const userRef = safeText(externalUserRef, 180);
    if (!userRef) throw new Error('External user reference is required');
    return this.transaction((state) => {
      state.mapping = {
        status: 'linked',
        externalUserRef: userRef,
        externalKeyRef: externalKeyRef ? safeText(externalKeyRef, 180) : null,
        updatedAt: this.now().toISOString(),
      };
      return state.mapping;
    });
  }

  setSelfServiceMapping(bound) {
    return this.transaction((state) => {
      state.mapping = {
        status: bound ? 'linked' : 'unlinked',
        externalUserRef: null,
        externalKeyRef: null,
        updatedAt: this.now().toISOString(),
      };
      return state.mapping;
    });
  }

  recordBalance(snapshot) {
    const amount = normalizedAmount(snapshot?.amount);
    const rawCurrency = snapshot?.currency;
    const currency = rawCurrency == null ? null : String(rawCurrency).toUpperCase();
    if (amount == null || (currency !== null && !CURRENCIES.test(currency))) {
      throw new Error('Invalid relay balance snapshot');
    }
    return this.transaction((state) => {
      state.balance = {
        status: 'available',
        amount,
        currency,
        source: 'relay-wallet-api',
        observedAt: normalizedDate(snapshot.observedAt, this.now().toISOString()),
        errorCode: null,
      };
      return state.balance;
    });
  }

  markBalanceUnavailable(code) {
    return this.transaction((state) => {
      state.balance = state.balance?.amount != null
        ? { ...state.balance, status: 'stale', errorCode: safeCode(code, 'RELAY_WALLET_UNAVAILABLE') }
        : {
          status: 'unknown',
          amount: null,
          currency: null,
          source: 'relay-wallet-api',
          observedAt: null,
          errorCode: safeCode(code, 'RELAY_WALLET_UNAVAILABLE'),
        };
      return state.balance;
    });
  }

  clearBalance(code = 'RELAY_ACCOUNT_NOT_BOUND') {
    return this.transaction((state) => {
      state.balance = {
        status: 'unknown',
        amount: null,
        currency: null,
        source: 'relay-wallet-api',
        observedAt: null,
        errorCode: safeCode(code, 'RELAY_ACCOUNT_NOT_BOUND'),
      };
      return state.balance;
    });
  }

  recordGenerationTask(task) {
    const localTaskId = safeText(task?.nodeId, 180);
    if (!localTaskId) throw new Error('Generation activity requires nodeId');
    const timestamp = this.now().toISOString();
    const status = TASK_STATUSES.has(task?.status) ? task.status : 'unknown';
    const estimatedCost = normalizedAmount(task?.estimatedCost);
    const attemptId = safeText(task?.attemptId, 180);
    return this.transaction((state) => {
      let activity = state.activities.find((entry) => entry.id === activityId(localTaskId));
      if (activity && attemptId && activity.attemptId !== attemptId &&
        (activity.attemptId || activity.status !== 'loading')) {
        // Keep the old attempt and its receipt binding; only the current attempt
        // retains the legacy node lookup used by provider submission callbacks.
        activity.id = `generation-history:${crypto.randomUUID()}`;
        activity = null;
      }
      if (!activity) {
        activity = {
          id: activityId(localTaskId),
          localTaskId,
          upstreamTaskId: null,
          model: safeText(task?.modelName, 120) || '未标注模型',
          source: safeText(task?.providerName, 80) || 'unknown',
          kind: safeText(task?.kind, 40) || 'generation',
          status,
          billing: estimatedCost == null
            ? { classification: 'pending', amount: null, currency: null, evidence: 'task-state' }
            : { classification: 'estimate', amount: estimatedCost, currency: 'CNY', evidence: 'catalog-estimate' },
          failure: null,
          latestReceiptAt: null,
          taskObserved: true,
          createdAt: normalizedDate(task?.createdAt, timestamp),
          updatedAt: timestamp,
        };
        state.activities.push(activity);
      }
      activity.model = safeText(task?.modelName, 120) || activity.model;
      if (attemptId) activity.attemptId = attemptId;
      activity.source = safeText(task?.providerName, 80) || activity.source;
      activity.kind = safeText(task?.kind, 40) || activity.kind;
      activity.status = status;
      activity.taskObserved = true;
      activity.updatedAt = normalizedDate(task?.updatedAt, timestamp);
      if (activity.billing.classification !== 'actual') {
        if (status === 'loading') {
          activity.billing = estimatedCost == null
            ? { classification: 'pending', amount: null, currency: null, evidence: 'task-state' }
            : { classification: 'estimate', amount: estimatedCost, currency: 'CNY', evidence: 'catalog-estimate' };
        } else {
          activity.billing = {
            classification: 'unknown',
            amount: null,
            currency: null,
            evidence: 'final-receipt-unavailable',
          };
        }
      }
      activity.failure = ['failed', 'cancelled', 'unknown'].includes(status)
        ? sanitizeRelayFailure(task)
        : null;
      return activity;
    });
  }

  recordUpstreamTask({ localTaskId, upstreamTaskId, model, kind, estimatedCost }) {
    const base = this.recordGenerationTask({
      nodeId: localTaskId,
      modelName: model,
      providerName: 'relay',
      kind,
      status: 'loading',
      estimatedCost,
    });
    return this.transaction((state) => {
      const activity = state.activities.find((entry) => entry.id === base.id);
      activity.upstreamTaskId = safeText(upstreamTaskId, 180);
      activity.updatedAt = this.now().toISOString();
      const latestReceipt = Object.values(state.receipts)
        .filter((receipt) => (
          receipt.localTaskId === localTaskId
          && receipt.upstreamTaskId === activity.upstreamTaskId
          && !state.outbox.some((entry) => (
            entry.idempotencyKey === `receipt-conflict:${receipt.receiptId}`
          ))
        ))
        .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
        .at(-1);
      if (latestReceipt && (!activity.latestReceiptAt || latestReceipt.occurredAt >= activity.latestReceiptAt)) {
        applyReceiptToActivity(activity, latestReceipt, activity.updatedAt);
      }
      return activity;
    });
  }

  applyFinalReceipt(value) {
    const receipt = {
      receiptId: safeText(value?.receiptId, 160),
      localTaskId: safeText(value?.localTaskId, 180),
      upstreamTaskId: safeText(value?.upstreamTaskId, 180) || null,
      amount: normalizedAmount(value?.amount),
      currency: String(value?.currency || '').toUpperCase(),
      occurredAt: normalizedDate(value?.occurredAt, ''),
      final: value?.final === true,
    };
    if (
      !RECEIPT_ID.test(receipt.receiptId)
      || !receipt.localTaskId
      || !receipt.upstreamTaskId
      || receipt.amount == null
      || !CURRENCIES.test(receipt.currency)
      || !receipt.occurredAt
      || !receipt.final
    ) throw new Error('Invalid final settlement receipt');
    const hash = receiptHash(receipt);
    return this.transaction((state) => {
      const existing = state.receipts[receipt.receiptId];
      if (existing?.hash === hash) return { outcome: 'duplicate', receipt: existing };
      let activity = state.activities.find((entry) => entry.localTaskId === receipt.localTaskId
        && entry.upstreamTaskId === receipt.upstreamTaskId)
        || state.activities.find((entry) => entry.id === activityId(receipt.localTaskId));
      if (existing && existing.hash !== hash) {
        if (!activity) return { outcome: 'conflict' };
        activity.status = 'conflict';
        activity.billing = {
          classification: 'unknown',
          amount: null,
          currency: null,
          evidence: 'receipt-conflict',
        };
        activity.failure = sanitizeRelayFailure({ code: 'RELAY_RECEIPT_CONFLICT' });
        activity.updatedAt = this.now().toISOString();
        const key = `receipt-conflict:${receipt.receiptId}`;
        if (!state.outbox.some((entry) => entry.idempotencyKey === key)) {
          state.outbox.push({
            id: crypto.randomUUID(),
            type: 'receipt-conflict',
            idempotencyKey: key,
            status: 'blocked',
            attempts: 0,
            payload: null,
            errorCode: 'RELAY_RECEIPT_CONFLICT',
            createdAt: activity.updatedAt,
            updatedAt: activity.updatedAt,
          });
        }
        return { outcome: 'conflict' };
      }
      if (
        activity?.taskObserved
        && activity.upstreamTaskId
        && activity.upstreamTaskId !== receipt.upstreamTaskId
      ) {
        const key = `receipt-task-mismatch:${receipt.receiptId}`;
        if (!state.outbox.some((entry) => entry.idempotencyKey === key)) {
          const timestamp = this.now().toISOString();
          state.outbox.push({
            id: crypto.randomUUID(),
            type: 'receipt-task-mismatch',
            idempotencyKey: key,
            status: 'blocked',
            attempts: 0,
            payload: null,
            errorCode: 'RELAY_RECEIPT_TASK_MISMATCH',
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
        return { outcome: 'mismatch' };
      }
      state.receipts[receipt.receiptId] = { ...receipt, hash };
      if (!activity) {
        const timestamp = this.now().toISOString();
        activity = {
          id: activityId(receipt.localTaskId),
          localTaskId: receipt.localTaskId,
          upstreamTaskId: receipt.upstreamTaskId,
          model: '未标注模型',
          source: 'relay',
          kind: 'generation',
          status: 'unknown',
          billing: {
            classification: 'pending',
            amount: null,
            currency: null,
            evidence: 'final-receipt-awaiting-task-reference',
          },
          failure: null,
          latestReceiptAt: null,
          taskObserved: false,
          createdAt: receipt.occurredAt,
          updatedAt: timestamp,
        };
        state.activities.push(activity);
        return { outcome: 'pending', receipt: state.receipts[receipt.receiptId] };
      }
      if (!activity.taskObserved || !activity.upstreamTaskId) {
        return { outcome: 'pending', receipt: state.receipts[receipt.receiptId] };
      }
      if (!activity.latestReceiptAt || receipt.occurredAt >= activity.latestReceiptAt) {
        applyReceiptToActivity(activity, receipt, this.now().toISOString());
      }
      return { outcome: 'applied', receipt: state.receipts[receipt.receiptId] };
    });
  }

  removeActivity(activityIdentifier) {
    const identifier = safeText(activityIdentifier, 200);
    if (!identifier) return false;
    if (!this.state.activities.some((activity) => activity.id === identifier)) return false;
    return this.transaction((state) => {
      const index = state.activities.findIndex((activity) => activity.id === identifier);
      if (index < 0) return false;
      state.activities.splice(index, 1);
      return true;
    });
  }

  publicSnapshot(limit = 20) {
    const activities = [...this.state.activities]
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
      .slice(0, Math.min(20, Math.max(1, Number(limit) || 20)))
      .map((activity) => ({
        id: activity.id,
        model: activity.model,
        source: activity.source,
        kind: activity.kind,
        status: activity.status,
        taskReference: maskedTaskReference(activity.upstreamTaskId || activity.localTaskId),
        billing: publicBilling(activity.billing),
        failure: activity.failure ? clone(activity.failure) : null,
        createdAt: activity.createdAt,
        updatedAt: activity.updatedAt,
      }));
    return Object.freeze({
      mappingStatus: this.state.mapping.status,
      balance: clone(this.state.balance) || {
        status: 'unknown',
        amount: null,
        currency: null,
        source: 'relay-wallet-api',
        observedAt: null,
        errorCode: null,
      },
      activities,
    });
  }
}
