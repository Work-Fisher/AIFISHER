import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Upload, X, LoaderCircle } from 'lucide-react';
import { CanvasTextEditor, type CanvasTextEditorHandle } from './CanvasTextEditor';
import { CanvasTextTags } from './CanvasTextTags';
import {
  createTextDocumentPatch,
  resolveTextDocument,
  textDocumentFromPlainText,
} from './textDocument';
import { readTextNodeFile, TEXT_NODE_FILE_ACCEPT } from './textNodeImport';
import './textNodeContent.css';

interface TextNode {
  id: string;
  projectId?: string;
  title?: string;
  textContent?: string;
  textRichContent?: unknown;
  textTags?: unknown;
  textAutoLayout?: unknown;
  status?: string;
}
export interface CanvasTextNodeContentProps {
  node: TextNode;
  selected?: boolean;
  isDragging?: boolean;
  isResizing?: boolean;
  showControls?: boolean;
  onUpdate(id: string, patch: Record<string, unknown>): void;
  onSelect?(id: string): void;
  renderHeader(children: ReactNode): ReactNode;
}
const noSubscription = () => () => {};
function nodeGenerating(node: TextNode) {
  return (
    ['loading', 'queued'].includes(node.status || '') ||
    Boolean(window.__FISHERAI_GENERATION_SCHEDULER__?.isInFlight(node.id))
  );
}

/** Node and fullscreen share one editor host; moving it never creates a second draft. */
export function CanvasTextNodeContent(props: CanvasTextNodeContentProps) {
  const { node, selected, isDragging, isResizing, showControls = true } = props;
  const current = useRef(props);
  useLayoutEffect(() => {
    current.current = props;
  });
  const [editing, setEditing] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingImport, setPendingImport] = useState<{ name: string; text: string } | null>(null);
  const [editorHost] = useState(() => {
    const element = document.createElement('div');
    element.className = 'af-text-editor-host';
    return element;
  });
  const inlineSlot = useRef<HTMLDivElement>(null);
  const fullscreenSlot = useRef<HTMLDivElement>(null);
  const fullDialog = useRef<HTMLDialogElement>(null);
  const importDialog = useRef<HTMLDialogElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const importButton = useRef<HTMLButtonElement>(null);
  const editor = useRef<CanvasTextEditorHandle>(null);
  const reader = useRef<AbortController | null>(null);
  const active = useRef(true);
  const composing = useRef(false);
  const pendingFullscreen = useRef<boolean | null>(null);
  const scheduler = window.__FISHERAI_GENERATION_SCHEDULER__;
  const inFlight = useSyncExternalStore(
    scheduler?.subscribe || noSubscription,
    () => Boolean(scheduler?.isInFlight(node.id)),
    () => false,
  );
  const generating = inFlight || ['loading', 'queued'].includes(node.status || '');
  const disabled = generating || reading || Boolean(isDragging || isResizing);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      reader.current?.abort();
      editorHost.remove();
    };
  }, [editorHost]);

  useLayoutEffect(() => {
    const slot = fullscreen ? fullscreenSlot.current : inlineSlot.current;
    if (slot && editorHost.parentNode !== slot) slot.append(editorHost);
    if (fullscreen && fullDialog.current && !fullDialog.current.open)
      fullDialog.current.showModal();
    if (editing && selected && !disabled) editor.current?.focus();
  }, [fullscreen, editorHost, editing, selected, disabled]);

  useEffect(() => {
    if (!selected || isDragging || isResizing || generating) {
      pendingFullscreen.current = null;
      // Selection and generation are owned by the canvas; discard only local UI state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEditing(false);
      setFullscreen(false);
    }
    if (!selected) {
      reader.current?.abort();
      reader.current = null;
      setReading(false);
      setPendingImport(null);
    }
  }, [selected, isDragging, isResizing, generating]);

  useEffect(() => {
    if (!editing || fullscreen) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !root.current?.contains(target) &&
        !editorHost.contains(target) &&
        !importDialog.current?.contains(target)
      )
        setEditing(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [editing, fullscreen, editorHost]);

  useLayoutEffect(() => {
    if (pendingImport && importDialog.current && !importDialog.current.open)
      importDialog.current.showModal();
  }, [pendingImport]);

  const focusEditor = () => {
    if (!disabled && showControls) {
      props.onSelect?.(node.id);
      setEditing(true);
    }
  };
  const changeFullscreen = (next: boolean) => {
    if (composing.current) {
      pendingFullscreen.current = next;
      return;
    }
    setFullscreen(next);
    setEditing(true);
  };
  const closeFullscreen = () => changeFullscreen(false);
  const importText = (text: string, mode: 'append' | 'replace') => {
    if (!active.current) return;
    const latest = current.current;
    if (nodeGenerating(latest.node)) {
      setError('文本正在生成，请完成后再导入。原文未改变。');
      return;
    }
    const previous = latest.node.textContent || '';
    const incoming = textDocumentFromPlainText(text);
    const document =
      mode === 'append' && previous.length > 0
        ? {
            type: 'doc',
            content: [
              ...(resolveTextDocument(previous, latest.node.textRichContent).content || []),
              { type: 'paragraph' },
              ...(incoming.content || []),
            ],
          }
        : incoming;
    latest.onUpdate(latest.node.id, createTextDocumentPatch(document));
    setPendingImport(null);
    setError('');
    setNotice(mode === 'append' ? '已追加文本' : '已导入文本');
    setEditing(true);
  };
  const chooseFile = async (file: File) => {
    reader.current?.abort();
    const controller = new AbortController();
    reader.current = controller;
    setReading(true);
    setError('');
    setNotice('');
    try {
      const imported = await readTextNodeFile(file, controller.signal);
      if (!active.current || controller.signal.aborted || reader.current !== controller) return;
      if ((current.current.node.textContent || '').length) setPendingImport(imported);
      else importText(imported.text, 'replace');
    } catch (failure) {
      if (active.current && !controller.signal.aborted && reader.current === controller) {
        setError(failure instanceof Error ? failure.message : '文本导入失败，原文未改变。');
      }
    } finally {
      if (active.current && reader.current === controller) {
        reader.current = null;
        setReading(false);
      }
    }
  };

  const clearText = () => {
    const latest = current.current;
    if (
      !active.current ||
      disabled ||
      reader.current ||
      composing.current ||
      nodeGenerating(latest.node)
    )
      return;
    if (!editor.current?.clearContent()) return;
    setNotice('');
    setError('');
    latest.onSelect?.(latest.node.id);
    setEditing(true);
  };

  const header = showControls ? (
    <div
      className="af-text-primary-tools"
      onPointerDownCapture={(event) => {
        if (event.button === 0 && !selected) props.onSelect?.(node.id);
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <button
        ref={importButton}
        type="button"
        className="af-text-header-button"
        aria-label="导入文本"
        title="导入文本（仅本机解析）"
        disabled={disabled}
        onClick={() => fileInput.current?.click()}
      >
        {reading ? (
          <LoaderCircle size={13} className="af-text-import-spinner" />
        ) : (
          <Upload size={13} />
        )}
        <span>{reading ? '读取中' : '导入文本'}</span>
      </button>
      {reading && (
        <button
          type="button"
          className="af-text-header-button"
          aria-label="取消文本导入"
          onClick={() => {
            reader.current?.abort();
            reader.current = null;
            setReading(false);
          }}
        >
          取消
        </button>
      )}
      <CanvasTextTags
        value={node.textTags}
        disabled={disabled}
        onChange={(textTags) => {
          if (!nodeGenerating(current.current.node))
            current.current.onUpdate(current.current.node.id, { textTags });
        }}
      />
      <input
        ref={fileInput}
        type="file"
        accept={TEXT_NODE_FILE_ACCEPT}
        aria-label="选择文本文件"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void chooseFile(file);
        }}
      />
    </div>
  ) : null;

  return (
    <>
      {props.renderHeader(header)}
      <div
        ref={root}
        className="af-text-node-content text-node-content nowheel"
        data-testid="canvas-node-text-content"
        onDoubleClick={(event) => {
          event.stopPropagation();
          focusEditor();
        }}
        onPointerDown={(event) => {
          if (editing && event.button !== 1) event.stopPropagation();
        }}
        onKeyDown={(event) => {
          if (editing) event.stopPropagation();
        }}
        onContextMenu={(event) => {
          if (editing) event.stopPropagation();
        }}
      >
        <div
          ref={inlineSlot}
          className="af-text-inline-slot"
          hidden={Boolean(fullscreen || isResizing)}
        />
        {fullscreen && <p className="af-text-node-placeholder">正在全屏编辑</p>}
        {isResizing && (
          <div className="af-text-resize-preview">
            {(node.textContent || '').slice(0, 1000)}
            {(node.textContent || '').length > 1000 ? '...' : ''}
          </div>
        )}
        {!editing && !node.textContent && !fullscreen && !isResizing && (
          <button
            type="button"
            className="af-text-start-editing"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={focusEditor}
            disabled={disabled}
          >
            双击开始编辑，或导入文本…
          </button>
        )}
        {error && (
          <div role="alert" className="af-text-import-error">
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="af-text-import-notice">
            {notice}
            <button
              type="button"
              aria-label="清空文本正文"
              title="清空当前节点全部正文（可 Ctrl+Z 撤销，不删除节点、标签或生成模板）"
              disabled={disabled}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onKeyDown={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                clearText();
              }}
            >
              <X size={12} />
            </button>
          </div>
        )}
      </div>
      {createPortal(
        <div
          className="af-text-editor-event-boundary"
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
            const next = pendingFullscreen.current;
            pendingFullscreen.current = null;
            if (next !== null)
              queueMicrotask(() => {
                if (active.current && current.current.selected) changeFullscreen(next);
              });
          }}
          onDoubleClick={(event) => {
            event.stopPropagation();
            focusEditor();
          }}
          onPointerDown={(event) => {
            if (fullscreen || (editing && event.button !== 1)) event.stopPropagation();
          }}
          onKeyDown={(event) => {
            if (editing || fullscreen) event.stopPropagation();
          }}
          onContextMenu={(event) => {
            if (editing || fullscreen) event.stopPropagation();
          }}
        >
          <CanvasTextEditor
            ref={editor}
            textContent={node.textContent || ''}
            textRichContent={node.textRichContent}
            editable={editing && !disabled}
            autoLayout={node.textAutoLayout === true}
            fullscreen={fullscreen}
            showToolbar={editing && Boolean(selected) && showControls && !disabled}
            onChange={(patch) => {
              if (active.current && !nodeGenerating(current.current.node))
                current.current.onUpdate(current.current.node.id, patch);
            }}
            onAutoLayout={() => {
              const latest = current.current;
              if (!nodeGenerating(latest.node))
                latest.onUpdate(latest.node.id, {
                  textAutoLayout: latest.node.textAutoLayout !== true,
                });
            }}
            onFullscreen={() => changeFullscreen(!fullscreen)}
          />
        </div>,
        editorHost,
      )}
      {fullscreen &&
        createPortal(
          <dialog
            ref={fullDialog}
            className="af-text-fullscreen"
            aria-label={`${node.title || '文本节点'} · 全屏编辑`}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.stopPropagation()}
            onCancel={(event) => {
              event.preventDefault();
              if (!composing.current) closeFullscreen();
            }}
          >
            <header>
              <span>{node.title || '文本节点'}</span>
              <button
                type="button"
                className="af-text-header-button"
                aria-label="退出文本全屏"
                onClick={closeFullscreen}
              >
                <X size={18} />
                退出全屏
              </button>
            </header>
            <div ref={fullscreenSlot} className="af-text-fullscreen-slot" />
            <footer>在当前节点中编辑 · 退出全屏不丢失内容 · Esc 退出</footer>
          </dialog>,
          document.body,
        )}
      {pendingImport &&
        createPortal(
          <dialog
            ref={importDialog}
            className="af-text-import-dialog"
            aria-label="导入到已有文本节点"
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            onCancel={(event) => {
              event.preventDefault();
              setPendingImport(null);
              importButton.current?.focus();
            }}
          >
            <h2>导入到已有文本节点</h2>
            <p>
              已读取「{pendingImport.name}」，共 {pendingImport.text.length.toLocaleString()} 字符。
            </p>
            <p>选择追加到当前正文末尾，或替换正文。下方的生成模板和节点标签不会改变。</p>
            <div className="af-text-import-actions">
              <button
                type="button"
                className="af-text-header-button"
                onClick={() => {
                  setPendingImport(null);
                  importButton.current?.focus();
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="af-text-header-button"
                disabled={generating}
                onClick={() => importText(pendingImport.text, 'replace')}
              >
                替换正文
              </button>
              <button
                type="button"
                className="af-text-header-button af-text-primary"
                disabled={generating}
                onClick={() => importText(pendingImport.text, 'append')}
              >
                追加到末尾
              </button>
            </div>
          </dialog>,
          document.body,
        )}
    </>
  );
}
