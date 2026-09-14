import { validCreativePreset } from './creativePresets';
import type * as ReactTypes from 'react';
import {
  promptToDocument,
  documentToPrompt,
  promptAssetIndex,
  promptAssetLabel,
  type PromptAsset,
  type PromptDocumentNode,
} from './promptDocument';
import {
  createPromptPresetClient,
  type PromptPresetConfig,
  type PromptPresetType,
} from './promptPresets';
import {
  createPromptSuggestions,
  type SuggestionUI,
  type SuggestionProps,
} from './promptSuggestions';
type Runtime = Pick<
  typeof ReactTypes,
  | 'createElement'
  | 'useState'
  | 'useRef'
  | 'useMemo'
  | 'useEffect'
  | 'useLayoutEffect'
  | 'useCallback'
>;
interface Editor {
  getJSON(): PromptDocumentNode;
  isFocused: boolean;
  state?: { selection: { from: number; to: number } };
  isDestroyed?: boolean;
  setEditable(value: boolean): void;
  commands: {
    setContent(value: PromptDocumentNode, options: { emitUpdate: boolean }): void;
    focus(position?: 'end'): void;
  };
  chain(): {
    focus(): { insertContentAt(range: unknown, content: PromptDocumentNode[]): { run(): void } };
  };
}
interface Extension {
  configure(options: Record<string, unknown>): unknown;
  extend(options: Record<string, unknown>): Extension;
}
interface Vendor {
  useEditor(options: Record<string, unknown>, deps: unknown[]): Editor | null;
  StarterKit: Extension;
  Placeholder: Extension;
  Mention: Extension;
  nodeView(component: unknown): unknown;
  PromptTagView: unknown;
  MentionView: unknown;
  PresetList: unknown;
  MentionList: unknown;
  ui: SuggestionUI;
  EditorContent: ReactTypes.ComponentType<{ editor: Editor | null; className: string }>;
}
interface Props {
  value: string;
  onChange(value: string): void;
  connectedAssets?: PromptAsset[];
  placeholder?: string;
  isDark?: boolean;
  onBlur?(): void;
  className?: string;
  type?: PromptPresetType;
  disableMentions?: boolean;
  disablePromptPresets?: boolean;
  disableDirectEdit?: boolean;
}
interface Position {
  pos: number;
  nodeBefore?: { textContent: string };
}
type InsertProps = { editor: Editor; range: unknown; props: Record<string, unknown> };
const EMPTY: PromptPresetConfig = { text: [], image: [], video: [], audio: [] };

export function CanvasPromptEditor(React: Runtime, props: Props, vendorRuntime: Vendor) {
  const [vendor] = React.useState(() => vendorRuntime);
  const currentRef = React.useRef(props),
    aliveRef = React.useRef(false),
    lastValueRef = React.useRef(props.value),
    editorRef = React.useRef<Editor | null>(null),
    popupRef = React.useRef<ReturnType<typeof createPromptSuggestions> | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null),
    scrollRef = React.useRef<HTMLDivElement>(null),
    timersRef = React.useRef(new Set<ReturnType<typeof setTimeout>>()),
    framesRef = React.useRef(new Set<number>());
  const presetsRef = React.useRef<PromptPresetConfig>(EMPTY),
    loadRef = React.useRef<AbortController | null>(null),
    queryRef = React.useRef('');
  const [presetError, setPresetError] = React.useState('');
  React.useLayoutEffect(() => {
    currentRef.current = props;
    lastValueRef.current = props.value;
  });
  const schedule = React.useCallback((fn: () => void, delay: number) => {
    const id = setTimeout(() => {
      timersRef.current.delete(id);
      if (aliveRef.current) fn();
    }, delay);
    timersRef.current.add(id);
    return id;
  }, []);
  const nextFrame = React.useCallback((fn: () => void) => {
    if (!aliveRef.current) return;
    const id = requestAnimationFrame(() => {
      framesRef.current.delete(id);
      if (aliveRef.current) fn();
    });
    framesRef.current.add(id);
  }, []);
  const keepPagePosition = React.useCallback(() => {
    nextFrame(() => {
      if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
    });
  }, [nextFrame]);
  const sync = React.useCallback((editor: Editor) => {
    if (!aliveRef.current || editor.isDestroyed || editorRef.current !== editor) return;
    const value = documentToPrompt(editor.getJSON(), currentRef.current.connectedAssets || []);
    if (value !== lastValueRef.current) {
      lastValueRef.current = value;
      currentRef.current.onChange(value);
    }
  }, []);
  const presetItems = React.useCallback((query: string) => {
    const categories = presetsRef.current[currentRef.current.type || 'image'] || [],
      needle = query.toLowerCase();
    return categories.flatMap((category) =>
      category.items
        .filter((item) => item.title.toLowerCase().includes(needle))
        .map((item) => ({ ...item, category: category.name })),
    );
  }, []);
  const reloadPresets = React.useCallback(async () => {
    loadRef.current?.abort();
    const request = new AbortController();
    loadRef.current = request;
    try {
      const result = await createPromptPresetClient().load(request.signal);
      if (!aliveRef.current || request.signal.aborted || loadRef.current !== request) return;
      const next: PromptPresetConfig = { text: [], image: [], video: [], audio: [] };
      for (const type of ['text', 'image', 'video', 'audio'] as const) {
        const categories = result[type];
        if (!Array.isArray(categories)) continue;
        next[type] = categories
          .filter(
            (category) =>
              category && typeof category.name === 'string' && Array.isArray(category.items),
          )
          .map((category) => ({
            ...category,
            items: category.items.filter(
              (item) =>
                item &&
                typeof item.title === 'string' &&
                (typeof item.prompt === 'string' || Array.isArray(item.prompt)),
            ),
          }));
      }
      presetsRef.current = next;
      setPresetError('');
      popupRef.current?.updateItems(presetItems(queryRef.current));
    } catch (error) {
      if (aliveRef.current && !request.signal.aborted && loadRef.current === request)
        setPresetError(error instanceof Error ? error.message : '预设列表读取失败');
    }
  }, [presetItems]);
  const makePopup = React.useCallback(
    (preset: boolean) => {
      const popup = createPromptSuggestions({
        component: preset ? vendor.PresetList : vendor.MentionList,
        ui: vendor.ui,
        alive: () => aliveRef.current,
        placement: preset ? 'top-start' : 'auto-start',
        extraProps: preset
          ? () => ({
              type: currentRef.current.type || 'image',
              onDeleteSuccess: () => void reloadPresets(),
            })
          : undefined,
      });
      const handlers = popup.handlers;
      return {
        ...handlers,
        onStart: (value: SuggestionProps) => {
          loadRef.current?.abort();
          setPresetError('');
          popupRef.current?.exit();
          popupRef.current = popup;
          handlers.onStart(value);
          queryRef.current = value.query || '';
          if (preset) void reloadPresets();
        },
        onUpdate: (value: SuggestionProps) => {
          queryRef.current = value.query || '';
          handlers.onUpdate(value);
        },
        onExit: () => {
          handlers.onExit();
          if (popupRef.current === popup) {
            popupRef.current = null;
            loadRef.current?.abort();
          }
        },
      };
    },
    [vendor.PresetList, vendor.MentionList, vendor.ui, reloadPresets],
  );
  const extensions = React.useMemo(
    () => [
      vendor.StarterKit.configure({
        heading: false,
        blockquote: false,
        codeBlock: false,
        bulletList: false,
        orderedList: false,
      }),
      vendor.Placeholder.configure({
        placeholder: () =>
          currentRef.current.placeholder ?? '描述任何内容，按@引用素材, 按 \\ 提示词预设库',
        emptyEditorClass: 'is-editor-empty',
      }),
      vendor.Mention.extend({
        name: 'promptTag',
        addAttributes() {
          return {
            label: {
              default: null,
              parseHTML: (element: HTMLElement) => element.getAttribute('data-label'),
              renderHTML: (attrs: { label: string }) => ({ 'data-label': attrs.label }),
            },
            prompt: {
              default: null,
              parseHTML: (element: HTMLElement) => element.getAttribute('data-prompt'),
              renderHTML: (attrs: { prompt: string }) => ({ 'data-prompt': attrs.prompt }),
            },
          };
        },
        addNodeView() {
          return vendor.nodeView(vendor.PromptTagView);
        },
      }).configure({
        HTMLAttributes: { class: 'prompt-tag' },
        suggestion: {
          char: '',
          allowSpaces: true,
          startOfLine: false,
          findSuggestionMatch: ({ $position }: { $position: Position }) => {
            if (currentRef.current.disablePromptPresets) return null;
            const match = ($position.nodeBefore?.textContent || '').match(
              /(\\[\w\d\s\u4e00-\u9fa5]*)$/,
            );
            return match
              ? {
                  range: { from: $position.pos - match[0].length, to: $position.pos },
                  query: match[0].slice(1),
                  text: match[0],
                }
              : null;
          },
          command: ({ editor, range, props }: InsertProps) =>
            editor
              .chain()
              .focus()
              .insertContentAt(range, [{ type: 'promptTag', attrs: props }])
              .run(),
          items: ({ query }: { query: string }) =>
            currentRef.current.disablePromptPresets ? [] : presetItems(query),
          render: () => makePopup(true),
        },
      }),
      vendor.Mention.extend({
        addAttributes(this: { parent?: () => Record<string, unknown> }) {
          return {
            ...this.parent?.(),
            assetType: {
              default: 'image',
              parseHTML: (element: HTMLElement) => element.getAttribute('data-asset-type'),
              renderHTML: (attrs: { assetType: string }) => ({
                'data-asset-type': attrs.assetType,
              }),
            },
            url: {
              default: '',
              parseHTML: (element: HTMLElement) => element.getAttribute('data-url'),
              renderHTML: (attrs: { url: string }) => ({ 'data-url': attrs.url }),
            },
          };
        },
        addNodeView() {
          return vendor.nodeView(vendor.MentionView);
        },
      }).configure({
        HTMLAttributes: { class: 'mention' },
        suggestion: {
          char: '@',
          allowSpaces: false,
          startOfLine: false,
          findSuggestionMatch: ({ $position }: { $position: Position }) => {
            if (currentRef.current.disableMentions) return null;
            const match = ($position.nodeBefore?.textContent || '').match(
              /([@＠][\p{L}\p{N}_-]*)$/u,
            );
            return match
              ? {
                  range: { from: $position.pos - match[0].length, to: $position.pos },
                  query: match[0].slice(1),
                  text: match[0],
                }
              : null;
          },
          command: ({ editor, range, props }: InsertProps) => {
            editor
              .chain()
              .focus()
              .insertContentAt(range, [{ type: 'mention', attrs: props }])
              .run();
          },
          items: ({ query }: { query: string }) => {
            if (currentRef.current.disableMentions) return [];
            const index = promptAssetIndex(currentRef.current.connectedAssets || []),
              needle = query.toLowerCase();
            return [...index.byId.values()]
              .map(({ asset, type, number }) => ({
                id: asset.id,
                label: promptAssetLabel(type, number),
                type,
                url: asset.url,
                title: asset.title || asset.id,
              }))
              .filter((item) =>
                [item.label, item.type, item.title].some((value) =>
                  value.toLowerCase().includes(needle),
                ),
              );
          },
          render: () => makePopup(false),
        },
      }),
    ],
    [vendor, presetItems, makePopup],
  );
  const editor = vendor.useEditor(
    {
      extensions,
      content: promptToDocument(props.value, props.connectedAssets || []),
      onUpdate: ({ editor }: { editor: Editor }) => {
        sync(editor);
        keepPagePosition();
      },
      onBlur: ({ editor }: { editor: Editor }) => {
        sync(editor);
        schedule(() => {
          if (
            editorRef.current === editor &&
            !editor.isFocused &&
            !popupRef.current?.isShown() &&
            !rootRef.current?.closest('[data-fisherai-prompt-expanded]')
          )
            currentRef.current.onBlur?.();
        }, 100);
      },
      editorProps: {
        attributes: {
          class: 'prose prose-sm dark:prose-invert focus:outline-none max-w-none tiptap-editor',
          'aria-label': '提示词',
        },
        editable: () => !currentRef.current.disableDirectEdit,
      },
    },
    [],
  );
  React.useLayoutEffect(() => {
    editorRef.current = editor;
  }, [editor]);
  React.useEffect(() => {
    aliveRef.current = true;
    const timers = timersRef.current;
    const frames = framesRef.current;
    return () => {
      aliveRef.current = false;
      loadRef.current?.abort();
      popupRef.current?.exit();
      popupRef.current = null;
      timers.forEach(clearTimeout);
      timers.clear();
      frames.forEach(cancelAnimationFrame);
      frames.clear();
    };
  }, []);
  React.useEffect(() => {
    if (!editor) return;
    editor.setEditable(!props.disableDirectEdit);
    if (!props.disableDirectEdit)
      nextFrame(() => {
        if (
          editorRef.current === editor &&
          !editor.isDestroyed &&
          !currentRef.current.disableDirectEdit
        )
          editor.commands.focus();
      });
  }, [editor, props.disableDirectEdit, nextFrame]);
  React.useEffect(() => {
    if (!editor || editor.isFocused || editor.isDestroyed) return;
    const assets = currentRef.current.connectedAssets || [];
    if (documentToPrompt(editor.getJSON(), assets) !== props.value)
      editor.commands.setContent(promptToDocument(props.value, assets), { emitUpdate: false });
  }, [editor, props.value]);
  React.useEffect(() => {
    const composer = rootRef.current?.closest('[data-fisherai-generation-composer]');
    if (!composer || !editor) return;
    const insert = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      const current = currentRef.current;
      if (editor.isDestroyed || current.disableMentions) return;
      const entry = promptAssetIndex(current.connectedAssets || []).byId.get(id);
      if (!entry || !editor.state) return;
      const range = { from: editor.state.selection.from, to: editor.state.selection.to };
      rootRef.current?.closest<HTMLElement>('.prompt-editor-container')?.click();
      editor
        .chain()
        .focus()
        .insertContentAt(range, [
          {
            type: 'mention',
            attrs: {
              id,
              label: promptAssetLabel(entry.type, entry.number),
              assetType: entry.type,
              url: entry.asset.url || '',
            },
          },
        ])
        .run();
    };
    const insertPreset = (event: Event) => {
      const preset = (event as CustomEvent<unknown>).detail;
      if (
        editor.isDestroyed ||
        currentRef.current.disablePromptPresets ||
        !editor.state ||
        !validCreativePreset(preset)
      )
        return;
      const range = { from: editor.state.selection.from, to: editor.state.selection.to };
      const prompt = [preset.prefix, preset.prompt].filter(Boolean).join('\n');
      rootRef.current?.closest<HTMLElement>('.prompt-editor-container')?.click();
      editor
        .chain()
        .focus()
        .insertContentAt(range, [{ type: 'promptTag', attrs: { label: preset.name, prompt } }])
        .run();
    };
    composer.addEventListener('fisherai:insert-prompt-reference', insert);
    composer.addEventListener('fisherai:insert-creative-preset', insertPreset);
    return () => {
      composer.removeEventListener('fisherai:insert-prompt-reference', insert);
      composer.removeEventListener('fisherai:insert-creative-preset', insertPreset);
    };
  }, [editor]);
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = scrollRef.current;
      if (target) target.scrollTop += event.deltaY;
    };
    root.addEventListener('wheel', wheel, { passive: false });
    return () => root.removeEventListener('wheel', wheel);
  }, []);
  const { EditorContent } = vendor;
  return (
    <div
      ref={rootRef}
      className={`w-full h-full min-h-0 relative nowheel overflow-hidden ${props.className || ''}`}
      onFocusCapture={keepPagePosition}
      onKeyDown={(event) => {
        if (!props.disableDirectEdit) event.stopPropagation();
      }}
      onClick={(event) => {
        if (
          !props.disableDirectEdit &&
          editor &&
          event.target === event.currentTarget &&
          window.getSelection()?.isCollapsed
        )
          editor.commands.focus('end');
        keepPagePosition();
      }}
      onDoubleClick={(event) => {
        if (props.disableDirectEdit) event.preventDefault();
      }}
      onPaste={(event) => {
        event.stopPropagation();
        keepPagePosition();
      }}
      onCopy={(event) => event.stopPropagation()}
      onCut={(event) => event.stopPropagation()}
    >
      <div
        ref={scrollRef}
        data-fisherai-prompt-scroll
        className="w-full h-full min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain custom-scrollbar"
        style={{ scrollbarGutter: 'stable', paddingRight: '4px' }}
      >
        <EditorContent editor={editor} className="p-0 h-full min-h-0" />
      </div>
      {presetError && (
        <div
          role="alert"
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            background: 'var(--af-surface-raised)',
            color: 'var(--af-danger)',
            fontSize: 12,
            padding: 6,
          }}
        >
          {presetError}
          <button onClick={() => void reloadPresets()}>重试</button>
        </div>
      )}
    </div>
  );
}
