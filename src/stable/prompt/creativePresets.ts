export type CreativeKind = 'style' | 'motion' | 'filter';
export interface CreativePreset {
  id: string;
  kind: CreativeKind;
  category: string;
  name: string;
  description: string;
  prompt: string;
  prefix?: string;
  preview?: string;
  poster?: string;
}
export type CreativeSelection = Partial<Record<CreativeKind | 'custom', CreativePreset>>;
export function validCreativePreset(value: unknown): value is CreativePreset {
  if (!value || typeof value !== 'object') return false;
  const p = value as CreativePreset;
  return (
    typeof p.id === 'string' &&
    p.id.length <= 100 &&
    ['style', 'motion', 'filter'].includes(p.kind) &&
    typeof p.name === 'string' &&
    p.name.length > 0 &&
    p.name.length <= 80 &&
    typeof p.prompt === 'string' &&
    p.prompt.length <= 12000 &&
    (p.prefix === undefined || (typeof p.prefix === 'string' && p.prefix.length <= 12000))
  );
}
export function creativeSelection(value: unknown): CreativeSelection {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([k, v]) => ['style', 'motion', 'filter', 'custom'].includes(k) && validCreativePreset(v),
    ),
  );
}
/** Snapshot text travels with the node: imported projects do not depend on a remote preset ID. */
export function composeCreativePrompt(prompt: string, value: unknown, type: string): string {
  if (!['image', 'video'].includes(type.toLowerCase())) return prompt;
  const selected = creativeSelection(value);
  const entries = [
    selected.style,
    selected.filter,
    ...(type.toLowerCase() === 'video' ? [selected.motion] : []),
    selected.custom,
  ].filter((p): p is CreativePreset => !!p);
  return [
    ...entries.map((p) => p.prefix?.trim()).filter(Boolean),
    prompt,
    ...entries.map((p) => p.prompt.trim()).filter(Boolean),
  ]
    .filter(Boolean)
    .join('\n');
}
