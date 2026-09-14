import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

export class AgentSessionStoreError extends Error {
  constructor(message, status = 500, code = 'AGENT_SESSION_STORE_FAILED') {
    super(message);
    this.name = 'AgentSessionStoreError';
    this.status = status;
    this.code = code;
  }
}

function sessionHash(sessionId) {
  return crypto.createHash('sha256').update(sessionId).digest('hex');
}

async function writeJsonAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`,
  );
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
    if (fs.existsSync(filePath)) await copyFile(filePath, `${filePath}.bak`);
    try {
      await rename(temporaryPath, filePath);
    } catch (error) {
      if (!['EEXIST', 'EPERM'].includes(error?.code)) throw error;
      await copyFile(temporaryPath, filePath);
    }
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function parseSession(raw, expectedId) {
  let session;
  try {
    session = JSON.parse(raw);
  } catch {
    throw new AgentSessionStoreError(
      'Agent 会话记录损坏，请从历史记录中删除后重试',
      500,
      'AGENT_SESSION_CORRUPT',
    );
  }
  if (
    !session
    || session.version !== 1
    || session.id !== expectedId
    || !Array.isArray(session.messages)
  ) {
    throw new AgentSessionStoreError(
      'Agent 会话记录格式无效',
      500,
      'AGENT_SESSION_CORRUPT',
    );
  }
  return session;
}

export function createAgentSessionStore({ libraryDirectory }) {
  const sessionsDirectory = path.join(libraryDirectory, 'agent', 'sessions');
  const trashDirectory = path.join(libraryDirectory, 'agent', '.trash');
  const writeQueues = new Map();

  function filePathFor(sessionId) {
    return path.join(sessionsDirectory, `${sessionHash(sessionId)}.json`);
  }

  function enqueue(sessionId, operation) {
    const previous = writeQueues.get(sessionId) || Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    writeQueues.set(sessionId, current);
    return current.finally(() => {
      if (writeQueues.get(sessionId) === current) writeQueues.delete(sessionId);
    });
  }

  async function get(sessionId) {
    const filePath = filePathFor(sessionId);
    try {
      return parseSession(await readFile(filePath, 'utf8'), sessionId);
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async function save(session) {
    return enqueue(session.id, async () => {
      const record = {
        version: 1,
        id: session.id,
        topic: session.topic || 'New Chat',
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messages: session.messages,
        ...(Object.hasOwn(session, 'selectedSkill') ? { selectedSkill: session.selectedSkill } : {}),
        ...(session.skillProjectId ? { skillProjectId: session.skillProjectId } : {}),
        ...(session.workflow ? { workflow: session.workflow } : {}),
        ...(session.workflowVariants ? { workflowVariants: session.workflowVariants } : {}),
      };
      await writeJsonAtomic(filePathFor(session.id), record);
      return record;
    });
  }

  async function list() {
    await mkdir(sessionsDirectory, { recursive: true });
    const files = (await readdir(sessionsDirectory)).filter((name) => name.endsWith('.json'));
    const sessions = [];
    for (const name of files) {
      try {
        const raw = await readFile(path.join(sessionsDirectory, name), 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed?.version !== 1 || typeof parsed?.id !== 'string' || !Array.isArray(parsed.messages)) {
          continue;
        }
        sessions.push({
          id: parsed.id,
          topic: parsed.topic || 'New Chat',
          createdAt: parsed.createdAt,
          updatedAt: parsed.updatedAt || parsed.createdAt,
          messageCount: parsed.messages.length,
        });
      } catch {
        // A damaged record is preserved for recovery and omitted from the list.
      }
    }
    return sessions.sort((left, right) =>
      String(right.updatedAt).localeCompare(String(left.updatedAt)),
    );
  }

  async function remove(sessionId) {
    return enqueue(sessionId, async () => {
      const sourcePath = filePathFor(sessionId);
      if (!fs.existsSync(sourcePath)) return false;
      await mkdir(trashDirectory, { recursive: true });
      const trashPath = path.join(
        trashDirectory,
        `${Date.now()}-${sessionHash(sessionId)}.json`,
      );
      await rename(sourcePath, trashPath);
      return true;
    });
  }

  return { get, save, list, remove };
}
