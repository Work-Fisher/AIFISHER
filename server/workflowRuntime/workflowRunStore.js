import crypto from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256Bytes, sha256Json } from './workflowFormat.js';
import {
  assertWorkflowStorageIsPrivate,
  resolveWorkflowStorageDirectory,
} from './workflowStoragePaths.js';

const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const SHA256 = /^[a-f\d]{64}$/i;
const IDEMPOTENCY_STATES = new Set([
  'reserved',
  'admitted',
  'rejected',
  'interrupted-before-admission',
]);

export class WorkflowRunStoreError extends Error {
  constructor(message, code = 'WORKFLOW_RUN_STORE_ERROR', status = 400) {
    super(message);
    this.name = 'WorkflowRunStoreError';
    this.code = code;
    this.status = status;
  }
}

function assertUuid(value, label) {
  const normalized = String(value || '');
  if (!UUID.test(normalized)) {
    throw new WorkflowRunStoreError(`${label}无效`, 'INVALID_WORKFLOW_RUN_REFERENCE');
  }
  return normalized;
}

function assertHash(value, label) {
  const normalized = String(value || '');
  if (!SHA256.test(normalized)) {
    throw new WorkflowRunStoreError(`${label}无效`, 'INVALID_WORKFLOW_RUN_HASH');
  }
  return normalized.toLowerCase();
}

async function writeAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  await rename(temporaryPath, filePath);
}

async function readJson(filePath, missingCode) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new WorkflowRunStoreError('工作流运行对象不存在', missingCode, 404);
    }
    if (error instanceof WorkflowRunStoreError) throw error;
    throw new WorkflowRunStoreError('工作流运行对象损坏', 'WORKFLOW_RUN_INTEGRITY_ERROR', 409);
  }
}

function proofPayload(proof) {
  return {
    runId: proof.runId,
    status: proof.status,
    receiptPayloadHash: proof.receiptPayloadHash,
    finishedAt: proof.finishedAt,
  };
}

export class WorkflowRunStore {
  constructor({ libraryDirectory, storageDirectory }) {
    this.libraryDirectory = path.resolve(libraryDirectory);
    this.rootDirectory = resolveWorkflowStorageDirectory({ libraryDirectory, storageDirectory });
    this.idempotencyDirectory = path.join(this.rootDirectory, 'idempotency', 'test-runs');
    this.ledgersDirectory = path.join(this.rootDirectory, 'input-stage-ledgers');
    this.pendingReceiptsDirectory = path.join(this.rootDirectory, 'pending-receipts');
    this.receiptsDirectory = path.join(this.rootDirectory, 'test-run-receipts');
    this.mutationLocks = new Map();
  }

  async init() {
    await mkdir(this.rootDirectory, { recursive: true });
    await assertWorkflowStorageIsPrivate({
      libraryDirectory: this.libraryDirectory,
      storageDirectory: this.rootDirectory,
    });
    await Promise.all([
      mkdir(this.idempotencyDirectory, { recursive: true }),
      mkdir(this.ledgersDirectory, { recursive: true }),
      mkdir(this.pendingReceiptsDirectory, { recursive: true }),
      mkdir(this.receiptsDirectory, { recursive: true }),
    ]);
  }

  idempotencyPath(key) {
    return path.join(this.idempotencyDirectory, `${sha256Bytes(key)}.json`);
  }

  async withLock(key, operation) {
    const previous = this.mutationLocks.get(key) || Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.mutationLocks.set(key, current);
    try {
      return await current;
    } finally {
      if (this.mutationLocks.get(key) === current) this.mutationLocks.delete(key);
    }
  }

  async reserveIdempotency({ key, fingerprint, runId, ownerToken }) {
    await this.init();
    const normalizedKey = assertUuid(key, 'Idempotency-Key');
    const record = {
      schemaVersion: 1,
      keyHash: sha256Bytes(normalizedKey),
      fingerprint: assertHash(fingerprint, '请求指纹'),
      runId: assertUuid(runId, '运行标识'),
      ownerToken: assertUuid(ownerToken, '幂等所有者标识'),
      state: 'reserved',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const filePath = this.idempotencyPath(normalizedKey);
    try {
      await writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
      });
      return { owner: true, record };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const existing = await readJson(filePath, 'IDEMPOTENCY_RECORD_NOT_FOUND');
      if (existing.fingerprint !== record.fingerprint) {
        throw new WorkflowRunStoreError(
          'Idempotency-Key 已用于不同的测试请求',
          'IDEMPOTENCY_CONFLICT',
          409,
        );
      }
      return { owner: false, record: existing };
    }
  }

  async updateAdmission({ key, ownerToken, state, code = null }) {
    if (!IDEMPOTENCY_STATES.has(state)) {
      throw new WorkflowRunStoreError('幂等状态无效', 'INVALID_IDEMPOTENCY_STATE');
    }
    const normalizedKey = assertUuid(key, 'Idempotency-Key');
    return this.withLock(`idempotency:${normalizedKey}`, async () => {
      const filePath = this.idempotencyPath(normalizedKey);
      const record = await readJson(filePath, 'IDEMPOTENCY_RECORD_NOT_FOUND');
      if (record.ownerToken !== ownerToken) {
        throw new WorkflowRunStoreError('幂等记录所有者冲突', 'IDEMPOTENCY_OWNER_CONFLICT', 409);
      }
      const next = {
        ...record,
        state,
        code,
        updatedAt: new Date().toISOString(),
      };
      await writeAtomic(filePath, next);
      return next;
    });
  }

  async getIdempotency(key) {
    const normalizedKey = assertUuid(key, 'Idempotency-Key');
    return readJson(this.idempotencyPath(normalizedKey), 'IDEMPOTENCY_RECORD_NOT_FOUND');
  }

  async recoverReservedAdmissions(taskJournal) {
    await this.init();
    const entries = await readdir(this.idempotencyDirectory, { withFileTypes: true });
    const recovered = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const filePath = path.join(this.idempotencyDirectory, entry.name);
      const record = await readJson(filePath, 'IDEMPOTENCY_RECORD_NOT_FOUND');
      if (record.state !== 'reserved') continue;
      const task = taskJournal.get(record.runId);
      const next = {
        ...record,
        state: task ? 'admitted' : 'interrupted-before-admission',
        code: task ? null : 'WORKFLOW_ADMISSION_INTERRUPTED',
        updatedAt: new Date().toISOString(),
      };
      await writeAtomic(filePath, next);
      recovered.push(next);
    }
    return recovered;
  }

  async saveInputStageLedger(runId, ledger) {
    await this.init();
    const id = assertUuid(runId, '运行标识');
    const record = {
      schemaVersion: 1,
      runId: id,
      ...ledger,
      updatedAt: new Date().toISOString(),
    };
    await writeAtomic(path.join(this.ledgersDirectory, `${id}.json`), record);
    return record;
  }

  async requireInputStageLedger(runId) {
    const id = assertUuid(runId, '运行标识');
    return readJson(
      path.join(this.ledgersDirectory, `${id}.json`),
      'INPUT_STAGE_LEDGER_NOT_FOUND',
    );
  }

  async reserveRetainedCache({ runId, deploymentId, totalBytes, entries, maximumBytes }) {
    return this.withLock('__retained-cache-quota__', async () => {
      const usage = await this.getRetainedCacheUsage();
      const requested = new Map();
      const targetDeploymentId = assertUuid(deploymentId, '缓存部署标识');
      for (const entry of entries || []) {
        assertHash(entry?.sha256, '缓存素材哈希');
        const bytes = Number(entry?.bytes);
        const relativeHandle = String(entry?.relativeHandle || '');
        if (!Number.isSafeInteger(bytes) || bytes < 0) {
          throw new WorkflowRunStoreError('缓存素材大小无效', 'INVALID_WORKFLOW_CACHE_ENTRY');
        }
        if (!relativeHandle || relativeHandle.length > 600 || /[\0\r\n]/.test(relativeHandle)) {
          throw new WorkflowRunStoreError('缓存素材句柄无效', 'INVALID_WORKFLOW_CACHE_ENTRY');
        }
        const targetKey = `${targetDeploymentId}\n${relativeHandle}`;
        requested.set(targetKey, Math.max(requested.get(targetKey) || 0, bytes));
      }
      const additionalBytes = Array.from(requested.entries()).reduce(
        (total, [targetKey, bytes]) => (usage.targets.has(targetKey) ? total : total + bytes),
        0,
      );
      if (usage.bytes + additionalBytes > maximumBytes) {
        throw new WorkflowRunStoreError(
          'AIFISHER 管理的 ComfyUI 输入缓存将超过 20 GiB，请配置输入目录清理授权',
          'WORKFLOW_CACHE_QUOTA_EXCEEDED',
          413,
        );
      }
      return this.saveInputStageLedger(runId, {
        deploymentId,
        cleanupState: 'retained-cache',
        totalBytes,
        entries,
      });
    });
  }

  async listInputStageLedgers() {
    await this.init();
    const ledgers = [];
    const entries = await readdir(this.ledgersDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const runId = entry.name.slice(0, -5);
      if (!UUID.test(runId)) continue;
      ledgers.push(await readJson(
        path.join(this.ledgersDirectory, entry.name),
        'INPUT_STAGE_LEDGER_NOT_FOUND',
      ));
    }
    return ledgers;
  }

  async getRetainedCacheUsage() {
    await this.init();
    const targets = new Map();
    const hashes = new Set();
    const entries = await readdir(this.ledgersDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      let ledger;
      try {
        ledger = await readJson(
          path.join(this.ledgersDirectory, entry.name),
          'INPUT_STAGE_LEDGER_NOT_FOUND',
        );
      } catch {
        continue;
      }
      for (const item of ledger.entries || []) {
        const hash = String(item?.sha256 || '').toLowerCase();
        const bytes = Number(item?.bytes);
        const deploymentId = String(ledger.deploymentId || '');
        const relativeHandle = String(item?.relativeHandle || '');
        if (
          ledger.cleanupState === 'retained-cache'
          && ['uploading', 'retained-cache'].includes(item?.state)
          && UUID.test(deploymentId)
          && SHA256.test(hash)
          && relativeHandle
          && relativeHandle.length <= 600
          && !/[\0\r\n]/.test(relativeHandle)
          && Number.isSafeInteger(bytes)
          && bytes >= 0
        ) {
          const targetKey = `${deploymentId}\n${relativeHandle}`;
          targets.set(targetKey, Math.max(targets.get(targetKey) || 0, bytes));
          hashes.add(hash);
        }
      }
    }
    return {
      bytes: Array.from(targets.values()).reduce((total, bytes) => total + bytes, 0),
      hashes,
      targets: new Set(targets.keys()),
    };
  }

  async stagePendingReceipt(runId, payload) {
    await this.init();
    const id = assertUuid(runId, '运行标识');
    const pendingReceiptId = crypto.randomUUID();
    const receiptPayloadHash = sha256Json(payload);
    const record = {
      schemaVersion: 1,
      pendingReceiptId,
      runId: id,
      payload,
      receiptPayloadHash,
      createdAt: new Date().toISOString(),
    };
    await writeFile(
      path.join(this.pendingReceiptsDirectory, `${pendingReceiptId}.json`),
      `${JSON.stringify(record, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx' },
    );
    return record;
  }

  async publishReceipt(pendingReceiptId, schedulerCommitProof) {
    await this.init();
    const pendingId = assertUuid(pendingReceiptId, '待发布凭证标识');
    const pendingPath = path.join(this.pendingReceiptsDirectory, `${pendingId}.json`);
    const pending = await readJson(pendingPath, 'PENDING_RECEIPT_NOT_FOUND');
    if (
      sha256Json(pending.payload) !== pending.receiptPayloadHash
      || pending.payload?.id !== pending.runId
      || schedulerCommitProof?.runId !== pending.runId
      || schedulerCommitProof?.status !== 'success'
      || schedulerCommitProof?.receiptPayloadHash !== pending.receiptPayloadHash
      || sha256Bytes(JSON.stringify(proofPayload(schedulerCommitProof)))
        !== schedulerCommitProof.commitHash
    ) {
      throw new WorkflowRunStoreError('调度提交证明无效', 'SCHEDULER_COMMIT_PROOF_INVALID', 409);
    }
    const receiptWithoutHash = {
      ...pending.payload,
      receiptPayloadHash: pending.receiptPayloadHash,
      schedulerCommitProof,
    };
    const receipt = {
      ...receiptWithoutHash,
      receiptHash: sha256Json(receiptWithoutHash),
    };
    const receiptPath = path.join(this.receiptsDirectory, `${pending.runId}.json`);
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    await unlink(pendingPath);
    return receipt;
  }

  async discardPendingReceipt(pendingReceiptId) {
    const pendingId = assertUuid(pendingReceiptId, '待发布凭证标识');
    await unlink(path.join(this.pendingReceiptsDirectory, `${pendingId}.json`)).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }

  async recoverPendingReceipts(taskJournal) {
    await this.init();
    const entries = await readdir(this.pendingReceiptsDirectory, { withFileTypes: true });
    const recovered = [];
    for (const entry of entries) {
      if (!entry.isFile() || !UUID.test(path.basename(entry.name, '.json'))) continue;
      const pendingReceiptId = path.basename(entry.name, '.json');
      const pending = await readJson(
        path.join(this.pendingReceiptsDirectory, entry.name),
        'PENDING_RECEIPT_NOT_FOUND',
      );
      const task = taskJournal.get(pending.runId);
      if (
        task?.status !== 'success'
        || task.pendingReceiptId !== pendingReceiptId
        || task.receiptPayloadHash !== pending.receiptPayloadHash
        || !task.schedulerCommitProof
      ) {
        continue;
      }
      try {
        recovered.push(await this.publishReceipt(pendingReceiptId, task.schedulerCommitProof));
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        const receipt = await this.requireReceipt(pending.runId);
        if (receipt.receiptPayloadHash !== pending.receiptPayloadHash) {
          throw new WorkflowRunStoreError(
            '已发布凭证与待恢复凭证冲突',
            'RECEIPT_RECOVERY_CONFLICT',
            409,
          );
        }
        await this.discardPendingReceipt(pendingReceiptId);
        recovered.push(receipt);
      }
    }
    return recovered;
  }

  async recoverPendingReceipt(runId, task) {
    const id = assertUuid(runId, '运行标识');
    return this.withLock(`receipt:${id}`, async () => {
      try {
        return await this.requireReceipt(id);
      } catch (error) {
        if (error?.code !== 'TEST_RUN_RECEIPT_NOT_FOUND') throw error;
      }
      const pendingReceiptId = assertUuid(task?.pendingReceiptId, '待发布凭证标识');
      const pending = await readJson(
        path.join(this.pendingReceiptsDirectory, `${pendingReceiptId}.json`),
        'PENDING_RECEIPT_NOT_FOUND',
      );
      if (
        task?.status !== 'success'
        || pending.runId !== id
        || task.receiptPayloadHash !== pending.receiptPayloadHash
        || !task.schedulerCommitProof
      ) {
        throw new WorkflowRunStoreError(
          '待恢复凭证与调度终态冲突',
          'RECEIPT_RECOVERY_CONFLICT',
          409,
        );
      }
      try {
        return await this.publishReceipt(pendingReceiptId, task.schedulerCommitProof);
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        const receipt = await this.requireReceipt(id);
        if (receipt.receiptPayloadHash !== pending.receiptPayloadHash) {
          throw new WorkflowRunStoreError(
            '已发布凭证与待恢复凭证冲突',
            'RECEIPT_RECOVERY_CONFLICT',
            409,
          );
        }
        await this.discardPendingReceipt(pendingReceiptId);
        return receipt;
      }
    });
  }

  async requireReceipt(runId) {
    const id = assertUuid(runId, '运行标识');
    const receipt = await readJson(
      path.join(this.receiptsDirectory, `${id}.json`),
      'TEST_RUN_RECEIPT_NOT_FOUND',
    );
    const { receiptHash, ...withoutHash } = receipt;
    const {
      receiptPayloadHash,
      schedulerCommitProof,
      ...payload
    } = withoutHash;
    if (
      sha256Json(withoutHash) !== receiptHash
      || sha256Json(payload) !== receiptPayloadHash
      || schedulerCommitProof?.runId !== id
      || schedulerCommitProof?.status !== 'success'
      || schedulerCommitProof?.receiptPayloadHash !== receiptPayloadHash
      || sha256Bytes(JSON.stringify(proofPayload(schedulerCommitProof)))
        !== schedulerCommitProof?.commitHash
    ) {
      throw new WorkflowRunStoreError('测试凭证完整性校验失败', 'RECEIPT_INTEGRITY_ERROR', 409);
    }
    return receipt;
  }
}
