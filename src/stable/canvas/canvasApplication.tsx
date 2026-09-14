import type { CanvasNode } from '../nodes/canvasNodeOperations';
import { alignCanvasDrag } from './canvasAlignment';
import type { CanvasGroup } from './canvasGroups';
import type { CanvasNodeFrame, SelectionResizeHandle } from './canvasEditing';
import type * as ReactTypes from 'react';
import type { Runtime, Dependencies } from './canvasApplicationDependencies';
import type { CanvasContextMenuState } from './canvasContextActions';
import { useCanvasAssetInsertion } from './canvasAssetInsertion';
import { useCanvasImageUpscale } from '../media/canvasImageUpscale';
import { createImageAngleDraft } from '../media/imageAngleDraft';
import type { ImageAngle } from '../prompt/imageAngle';
import { createCanvasSceneProjector, canvasVisibleScene } from './canvasSceneData';
import { applyCanvasPromptProposal } from '../agent/canvasPromptProposal';
import type { PromptProposal } from '../agent/codexClient';
import { flushSync } from 'react-dom';
import { createCanvasCreationControl } from '../agent/canvasCreationControl';
import { createCanvasProjectControl } from '../agent/canvasProjectControl';
import { createCanvasTaskControl } from '../agent/canvasTaskControl';
import { createCanvasMediaControl } from '../agent/canvasMediaControl';
import { createCanvasExternalClient } from '../agent/canvasExternalClient';
import { createCanvasWorkflowControl } from '../agent/canvasWorkflowControl';
import { createCanvasProductControl } from '../agent/canvasProductControl';
import { requestWorkflowNodeRun } from '../local/workflowNodeSession';
import { createGenerationPlanClient } from '../agent/generationPlanClient';
import { createCanvasBudgetControl } from '../agent/canvasBudgetControl';
import { createCanvasControlExecutor } from '../agent/canvasControlExecutor';
import { createCanvasAssetControl } from '../agent/canvasAssetControl';
import { projectArchiveRestoreRequest } from '../desktop/localFileUpload';
import {
  useCanvasPageEvents,
  useCanvasDeferredFrame,
  useCanvasSurfaceSize,
} from './canvasApplicationEvents';
export function CanvasApplication(React: Runtime, dependencies: Dependencies) {
  const {
    usePanels,
    useTitle,
    useViewport,
    useNodes,
    useConnections,
    useDrag,
    useResize,
    useMarquee,
    useGroups,
    useEdgePan,
    useHistory,
    useWorkflow,
    useLocalUser,
    userColorForId,
    NodeStatus,
    useGeneration,
    useSnapshots,
    useAudioTrim,
    NodeType,
    useTextActions,
    useLocalWorkflows,
    useAssets,
    usePresets,
    useCommands,
    useAutoSave,
    useVideoResults,
    useImageResults,
    useContextMenu,
    media,
    getNodeWidth,
    getNodeHeight,
    createId,
    textForNode,
    Projects,
    Settings,
    Header,
    Sidebar,
    Scene,
    Controls,
    SidePanels,
    Overlays,
    Annotation,
    Crop,
    Resize,
  } = dependencies;
  const session = window.__FISHERAI_CANVAS_SESSION__,
    navigationRef = React.useRef(0),
    mountedRef = React.useRef(true),
    [view, setView] = React.useState('dashboard'),
    [folderId, setFolderId] = React.useState<string | null>(null),
    [contextMenu, setContextMenu] = React.useState<CanvasContextMenuState>({
      isOpen: false,
      x: 0,
      y: 0,
      type: 'global',
    }),
    [showGridSlider, setShowGridSlider] = React.useState(false),
    [gridColumns, setGridColumns] = React.useState(3),
    [isCompact, setCompact] = React.useState(false),
    [isMinimapOpen, setMinimapOpen] = React.useState(true),
    [minimapWidth, setMinimapWidth] = React.useState(250),
    [chatPanelWidth, setChatPanelWidth] = React.useState(400),
    [settingsOpen, setSettingsOpen] = React.useState(false),
    [savedAt, setSavedAt] = React.useState<number | null | undefined>(void 0),
    [savedBy, setSavedBy] = React.useState('用户-'),
    [savedRevision, setSavedRevision] = React.useState<number | null>(null),
    zoomControlsRef = React.useRef<HTMLDivElement | null>(null),
    pointerRef = React.useRef<{
      x: number;
      y: number;
    } | null>(null),
    projectFileRef = React.useRef<HTMLInputElement | null>(null),
    mergeProjectFileRef = React.useRef<HTMLInputElement | null>(null);

  const {
      isHistoryPanelOpen,
      historyPanelY,
      handleHistoryClick,
      closeHistoryPanel,
      expandedImageUrl,
      expandedComparePayload,
      expandedCompositePayload,
      handleExpandImage,
      handleOpenCompare,
      handleOpenComposite,
      handleCloseExpand,
      handleCloseCompare,
      handleCloseComposite,
      isChatOpen,
      toggleChat,
      closeChat,
      isAssetLibraryOpen,
      assetLibraryY,
      assetLibraryVariant,
      handleAssetsClick,
      closeAssetLibrary,
      openAssetLibraryModal,
      isWorkflowPresetPanelOpen,
      workflowPresetPanelY,
      closeWorkflowPresetPanel,
      isDraggingNodeToChat,
      handleNodeDragStart,
      handleNodeDragEnd,
      annotatingNodeId,
      handleStartAnnotation,
      handleCloseAnnotation,
      cropNodeId,
      imageEditorMode,
      handleStartCrop,
      handleCloseCrop,
      resizeNodeId,
      handleStartResize,
      handleCloseResize,
    } = usePanels(),
    [batchConnecting, setBatchConnecting] = React.useState(false),
    selectedCoverRef = React.useRef<string | null>(null),
    newProjectPendingRef = React.useRef(false);
  const {
      canvasTitle,
      setCanvasTitle,
      isEditingTitle,
      setIsEditingTitle,
      editingTitleValue,
      setEditingTitleValue,
      canvasTitleInputRef,
    } = useTitle(),
    { viewport, setViewport, canvasRef, handleWheel, handleSliderZoom, focusOnNodes } =
      useViewport(),
    onCanvasWheel = (ke: ReactTypes.WheelEvent<HTMLDivElement>) => {
      handleWheel(ke);
    },
    {
      nodes,
      setNodes,
      getNodes,
      createAgentNode,
      configureAgentNode,
      connectAgentNodes,
      selectedNodeIds,
      setSelectedNodeIds,
      updateNode,
      deleteNodes,
      clearSelection,
      handleSelectTypeFromMenu,
      autoAlignNodes,
      gridLayoutNodes,
    } = useNodes(),
    focusNodes = React.useCallback(
      (FisherIds: readonly string[]) => focusOnNodes(getNodes(), FisherIds),
      [focusOnNodes, getNodes],
    );

  const {
      isDraggingConnection,
      isPendingConnection,
      connectionStart,
      tempConnectionEnd,
      hoveredNodeId: connectionHoveredNodeId,
      hoveredSide,
      hoveredPortIndex,
      isInvalidHover,
      selectedConnection,
      setSelectedConnection,
      pendingBatchSourceNodeIds,
      handleConnectorPointerDown,
      updateConnectionDrag,
      completeConnectionDrag,
      cancelConnectionDrag,
      handleEdgeClick,
      deleteSelectedConnection,
    } = useConnections(),
    {
      handleNodePointerDown,
      updateNodeDrag,
      endNodeDrag,
      startPanning,
      updatePanning,
      endPanning,
      isDragging,
      isPanning,
      releasePointerCapture,
    } = useDrag(),
    {
      isResizing,
      handleResizeStart,
      handleSelectionResizeStart: startSelectionResize,
      updateNodeResize,
      endNodeResize,
    } = useResize(),
    {
      selectionBox,
      isSelecting,
      startSelection,
      updateSelection,
      endSelection,
      clearSelectionBox,
    } = useMarquee(),
    {
      groups,
      setGroups,
      getGroups,
      groupNodes,
      ungroupNodes,
      cleanupInvalidGroups,
      getCommonGroup,
      renameGroup,
    } = useGroups(),
    { updatePointerPos } = useEdgePan({
      canvasRef,
      isDragging,
      isDraggingConnection,
      isSelecting,
      viewport,
      setViewport,
      setNodes,
      selectedNodeIds,
    }),
    {
      undo: undoHistory,
      redo: redoHistory,
      pushHistory,
      reset,
      canUndo,
      canRedo,
    } = useHistory({ nodes, groups }, 50);

  const {
      workflowId,
      isWorkflowPanelOpen,
      workflowPanelY,
      handleSaveWorkflow,
      handleLoadWorkflow,
      closeWorkflowPanel,
      resetWorkflowId,
      getWorkflowEpoch,
      importDocument,
      useProjectFiles,
      useSaveFeedback,
    } = useWorkflow({
      nodes,
      groups,
      viewport,
      canvasTitle,
      isMinimapOpen,
      setNodes,
      setGroups,
      setSelectedNodeIds,
      setCanvasTitle,
      setEditingTitleValue,
      setViewport,
      setIsMinimapOpen: setMinimapOpen,
      onPanelOpen: () => {
        closeHistoryPanel();
        closeAssetLibrary();
        closeWorkflowPresetPanel();
      },
    }),
    activeProjectId = view === 'canvas' ? workflowId : null;

  // The source-owned canvas remains the only node store and save/history owner.
  const dramaBridge = window.__FISHERAI_DRAMA_BRIDGE__;
  const dramaDocumentEpoch = getWorkflowEpoch();
  React.useLayoutEffect(() => {
    dramaBridge?.setProject(activeProjectId);
    return () => dramaBridge?.clearProject(activeProjectId);
  }, [dramaBridge, activeProjectId, dramaDocumentEpoch]);
  React.useLayoutEffect(
    () =>
      dramaBridge?.bind(
        nodes,
        (transform) => {
          setNodes((current) => {
            const next = transform(current);
            if (!next.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)))
              throw new Error('文戏节点坐标无效，未写入画布。');
            return next as CanvasNode[];
          });
        },
        setSelectedNodeIds,
      ),
    [dramaBridge, nodes, setNodes, setSelectedNodeIds, dramaDocumentEpoch],
  );

  const deferFrame = useCanvasDeferredFrame(React, view === 'canvas', getWorkflowEpoch);
  const windowSize = useCanvasSurfaceSize(React, canvasRef, view, getWorkflowEpoch());

  const {
      id: localUserId,
      no: localUserNo,
      name: localUserName,
      setName: setLocalUserName,
    } = useLocalUser(),
    userColor = React.useMemo(
      () => userColorForId(localUserId || localUserNo),
      [localUserId, localUserNo, userColorForId],
    ),
    [dirty, setDirty] = React.useState(false),
    hasUnsavedChanges = dirty,
    firstEditRef = React.useRef(true),
    observedContentRef = React.useRef({ nodes, groups, title: canvasTitle }),
    loadingCountRef = React.useRef(0),
    resultCountRef = React.useRef(0),
    applyingDocumentRef = React.useRef(false);

  // History commits record edits; only explicit navigation restores a snapshot.
  const restoreHistory = (snapshot: { nodes: CanvasNode[]; groups: CanvasGroup[] } | null) => {
    if (!snapshot) return;
    applyingDocumentRef.current = true;
    setNodes(snapshot.nodes);
    setGroups(snapshot.groups);
    setDirty(true);
  };
  const undo = () => restoreHistory(undoHistory());
  const redo = () => restoreHistory(redoHistory());
  const controlRuntime = React.useRef<Parameters<typeof createCanvasControlExecutor>[0]>(
    () => null,
  );
  const documentEpoch = getWorkflowEpoch();
  controlRuntime.current = () =>
    view === 'canvas' &&
    workflowId &&
    mountedRef.current &&
    !isDragging &&
    !isResizing &&
    !isDraggingConnection &&
    !isSelecting
      ? {
          projectId: workflowId,
          snapshot: () => ({ nodes: getNodes(), groups: getGroups() }),
          create: createAgentNode,
          configure: configureAgentNode,
          connect: connectAgentNodes,
          measure: (node) => ({ width: getNodeWidth(node), height: getNodeHeight(node) }),
          selection: () => selectedNodeIds,
          focus: (ids) => {
            setSelectedNodeIds(ids);
            focusOnNodes(getNodes(), ids);
          },
          commit: (before, after) => {
            flushSync(() => {
              pushHistory(before);
              applyingDocumentRef.current = true;
              setNodes(after.nodes);
              setGroups(after.groups);
              pushHistory(after);
              setDirty(true);
            });
          },
        }
      : null;
  const creationRuntime = React.useRef<Parameters<typeof createCanvasCreationControl>[1]>(
    () => null,
  );
  creationRuntime.current = () =>
    view === 'canvas' && workflowId && mountedRef.current
      ? {
          projectId: workflowId,
          nodes: getNodes,
          generate: (id, authorization) => handleGenerate(id, authorization),
        }
      : null;
  const canvasExecutor = React.useMemo(
    () =>
      createCanvasControlExecutor(() =>
        getWorkflowEpoch() === documentEpoch ? controlRuntime.current() : null,
      ),
    [documentEpoch, getWorkflowEpoch],
  );
  const canvasCreation = React.useMemo(
    () =>
      createCanvasCreationControl(
        createCanvasWorkflowControl(
          createCanvasMediaControl(createCanvasAssetControl(canvasExecutor), canvasExecutor, () =>
            getWorkflowEpoch() === documentEpoch ? creationRuntime.current() : null,
          ),
          canvasExecutor,
          () => (getWorkflowEpoch() === documentEpoch ? creationRuntime.current() : null),
        ),
        () => (getWorkflowEpoch() === documentEpoch ? creationRuntime.current() : null),
        globalThis.fetch,
        createGenerationPlanClient(),
      ),
    [canvasExecutor, documentEpoch, getWorkflowEpoch],
  );
  React.useEffect(() => {
    if (activeProjectId) void canvasCreation.restore(activeProjectId).catch(() => {});
  }, [activeProjectId, canvasCreation]);
  const projectRuntime = React.useRef<Parameters<typeof createCanvasProjectControl>[1]>(() => null);
  const canvasProjects = React.useMemo(
    () =>
      createCanvasProjectControl(canvasCreation.control, () =>
        getWorkflowEpoch() === documentEpoch ? projectRuntime.current() : null,
      ),
    [canvasCreation, documentEpoch, getWorkflowEpoch],
  );
  const taskControl = React.useMemo(
    () =>
      createCanvasTaskControl(canvasProjects.control, () =>
        getWorkflowEpoch() === documentEpoch ? creationRuntime.current() : null,
      ),
    [canvasProjects, documentEpoch, getWorkflowEpoch],
  );
  const canvasBudgets = React.useMemo(
    () =>
      createCanvasBudgetControl(taskControl, canvasCreation, () =>
        getWorkflowEpoch() === documentEpoch ? creationRuntime.current() : null,
      ),
    [taskControl, canvasCreation, documentEpoch, getWorkflowEpoch],
  );
  React.useEffect(() => {
    if (activeProjectId) void canvasBudgets.refresh(activeProjectId);
  }, [activeProjectId, canvasBudgets]);
  const productRuntime = React.useRef<Parameters<typeof createCanvasProductControl>[1]>(() => null);
  const canvasProducts = React.useMemo(
    () =>
      createCanvasProductControl(canvasBudgets.control, () =>
        getWorkflowEpoch() === documentEpoch ? productRuntime.current() : null,
      ),
    [canvasBudgets, documentEpoch, getWorkflowEpoch],
  );
  const canvasExternal = React.useMemo(
    () =>
      activeProjectId
        ? createCanvasExternalClient(
            activeProjectId,
            canvasProducts.control,
            globalThis.fetch,
            (sessionId) => {
              canvasCreation.cancelSession(sessionId);
              canvasProjects.cancelSession(sessionId);
              canvasProducts.cancelSession(sessionId);
              void canvasBudgets.refresh(activeProjectId);
            },
          )
        : undefined,
    [activeProjectId, canvasProducts, canvasCreation, canvasProjects, canvasBudgets],
  );
  const canvasControl = canvasExternal?.control || canvasProducts.control;
  React.useEffect(() => {
    if (canvasExternal) void canvasExternal.start();
    return () => canvasExternal?.stop();
  }, [canvasExternal]);
  const save = useSaveFeedback({
      enabled: view === 'canvas',
      getWorkflowEpoch,
      getNodes,
      getSelectedCoverId: () => selectedCoverRef.current,
      folderId,
      userNo: localUserNo,
      saveWorkflow: handleSaveWorkflow,
      setDirty,
      setSavedAt,
      setSavedBy,
      setSavedRevision,
    }),
    saveManually = React.useCallback(async () => {
      await save({ manual: true });
    }, [save]),
    loadProject = React.useCallback(
      async (ke: string) => {
        const intent = ++navigationRef.current;
        applyingDocumentRef.current = true;
        const st = await handleLoadWorkflow(ke);
        if (!mountedRef.current || intent !== navigationRef.current) return null;
        if (st) {
          const ot = st.nodes || [];
          reset({ nodes: ot, groups: st.groups || [] });
          loadingCountRef.current = ot.filter((Ge) => Ge.status === NodeStatus.LOADING).length;
          resultCountRef.current = ot.filter(
            (Ge) => Ge.status === NodeStatus.SUCCESS && Ge.resultUrl,
          ).length;
          setSavedAt(st.lastSavedAt);
          setSavedBy(st.lastSavedBy || '用户-');
          setSavedRevision(typeof st.revision == 'number' ? st.revision : null);
        }
        return (st && setDirty(false), st);
      },
      [handleLoadWorkflow, reset, NodeStatus],
    ),
    { handleGenerate } = useGeneration({
      nodes,
      getNodes,
      projectId: workflowId || undefined,
      enabled: view === 'canvas',
      updateNode,
    }),
    { handleVideoSnapshot, handleVideoFirstLastSnapshot } = useSnapshots({
      nodes,
      getNodes,
      enabled: view === 'canvas',
      projectId: workflowId || undefined,
      setNodes,
      setSelectedNodeIds,
    }),
    { handleAudioTrim } = useAudioTrim({
      nodes,
      getNodes,
      enabled: view === 'canvas',
      projectId: workflowId || undefined,
      setNodes,
      setSelectedNodeIds,
    });

  const handleUpscaleImage = useCanvasImageUpscale(React, {
    projectId: workflowId || undefined,
    enabled: view === 'canvas',
    getNodes,
    setNodes,
    select: setSelectedNodeIds,
  });
  const agentReferences = React.useMemo(
      () =>
        isChatOpen
          ? nodes
              .filter(
                (ke) =>
                  selectedNodeIds.includes(ke.id) &&
                  [
                    'image',
                    'upload image',
                    'video',
                    'upload video',
                    'audio',
                    'upload audio',
                  ].includes(String(ke.type).toLowerCase()) &&
                  typeof ke.resultUrl == 'string' &&
                  ke.resultUrl.length > 0,
              )
              .map((ke) => ({
                nodeId: ke.id,
                url: ke.resultUrl,
                type: String(ke.type).toLowerCase().includes('video')
                  ? 'video'
                  : String(ke.type).toLowerCase().includes('audio')
                    ? 'audio'
                    : 'image',
              }))
          : [],
      [isChatOpen, nodes, selectedNodeIds],
    ),
    clearCanvas = () => {
      applyingDocumentRef.current = true;
      setNodes([]);
      setGroups([]);
      setSelectedNodeIds([]);
      setCanvasTitle('Untitled');
      setEditingTitleValue('Untitled');
      resetWorkflowId();
      selectedCoverRef.current = null;
      setSavedAt(undefined);
      setSavedRevision(null);
      setSavedBy('用户-');
      reset({ nodes: [], groups: [] });
      setDirty(false);
    },
    { handleWriteContent, handleTextToVideo, handleTextToImage } = useTextActions({
      nodes,
      getNodes,
      enabled: view === 'canvas',
      projectId: workflowId || undefined,
      updateNode,
      setNodes,
      setSelectedNodeIds,
    }),
    { handleMiniMaxH3T2VAGenerate } = useLocalWorkflows({
      nodes,
      getNodes,
      enabled: view === 'canvas',
      projectId: workflowId || undefined,
      setNodes,
      setSelectedNodeIds,
    });
  const {
      isCreateAssetModalOpen,
      setIsCreateAssetModalOpen,
      nodeToSnapshot,
      assetCategories,
      handleOpenCreateAsset,
      handleSaveAssetToLibrary,
      handleContextUpload,
      handleClipboardImagePaste,
      handleReplaceMedia,
    } = useAssets({
      nodes,
      getNodes,
      enabled: view === 'canvas',
      viewport,
      contextMenu,
      projectId: workflowId || undefined,
      setNodes,
      setSelectedNodeIds,
    }),
    {
      isCreateWorkflowPresetModalOpen,
      setIsCreateWorkflowPresetModalOpen,
      workflowPresetCoverUrl,
      workflowPresetCategories,
      workflowPresetDefaultName,
      canCreateWorkflowPreset,
      handleOpenCreateWorkflowPreset,
      handleSaveWorkflowPreset,
      handleImportWorkflowPreset,
    } = usePresets({
      nodes,
      getNodes,
      enabled: view === 'canvas',
      selectedNodeIds,
      viewport,
      projectId: workflowId || undefined,
      setNodes,
      setSelectedNodeIds,
      closeWorkflowPresetPanel,
    }),
    { handleCopy, handlePaste, hasCopiedNodes } = useCommands({
      nodes,
      viewport,
      selectedNodeIds,
      selectedConnection,
      setNodes,
      setSelectedNodeIds,
      setContextMenu,
      deleteNodes,
      deleteSelectedConnection,
      clearSelection,
      clearSelectionBox,
      undo,
      redo,
      autoAlignNodes,
      handleSaveWorkflow: saveManually,
      focusOnNodes,
      groupSelectedNodes: (ke: string[]) => {
        if (ke.length > 1) {
          groupNodes(ke, nodes, setNodes);
        }
      },
    });
  useAutoSave({
    isDirty: dirty,
    nodes,
    groups,
    title: canvasTitle,
    documentId: workflowId,
    enabled: view === 'canvas',
    onSave: () => save({ reportFailure: true }),
    hasActiveOperations: nodes.some((node) => node.status === NodeStatus.LOADING),
    interval: 5e3,
  });
  useVideoResults({ nodes, updateNode });

  useImageResults({ nodes, updateNode });
  useCanvasPageEvents(React, {
    enabled: view === 'canvas',
    canvasRef,
    pointer: pointerRef,
    hasCopiedNodes,
    paste: handlePaste,
    upload: handleClipboardImagePaste,
  });
  const {
      handleDoubleClick,
      handleGlobalContextMenu,
      handleAddNext,
      handleNodeContextMenu,
      handleContextMenuCreateAsset,
      handleContextMenuCreateWorkflowPreset,
      handleContextMenuSelect,
      handleToolbarAdd,
    } = useContextMenu({
      nodes,
      selectedNodeIds,
      viewport,
      projectId: workflowId || undefined,
      contextMenu,
      setContextMenu,
      handleOpenCreateAsset,
      handleOpenCreateWorkflowPreset,
      handleSelectTypeFromMenu,
      onCancelConnection: cancelConnectionDrag,
    }),
    openHistory = React.useCallback(
      (ke: ReactTypes.MouseEvent<HTMLButtonElement>) => {
        handleHistoryClick(ke, closeWorkflowPanel);
      },
      [handleHistoryClick, closeWorkflowPanel],
    ),
    openAssets = React.useCallback(
      (ke: ReactTypes.MouseEvent<HTMLButtonElement>) => {
        handleAssetsClick(ke, closeWorkflowPanel);
      },
      [handleAssetsClick, closeWorkflowPanel],
    ),
    openAssetsModal = React.useCallback(() => {
      openAssetLibraryModal(contextMenu.y, closeWorkflowPanel);
    }, [openAssetLibraryModal, contextMenu.y, closeWorkflowPanel]),
    replaceMedia = handleReplaceMedia,
    createCollage = media.useCanvasCollage(React, {
      nodes,
      getNodes,
      enabled: view === 'canvas',
      projectId: workflowId || undefined,
      setNodes,
      setSelectedNodeIds,
      selectedNodeIds,
      getNodeWidth,
      getNodeHeight,
    }),
    { selectHistoryAsset, importLibraryAsset } = useCanvasAssetInsertion(React, {
      enabled: view === 'canvas',
      getWorkflowEpoch,
      projectId: workflowId || undefined,
      viewport,
      canvasRef,
      setNodes,
      closeHistory: closeHistoryPanel,
      closeLibrary: closeAssetLibrary,
    });

  projectRuntime.current = () =>
    view === 'canvas' && workflowId && mountedRef.current
      ? {
          projectId: workflowId,
          folderId,
          save: async () => {
            const receipt = await save({ manual: true, reportFailure: true });
            return !!receipt && receipt.unchanged !== false;
          },
          rename: async (title) => {
            flushSync(() => {
              setCanvasTitle(title);
              setEditingTitleValue(title);
              setDirty(true);
            });
            const receipt = await save({ manual: true, reportFailure: true });
            return !!receipt && receipt.unchanged !== false;
          },
          move: (id) => flushSync(() => setFolderId(id)),
          open: (id) => openProject(id),
          exit: () => backToProjects(),
          importFile: () => chooseProjectFile(),
          download: (id) => {
            const link = document.createElement('a');
            link.href = `/api/workflows/${encodeURIComponent(id)}/backup`;
            link.download = '';
            link.click();
          },
        }
      : null;
  productRuntime.current = () =>
    view === 'canvas' && workflowId && mountedRef.current
      ? {
          projectId: workflowId,
          async invoke(operation, nodeId) {
            const node = nodeId ? getNodes().find((item) => item.id === nodeId) : undefined;
            if (nodeId && (!node || node.status === 'loading')) throw Error('节点不可用');
            if (operation === 'workflowManager') {
              window.dispatchEvent(new CustomEvent('fisherai:open-workflow-library'));
              return;
            }
            if (operation === 'upload' || operation === 'replace') {
              const input = document.createElement('input'),
                epoch = getWorkflowEpoch();
              input.type = 'file';
              input.accept = 'image/*,video/*,audio/*';
              input.multiple = operation === 'upload';
              input.onchange = () => {
                const files = input.files;
                input.remove();
                if (getWorkflowEpoch() !== epoch || !files?.length) return;
                if (nodeId) void handleReplaceMedia(nodeId, files[0]);
                else void handleContextUpload(files);
              };
              input.oncancel = () => input.remove();
              input.hidden = true;
              document.body.append(input);
              input.click();
              return;
            }
            if (!node) throw Error('节点不存在');
            if (operation === 'saveAsset') {
              handleOpenCreateAsset(node.id);
              return;
            }
            if (operation === 'resize') {
              handleStartResize(node.id);
              return;
            }
            if (operation === 'download') {
              if (typeof node.resultUrl !== 'string' || !window.__FISHERAI_MEDIA_DOWNLOAD__)
                throw Error('素材不可用');
              const extension = node.type.includes('Video')
                ? 'mp4'
                : node.type.includes('Audio')
                  ? 'mp3'
                  : 'png';
              const result = await window.__FISHERAI_MEDIA_DOWNLOAD__.download(
                node,
                node.resultUrl,
                extension,
              );
              if (result?.status === 'failed') throw Error('下载失败');
              return;
            }
            if (operation === 'runWorkflow') {
              if (node.kind !== 'workflow') throw Error('不是执行工作流');
              const epoch = getWorkflowEpoch();
              const configuration = () => {
                const current = getNodes().find((item) => item.id === node.id);
                return JSON.stringify([
                  current?.parameterValues,
                  current?.parentIds,
                  current?.sourcePortIndices,
                  current?.workflowRef,
                  current?.canvasNodeHash,
                  current?.runningHubInstanceType,
                  getNodes().filter((item) => current?.parentIds?.includes(item.id)),
                ]);
              };
              const expected = configuration();
              const authorized = () =>
                mountedRef.current && getWorkflowEpoch() === epoch && configuration() === expected;
              flushSync(() => {
                setSelectedNodeIds([node.id]);
                focusOnNodes(getNodes(), [node.id]);
              });
              await new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
              );
              if (!authorized() || !(await requestWorkflowNodeRun(workflowId, node.id, authorized)))
                throw Error('请在节点核对原任务');
            }
          },
        }
      : null;
  const onCanvasPointerDown = (ke: ReactTypes.PointerEvent<HTMLDivElement>) => {
      if ((isPendingConnection && cancelConnectionDrag(), ke.button === 1)) {
        startPanning(ke);
        setSelectedConnection(null);
        setContextMenu((st) => ({ ...st, isOpen: false }));
        return;
      }
      if (ke.target instanceof Element && ke.target.id === 'canvas-background' && ke.button === 0) {
        startSelection(ke, viewport);
        setSelectedNodeIds(window.__FISHERAI_CANVAS_SELECTION__?.clearSelection() ?? []);
        setSelectedConnection(null);
        setContextMenu((st) => ({ ...st, isOpen: false }));
        closeWorkflowPanel();
        closeHistoryPanel();
        closeAssetLibrary();
        closeWorkflowPresetPanel();
      }
    },
    onCanvasPointerMove = React.useCallback(
      (ke: ReactTypes.PointerEvent<HTMLDivElement>) => {
        pointerRef.current = { x: ke.clientX, y: ke.clientY };
        updatePointerPos(ke.clientX, ke.clientY);
        const { isUpdating: st, selectedIds: ot } = updateSelection(ke, nodes, viewport);
        if (st) {
          setSelectedNodeIds(ot);
          return;
        }
        if (!(
          updateNodeResize(ke, viewport, setNodes) ||
          updateNodeDrag(
            ke,
            viewport,
            setNodes,
            window.__FISHERAI_CANVAS_EDITING__?.getMovableNodeIds(selectedNodeIds) ??
              selectedNodeIds,
            { getWidth: getNodeWidth, getHeight: getNodeHeight },
          ) ||
          updateConnectionDrag(ke, nodes, viewport) ||
          isSelecting
        )) {
          updatePanning(ke, setViewport);
        }
      },
      [
        updatePointerPos,
        updateNodeResize,
        updateSelection,
        nodes,
        viewport,
        setSelectedNodeIds,
        updateNodeDrag,
        getNodeWidth,
        getNodeHeight,
        setNodes,
        selectedNodeIds,
        updateConnectionDrag,
        isSelecting,
        updatePanning,
        setViewport,
      ],
    ),
    startBatchConnection = React.useCallback(
      (ke: ReactTypes.PointerEvent<HTMLDivElement>, st: 'left' | 'right') => {
        const ot = selectedNodeIds;
        if (!(ot.length < 2)) {
          setBatchConnecting(true);
          handleConnectorPointerDown(ke, ot[0], st);
        }
      },
      [selectedNodeIds, handleConnectorPointerDown],
    ),
    onConnectionCompleted = React.useCallback(() => {}, []),
    onCanvasPointerUp = React.useCallback(
      (ke: ReactTypes.PointerEvent<HTMLDivElement>) => {
        if (isSelecting) {
          setSelectedNodeIds(endSelection(nodes, viewport));
          releasePointerCapture(ke);
          return;
        }
        const st =
          batchConnecting && connectionStart ? Array.from(new Set(selectedNodeIds)) : void 0;
        if (completeConnectionDrag(handleAddNext, setNodes, nodes, onConnectionCompleted, ke, st)) {
          setBatchConnecting(false);
          releasePointerCapture(ke);
          return;
        }
        endPanning();
        endNodeResize();
        deferFrame(() => {
          if (isResizing || isDragging || window.__FISHERAI_CANVAS_EDITING__?.hasPendingMove()) {
            pushHistory();
          }
        });
        endNodeDrag();
        setBatchConnecting(false);
        releasePointerCapture(ke);
      },
      [
        isSelecting,
        endSelection,
        nodes,
        viewport,
        setSelectedNodeIds,
        connectionStart,
        releasePointerCapture,
        completeConnectionDrag,
        handleAddNext,
        setNodes,
        onConnectionCompleted,
        endPanning,
        isDragging,
        pushHistory,
        deferFrame,
        endNodeDrag,
        isResizing,
        endNodeResize,
        batchConnecting,
        selectedNodeIds,
      ],
    ),
    saveAnnotation = media.useCanvasImageEditSave(React, {
      nodes,
      getNodes,
      enabled: view === 'canvas',
      projectId: workflowId || undefined,
      setNodes,
      setSelectedNodeIds,
      title: '标注',
      getNodeWidth: () => 300,
    }),
    saveCrop = media.useCanvasCropSave(React, {
      nodes,
      getNodes,
      enabled: view === 'canvas',
      projectId: workflowId || undefined,
      setNodes,
      setSelectedNodeIds,
      getNodeWidth,
      getNodeHeight,
    }),
    saveResize = media.useCanvasImageEditSave(React, {
      nodes,
      getNodes,
      enabled: view === 'canvas',
      projectId: workflowId || undefined,
      setNodes,
      setSelectedNodeIds,
      title: '尺寸',
      getNodeWidth,
    }),
    saveComposite = media.useCanvasCompositeSave(React, {
      nodes,
      getNodes,
      enabled: view === 'canvas',
      projectId: workflowId || undefined,
      setNodes,
      setSelectedNodeIds,
      getNodeWidth,
    }),
    openComposite = React.useCallback(
      (ke: Record<string, unknown>) => {
        handleOpenComposite({ ...ke, onSave: saveComposite });
      },
      [handleOpenComposite, saveComposite],
    ),
    openProject = async (ke: string) => {
      const st = await loadProject(ke);
      if (st) {
        setFolderId(st.folderId || null);
        setView('canvas');
      }
    },
    chooseProjectFile = React.useCallback(() => {
      let ke;
      if (!((ke = projectFileRef.current) == null)) {
        ke.click();
      }
    }, []);
  const { handleOpenProjectFile, handleMergeProjectFile } = useProjectFiles({
      view,
      projectId: workflowId || undefined,
      getWorkflowEpoch,
      getNodes,
      setNodes,
      setGroups: (value) =>
        setGroups(
          (current) => (typeof value === 'function' ? value(current) : value) as CanvasGroup[],
        ),
      setSelectedNodeIds,
      importDocument,
      onOpened: (document) => {
        navigationRef.current++;
        applyingDocumentRef.current = true;
        setSavedAt(null);
        setSavedBy('用户-');
        setSavedRevision(null);
        setFolderId(null);
        reset({
          nodes: document.nodes,
          groups: document.groups as CanvasGroup[],
        });
        setDirty(true);
        setView('canvas');
      },
      onChanged: () => setDirty(true),
      createId,
    }),
    backToProjects = async () => {
      navigationRef.current++;
      resetWorkflowId();
      session?.clear();
      setView('dashboard');
    },
    newProject = (ke: string | null = null) => {
      navigationRef.current++;
      session?.clear();
      clearCanvas();
      setFolderId(typeof ke == 'string' ? ke : null);
      setView('canvas');
      newProjectPendingRef.current = true;
    },
    onDragOver = (ke: ReactTypes.DragEvent<HTMLDivElement>) => {
      ke.preventDefault();
      ke.stopPropagation();
      ke.dataTransfer.dropEffect = 'copy';
    },
    onDrop = (event: ReactTypes.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const bounds = canvasRef.current?.getBoundingClientRect();
      if (!bounds) return;
      return handleClipboardImagePaste([...event.dataTransfer.files], {
        x: event.clientX - bounds.left - 170 * viewport.zoom,
        y: event.clientY - bounds.top - 100 * viewport.zoom,
      });
    },
    projectScene = React.useMemo(
      () => createCanvasSceneProjector({ width: getNodeWidth, height: getNodeHeight, text: textForNode }),
      [getNodeWidth, getNodeHeight, textForNode],
    ),
    sceneData = React.useMemo(() => projectScene(nodes), [nodes, projectScene]),
    { nodeDisplayData, nodesByGroupId } = sceneData,
    { visibleNodeIds, visibleGroups } = React.useMemo(
      () => canvasVisibleScene(sceneData, groups, viewport, windowSize),
      [sceneData, groups, viewport, windowSize],
    ),
    onEdgeDoubleClick = React.useCallback(
      (ke: ReactTypes.MouseEvent, st: string, ot: string, Ge: number) => {
        ke.stopPropagation();
        setSelectedConnection({ parentId: st, childId: ot, portIndex: Ge });
        deleteSelectedConnection(setNodes);
      },
      [setSelectedConnection, deleteSelectedConnection, setNodes],
    ),
    onEdgeClick = React.useCallback(
      (ke: ReactTypes.MouseEvent, st: string, ot: string, Ge: number) => {
        if (!ke.shiftKey) {
          clearSelection();
        }
        handleEdgeClick(ke, st, ot, Ge);
      },
      [clearSelection, handleEdgeClick],
    );

  React.useEffect(() => {
    if (view === 'canvas' && isMinimapOpen && zoomControlsRef.current) {
      const ke = zoomControlsRef.current.getBoundingClientRect();
      if (ke.width > 0) {
        setMinimapWidth(ke.width + 24);
      }
      const st = new ResizeObserver((ot) => {
        for (const Ge of ot)
          if (Ge.target === zoomControlsRef.current) {
            const ft = Ge.contentRect.width;
            if (ft > 0) {
              setMinimapWidth(ft + 24);
            }
          }
      });
      return (st.observe(zoomControlsRef.current), () => st.disconnect());
    }
  }, [isMinimapOpen, view]);
  React.useEffect(() => {
    window.__FISHERAI_FOCUS_NODES__ = focusNodes;
    return () => {
      if (window.__FISHERAI_FOCUS_NODES__ === focusNodes) {
        delete window.__FISHERAI_FOCUS_NODES__;
      }
    };
  }, [focusNodes]);
  React.useEffect(() => {
    mountedRef.current = true;
    const navigation = navigationRef;
    return () => {
      mountedRef.current = false;
      navigation.current++;
    };
  }, []);
  React.useEffect(() => {
    let active = true;
    const ke = session?.load();
    const intent = navigationRef.current + 1;
    if (ke) {
      loadProject(ke.workflowId)
        .then((st) => {
          if (!active || !mountedRef.current || intent !== navigationRef.current) return;
          if (st) {
            setFolderId(st.folderId || ke.folderId || null);
            setViewport(ke.viewport);
            setView('canvas');
          } else {
            session?.clear();
          }
        })
        .catch(() => {
          if (active && mountedRef.current && intent === navigationRef.current) session?.clear();
        });
    }
    return () => {
      active = false;
    };
  }, [loadProject, session, setViewport]);
  React.useEffect(() => {
    if (view === 'canvas' && workflowId) {
      session?.save({
        workflowId,
        folderId: typeof folderId === 'string' ? folderId : null,
        viewport,
      });
    }
  }, [view, workflowId, folderId, viewport, session]);
  React.useEffect(() => {
    const previous = observedContentRef.current;
    observedContentRef.current = { nodes, groups, title: canvasTitle };
    if (firstEditRef.current) {
      firstEditRef.current = false;
      loadingCountRef.current = nodes.filter((ot) => ot.status === NodeStatus.LOADING).length;
      resultCountRef.current = nodes.filter(
        (ot) => ot.status === NodeStatus.SUCCESS && ot.resultUrl,
      ).length;
      return;
    }
    if (applyingDocumentRef.current) {
      applyingDocumentRef.current = false;
      return;
    }
    if (previous.nodes === nodes && previous.groups === groups && previous.title === canvasTitle)
      return;
    setDirty(true);
    if (!isDragging && !isResizing && !isDraggingConnection && !isSelecting) {
      pushHistory({ nodes, groups });
    }
    const ke = nodes.filter((ot) => ot.status === NodeStatus.LOADING).length;
    if (ke > loadingCountRef.current) {
      save();
    }
    loadingCountRef.current = ke;
    const st = nodes.filter((ot) => ot.status === NodeStatus.SUCCESS && ot.resultUrl).length;
    if (st > resultCountRef.current) {
      save();
    }
    resultCountRef.current = st;
  }, [
    nodes,
    groups,
    canvasTitle,
    NodeStatus,
    isDragging,
    isResizing,
    isDraggingConnection,
    isSelecting,
    pushHistory,
    save,
  ]);
  React.useEffect(() => {
    if (selectedNodeIds.length === 1) {
      const ke = nodes.find((st) => st.id === selectedNodeIds[0]);
      if (
        ke &&
        ((['image', 'upload image', 'video', 'upload video', 'audio', 'upload audio'].includes(
          String(ke.type).toLowerCase(),
        ) &&
          ke.resultUrl) ||
          ((ke.type === NodeType.VIDEO || ke.type === NodeType.UPLOAD_VIDEO) &&
            (ke.lastFrame || ke.resultUrl)))
      ) {
        selectedCoverRef.current = ke.id;
      }
    }
  }, [selectedNodeIds, nodes, NodeType]);
  React.useEffect(() => {
    if (view === 'canvas' && newProjectPendingRef.current) {
      newProjectPendingRef.current = false;
      save();
    }
  }, [view, save]);
  React.useEffect(() => {
    cleanupInvalidGroups(nodes, setNodes);
  }, [nodes, cleanupInvalidGroups, setNodes]);
  React.useEffect(() => {
    const insert = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          nodes?: CanvasNode[];
          nodeIds?: string[];
        }>
      ).detail;
      if (
        !Array.isArray(detail?.nodes) ||
        !Array.isArray(detail.nodeIds) ||
        !detail.nodeIds.length
      )
        return;
      setView('canvas');
      setSettingsOpen(false);
      // The insertion event is already emitted after the node store accepts the nodes.
      // A second RAF can be cancelled by the very render caused by this insertion.
      focusOnNodes(detail.nodes, detail.nodeIds);
      setSelectedNodeIds(detail.nodeIds);
    };
    window.addEventListener('fisherai:workflow-canvas-inserted', insert);
    return () => {
      window.removeEventListener('fisherai:workflow-canvas-inserted', insert);
    };
  }, [view, focusOnNodes, setSelectedNodeIds]);
  React.useEffect(() => {
    const ke = () => setSettingsOpen(true);
    return (
      window.addEventListener('fisherai:open-settings', ke),
      () => window.removeEventListener('fisherai:open-settings', ke)
    );
  }, [setSettingsOpen]);
  if (view === 'dashboard')
    return React.createElement(React.Fragment, {
      children: [
        React.createElement(Projects, {
          key: 'projects',
          onOpenProject: openProject,
          onNewProject: newProject,
          initialFolderId: folderId,
        }),
        React.createElement(Settings, {
          key: 'settings',
          isOpen: settingsOpen,
          onClose: () => setSettingsOpen(false),
          localUserName,
          setLocalUserName,
          localUserId,
          localUserNo,
        }),
      ],
    });
  const batchSourceNodeIds =
    batchConnecting && connectionStart
      ? Array.from(new Set(selectedNodeIds))
      : pendingBatchSourceNodeIds;
  return React.createElement('div', {
    key: 'div',
    className:
      'w-screen h-screen bg-[var(--af-input)] text-[var(--af-text)] overflow-hidden select-none font-sans transition-colors duration-300',
    children: [
      React.createElement(Header, {
        key: 'header',
        canvasTitle,
        isEditingTitle,
        editingTitleValue,
        canvasTitleInputRef,
        setCanvasTitle,
        setIsEditingTitle,
        setEditingTitleValue,
        onSave: () => save({ manual: true, reportFailure: true }),
        documentEpoch: getWorkflowEpoch(),
        onBack: backToProjects,
        onImportProjectJson: chooseProjectFile,
        hasUnsavedChanges,
        isChatOpen,
        chatPanelWidth,
        lastAutoSaveTime: savedAt,
        lastSavedBy: savedBy,
        lastSavedRevision: savedRevision,
      }),
      React.createElement('input', {
        key: 'input',
        ref: projectFileRef,
        type: 'file',
        accept: '.json,.fisherai,application/json',
        onChange: async (event: ReactTypes.ChangeEvent<HTMLInputElement>) => {
          const file = event.target.files?.[0];
          if (!file?.name.toLowerCase().endsWith('.fisherai')) return handleOpenProjectFile(event);
          event.target.value = '';
          const epoch = getWorkflowEpoch();
          try {
            if (view === 'canvas' && !(await projectRuntime.current()?.save())) return;
            const response = await fetch(
              '/api/workflows/restore',
              projectArchiveRestoreRequest(file),
            );
            if (!response.ok) throw Error('备份导入未确认，请核对项目列表。');
            const restored = await response.json();
            if (typeof restored.id !== 'string') throw Error('备份回执无效，请核对项目列表。');
            if (getWorkflowEpoch() === epoch) await openProject(restored.id);
          } catch (error) {
            window.alert(error instanceof Error ? error.message : '备份导入未完成。');
          }
        },
        className: 'hidden',
      }),
      React.createElement('input', {
        key: 'merge-project-file',
        type: 'file',
        accept: '.json,application/json',
        ref: mergeProjectFileRef,
        style: { display: 'none' },
        onChange: handleMergeProjectFile,
      }),
      React.createElement(Sidebar, {
        key: 'sidebar',
        onAddClick: handleToolbarAdd,
        onWorkflowsClick: () =>
          window.dispatchEvent(new CustomEvent('fisherai:open-workflow-library')),
        onWorkflowPresetsClick: () =>
          window.dispatchEvent(new CustomEvent('fisherai:open-skill-community')),
        onHistoryClick: openHistory,
        onAssetsClick: openAssets,
        onToolsOpen: () => {
          closeWorkflowPanel();
          closeHistoryPanel();
          closeAssetLibrary();
          closeWorkflowPresetPanel();
        },
        onSettingsClick: () => {
          setSettingsOpen(true);
        },
        currentUserName: localUserName,
        currentUserColor: userColor,
      }),
      React.createElement(Scene, {
        key: 'scene',
        documentEpoch: getWorkflowEpoch(),
        nodes,
        viewport,
        selectedNodeIds,
        groups,
        visibleNodeIds,
        visibleGroups,
        nodesByGroupId,
        nodeDisplayData,
        alignmentGuides: isDragging ? alignCanvasDrag(nodes, selectedNodeIds,
          { getWidth: getNodeWidth, getHeight: getNodeHeight }, { x: 0, y: 0 }, viewport.zoom, 0.01).guides : [],
        isPanning,
        isDragging,
        isResizing,
        isDraggingConnection,
        isPendingConnection,
        connectionStart,
        tempConnectionEnd,
        batchConnectionSourceNodeIds: batchSourceNodeIds,
        connectionHoveredNodeId,
        connectionHoveredSide: hoveredSide,
        connectionHoveredPortIndex: hoveredPortIndex,
        isInvalidHover,
        selectedConnection,
        showGridSlider,
        gridColumns,
        isCompact,
        canvasRef,
        onPointerDown: onCanvasPointerDown,
        onPointerMove: onCanvasPointerMove,
        onPointerUp: onCanvasPointerUp,
        onWheel: onCanvasWheel,
        onDoubleClick: handleDoubleClick,
        onContextMenu: handleGlobalContextMenu,
        onDragOver,
        onDrop,
        onEdgeClick,
        onEdgeDoubleClick,
        onGroup: (ke: string[]) => groupNodes(ke, nodes, setNodes),
        onUngroup: (ke: string) => ungroupNodes(ke, nodes, setNodes),
        onRenameGroup: renameGroup,
        onGridLayout: (ke: number) => gridLayoutNodes(ke, isCompact),
        onToggleGridSlider: () => {
          if (!showGridSlider) {
            gridLayoutNodes(gridColumns, isCompact);
          }
          setShowGridSlider(!showGridSlider);
        },
        onCreateCollage: createCollage,
        onNodePointerDown: (ke: ReactTypes.PointerEvent<HTMLDivElement>, st: string) => {
          const Ge = window.__FISHERAI_CANVAS_SELECTION__;
          if (Ge) {
            setSelectedNodeIds(Ge.selectNode(selectedNodeIds, st, ke));
          } else {
            if (!selectedNodeIds.includes(st)) {
              setSelectedNodeIds(
                ke.shiftKey || ke.ctrlKey || ke.metaKey ? (ft) => [...ft, st] : [st],
              );
            }
          }
          if (!(ke.shiftKey || ke.ctrlKey || ke.metaKey)) {
            setSelectedConnection(null);
          }
          handleNodePointerDown(ke, st, void 0);
        },
        onNodeContextMenu: handleNodeContextMenu,
        onSelect: (ke: string) => {
          setSelectedNodeIds([ke]);
          setSelectedConnection(null);
        },
        onGroupPointerDown: (ke: ReactTypes.PointerEvent<HTMLDivElement>, st: string[]) => {
          const ht = window.__FISHERAI_CANVAS_SELECTION__;
          if (ht) {
            setSelectedNodeIds(ht.selectGroup(selectedNodeIds, st, ke));
          } else {
            if (ke.shiftKey || ke.ctrlKey || ke.metaKey) {
              setSelectedNodeIds((Rt) => [...new Set([...Rt, ...st])]);
            } else {
              if (st.length > 0) {
                setSelectedNodeIds(st);
              }
            }
          }
          if (!(ke.shiftKey || ke.ctrlKey || ke.metaKey)) {
            setSelectedConnection(null);
          }
          if (st.length > 0) {
            handleNodePointerDown(ke, st[0], void 0);
          }
        },
        onConnectorDown: (
          ke: ReactTypes.PointerEvent<HTMLDivElement>,
          st: string,
          ot: 'left' | 'right',
          Ge: number,
        ) => {
          setBatchConnecting(false);
          handleConnectorPointerDown(ke, st, ot, Ge);
        },
        onSelectionResizeStart: (
          ke: ReactTypes.PointerEvent<HTMLDivElement>,
          st: SelectionResizeHandle,
          ot: CanvasNodeFrame[],
        ) => startSelectionResize(ke, st, ot),
        onSelectionBatchConnectorDown: startBatchConnection,
        onNodeUpload: replaceMedia,
        onExpand: handleExpandImage,
        onDragStart: handleNodeDragStart,
        onDragEnd: handleNodeDragEnd,
        onWriteContent: handleWriteContent,
        onTextToVideo: handleTextToVideo,
        onTextToImage: handleTextToImage,
        onMiniMaxH3T2VAGenerate: handleMiniMaxH3T2VAGenerate,
        onVideoSnapshot: handleVideoSnapshot,
        onVideoFirstLastSnapshot: handleVideoFirstLastSnapshot,
        onAudioTrim: handleAudioTrim,
        onOpenCompare: handleOpenCompare,
        onOpenComposite: openComposite,
        onNodeMouseEnter: () => {},
        onNodeMouseLeave: () => {},
        onResizeStart: handleResizeStart,
        onUpdateNode: updateNode,
        onGenerate: handleGenerate,
        onAddNext: handleAddNext,
        getCommonGroup,
        onSaveAsset: handleOpenCreateAsset,
        onAnnotate: handleStartAnnotation,
        onCrop: handleStartCrop,
        onResizeImage: handleStartResize,
        onUpscaleImage: handleUpscaleImage,
        projectId: workflowId || void 0,
      }),
      React.createElement(Controls, {
        key: 'controls',
        view,
        canvasRef,
        documentEpoch: getWorkflowEpoch(),
        nodes,
        viewport,
        onViewportChange: setViewport,
        isMinimapOpen,
        setIsMinimapOpen: setMinimapOpen,
        minimapWidth,
        zoomControlsRef,
        onResetCanvas: focusOnNodes,
        onSliderZoom: handleSliderZoom,
        showGridSlider,
        setShowGridSlider,
        gridColumns,
        setGridColumns,
        isCompact,
        setIsCompact: setCompact,
        onGridLayout: gridLayoutNodes,
        selectedNodeIds,
      }),
      React.createElement(SidePanels, {
        key: 'sidepanels',
        documentEpoch: getWorkflowEpoch(),
        isWorkflowPanelOpen,
        workflowPanelY,
        onCloseWorkflowPanel: closeWorkflowPanel,
        onLoadWorkflow: loadProject,
        workflowId: workflowId || void 0,
        isHistoryPanelOpen,
        historyPanelY,
        onCloseHistoryPanel: closeHistoryPanel,
        onSelectAsset: selectHistoryAsset,
        isAssetLibraryOpen,
        assetLibraryY,
        assetLibraryVariant,
        onCloseAssetLibrary: closeAssetLibrary,
        onLibrarySelect: importLibraryAsset,
        isWorkflowPresetPanelOpen,
        workflowPresetPanelY,
        onCloseWorkflowPresetPanel: closeWorkflowPresetPanel,
        onWorkflowPresetSelect: handleImportWorkflowPreset,
        isChatOpen,
        onToggleChat: toggleChat,
        onCloseChat: closeChat,
        localUserName,
        isDraggingNodeToChat,
        chatPanelWidth,
        onChatPanelWidthChange: setChatPanelWidth,
        projectId: workflowId || void 0,
        nodes,
        selectedAgentReferenceNodes: agentReferences,
        selectedNodeIds,
        onApplyPrompt: (proposal: PromptProposal) =>
          applyCanvasPromptProposal(getNodes(), proposal, updateNode),
        onCreateTextNode: (text: string) => {
          const runtime = getWorkflowEpoch() === documentEpoch ? controlRuntime.current() : null;
          if (!runtime) throw new Error('当前画布不可编辑，请结束拖拽后重试。');
          const before = runtime.snapshot();
          const node = runtime.create(
            'Text',
            { x: (160 - viewport.x) / viewport.zoom, y: (120 - viewport.y) / viewport.zoom },
            runtime.projectId,
          );
          node.title = 'Agent 提示词';
          node.textContent = text;
          node.textMode = 'editing';
          runtime.commit(before, { ...before, nodes: [...before.nodes, node] });
          runtime.focus?.([node.id]);
          return node.id;
        },
        onCanvasAction: canvasControl,
        canvasCreation,
        canvasProjects,
        canvasBudgets,
        canvasExternal,
        canvasProducts,
        onLocateNode: (ke: string) => {
          focusOnNodes(nodes, [ke]);
          setSelectedNodeIds([ke]);
        },
      }),
      React.createElement(Overlays, {
        key: 'overlays',
        contextMenu,
        onCloseContextMenu: () => {
          setContextMenu((ke) => ({ ...ke, isOpen: false }));
          cancelConnectionDrag();
        },
        onSelectType: handleContextMenuSelect,
        onUpload: handleContextUpload,
        onUndo: undo,
        onRedo: redo,
        onPaste: handlePaste,
        onCopy: handleCopy,
        onCreateAsset: handleContextMenuCreateAsset,
        onCreateWorkflow: handleContextMenuCreateWorkflowPreset,
        onAddAssets: openAssetsModal,
        canCreateWorkflow: canCreateWorkflowPreset,
        canUndo,
        canRedo,
        expandedImageUrl,
        expandedComparePayload,
        expandedCompositePayload,
        onCloseExpand: handleCloseExpand,
        onCloseCompare: handleCloseCompare,
        onCloseComposite: handleCloseComposite,
        isCreateAssetModalOpen,
        setIsCreateAssetModalOpen,
        nodeToSnapshot,
        assetCategories,
        assetDefaultOwnership: canvasTitle,
        onSaveAssetToLibrary: handleSaveAssetToLibrary,
        isCreateWorkflowPresetModalOpen,
        setIsCreateWorkflowPresetModalOpen,
        workflowPresetCoverUrl,
        workflowPresetCategories,
        workflowPresetDefaultName,
        onSaveWorkflowPreset: handleSaveWorkflowPreset,
      }),
      React.createElement(Settings, {
        key: 'settings',
        isOpen: settingsOpen,
        onClose: () => setSettingsOpen(false),
        localUserName,
        setLocalUserName,
        localUserId,
        localUserNo,
      }),
      annotatingNodeId &&
        React.createElement(Annotation, {
          key: 'annotation',
          node: nodes.find((ke) => ke.id === annotatingNodeId),
          onSave: saveAnnotation,
          onClose: handleCloseAnnotation,
          projectId: workflowId || undefined,
        }),
      cropNodeId &&
        React.createElement(Crop, {
          key: `crop:${workflowId}:${cropNodeId}:${imageEditorMode}`,
          mode: imageEditorMode,
          onPanorama: (id: string) => {
            if (!workflowId || view !== 'canvas') throw new Error('请先打开项目。');
            const result = createImageAngleDraft(getNodes(), id, null, workflowId, {
              create: createAgentNode,
              configure: configureAgentNode,
              connect: connectAgentNodes,
              width: getNodeWidth,
            });
            flushSync(() => {
              setNodes(result.nodes);
              setSelectedNodeIds([result.id]);
            });
            void handleGenerate(result.id);
          },
          onAngle: (id: string, angle: ImageAngle) => {
            if (!workflowId || view !== 'canvas') throw new Error('请先打开项目。');
            const result = createImageAngleDraft(getNodes(), id, angle, workflowId, {
              create: createAgentNode,
              configure: configureAgentNode,
              connect: connectAgentNodes,
              width: getNodeWidth,
            });
            flushSync(() => {
              setNodes(result.nodes);
              setSelectedNodeIds([result.id]);
            });
            void handleGenerate(result.id);
          },
          sources: nodes.filter(
            (node) => ['Image', 'Upload Image'].includes(node.type) && node.resultUrl,
          ),
          node: nodes.find((ke) => ke.id === cropNodeId),
          onSave: saveCrop,
          onClose: handleCloseCrop,
          projectId: workflowId || undefined,
        }),
      resizeNodeId &&
        React.createElement(Resize, {
          key: 'resize',
          node: nodes.find((ke) => ke.id === resizeNodeId),
          onSave: saveResize,
          onClose: handleCloseResize,
          projectId: workflowId || undefined,
        }),
      selectionBox.isActive &&
        React.createElement('div', {
          key: 'div',
          className: 'absolute pointer-events-none',
          style: {
            left: Math.min(selectionBox.startX, selectionBox.endX),
            top: Math.min(selectionBox.startY, selectionBox.endY),
            width: Math.abs(selectionBox.endX - selectionBox.startX),
            height: Math.abs(selectionBox.endY - selectionBox.startY),
            border: '2px solid #3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            borderRadius: '12px',
            zIndex: 1e3,
          },
        }),
    ],
  });
}
