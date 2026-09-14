import type * as React from 'react';

type Hooks = Pick<typeof React, 'useState' | 'useCallback'>;
type Panel = 'history' | 'assets' | 'presets';
type Preview = 'image' | 'compare' | 'composite';
type Editor = 'annotation' | 'crop' | 'resize';
type AnchorEvent = { currentTarget: { getBoundingClientRect(): { top: number } } };
interface Panels {
  openPanel: Panel | null;
  historyY: number;
  assetsY: number;
  presetsY: number;
  assetVariant: 'panel' | 'modal';
  chatOpen: boolean;
  draggingToChat: boolean;
  previews: Record<Preview, unknown>;
  editors: Record<Editor, string | null>;
  imageEditorMode: 'editor' | 'grid' | 'panorama' | 'angle' | 'panorama-generate';
}
const initialPanels = (): Panels => ({
  openPanel: null,
  historyY: 0,
  assetsY: 0,
  presetsY: 0,
  assetVariant: 'panel',
  chatOpen: false,
  draggingToChat: false,
  previews: { image: null, compare: null, composite: null },
  editors: { annotation: null, crop: null, resize: null },
  imageEditorMode: 'editor',
});

/** Own panel exclusivity, anchors, previews and editor targets without changing their UI. */
export function useCanvasPanels(hooks: Hooks) {
  const [state, setState] = hooks.useState(initialPanels);
  const closePanel = hooks.useCallback((panel: Panel) => {
    setState((current) =>
      current.openPanel === panel ? { ...current, openPanel: null } : current,
    );
  }, []);
  const openPanel = hooks.useCallback(
    (panel: Panel, y: number, closeWorkflow: () => void, modal = false) => {
      closeWorkflow();
      setState((current) => ({
        ...current,
        openPanel: !modal && current.openPanel === panel ? null : panel,
        historyY: panel === 'history' ? y : current.historyY,
        assetsY: panel === 'assets' ? y : current.assetsY,
        presetsY: panel === 'presets' ? y : current.presetsY,
        assetVariant: panel === 'assets' ? (modal ? 'modal' : 'panel') : current.assetVariant,
        chatOpen: false,
      }));
    },
    [],
  );
  const setPreview = hooks.useCallback((preview: Preview, payload: unknown) => {
    setState((current) => ({ ...current, previews: { ...current.previews, [preview]: payload } }));
  }, []);
  const setEditor = hooks.useCallback((editor: Editor, id: string | null) => {
    setState((current) => ({ ...current, editors: { ...current.editors, [editor]: id } }));
  }, []);
  const handleHistoryClick = hooks.useCallback(
    (event: AnchorEvent, close: () => void) =>
      openPanel('history', event.currentTarget.getBoundingClientRect().top, close),
    [openPanel],
  );
  const handleAssetsClick = hooks.useCallback(
    (event: AnchorEvent, close: () => void) =>
      openPanel('assets', event.currentTarget.getBoundingClientRect().top, close),
    [openPanel],
  );
  const handleWorkflowPresetClick = hooks.useCallback(
    (event: AnchorEvent, close: () => void) =>
      openPanel('presets', event.currentTarget.getBoundingClientRect().top, close),
    [openPanel],
  );
  const openAssetLibraryModal = hooks.useCallback(
    (y: number, close: () => void) => openPanel('assets', y, close, true),
    [openPanel],
  );
  const closeHistoryPanel = hooks.useCallback(() => closePanel('history'), [closePanel]);
  const closeAssetLibrary = hooks.useCallback(() => closePanel('assets'), [closePanel]);
  const closeWorkflowPresetPanel = hooks.useCallback(() => closePanel('presets'), [closePanel]);
  const handleExpandImage = hooks.useCallback(
    (payload: unknown) => setPreview('image', payload),
    [setPreview],
  );
  const handleOpenCompare = hooks.useCallback(
    (payload: unknown) => setPreview('compare', payload),
    [setPreview],
  );
  const handleOpenComposite = hooks.useCallback(
    (payload: unknown) => setPreview('composite', payload),
    [setPreview],
  );
  const handleCloseExpand = hooks.useCallback(() => setPreview('image', null), [setPreview]);
  const handleCloseCompare = hooks.useCallback(() => setPreview('compare', null), [setPreview]);
  const handleCloseComposite = hooks.useCallback(() => setPreview('composite', null), [setPreview]);
  const toggleChat = hooks.useCallback(
    () => setState((current) => ({ ...current, chatOpen: !current.chatOpen })),
    [],
  );
  const closeChat = hooks.useCallback(
    () => setState((current) => ({ ...current, chatOpen: false })),
    [],
  );
  const handleNodeDragStart = hooks.useCallback((_id: string, chatOpen: boolean) => {
    if (chatOpen) setState((current) => ({ ...current, draggingToChat: true }));
  }, []);
  const handleNodeDragEnd = hooks.useCallback(
    () => setState((current) => ({ ...current, draggingToChat: false })),
    [],
  );
  const handleStartAnnotation = hooks.useCallback(
    (id: string) => setEditor('annotation', id),
    [setEditor],
  );
  const handleCloseAnnotation = hooks.useCallback(() => setEditor('annotation', null), [setEditor]);
  const handleStartCrop = hooks.useCallback(
    (id: string, mode: Panels['imageEditorMode'] = 'editor') => {
      setState((current) => ({
        ...current,
        imageEditorMode: mode,
        editors: { ...current.editors, crop: id },
      }));
    },
    [],
  );
  const handleCloseCrop = hooks.useCallback(() => setEditor('crop', null), [setEditor]);
  const handleStartResize = hooks.useCallback((id: string) => setEditor('resize', id), [setEditor]);
  const handleCloseResize = hooks.useCallback(() => setEditor('resize', null), [setEditor]);
  const resetPanels = hooks.useCallback(() => setState(initialPanels()), []);
  return {
    isHistoryPanelOpen: state.openPanel === 'history',
    historyPanelY: state.historyY,
    handleHistoryClick,
    closeHistoryPanel,
    expandedImageUrl: state.previews.image,
    expandedComparePayload: state.previews.compare,
    expandedCompositePayload: state.previews.composite,
    handleExpandImage,
    handleOpenCompare,
    handleOpenComposite,
    handleCloseExpand,
    handleCloseCompare,
    handleCloseComposite,
    isChatOpen: state.chatOpen,
    toggleChat,
    closeChat,
    isAssetLibraryOpen: state.openPanel === 'assets',
    assetLibraryY: state.assetsY,
    assetLibraryVariant: state.assetVariant,
    handleAssetsClick,
    closeAssetLibrary,
    openAssetLibraryModal,
    isWorkflowPresetPanelOpen: state.openPanel === 'presets',
    workflowPresetPanelY: state.presetsY,
    handleWorkflowPresetClick,
    closeWorkflowPresetPanel,
    isDraggingNodeToChat: state.draggingToChat,
    handleNodeDragStart,
    handleNodeDragEnd,
    annotatingNodeId: state.editors.annotation,
    handleStartAnnotation,
    handleCloseAnnotation,
    cropNodeId: state.editors.crop,
    imageEditorMode: state.imageEditorMode,
    handleStartCrop,
    handleCloseCrop,
    resizeNodeId: state.editors.resize,
    handleStartResize,
    handleCloseResize,
    resetPanels,
  };
}
