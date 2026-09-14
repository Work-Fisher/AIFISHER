import { resolveMediaArtifact } from '../media/mediaArtifact.js';
import { isComfyPreviewNode, isSavedComfyFile } from './comfySavedOutputs.js';

const MAX_OUTPUT_CANDIDATES = 1_000;
const SAFE_NODE_ID = /^[\p{L}\p{N}_.-]{1,160}$/u;

function unsafePublicString(value) {
  const text = String(value || '');
  return /[\0\r\n]/.test(text)
    || /(?:^|[\s"'(])(?:[A-Za-z]:[\\/]|\\\\|file:\/\/|\/(?!\/)[^\s"'<>]+)/i.test(text)
    || /https?:\/\/[^\s"'<>]+/i.test(text)
    || /(?:api[_ -]?key|authorization|bearer|token|secret|password)\s*[:=]/i.test(text);
}

function safeOutputMetadata(value, label, { nodeId = false } = {}) {
  const text = String(value || '').trim();
  if (
    !text
    || Buffer.byteLength(text, 'utf8') > 160
    || unsafePublicString(text)
    || (nodeId && !SAFE_NODE_ID.test(text))
  ) {
    throw new WorkflowOutputError(`${label}无效`, 'OUTPUT_REFERENCE_INVALID');
  }
  return text;
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export class WorkflowOutputError extends Error {
  constructor(message, code = 'WORKFLOW_OUTPUT_ERROR', status = 409) {
    super(message);
    this.name = 'WorkflowOutputError';
    this.code = code;
    this.status = status;
  }
}

function historyEntry(history, promptId) {
  if (!history || typeof history !== 'object') return null;
  return history[promptId] || history[String(promptId)] || null;
}

export function classifyHistoryState(history, promptId) {
  const entry = historyEntry(history, promptId);
  if (!entry) return { state: 'pending', entry: null };
  const status = entry.status;
  const statusString = String(status?.status_str || '').toLowerCase();
  const completed = status?.completed;
  if (statusString === 'success' && completed === true) return { state: 'success', entry };
  if (['error', 'failed', 'interrupted'].includes(statusString) || completed === false) {
    return { state: 'failed', entry, statusString };
  }
  if (completed === true || statusString) return { state: 'invalid-terminal', entry, statusString };
  return { state: 'pending', entry };
}

function mediaKindFor(outputKey, filename) {
  const normalizedKey = String(outputKey || '').toLowerCase();
  const declaredType = /audio/.test(normalizedKey)
    ? 'audio'
    : /(?:video|gifs?)/.test(normalizedKey)
      ? 'video'
      : /(?:image|mask|frame)/.test(normalizedKey)
        ? 'image'
        : '';
  try {
    return resolveMediaArtifact({ filename, declaredType }).kind;
  } catch {
    return 'json';
  }
}

function isFileHandle(value) {
  return value
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof value.filename === 'string';
}

export function normalizeHistoryOutputs({ history, promptId, executionPlan }) {
  const classified = classifyHistoryState(history, promptId);
  if (classified.state !== 'success') {
    throw new WorkflowOutputError(
      '只有 ComfyUI history 明确成功且 completed=true 才能读取输出',
      classified.state === 'failed'
        ? 'COMFYUI_EXECUTION_FAILED'
        : 'COMFYUI_HISTORY_NOT_SUCCESS',
    );
  }
  const candidates = collectHistoryOutputs(classified.entry, executionPlan);
  if (candidates.length === 0) {
    throw new WorkflowOutputError(
      '工作流已执行成功，但没有可保存的结果。请使用保存节点并开启保存输出；临时预览不会加入素材库。',
      'OUTPUT_NOT_FOUND',
    );
  }
  return candidates;
}

function collectHistoryOutputs(entry, executionPlan) {
  const candidates = [];
  const addCandidate = (candidate) => {
    if (candidates.length >= MAX_OUTPUT_CANDIDATES) {
      throw new WorkflowOutputError(
        'ComfyUI 输出候选超过 1000 项',
        'OUTPUT_CANDIDATE_LIMIT',
        413,
      );
    }
    candidates.push(candidate);
  };
  if (!isPlainRecord(entry?.outputs) || !isPlainRecord(executionPlan)) {
    throw new WorkflowOutputError('ComfyUI 输出结构无效', 'OUTPUT_REFERENCE_INVALID');
  }
  for (const [rawNodeId, nodeOutputs] of Object.entries(entry.outputs)) {
    const nodeId = safeOutputMetadata(rawNodeId, '输出节点标识', { nodeId: true });
    if (!Object.hasOwn(executionPlan, nodeId) || !isPlainRecord(nodeOutputs)) {
      throw new WorkflowOutputError('ComfyUI 输出引用了执行计划外的节点', 'OUTPUT_REFERENCE_INVALID');
    }
    const classType = safeOutputMetadata(
      executionPlan[nodeId]?.class_type,
      '输出节点类型',
    );
    if (isComfyPreviewNode(classType)) continue;
    for (const [rawOutputKey, rawValue] of Object.entries(nodeOutputs)) {
      const outputKey = safeOutputMetadata(rawOutputKey, '输出字段');
      const values = Array.isArray(rawValue) ? rawValue : [rawValue];
      values.forEach((value, outputIndex) => {
        if (isFileHandle(value)) {
          const candidate = {
            nodeId,
            classType,
            outputKey,
            outputIndex,
            mediaKind: mediaKindFor(outputKey, value.filename),
            kind: 'file',
            handle: {
              filename: value.filename,
              subfolder: String(value.subfolder || ''),
              type: value.type,
            },
          };
          if (isSavedComfyFile(candidate, executionPlan)) addCandidate(candidate);
          return;
        }
        addCandidate({
          nodeId,
          classType,
          outputKey,
          outputIndex,
          mediaKind: typeof value === 'string' ? 'text' : 'json',
          kind: 'inline',
          value,
        });
      });
    }
  }
  return candidates;
}

export function normalizeAvailableHistoryOutputs({ history, promptId, executionPlan }) {
  const classified = classifyHistoryState(history, promptId);
  if (!classified.entry || !isPlainRecord(classified.entry.outputs)) return [];
  return collectHistoryOutputs(classified.entry, executionPlan);
}

export function toOutputCandidateDto(candidate) {
  return {
    nodeId: candidate.nodeId,
    classType: candidate.classType,
    outputKey: candidate.outputKey,
    outputIndex: candidate.outputIndex,
    mediaKind: candidate.mediaKind,
    kind: candidate.kind,
  };
}
