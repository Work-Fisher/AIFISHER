/** @jsxRuntime classic */
/** @jsx React.createElement */
import type { CanvasComponent } from '../app/canvasComponentType';
import type * as ReactTypes from 'react';
type Icons = Record<
  | 'Text'
  | 'Gemini'
  | 'OpenAI'
  | 'Jimeng'
  | 'Doubao'
  | 'Kling'
  | 'Aliyun'
  | 'Grok'
  | 'DeepSeek'
  | 'Mureka',
  CanvasComponent
>;
export function CanvasModelIcon(
  React: Pick<typeof ReactTypes, 'createElement'>,
  { model, size = 20 }: { model?: { provider?: string } | null; size?: number },
  icons: Icons,
) {
  const provider = (model?.provider || '').toLowerCase();
  const families: Array<[keyof Icons, string[], number]> = [
    ['Gemini', ['gemini', 'google'], 0],
    ['OpenAI', ['openai', 'gpt'], 0],
    ['Jimeng', ['jimeng'], 2],
    ['Doubao', ['doubao', 'volcengine'], 2],
    ['Kling', ['kling'], 2],
    ['Aliyun', ['aliyun'], 2],
    ['Grok', ['grok', 'xai'], 0],
    ['DeepSeek', ['deepseek'], 2],
    ['Mureka', ['mureka'], 2],
  ];
  const match = families.find(([, aliases]) => aliases.some((alias) => provider.includes(alias)));
  const Icon = icons[match?.[0] || 'Text'];
  return (
    <Icon
      size={size + (match?.[2] || 0)}
      className={
        match?.[0] === 'OpenAI'
          ? 'text-green-400'
          : !match
            ? 'text-[var(--af-text-secondary)]'
            : undefined
      }
    />
  );
}
