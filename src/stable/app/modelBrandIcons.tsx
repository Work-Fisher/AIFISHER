import gemini from './model-brands/gemini.svg';
import openai from './model-brands/openai.svg';
import jimeng from './model-brands/jimeng.svg';
import doubao from './model-brands/doubao.svg';
import kling from './model-brands/kling.svg';
import aliyun from './model-brands/aliyun.svg';
import grok from './model-brands/grok.svg';
import deepseek from './model-brands/deepseek.svg';
import mureka from './model-brands/mureka.svg';

interface BrandIconProps {
  size?: number;
  className?: string;
}

function brandIcon(name: string, asset: string) {
  return function BrandIcon({ size = 16, className }: BrandIconProps) {
    // Monochrome SVGs loaded as <img> cannot inherit the surrounding text color.
    if (name === 'Grok')
      return (
        <span
          role="img"
          aria-label={name}
          className={className}
          style={{
            display: 'inline-block',
            flexShrink: 0,
            width: size,
            height: size,
            background: 'currentColor',
            mask: `url("${asset}") center / contain no-repeat`,
          }}
        />
      );
    return (
      <img
        src={asset}
        width={size}
        height={size}
        alt={name}
        className={className}
        draggable={false}
      />
    );
  };
}

export const Gemini = brandIcon('Gemini', gemini);
export const OpenAI = brandIcon('OpenAI', openai);
export const Jimeng = brandIcon('Jimeng', jimeng);
export const Doubao = brandIcon('Doubao', doubao);
export const Kling = brandIcon('Kling', kling);
export const Aliyun = brandIcon('Aliyun', aliyun);
export const Grok = brandIcon('Grok', grok);
export const DeepSeek = brandIcon('DeepSeek', deepseek);
export const Mureka = brandIcon('Mureka', mureka);
