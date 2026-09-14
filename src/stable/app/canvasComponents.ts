import * as React from 'react';
import * as Icons from 'lucide-react';
import { NodeViewWrapper } from '@tiptap/react';
import { createPromptVendor } from './promptVendor';
import { Canvas as ThreeCanvas, useThree } from '@react-three/fiber';
import { useTexture, OrbitControls, Sphere } from '@react-three/drei';
import { Vector2, NoToneMapping, SRGBColorSpace, BackSide } from 'three';
import * as Dialogs from '../dialogs/canvasDialogs';
import { CanvasImageStudio } from '../dialogs/canvasImageStudio';
import * as Workflow from '../local/canvasWorkflowGenerator';
import * as BrandIcons from './modelBrandIcons';
import { bind, bindRef } from './presentation';
import { avatarClass, avatarColor, avatarText } from '../profile/canvasAvatar';
import { nodeWidth, nodeHeight, nodePortX, nodePortY } from '../nodes/canvasNodeRules';
import {
  IMAGE_MODELS,
  VIDEO_MODELS,
  TEXT_MODELS,
  AUDIO_MODELS,
  IMAGE_RATIOS,
  IMAGE_RESOLUTIONS,
  VIDEO_ASPECT_RATIOS,
  VIDEO_RESOLUTIONS,
} from '../../config/modelConfig';
import { version } from '../../../package.json';

const versionInfo = { version };
const agentModels = Dialogs.canvasAgentModels(TEXT_MODELS);

// These are stable component types. Dependency factories defer cross-references,
// while the underlying source owns state and lifecycle for each mounted instance.
export const ProjectDashboard = bind(Dialogs.ProjectDashboard)(() => [
  {
    DashboardHeader: ProjectDashboardHeader,
    FolderCard: DashboardFolderCard,
    ProjectCard: DashboardProjectCard,
    ContextMenu: ProjectDashboardMenu,
    HomeIcon: Icons.House,
    AddIcon: Icons.Plus,
    FolderListIcon: Icons.PanelsTopLeft,
    MoreIcon: Icons.EllipsisVertical,
    CloseIcon: Icons.X,
    FolderIcon: Icons.Folder,
    LoadingIcon: Icons.LoaderCircle,
  },
]);
export const Settings = bind(Dialogs.CanvasSettings)(() => [
  {
    CloseIcon: Icons.X,
    avatarClass: avatarClass,
    avatarText: avatarText,
    avatarColor: avatarColor,
  },
]);
export const Header = bind(Dialogs.CanvasHeader)(() => [
  {
    Tooltip: Tooltip,
    SaveIcon: Icons.Save,
    ImportIcon: Icons.FolderOpen,
    BackIcon: Icons.LogOut,
  },
]);
export const Sidebar = bind(Dialogs.CanvasSidebar)(() => [
  {
    Tooltip: Tooltip,
    Add: Icons.Plus,
    Image: Icons.Image,
    Workflow: Icons.Workflow,
    History: Icons.History,
    Settings: Icons.Wrench,
    avatarClass: avatarClass,
    avatarText: avatarText,
  },
]);
export const Scene = bind(Dialogs.CanvasScene)(() => [
  { Edges: Edges, Selection: SelectionBounds, Node: Node },
]);
export const ViewportControls = bind(Dialogs.CanvasViewportControls)(() => [
  { Tooltip: Tooltip, Minimap: Minimap },
]);
export const SidePanels = bind(Dialogs.CanvasSidePanels)(() => [
  {
    History: AssetHistory,
    Assets: AssetLibrary,
    Presets: WorkflowLibrary,
    AgentLauncher: AgentLauncher,
    Agent: AgentPanel,
  },
]);
export const Overlays = bind(Dialogs.CanvasOverlays)(() => [
  {
    ContextMenu: ContextMenu,
    AssetDialog: AssetDialog,
    PresetDialog: PresetDialog,
    MediaPreview: MediaPreview,
    ComparePreview: ComparePreview,
    CompositePreview: CompositePreview,
  },
]);
export const ImageAnnotation = bind(Dialogs.CanvasImageAnnotation)(() => [
  { Close: Icons.X, Save: Icons.Check, Spinner: Icons.LoaderCircle },
]);
export const ImageCrop = bind(CanvasImageStudio)(() => [
  { CropEditor, Annotation: ImageAnnotation, Composite: CompositePreview },
]);
export const CropEditor = bind(Dialogs.CanvasImageCrop)(() => [
  {
    Close: Icons.X,
    Save: Icons.Check,
    Spinner: Icons.LoaderCircle,
    Globe: Icons.Globe,
    Chevron: Icons.ChevronDown,
    Canvas: ThreeCanvas,
    Scene: PanoramaScene,
    Vector2: Vector2,
    toneMapping: NoToneMapping,
    colorSpace: SRGBColorSpace,
  },
]);
export const ImageResize = bind(Dialogs.CanvasImageResize)(() => [
  { Close: Icons.X, Save: Icons.Check, Spinner: Icons.LoaderCircle },
]);
export const ProjectDashboardHeader = bind(Dialogs.ProjectDashboardHeader)(() => [
  {
    SearchIcon: Icons.Search,
    ChevronIcon: Icons.ChevronDown,
    CheckIcon: Icons.Check,
    GridIcon: Icons.Grid3X3,
    ListIcon: Icons.List,
    FolderAddIcon: Icons.FolderPlus,
    AddIcon: Icons.Plus,
    versionInfo: versionInfo,
  },
]);
export const DashboardFolderCard = bind(Dialogs.DashboardFolderCard)(() => [
  { MoreIcon: Icons.EllipsisVertical, RenameIcon: Icons.Pen, FolderIcon: Icons.Folder },
]);
export const DashboardProjectCard = bind(Dialogs.DashboardProjectCard)(() => [
  { MoreIcon: Icons.EllipsisVertical, RenameIcon: Icons.Pen, FolderIcon: Icons.Folder },
]);
export const ProjectDashboardMenu = bind(Dialogs.ProjectDashboardMenu)(() => [
  {
    OpenIcon: Icons.FolderOpen,
    RenameIcon: Icons.PenLine,
    MoveIcon: Icons.Move,
    CleanupIcon: Icons.Eraser,
    DeleteIcon: Icons.Trash2,
  },
]);
export const Tooltip = bind(Dialogs.CanvasTooltip)(() => []);
export const Edges = React.memo(
  bind(Dialogs.CanvasEdges)(() => [
    { getWidth: nodeWidth, getHeight: nodeHeight, getPortX: nodePortX, getPortY: nodePortY },
  ]),
);
export const SelectionBounds = bind(Dialogs.CanvasSelectionBounds)(() => [
  { width: nodeWidth, height: nodeHeight },
]);
export const Node = React.memo(
  bind(Dialogs.CanvasNode)(() => [
    {
      Text: TextCard,
      Image: ImageCard,
      Video: VideoCard,
      Audio: AudioNode,
      'Image Compare': CompareNode,
      'Image Composite': CompositeNode,
      Workflow: WorkflowGenerator,
      MiniMax: MiniMaxNode,
      LegacyWorkflow: LegacyWorkflowNode,
    },
  ]),
  Dialogs.equalCanvasNodeProps,
);
export const Minimap = React.memo(
  bind(Dialogs.CanvasMinimap)(() => [{ width: nodeWidth, height: nodeHeight }]),
);
export const AssetHistory = bind(Dialogs.CanvasAssetHistory)(() => [
  {
    ImageIcon: Icons.Image,
    VideoIcon: Icons.Video,
    AudioIcon: Icons.Music,
    CloseIcon: Icons.Maximize2,
    DeleteIcon: Icons.Trash2,
    Spinner: Icons.LoaderCircle,
  },
]);
export const AssetLibrary = bind(Dialogs.CanvasAssetLibrary)(() => [
  {
    CloseIcon: Icons.X,
    DeleteIcon: Icons.Trash2,
    ImageIcon: Icons.Image,
    VideoIcon: Icons.Video,
    AudioIcon: Icons.Music,
    WorkflowIcon: Icons.Workflow,
  },
]);
export const WorkflowLibrary = bind(Dialogs.CanvasWorkflowLibrary)(() => [
  {
    CloseIcon: Icons.X,
    DeleteIcon: Icons.Trash2,
    ImageIcon: Icons.Image,
    VideoIcon: Icons.Video,
    AudioIcon: Icons.Music,
    WorkflowIcon: Icons.Workflow,
  },
]);
export const AgentLauncher = bind(Dialogs.CanvasAgentLauncher)(() => []);
export const AgentPanel = bind(Dialogs.CanvasAgentPanel)(() => [
  {
    Tooltip: Tooltip,
    Message: AgentMessage,
    ImageIcon: Icons.Sparkles,
    BackIcon: Icons.ChevronLeft,
    Spinner: Icons.LoaderCircle,
    HistoryIcon: Icons.History,
    DeleteIcon: Icons.Trash2,
    AddIcon: Icons.Plus,
    CloseIcon: Icons.X,
    UploadIcon: Icons.Paperclip,
    ChatIcon: Icons.MessageSquare,
    SettingsIcon: Icons.SlidersHorizontal,
    ChevronIcon: Icons.ChevronDown,
    SendIcon: Icons.ArrowUp,
  },
  agentModels,
]);
export const ContextMenu = bind(Dialogs.CanvasContextMenu)(() => [
  {
    image: Icons.Image,
    skill: Icons.Workflow,
    copy: Icons.Copy,
    paste: Icons.Clipboard,
    duplicate: Icons.Files,
    delete: Icons.Trash2,
    upload: Icons.Upload,
    assets: Icons.Layers,
    add: Icons.Plus,
    next: Icons.ChevronRight,
    undo: Icons.Undo2,
    redo: Icons.Redo2,
    text: Icons.Type,
    video: Icons.Video,
    audio: Icons.Music,
    workflow: Icons.Cpu,
    compare: Icons.Columns2,
    composite: Icons.Images,
  },
]);
export const AssetDialog = bind(Dialogs.CanvasAssetDialog)(() => [SaveDialog]);
export const PresetDialog = bind(Dialogs.CanvasPresetDialog)(() => [SaveDialog]);
export const MediaPreview = bind(Dialogs.CanvasMediaPreview)(() => []);
export const ComparePreview = bind(Dialogs.CanvasComparePreview)(() => []);
export const CompositePreview = bind(Dialogs.CanvasCompositePreview)(() => [
  {
    layers: Icons.Layers,
    up: Icons.ArrowUp,
    down: Icons.ArrowDown,
    save: Icons.Check,
    close: Icons.X,
  },
]);
export const PanoramaScene = bind(Dialogs.CanvasPanoramaScene)(() => [
  {
    useTexture: useTexture,
    useThree: useThree,
    Controls: OrbitControls,
    Sphere: Sphere,
    colorSpace: SRGBColorSpace,
    side: BackSide,
  },
]);
export const TextCard = bind(Dialogs.CanvasTextCard)(() => [
  {
    Frame: NodeFrame,
    Header: NodeHeader,
    Composer: TextComposer,
    defaultModel: TEXT_MODELS[0]?.name || '豆包大语言2.0-mini',
    nodeWidth: nodeWidth,
    nodeHeight: nodeHeight,
  },
]);
export const ImageCard = bind(Dialogs.CanvasImageCard)(() => [
  {
    Frame: NodeFrame,
    Header: NodeHeader,
    Toolbar: MediaToolbar,
    Composer: ImageComposer,
    Preview: ImagePreview,
  },
]);
export const VideoCard = bind(Dialogs.CanvasVideoCard)(() => [
  {
    Frame: NodeFrame,
    Header: NodeHeader,
    Toolbar: MediaToolbar,
    Composer: VideoComposer,
    Preview: VideoPlayer,
  },
]);
export const AudioNode = bind(Dialogs.CanvasAudioNode)(() => [
  {
    models: AUDIO_MODELS,
    Frame: NodeFrame,
    Header: NodeHeader,
    Toolbar: MediaToolbar,
    Player: AudioPlayer,
    ConnectedAssets: ConnectedAssets,
    PromptEditor: PromptEditor,
    ModelSelector: ModelSelector,
    AdvancedSettings: AdvancedSettings,
    Tooltip: Tooltip,
    CollapseIcon: Icons.ChevronUp,
    SettingsIcon: Icons.SlidersHorizontal,
    GenerateIcon: Icons.ArrowUp,
  },
]);
export const CompareNode = bind(Dialogs.CanvasCompareNode)(() => [
  { Frame: NodeFrame, Header: NodeHeader, Empty: Icons.Columns2 },
]);
export const CompositeNode = bind(Dialogs.CanvasCompositeNode)(() => [
  { Frame: NodeFrame, Header: NodeHeader, Empty: Icons.Layers },
]);
export const WorkflowGenerator = bind(Workflow.CanvasWorkflowGenerator)(() => [NodeFrame]);
export const MiniMaxNode = bind(Dialogs.CanvasMiniMaxNode)(() => [
  { Frame: NodeFrame, PromptEditor: PromptEditor },
]);
export const LegacyWorkflowNode = bind(Dialogs.CanvasLegacyWorkflowNode)(() => [
  { Frame: NodeFrame, Header: NodeHeader },
]);
export const AgentMessage = bind(Dialogs.CanvasAgentMessage)(() => []);
export const SaveDialog = bind(Dialogs.CanvasSaveDialog)(() => []);
export const NodeFrame = bind(Dialogs.CanvasNodeFrame)(() => [
  { Connectors: Connectors, getWidth: nodeWidth, getHeight: nodeHeight },
]);
export const NodeHeader = bind(Dialogs.CanvasNodeHeader)(() => [
  {
    Image: Icons.Image,
    Video: Icons.Video,
    Audio: Icons.Music,
    Text: Icons.Type,
    Compare: Icons.Columns2,
    Composite: Icons.Layers,
    Workflow: Icons.Cpu,
  },
]);
export const MediaToolbar = bind(Dialogs.CanvasMediaToolbar)(() => [
  {
    Tooltip: Tooltip,
    annotate: Icons.Pencil,
    crop: Icons.Crop,
    resize: Icons.Expand,
    replace: Icons.Upload,
    saveAsset: Icons.FolderPlus,
    download: Icons.Download,
    expand: Icons.Maximize2,
  },
]);
export const PromptEditor = bind(Dialogs.CanvasPromptEditor)(() => [
  createPromptVendor({
    PromptTagView: PromptTag,
    MentionView: MentionTag,
    PresetList,
    MentionList,
  }),
]);
export const ImagePreview = bind(Dialogs.CanvasImagePreview)(() => [
  {
    DownloadIcon: Icons.Download,
    ImageIcon: Icons.Image,
    nodeWidth: nodeWidth,
    nodeHeight: nodeHeight,
  },
]);
export const VideoPlayer = bind(Dialogs.CanvasVideoPlayer)(() => [
  {
    MuteIcon: Icons.VolumeX,
    VolumeIcon: Icons.Volume2,
    PlayIcon: Icons.Play,
    PauseIcon: Icons.Pause,
    FramesIcon: Icons.Aperture,
    SnapshotIcon: Icons.Camera,
    Spinner: Icons.LoaderCircle,
    ImageIcon: Icons.Image,
    VideoIcon: Icons.Film,
    Tooltip: Tooltip,
  },
]);
export const AudioPlayer = bind(Dialogs.CanvasAudioPlayer)(() => [
  {
    PlayIcon: Icons.Play,
    PauseIcon: Icons.Pause,
    TrimIcon: Icons.Scissors,
    ConfirmIcon: Icons.Check,
    Spinner: Icons.LoaderCircle,
    AudioIcon: Icons.Music,
    Tooltip: Tooltip,
  },
]);
export const ConnectedAssets = bind(Dialogs.CanvasConnectedAssets)(() => [
  { ImageIcon: Icons.Image, VideoIcon: Icons.Film, AudioIcon: Icons.Music, RemoveIcon: Icons.X },
]);
export const ModelSelector = bind(Dialogs.CanvasModelSelector)(() => [{ ModelIcon: ModelIcon }]);
export const AdvancedSettings = bind(Dialogs.CanvasAdvancedSettings)(() => []);
export const Connectors = bind(Dialogs.CanvasConnectors)(() => [Connector]);
export const TextComposerView = bind(Dialogs.CanvasTextComposer)(() => [
  {
    models: TEXT_MODELS,
    PromptEditor: PromptEditor,
    ConnectedAssets: ConnectedAssets,
    ModelSelector: ModelSelector,
    AdvancedSettings: AdvancedSettings,
    Tooltip: Tooltip,
    CollapseIcon: Icons.ChevronUp,
    SettingsIcon: Icons.SlidersHorizontal,
    GenerateIcon: Icons.ArrowUp,
  },
]);
export const PromptTag = bind(Dialogs.CanvasPromptTag)(() => [
  { Wrapper: NodeViewWrapper, CloseIcon: Icons.X, TagIcon: Icons.Sparkles },
]);
export const MentionTag = bind(Dialogs.CanvasMentionTag)(() => [
  {
    Wrapper: NodeViewWrapper,
    CloseIcon: Icons.X,
    ImageIcon: Icons.Image,
    VideoIcon: Icons.Video,
    TextIcon: Icons.Type,
    AudioIcon: Icons.Music,
  },
]);
export const PresetList = bindRef(Dialogs.CanvasPresetList)(() => [
  { CreateForm: PresetForm, PresetCard: PresetCard, AddIcon: Icons.Plus, CopyIcon: Icons.Copy },
]);
export const MentionList = bindRef(Dialogs.CanvasMentionList)(() => [
  { VideoIcon: Icons.Video, TextIcon: Icons.Type, AudioIcon: Icons.Music },
]);
export const ImageComposerView = bind(Dialogs.CanvasImageComposer)(() => [
  {
    models: IMAGE_MODELS,
    ratios: IMAGE_RATIOS,
    resolutions: IMAGE_RESOLUTIONS,
    PromptEditor: PromptEditor,
    ConnectedAssets: ConnectedAssets,
    ModelSelector: ModelSelector,
    Dimensions: Dimensions,
    AdvancedSettings: AdvancedSettings,
    Tooltip: Tooltip,
    CollapseIcon: Icons.ChevronUp,
    SettingsIcon: Icons.SlidersHorizontal,
    GenerateIcon: Icons.ArrowUp,
  },
]);
export const VideoComposerView = bind(Dialogs.CanvasVideoComposer)(() => [
  {
    models: VIDEO_MODELS,
    ratios: VIDEO_ASPECT_RATIOS,
    resolutions: VIDEO_RESOLUTIONS,
    PromptEditor: PromptEditor,
    ConnectedAssets: ConnectedAssets,
    ModelSelector: ModelSelector,
    Dimensions: Dimensions,
    AdvancedSettings: AdvancedSettings,
    Tooltip: Tooltip,
    CollapseIcon: Icons.ChevronUp,
    SettingsIcon: Icons.SlidersHorizontal,
    GenerateIcon: Icons.ArrowUp,
    VolumeIcon: Icons.Volume2,
    MuteIcon: Icons.VolumeX,
  },
]);
export const ModelIcon = bind(Dialogs.CanvasModelIcon)(() => [
  {
    Text: Icons.Type,
    Gemini: BrandIcons.Gemini,
    OpenAI: BrandIcons.OpenAI,
    Jimeng: BrandIcons.Jimeng,
    Doubao: BrandIcons.Doubao,
    Kling: BrandIcons.Kling,
    Aliyun: BrandIcons.Aliyun,
    Grok: BrandIcons.Grok,
    DeepSeek: BrandIcons.DeepSeek,
    Mureka: BrandIcons.Mureka,
  },
]);
export const Connector = bind(Dialogs.CanvasConnector)(() => [Icons.Plus]);
export const PresetForm = bind(Dialogs.CanvasPresetForm)(() => [
  {
    BackIcon: Icons.ArrowLeft,
    UploadIcon: Icons.Upload,
    ImageIcon: Icons.Image,
    Spinner: Icons.LoaderCircle,
    TagIcon: Icons.Sparkles,
  },
]);
export const PresetCard = bind(Dialogs.CanvasPresetCard)(() => [
  { ImageIcon: Icons.Image, DeleteIcon: Icons.Trash2 },
]);
export const Dimensions = bind(Dialogs.CanvasDimensions)(() => []);
export const TextComposer = React.memo(TextComposerView);
export const ImageComposer = React.memo(ImageComposerView);
export const VideoComposer = React.memo(VideoComposerView);
