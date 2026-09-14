import type * as ReactTypes from 'react';
import { createPromptPresetClient, serializePromptTag } from './promptPresets';
import {
  promptPreviewIsVideo,
  type PromptRuntime,
  type PromptIcons,
  type PresetFormProps,
} from './promptComponents';
import { usePromptMutation } from './usePromptMutation';
export function CanvasPresetForm(
  React: PromptRuntime,
  { type, initialCategory, onSave, onCancel }: PresetFormProps,
  {
    BackIcon,
    UploadIcon,
    ImageIcon,
    Spinner,
    TagIcon,
  }: Pick<PromptIcons, 'BackIcon' | 'UploadIcon' | 'ImageIcon' | 'Spinner' | 'TagIcon'>,
) {
  const [title, setTitle] = React.useState(''),
    [category, setCategory] = React.useState(initialCategory || ''),
    [text, setText] = React.useState(''),
    [preview, setPreview] = React.useState<string | null>(null),
    [reading, setReading] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null),
    readerRef = React.useRef<FileReader | null>(null),
    alive = React.useRef(false);
  const mutation = usePromptMutation(React),
    saving = mutation.busy || reading;
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      const reader = readerRef.current;
      readerRef.current = null;
      reader?.abort();
    };
  }, []);
  const stop = (event: ReactTypes.SyntheticEvent) => event.stopPropagation();
  const cancel = () => {
    if (!saving) onCancel();
  };
  const pickFile = (event: ReactTypes.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || mutation.busy) return;
    const previous = readerRef.current;
    readerRef.current = null;
    previous?.abort();
    setReading(false);
    const limit = file.type === 'video/mp4' ? 25 : 5;
    if (
      !['image/png', 'image/jpeg', 'image/webp', 'video/mp4'].includes(file.type) ||
      !file.size ||
      file.size > limit * 1024 * 1024
    ) {
      mutation.setError('请选择不超过 5 MB 的 PNG、JPEG、WebP 图片，或不超过 25 MB 的 MP4');
      return;
    }
    const reader = new FileReader();
    readerRef.current = reader;
    setReading(true);
    mutation.setError('');
    const current = () => alive.current && readerRef.current === reader;
    reader.onload = () => {
      if (current() && typeof reader.result === 'string') setPreview(reader.result);
    };
    reader.onerror = () => {
      if (current()) mutation.setError('预览读取失败，请重新选择文件');
    };
    reader.onloadend = () => {
      if (current()) {
        readerRef.current = null;
        setReading(false);
      }
    };
    reader.readAsDataURL(file);
  };
  const save = () => {
    if (saving) return;
    try {
      serializePromptTag(title, text);
      if (!category.trim() || category.trim().length > 80)
        throw Error('请填写不超过 80 字的分类名称');
    } catch (cause) {
      mutation.setError(cause instanceof Error ? cause.message : '请填写完整信息');
      return;
    }
    void mutation.run(
      (signal) =>
        createPromptPresetClient().create(
          {
            type,
            category: category.trim(),
            title: title.trim(),
            prompt: text.trim(),
            previewBase64: preview,
          },
          signal,
        ),
      onSave,
    );
  };

  return (
    <div
      role="dialog"
      aria-label="创建提示词预设"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape' && !event.nativeEvent.isComposing) cancel();
      }}
      className={
        'flex flex-col w-full bg-[var(--af-input)] animate-in slide-in-from-right-4 duration-300'
      }
      onMouseDown={stop}
      onClick={stop}
    >
      <div className={'flex items-center gap-2 px-5 py-3 border-b border-[var(--af-border)]'}>
        <button
          aria-label="返回预设列表"
          disabled={saving}
          onClick={cancel}
          className={
            'p-1.5 hover:bg-[var(--af-hover)] rounded-full text-[var(--af-text-secondary)] hover:text-[var(--af-text)] transition-colors'
          }
        >
          <BackIcon size={18} />
        </button>
        <h3 className={'text-base font-bold text-[var(--af-text)]'}>
          {'创建新预设 ('}
          {type === 'image'
            ? '图片'
            : type === 'video'
              ? '视频'
              : type === 'audio'
                ? '音频'
                : '文本'}
          {')'}
        </h3>
      </div>
      <div className={'overflow-y-auto p-5 space-y-4 custom-scrollbar'}>
        <div className={'flex items-start gap-4'}>
          <div className={'space-y-1.5 flex-shrink-0'}>
            <label
              className={
                'text-[11px] font-bold text-[var(--af-text-muted)] uppercase tracking-widest'
              }
            >
              {'预览'}
            </label>
            <div
              onClick={() => {
                if (!saving) fileRef.current?.click();
              }}
              className={
                'w-[224px] aspect-video rounded-lg border-2 border-dashed border-[var(--af-border)] hover:border-[var(--af-info)] bg-[var(--af-input)] flex flex-col items-center justify-center cursor-pointer transition-all group overflow-hidden relative'
              }
            >
              {preview ? (
                <React.Fragment>
                  {promptPreviewIsVideo(preview) ? (
                    <video
                      src={preview}
                      onClick={stop}
                      className="w-full h-full object-cover"
                      muted
                      controls
                      playsInline
                    />
                  ) : (
                    <img src={preview} className="w-full h-full object-cover" alt="预览" />
                  )}
                  <div
                    data-af-media-chrome="true"
                    style={{
                      background: 'color-mix(in srgb, var(--af-media-bg) 75%, transparent)',
                      ...(promptPreviewIsVideo(preview)
                        ? { pointerEvents: 'none' as const, opacity: 0 }
                        : {}),
                    }}
                    className={
                      'absolute inset-0 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity'
                    }
                  >
                    <UploadIcon size={18} className={'text-[var(--af-media-text)]'} />
                  </div>
                  {promptPreviewIsVideo(preview) && (
                    <button
                      type="button"
                      disabled={saving}
                      data-af-media-chrome="true"
                      onClick={(event) => {
                        event.stopPropagation();
                        fileRef.current?.click();
                      }}
                      style={{
                        position: 'absolute',
                        top: 6,
                        right: 6,
                        padding: '3px 7px',
                        borderRadius: 4,
                        background: 'color-mix(in srgb, var(--af-media-bg) 85%, transparent)',
                        color: 'var(--af-media-text)',
                        fontSize: 11,
                      }}
                    >
                      更换预览
                    </button>
                  )}
                </React.Fragment>
              ) : (
                <React.Fragment>
                  <div
                    className={
                      'p-2 rounded-full bg-[var(--af-surface-raised)] text-[var(--af-text-muted)] group-hover:bg-[var(--af-info-bg)] group-hover:text-[var(--af-info)] transition-colors mb-1'
                    }
                  >
                    <ImageIcon size={18} />
                  </div>
                  <span
                    className={
                      'text-[10px] text-[var(--af-text-muted)] group-hover:text-[var(--af-text-secondary)]'
                    }
                  >
                    {'上传预览'}
                  </span>
                </React.Fragment>
              )}
            </div>
            <input
              disabled={saving}
              ref={fileRef}
              type={'file'}
              accept={'image/png,image/jpeg,image/webp,video/mp4'}
              className={'hidden'}
              onChange={pickFile}
            />
          </div>
          <div className={'flex-1 space-y-3'}>
            <div className={'space-y-1.5'}>
              <label
                className={
                  'text-[11px] font-bold text-[var(--af-text-muted)] uppercase tracking-widest'
                }
              >
                {'分类'}
              </label>
              <input
                disabled={saving}
                aria-label="分类"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                placeholder={'输入提示词预设分类'}
                className={
                  'w-full bg-[var(--af-input)] border border-[var(--af-border)] rounded-lg px-3.5 py-2 text-sm text-[var(--af-text)] focus:outline-none focus:border-[var(--af-info)] transition-colors'
                }
              />
            </div>
            <div className={'space-y-1.5'}>
              <label
                className={
                  'text-[11px] font-bold text-[var(--af-text-muted)] uppercase tracking-widest'
                }
              >
                {'预设名称'}
              </label>
              <input
                disabled={saving}
                aria-label="预设名称"
                autoFocus
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={'如：赛博朋克'}
                className={
                  'w-full bg-[var(--af-input)] border border-[var(--af-border)] rounded-lg px-3.5 py-2 text-sm text-[var(--af-text)] focus:outline-none focus:border-[var(--af-info)] transition-colors'
                }
              />
            </div>
          </div>
        </div>
        <div className={'space-y-1.5'}>
          <label
            className={
              'text-[11px] font-bold text-[var(--af-text-muted)] uppercase tracking-widest'
            }
          >
            {'提示词内容'}
          </label>
          <textarea
            aria-label="提示词内容"
            disabled={saving}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={'输入提示词内容，多行将自动转为列表格式...'}
            className={
              'w-full bg-[var(--af-input)] border border-[var(--af-border)] rounded-lg px-3.5 py-2.5 text-sm text-[var(--af-text)] focus:outline-none focus:border-[var(--af-info)] transition-colors min-h-[140px] resize-none'
            }
          />
        </div>
      </div>
      {mutation.error && (
        <div
          role="alert"
          style={{ color: 'var(--af-danger)', fontSize: 12, padding: '0 20px 12px' }}
        >
          {mutation.error}
        </div>
      )}
      <div
        className={
          'px-5 py-3 border-t border-[var(--af-border)] flex items-center justify-end gap-2.5 bg-[var(--af-hover)]'
        }
      >
        <button
          onClick={cancel}
          disabled={saving}
          className={
            'min-w-[104px] h-9 inline-flex items-center justify-center px-5 rounded-lg text-sm font-bold text-[var(--af-text-secondary)] bg-[var(--af-hover)] hover:text-[var(--af-text)] hover:bg-[var(--af-hover)] transition-all'
          }
        >
          {'取消'}
        </button>
        <button
          onClick={save}
          disabled={saving}
          className={
            'min-w-[104px] h-9 inline-flex items-center justify-center px-5 rounded-lg text-sm font-bold bg-[var(--af-info-bg)] hover:bg-[var(--af-info-bg)] text-[var(--af-text)] shadow-lg shadow-blue-900/20 transition-all gap-2 disabled:opacity-50 disabled:cursor-not-allowed'
          }
        >
          {saving ? <Spinner size={16} className={'animate-spin'} /> : <TagIcon size={16} />}
          {saving ? '保存中...' : '保存预设'}
        </button>
      </div>
    </div>
  );
}
