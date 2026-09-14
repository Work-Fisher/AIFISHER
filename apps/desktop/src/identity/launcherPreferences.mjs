import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { writeFileAtomically } from './atomicFile.mjs';
import { normalizeEmail } from './identityValidation.mjs';

// undefined: no file. Unreadable or malformed files count as empty, as in the Tauri launcher.
async function readDocument(filePath) {
  let text;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    return error?.code === 'ENOENT' ? undefined : { rememberedEmail: null };
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { rememberedEmail: null };
  }
  const valid = Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).every((key) => key === 'rememberedEmail')
    && (value.rememberedEmail === undefined
      || value.rememberedEmail === null
      || typeof value.rememberedEmail === 'string');
  return { rememberedEmail: valid ? normalizeEmail(value.rememberedEmail) : null };
}

export function createLauncherPreferences({ stateDir, legacyTauriPath = null } = {}) {
  if (!stateDir) throw new Error('Launcher preferences directory is required');
  const filePath = path.join(stateDir, 'launcher.json');

  async function save({ rememberedEmail = null } = {}) {
    const email = normalizeEmail(rememberedEmail);
    await writeFileAtomically(
      filePath,
      JSON.stringify(email ? { rememberedEmail: email } : {}, null, 2),
    );
    return { rememberedEmail: email };
  }

  // The new file doubles as the migration marker: once written, the Tauri copy is never read.
  async function load() {
    const current = await readDocument(filePath);
    if (current !== undefined) return current;
    const legacy = legacyTauriPath ? await readDocument(legacyTauriPath) : undefined;
    if (!legacy?.rememberedEmail) return { rememberedEmail: null };
    await save(legacy).catch(() => {});
    return legacy;
  }

  return Object.freeze({ load, save, filePath });
}
