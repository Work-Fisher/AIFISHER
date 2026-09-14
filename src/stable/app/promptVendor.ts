import * as React from 'react';
import { Editor } from '@tiptap/core';
import { useEditor, ReactNodeViewRenderer, EditorContent, ReactRenderer } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import Mention from '@tiptap/extension-mention';
import tippy from 'tippy.js';
import type { CanvasPromptEditor } from '../prompt/canvasPromptEditor';
import type { PromptKeyHandle } from '../prompt/promptComponents';

type Vendor = Parameters<typeof CanvasPromptEditor>[2];
type Views = Pick<Vendor, 'PromptTagView' | 'MentionView' | 'PresetList' | 'MentionList'>;

function editorInstance(value: unknown): Editor {
  if (!(value instanceof Editor)) throw new Error('提示词编辑器实例不属于当前画布。');
  return value;
}

/** Translate the renderer library's objects into the prompt module's lifecycle contract. */
export function createPromptVendor(views: Views): Vendor {
  return {
    ...views,
    useEditor,
    StarterKit,
    Placeholder,
    Mention,
    nodeView: (component) =>
      ReactNodeViewRenderer(component as Parameters<typeof ReactNodeViewRenderer>[0]),
    EditorContent: ({ editor, className }) =>
      React.createElement(EditorContent, {
        editor: editor === null ? null : editorInstance(editor),
        className,
      }),
    ui: {
      createRenderer(component, props) {
        const renderer = new ReactRenderer<PromptKeyHandle>(
          component as ConstructorParameters<typeof ReactRenderer<PromptKeyHandle>>[0],
          { props, editor: editorInstance(props.editor) },
        );
        return {
          element: renderer.element,
          get ref() {
            return renderer.ref ?? undefined;
          },
          updateProps: (next) => renderer.updateProps(next),
          destroy: () => renderer.destroy(),
        };
      },
      createPopup: (options) => tippy('body', options)[0],
    },
  };
}
