import { createStableTextElement as textElement } from '../design/dom';

/** 与 detectComfyInstallation 支持的目录结构保持一致。 */
export function createComfyDirectoryGuide() {
  const guide = document.createElement('div');
  guide.setAttribute('data-fisherai-comfyui-directory-guide', 'true');
  guide.className = 'mt-3 w-full border-l border-[var(--af-border-control)] pl-3';
  guide.append(
    textElement('p', '选择 ComfyUI 安装根目录', 'text-xs font-medium text-[var(--af-text)]'),
    textElement(
      'p',
      '整合包选择包含 ComfyUI 与 python_embeded 的外层目录；源码版选择包含 main.py 与 venv/.venv 的目录。不要选择 models、custom_nodes、input 或 output。',
      'mt-1 text-[11px] leading-5 text-[var(--af-text-muted)]',
    ),
  );
  guide.append(
    textElement(
      'p',
      '已运行的 ComfyUI 按已配置的本机地址连接（默认 127.0.0.1:8188）；模型列表从该服务读取。自动查找只识别安装目录，选择后才保存。未安装时需先安装 ComfyUI 及 Python 环境。',
      'mt-1 text-[11px] leading-5 text-[var(--af-text-muted)]',
    ),
  );
  return guide;
}
