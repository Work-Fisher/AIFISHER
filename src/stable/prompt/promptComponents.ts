import type * as React from 'react';
import type { PromptPreset, PromptPresetType } from './promptPresets';
export type PromptRuntime = Pick<
  typeof React,
  | 'Fragment'
  | 'createElement'
  | 'useState'
  | 'useRef'
  | 'useMemo'
  | 'useEffect'
  | 'useLayoutEffect'
  | 'useCallback'
  | 'useImperativeHandle'
>;
export type PromptIcon = React.ComponentType<{ size?: number; className?: string }>;
export interface PromptIcons {
  ImageIcon: PromptIcon;
  VideoIcon: PromptIcon;
  TextIcon: PromptIcon;
  AudioIcon: PromptIcon;
  CloseIcon: PromptIcon;
  TagIcon: PromptIcon;
  AddIcon: PromptIcon;
  CopyIcon: PromptIcon;
  DeleteIcon: PromptIcon;
  BackIcon: PromptIcon;
  UploadIcon: PromptIcon;
  Spinner: PromptIcon;
}
export interface PromptKeyHandle {
  onKeyDown(props: { event: KeyboardEvent }): boolean;
}
export interface PromptPresetItem extends PromptPreset {
  category: string;
}
export interface PresetListProps {
  items: PromptPresetItem[];
  type?: PromptPresetType;
  editor?: {isDestroyed?: boolean;commands:{focus():void}};
  command(props: { label: string; prompt: string }): void;
  onDeleteSuccess?(): void;
}
export interface PresetFormProps {
  type: PromptPresetType;
  initialCategory?: string;
  onSave(): void;
  onCancel(): void;
}
export interface PresetCardProps {
  item: PromptPresetItem;
  isSelected: boolean;
  onClick(): void;
  onMouseEnter(): void;
  onDelete(): Promise<boolean>;
}
export function presetText(item?: PromptPreset) {
  return Array.isArray(item?.prompt) ? item.prompt.join('\n') : item?.prompt || '';
}
export function promptPreviewIsVideo(url: string) {
  return /^data:video\/mp4[;,]/i.test(url) || /\.mp4(?:[?#]|$)/i.test(url);
}
export function isolatePromptMenuKeyboard(event: React.KeyboardEvent) {
  event.stopPropagation();
  if (event.key === 'Delete' || event.key === 'Backspace' ||
    ((event.ctrlKey || event.metaKey) && ['z', 'y', 's', 'g'].includes(event.key.toLowerCase())))
    event.preventDefault();
}
