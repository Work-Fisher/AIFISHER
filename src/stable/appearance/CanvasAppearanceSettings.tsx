import * as React from 'react';
import { installCanvasAppearance, useCanvasAppearance } from './canvasAppearance';
import { WallpaperLayers } from './CanvasWallpaper';
import { CANVAS_THEMES } from './themeTokens';
import './appearance.css';

export function CanvasAppearanceSettings() {
  const appearance = useCanvasAppearance();
  const store = installCanvasAppearance();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const { background, image, busy, error } = appearance;
  const palette = CANVAS_THEMES[appearance.theme];
  return (
    <section className="af-appearance" aria-labelledby="af-appearance-title">
      <header>
        <h2 id="af-appearance-title">画布外观</h2>
        <p>主题和背景分别设置，仅保存在当前账号的本机，不影响项目或生成结果。</p>
      </header>
      <fieldset>
        <legend>界面主题</legend>
        <div className="af-theme-options">
          {(['dark', 'light'] as const).map((theme) => (
            <button
              key={theme}
              type="button"
              aria-pressed={appearance.theme === theme}
              onClick={() => store.update({ theme })}
              className="af-theme-option"
            >
              <span className={`af-theme-swatch af-theme-swatch-${theme}`} aria-hidden="true">
                <i />
                <i />
              </span>
              <span>{theme === 'dark' ? '深色' : '白色'}</span>
              <span>{appearance.theme === theme ? '已选择' : '选择'}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>画布背景</legend>
        <div className="af-appearance-actions">
          <button
            type="button"
            aria-pressed={!background.enabled}
            disabled={busy}
            onClick={() => store.update({ background: { enabled: false } })}
          >
            默认纯色
          </button>
          <button
            type="button"
            aria-pressed={background.enabled}
            disabled={busy || !image}
            onClick={() => store.update({ background: { enabled: true } })}
          >
            自定义图片
          </button>
        </div>
        <div
          className="af-appearance-preview"
          data-af-theme={appearance.theme}
          style={{ background: palette.canvas }}
          aria-label="背景效果预览"
        >
          <WallpaperLayers appearance={appearance} />
          <div
            className="af-appearance-sample"
            style={{
              background: palette.surface,
              color: palette.text,
              borderColor: palette['border-control'],
            }}
          >
            <strong>文字与节点保持清晰</strong>
            <span style={{ color: palette['text-secondary'] }}>素材原色不变 · 背景不参与生成</span>
            <span
              className="af-appearance-sample-button"
              style={{ background: palette.primary, color: palette['on-primary'] }}
            >
              生成
            </span>
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          aria-label="选择背景图片"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void store.upload(file);
          }}
        />
        <div className="af-appearance-actions">
          <button
            className="af-appearance-primary"
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? '正在处理…' : image ? '替换图片' : '上传图片'}
          </button>
          <button type="button" disabled={busy || !image} onClick={() => void store.remove()}>
            移除图片
          </button>
          {image && (
            <span>
              {image.width} × {image.height}
            </span>
          )}
        </div>
        <p>
          支持静态 JPG、PNG、WebP，最大 20 MiB、3200
          万像素。图片仅在本机处理；自动适配窗口，不随画布拖拽和缩放。
        </p>
      </fieldset>
      {image && background.enabled && (
        <fieldset>
          <legend>背景调整</legend>
          {(
            [
              ['fade', '背景淡化', 95, '%'],
              ['blur', '柔化模糊', 12, 'px'],
              ['positionX', '水平位置', 100, '%'],
              ['positionY', '垂直位置', 100, '%'],
            ] as const
          ).map(([key, label, max, unit]) => (
            <label className="af-appearance-slider" key={key}>
              <span>
                {label}
                <output>
                  {background[key]}
                  {unit}
                </output>
              </span>
              <input
                type="range"
                min="0"
                max={max}
                step="1"
                value={background[key]}
                onChange={(event) =>
                  store.update({ background: { [key]: Number(event.target.value) } })
                }
              />
            </label>
          ))}
          <p>图片越复杂，建议提高淡化。面板、输入框和文字颜色始终跟随主题。</p>
        </fieldset>
      )}
      {error && (
        <p role="alert" className="af-appearance-error">
          {error}
        </p>
      )}
      <p role="status">{busy ? '正在本机校验和保存背景，请稍候。' : '外观更改自动保存。'}</p>
      <button type="button" onClick={() => store.reset()} disabled={busy}>
        恢复默认外观
      </button>
      <p>恢复默认会切回深色纯色画布，保留已上传图片，方便再次启用。</p>
    </section>
  );
}
