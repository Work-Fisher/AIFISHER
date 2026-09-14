import { normalizeMidjourneyPrompt } from '../../shared/midjourneyPrompt.js';

export type PromptPresetType = 'text' | 'image' | 'video' | 'audio';

export type PromptPreset = {
  title: string;
  prompt: string | string[];
  preview?: string;
  [key: string]: unknown;
};

export type PromptPresetCategory = {
  name: string;
  items: PromptPreset[];
  [key: string]: unknown;
};

export type PromptPresetConfig = Record<PromptPresetType, PromptPresetCategory[]> & {
  [key: string]: unknown;
};

export type CreatePromptPresetInput = {
  type: PromptPresetType;
  category: string;
  title: string;
  prompt: string;
  previewBase64?: string | null;
};

export type ParsedPromptTag = {
  label: string;
  prompt: string;
  start: number;
  end: number;
};

const TAG_PATTERN = /\[\[([^|\]]+)\|([\s\S]*?)\]\]/g;

function validatedTagPart(value: string, label: string, maximumLength: number): string {
  const text = String(value ?? '').trim();
  if (!text || text.length > maximumLength || text.includes(']]')) {
    throw new Error(`${label}无法安全保存为提示词标签`);
  }
  return text;
}

export function serializePromptTag(label: string, prompt: string): string {
  const normalizedLabel = validatedTagPart(label, '预设名称', 120);
  if (normalizedLabel.includes('|') || normalizedLabel.includes('[[')) {
    throw new Error('预设名称包含标签保留字符');
  }
  const normalizedPrompt = validatedTagPart(prompt, '提示词内容', 20000);
  return `[[${normalizedLabel}|${normalizedPrompt}]]`;
}

export function parsePromptTags(value: string): ParsedPromptTag[] {
  const text = String(value || '');
  const tags: ParsedPromptTag[] = [];
  for (const match of text.matchAll(TAG_PATTERN)) {
    const start = match.index ?? 0;
    tags.push({
      label: match[1],
      prompt: match[2],
      start,
      end: start + match[0].length,
    });
  }
  return tags;
}

function replacePromptTags(
  value: string,
  replacement: (tag: ParsedPromptTag) => string,
): string {
  const text = String(value || '');
  const tags = parsePromptTags(text);
  if (tags.length === 0) return text;
  let output = '';
  let cursor = 0;
  for (const tag of tags) {
    output += text.slice(cursor, tag.start);
    output += replacement(tag);
    cursor = tag.end;
  }
  return output + text.slice(cursor);
}

export function displayPromptTags(value: string): string {
  return replacePromptTags(value, ({ label }) => `[${label}]`);
}

export function expandPromptTags(value: string, { trailingParameters = false } = {}): string {
  const parameters: string[] = [];
  const expanded = replacePromptTags(value, ({ prompt }) => {
    if (!trailingParameters) return prompt;
    const match = /(?:^|\s)--[a-z][a-z-]*(?=\s|$)/i.exec(prompt);
    if (!match) return prompt;
    parameters.push(prompt.slice(match.index).trim());
    return prompt.slice(0, match.index).trimEnd();
  });
  return trailingParameters
    ? normalizeMidjourneyPrompt([expanded.trim(), ...parameters].filter(Boolean).join('\n'))
    : expanded;
}

function escapeAttribute(value: string): string {
  return value.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function serializedTagsToHtml(escapedText: string): string {
  return replacePromptTags(escapedText, ({ label, prompt }) =>
    `<span data-type="promptTag" data-label="${escapeAttribute(label)}" `
    + `data-prompt="${escapeAttribute(prompt)}"></span>`,
  );
}

async function readJson<T>(response: Response): Promise<T> {
  const result = await response.json() as T & { error?: unknown };
  if (!response.ok) {
    throw new Error(result?.error ? String(result.error) : `提示词预设操作失败 (${response.status})`);
  }
  return result;
}

export function createPromptPresetClient(
  fetcher: typeof fetch = globalThis.fetch,
  now: () => number = Date.now,
) {
  return {
    load(signal?: AbortSignal): Promise<PromptPresetConfig> {
      return fetcher(`/library/prompts/prompt.json?t=${now()}`, { cache: 'no-store', ...(signal ? {signal} : {}) })
        .then((response) => readJson<PromptPresetConfig>(response));
    },
    create(input: CreatePromptPresetInput, signal?: AbortSignal): Promise<{ success: true; preset?: PromptPreset }> {
      return fetcher('/api/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        ...(signal ? {signal} : {}),
      }).then((response) => readJson(response));
    },
    remove(
      type: PromptPresetType,
      category: string,
      title: string,
      signal?: AbortSignal,
    ): Promise<{ success: true }> {
      const route = [type, category, title].map(encodeURIComponent).join('/');
      return fetcher(`/api/prompts/${route}`, { method: 'DELETE', ...(signal ? {signal} : {}) })
        .then((response) => readJson(response));
    },
    serializeTag: serializePromptTag,
    parseTags: parsePromptTags,
    displayTags: displayPromptTags,
    expandTags: expandPromptTags,
    serializedTagsToHtml,
  };
}

export type PromptPresetClient = ReturnType<typeof createPromptPresetClient>;

declare global {
  interface Window {
    __FISHERAI_PROMPT_PRESETS__?: PromptPresetClient;
  }
}

export function installPromptPresets(
  client = createPromptPresetClient(),
): PromptPresetClient {
  window.__FISHERAI_PROMPT_PRESETS__ = client;
  return client;
}
