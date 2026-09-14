import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import {
  Bold,
  Italic,
  Underline,
  Table2,
  Copy,
  AlignLeft,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
} from 'lucide-react';
import {
  createTextDocumentPatch,
  resolveTextDocument,
  type TextDocumentNode,
} from './textDocument';
import {
  copyTextEditorDocument,
  insertTextTable,
  MAX_TEXT_TABLE_SIZE,
  runTextTableAction,
  textEditorExtensions,
  textTableSize,
  type TextTableAction,
} from './textEditorExtensions';
import './textEditor.css';

export interface CanvasTextEditorHandle {
  focus(): void;
  getJSON(): TextDocumentNode | null;
  insertPlainText(text: string): void;
  appendPlainText(text: string): void;
  clearContent(): boolean;
}

export interface CanvasTextEditorProps {
  textContent: string;
  textRichContent?: unknown;
  editable: boolean;
  autoLayout?: boolean;
  onChange(patch: ReturnType<typeof createTextDocumentPatch>): void;
  onAutoLayout(): void;
  onFullscreen(): void;
  fullscreen?: boolean;
  showToolbar?: boolean;
  className?: string;
}

function documentKey(document: TextDocumentNode) {
  return JSON.stringify(createTextDocumentPatch(document).textRichContent.document);
}

function syncDocument(editor: Editor, document: TextDocumentNode) {
  if (documentKey(editor.getJSON()) !== documentKey(document)) {
    editor.commands.setContent(document, { emitUpdate: false });
  }
}

function ToolButton({
  label,
  children,
  active,
  onClick,
  disabled,
  controls,
  expanded,
  buttonRef,
}: {
  label: string;
  children: ReactNode;
  active?: boolean;
  onClick(): void;
  disabled?: boolean;
  controls?: string;
  expanded?: boolean;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      aria-controls={controls}
      aria-expanded={expanded}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export const CanvasTextEditor = forwardRef<CanvasTextEditorHandle, CanvasTextEditorProps>(
  function CanvasTextEditor(props, ref) {
    const {
      editable,
      autoLayout = false,
      fullscreen = false,
      showToolbar = false,
      className = '',
    } = props;
    const current = useRef(props);
    const composing = useRef(false);
    const pendingDocument = useRef<TextDocumentNode | null>(null);
    const alive = useRef(true);
    const tableTrigger = useRef<HTMLButtonElement>(null);
    const [initialDocument] = useState(() =>
      resolveTextDocument(props.textContent, props.textRichContent),
    );
    const [tableOpen, setTableOpen] = useState(false);
    const [rows, setRows] = useState(3);
    const [columns, setColumns] = useState(3);
    const [feedback, setFeedback] = useState<{ message: string; error?: boolean } | null>(null);
    const tableId = useId();

    useLayoutEffect(() => {
      current.current = props;
    });
    useEffect(() => {
      alive.current = true;
      return () => {
        alive.current = false;
      };
    }, []);

    const editor = useEditor(
      {
        extensions: textEditorExtensions(),
        content: initialDocument,
        editable,
        shouldRerenderOnTransaction: false,
        enableInputRules: false,
        enablePasteRules: false,
        editorProps: {
          // Returning true skips ProseMirror's mouse-selection handler without
          // preventing or stopping the event; the canvas still receives middle pan.
          handleDOMEvents: {
            mousedown: (_view, event) => event.button === 1 || !current.current.editable,
          },
          attributes: {
            role: 'textbox',
            'aria-label': '文本节点正文',
            'aria-multiline': 'true',
            class: 'af-text-editor-document',
          },
        },
        onUpdate: ({ editor }) => {
          current.current.onChange(createTextDocumentPatch(editor.getJSON()));
        },
      },
      [],
    );

    const formatting = useEditorState({
      editor,
      selector: ({ editor }) => ({
        bold: editor?.isActive('bold') ?? false,
        italic: editor?.isActive('italic') ?? false,
        underline: editor?.isActive('underline') ?? false,
        table: textTableSize(editor),
      }),
    });

    useEffect(() => {
      editor?.setEditable(editable, false);
    }, [editor, editable]);
    useEffect(() => {
      if (!editor) return;
      const document = resolveTextDocument(props.textContent, props.textRichContent);
      if (composing.current || editor.view.composing) pendingDocument.current = document;
      else syncDocument(editor, document);
    }, [editor, props.textContent, props.textRichContent]);

    useImperativeHandle(
      ref,
      () => ({
        focus() {
          editor?.commands.focus();
        },
        getJSON() {
          return editor?.getJSON() ?? null;
        },
        clearContent() {
          if (!editor || editor.isDestroyed || composing.current || editor.view.composing)
            return false;
          // The node-level action also works in reading mode; its owner checks generation locks.
          // Keep this deletion separate from a just-completed import and subsequent typing.
          pendingDocument.current = null;
          editor.view.dispatch(closeHistory(editor.state.tr));
          const cleared = editor.commands.clearContent(true);
          editor.view.dispatch(closeHistory(editor.state.tr));
          editor.commands.focus('start');
          return cleared;
        },
        insertPlainText(text) {
          if (editor?.isEditable && text)
            editor
              .chain()
              .focus()
              .insertContent(resolveTextDocument(text, undefined).content ?? [])
              .run();
        },
        appendPlainText(text) {
          if (editor?.isEditable && text)
            editor
              .chain()
              .focus()
              .insertContentAt(
                editor.state.doc.content.size,
                resolveTextDocument(text, undefined).content ?? [],
              )
              .run();
        },
      }),
      [editor],
    );

    const tableAction = (action: TextTableAction) => {
      if (editor) runTextTableAction(editor, action);
    };
    const copy = async () => {
      if (!editor) return;
      try {
        const result = await copyTextEditorDocument(editor);
        if (alive.current)
          setFeedback({
            message:
              result === 'rich' ? '已复制，包含文字格式' : '已复制纯文本；当前剪贴板未保留格式',
          });
      } catch {
        if (alive.current)
          setFeedback({ message: '复制失败，请选中文字后按 Ctrl+C 复制。', error: true });
      }
    };

    return (
      <div
        data-af-text-editor=""
        data-editable={editable ? 'true' : 'false'}
        data-auto-layout={autoLayout ? 'true' : 'false'}
        data-fullscreen={fullscreen ? 'true' : 'false'}
        className={`af-text-editor ${className}`}
        onKeyDownCapture={(event) => {
          // ProseMirror also binds Escape inside tables. Close the fullscreen
          // surface first unless a nested table panel or IME owns this key.
          if (
            fullscreen &&
            !tableOpen &&
            event.key === 'Escape' &&
            !composing.current &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            event.stopPropagation();
            current.current.onFullscreen();
          }
        }}
        onKeyDown={(event) => {
          if (composing.current || event.nativeEvent.isComposing) {
            event.stopPropagation();
          } else if (event.key === 'Escape' && tableOpen) {
            event.preventDefault();
            event.stopPropagation();
            setTableOpen(false);
            tableTrigger.current?.focus();
          } else if (event.key !== 'Escape') event.stopPropagation();
        }}
        onPointerDown={(event) => {
          if (event.button === 0 && (editable || fullscreen)) event.stopPropagation();
        }}
        onMouseDown={(event) => {
          if (event.button === 0 && (editable || fullscreen)) event.stopPropagation();
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
          queueMicrotask(() => {
            if (!editor || editor.isDestroyed) return;
            const pending = pendingDocument.current;
            pendingDocument.current = null;
            // The final composition transaction may have echoed through the parent
            // after a pending update; the current props are the latest authority.
            if (pending)
              syncDocument(
                editor,
                resolveTextDocument(current.current.textContent, current.current.textRichContent),
              );
          });
        }}
      >
        {(showToolbar || fullscreen) && (
          <div
            className="af-text-editor-toolbar"
            role="toolbar"
            aria-label="文本格式工具栏"
            onPointerDown={(event) => {
              if (event.button !== 1) {
                event.preventDefault();
                event.stopPropagation();
              }
            }}
            onMouseDown={(event) => {
              if (event.button !== 1) {
                event.preventDefault();
                event.stopPropagation();
              }
            }}
          >
            <ToolButton
              label="粗体 (Ctrl+B)"
              active={formatting?.bold}
              disabled={!editable}
              onClick={() => editor?.chain().focus().toggleBold().run()}
            >
              <Bold size={16} />
            </ToolButton>
            <ToolButton
              label="斜体 (Ctrl+I)"
              active={formatting?.italic}
              disabled={!editable}
              onClick={() => editor?.chain().focus().toggleItalic().run()}
            >
              <Italic size={16} />
            </ToolButton>
            <ToolButton
              label="下划线 (Ctrl+U)"
              active={formatting?.underline}
              disabled={!editable}
              onClick={() => editor?.chain().focus().toggleUnderline().run()}
            >
              <Underline size={16} />
            </ToolButton>
            <span className="af-text-editor-divider" />
            <ToolButton
              label="插入或编辑表格"
              active={Boolean(formatting?.table)}
              disabled={!editable}
              controls={tableId}
              expanded={tableOpen}
              buttonRef={tableTrigger}
              onClick={() => setTableOpen(!tableOpen)}
            >
              <Table2 size={16} />
            </ToolButton>
            <ToolButton
              label="复制全部正文"
              onClick={() => {
                void copy();
              }}
            >
              <Copy size={16} />
            </ToolButton>
            <ToolButton
              label="自动排版"
              active={autoLayout}
              disabled={!editable}
              onClick={props.onAutoLayout}
            >
              <AlignLeft size={16} />
            </ToolButton>
            <ToolButton
              label={fullscreen ? '退出全屏' : '全屏编辑'}
              active={fullscreen}
              onClick={props.onFullscreen}
            >
              {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </ToolButton>
            {tableOpen && editable && (
              <div
                id={tableId}
                className="af-text-editor-table-panel"
                role="group"
                aria-label="表格操作"
              >
                {formatting?.table ? (
                  <>
                    <p>
                      {formatting.table.rows} 行 × {formatting.table.columns} 列
                    </p>
                    <div className="af-text-editor-table-actions">
                      <button
                        type="button"
                        disabled={formatting.table.rows >= MAX_TEXT_TABLE_SIZE}
                        onClick={() => tableAction('addRow')}
                      >
                        下方插入行
                      </button>
                      <button
                        type="button"
                        disabled={formatting.table.columns >= MAX_TEXT_TABLE_SIZE}
                        onClick={() => tableAction('addColumn')}
                      >
                        右侧插入列
                      </button>
                      <button type="button" onClick={() => tableAction('deleteRow')}>
                        删除当前行
                      </button>
                      <button type="button" onClick={() => tableAction('deleteColumn')}>
                        删除当前列
                      </button>
                    </div>
                    <button
                      type="button"
                      className="af-text-editor-wide-button"
                      onClick={() => {
                        tableAction('deleteTable');
                        setTableOpen(false);
                      }}
                    >
                      删除表格
                    </button>
                  </>
                ) : (
                  <>
                    <p>插入表格</p>
                    <div className="af-text-editor-table-dimension">
                      <span>行数</span>
                      <ToolButton
                        label="减少行数"
                        disabled={rows <= 1}
                        onClick={() => setRows(rows - 1)}
                      >
                        <Minus size={14} />
                      </ToolButton>
                      <output aria-label="表格行数">{rows}</output>
                      <ToolButton
                        label="增加行数"
                        disabled={rows >= MAX_TEXT_TABLE_SIZE}
                        onClick={() => setRows(rows + 1)}
                      >
                        <Plus size={14} />
                      </ToolButton>
                    </div>
                    <div className="af-text-editor-table-dimension">
                      <span>列数</span>
                      <ToolButton
                        label="减少列数"
                        disabled={columns <= 1}
                        onClick={() => setColumns(columns - 1)}
                      >
                        <Minus size={14} />
                      </ToolButton>
                      <output aria-label="表格列数">{columns}</output>
                      <ToolButton
                        label="增加列数"
                        disabled={columns >= MAX_TEXT_TABLE_SIZE}
                        onClick={() => setColumns(columns + 1)}
                      >
                        <Plus size={14} />
                      </ToolButton>
                    </div>
                    <button
                      type="button"
                      className="af-text-editor-wide-button"
                      onClick={() => {
                        if (editor && insertTextTable(editor, rows, columns)) setTableOpen(false);
                      }}
                    >
                      插入 {rows} × {columns} 表格
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
        <div className="af-text-editor-scroll overflow-y-auto">
          <EditorContent editor={editor} />
        </div>
        {feedback && (
          <div
            className="af-text-editor-feedback"
            role={feedback.error ? 'alert' : 'status'}
            data-error={feedback.error ? 'true' : 'false'}
          >
            {feedback.message}
          </div>
        )}
      </div>
    );
  },
);
