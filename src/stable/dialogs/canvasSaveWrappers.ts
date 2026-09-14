import type * as React from 'react';
import { ASSET_CATEGORIES, assetDefaultName } from '../media/assetOrganization';
import type { CanvasSaveDialogProps } from './canvasSaveDialog';
type Runtime = Pick<typeof React, 'createElement'>;
type SharedProps = Pick<CanvasSaveDialogProps, 'isOpen' | 'onClose' | 'categories' | 'onSave'>;
interface AssetProps extends SharedProps {
  defaultOwnership?: string;
  nodeToSnapshot?: { title?: string; prompt?: string; type?: string; resultUrl?: string } | null;
}
interface PresetProps extends SharedProps {
  coverUrl?: string;
  defaultName?: string;
}
export function CanvasAssetDialog(
  runtime: Runtime,
  props: AssetProps,
  Dialog: React.ComponentType<CanvasSaveDialogProps>,
) {
  const node = props.nodeToSnapshot;
  if (!props.isOpen || !node) return null;
  return runtime.createElement(Dialog, {
    isOpen: props.isOpen,
    onClose: props.onClose,
    title: '保存到资产',
    submitLabel: '保存',
    defaultName: assetDefaultName(node),
    categories: [...new Set([...props.categories, ...ASSET_CATEGORIES])],
    coverUrl: node.resultUrl || '',
    coverAlt: '资产封面',
    defaultOwnership: props.defaultOwnership || '',
    compactCategory: true,
    onSave: props.onSave,
    closeImmediatelyOnSave: true,
  });
}
export function CanvasPresetDialog(
  runtime: Runtime,
  props: PresetProps,
  Dialog: React.ComponentType<CanvasSaveDialogProps>,
) {
  return runtime.createElement(Dialog, {
    isOpen: props.isOpen,
    onClose: props.onClose,
    title: '创建 SKILL',
    submitLabel: '创建',
    defaultName: props.defaultName || '我的 SKILL',
    categories: props.categories,
    coverUrl: props.coverUrl,
    coverAlt: 'SKILL 缩略图',
    onSave: props.onSave,
    closeImmediatelyOnSave: true,
  });
}
