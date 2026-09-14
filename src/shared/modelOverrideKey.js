// ASCII-only and collision-free for Chinese names and source suffixes in .env.
export function modelOverrideKey(name) {
  return `MODEL_ID_CUSTOM_${Array.from(name).map((char) => char.codePointAt(0).toString(16)).join('_')}`;
}

/** Returns true for the common provider credential shapes, which must never
 * be accepted as a custom model ID. */
export function isLikelyProviderApiKey(value) {
  const normalized = String(value || '').trim();
  return /^(?:apikey|sk|key)-[A-Za-z0-9][A-Za-z0-9_-]{8,}$/i.test(normalized)
    || /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(normalized);
}
