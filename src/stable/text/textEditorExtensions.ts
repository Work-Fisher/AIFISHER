import { Extension, Node, type Editor, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
  addColumnAfter,
  addRowAfter,
  deleteColumn,
  deleteRow,
  deleteTable,
  findTable,
  goToNextCell,
  tableEditing,
  TableMap,
  tableNodes,
} from '@tiptap/pm/tables';
import { createTextDocumentPatch } from './textDocument';

export const MAX_TEXT_TABLE_SIZE = 20;
const specs = tableNodes({ tableGroup: 'block', cellContent: 'block+', cellAttributes: {} });
const tableNames = {
  table: 'table',
  table_row: 'tableRow',
  table_cell: 'tableCell',
  table_header: 'tableHeader',
} as const;
const tags = { table: 'table', table_row: 'tr', table_cell: 'td', table_header: 'th' };

function span(value: string | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_TEXT_TABLE_SIZE ? parsed : 1;
}

// Use the installed ProseMirror table schema and commands. Only the node names
// change to the camelCase names used by the persisted document contract.
const tables = Object.entries(tableNames).map(([key, name]) => {
  const spec = specs[key as keyof typeof specs];
  return Node.create({
    name,
    group: spec.group,
    content: spec.content?.replace(
      /table_row|table_cell|table_header/g,
      (value) => tableNames[value as keyof typeof tableNames],
    ),
    isolating: spec.isolating,
    addAttributes() {
      if (name !== 'tableCell' && name !== 'tableHeader') return {};
      return {
        colspan: {
          default: 1,
          rendered: false,
          parseHTML: (element) => span(element.getAttribute('colspan')),
        },
        rowspan: {
          default: 1,
          rendered: false,
          parseHTML: (element) => span(element.getAttribute('rowspan')),
        },
        colwidth: { default: null, rendered: false, parseHTML: () => null },
      };
    },
    parseHTML() {
      return [{ tag: tags[key as keyof typeof tags] }];
    },
    renderHTML({ node }) {
      return spec.toDOM!(node);
    },
  });
});

const tableBehavior = Extension.create({
  name: 'textTableBehavior',
  extendNodeSchema(extension) {
    const entry = Object.entries(tableNames).find(([, name]) => extension.name === name);
    return entry ? { tableRole: specs[entry[0] as keyof typeof specs].tableRole } : {};
  },
  addProseMirrorPlugins() {
    return [tableEditing()];
  },
  addKeyboardShortcuts() {
    return {
      Tab: () => goToNextCell(1)(this.editor.state, this.editor.view.dispatch),
      'Shift-Tab': () => goToNextCell(-1)(this.editor.state, this.editor.view.dispatch),
    };
  },
});

export function textEditorExtensions() {
  return [
    StarterKit.configure({ link: false, heading: { levels: [1, 2, 3] }, trailingNode: false }),
    ...tables,
    tableBehavior,
  ];
}

export function textTableSize(editor: Editor | null) {
  if (!editor) return null;
  const table = findTable(editor.state.selection.$from);
  if (!table) return null;
  const map = TableMap.get(table.node);
  return { rows: map.height, columns: map.width };
}

export function insertTextTable(editor: Editor, rows: number, columns: number) {
  if (
    !editor.isEditable ||
    ![rows, columns].every(
      (value) => Number.isInteger(value) && value >= 1 && value <= MAX_TEXT_TABLE_SIZE,
    )
  )
    return false;
  const table: JSONContent = {
    type: 'table',
    content: Array.from({ length: rows }, (_, row) => ({
      type: 'tableRow',
      content: Array.from({ length: columns }, () => ({
        type: row === 0 ? 'tableHeader' : 'tableCell',
        content: [{ type: 'paragraph' }],
      })),
    })),
  };
  return editor
    .chain()
    .focus()
    .insertContent([table, { type: 'paragraph' }])
    .run();
}

const tableActions = {
  addRow: addRowAfter,
  addColumn: addColumnAfter,
  deleteRow,
  deleteColumn,
  deleteTable,
};
export type TextTableAction = keyof typeof tableActions;

export function runTextTableAction(editor: Editor, action: TextTableAction) {
  const size = textTableSize(editor);
  if (
    !editor.isEditable ||
    !size ||
    (action === 'addRow' && size.rows >= MAX_TEXT_TABLE_SIZE) ||
    (action === 'addColumn' && size.columns >= MAX_TEXT_TABLE_SIZE)
  )
    return false;
  editor.commands.focus();
  return tableActions[action](editor.state, editor.view.dispatch);
}

export async function copyTextEditorDocument(editor: Editor): Promise<'rich' | 'plain'> {
  const plain = createTextDocumentPatch(editor.getJSON()).textContent;
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([plain], { type: 'text/plain' }),
          'text/html': new Blob([editor.getHTML()], { type: 'text/html' }),
        }),
      ]);
      return 'rich';
    } catch {
      // Some desktop clipboard implementations accept plain text only.
    }
  }
  if (!navigator.clipboard?.writeText)
    throw new Error('剪贴板不可用，请选中文字后按 Ctrl+C 复制。');
  await navigator.clipboard.writeText(plain);
  return 'plain';
}
