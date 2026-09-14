import { PanoramaGenerate } from './panoramaGenerate';
import { createPortal } from 'react-dom';
import * as React from 'react';
import { Crop, Paintbrush, Layers, Scan, Undo2, Redo2, X } from 'lucide-react';
import { activateModal } from '../design/modalFocus';
import type { CanvasComponent } from '../app/canvasComponentType';
import type { CropOutput } from './imageCropGeometry';
import './imageStudio.css';
import { CanvasImageAngle } from './canvasImageAngle';
import type { ImageAngle } from '../prompt/imageAngle';

interface Source {
  id: string;
  resultUrl?: string;
  title?: string;
  imageAngle?: unknown;
}
interface Props {
  node?: Source;
  sources?: Source[];
  projectId?: string;
  mode?: 'editor' | 'grid' | 'panorama' | 'angle' | 'panorama-generate';
  onPanorama?(id: string): void;
  onAngle?(id: string, angle: ImageAngle): void;
  onClose(): void;
  onSave(
    id: string,
    outputs: CropOutput[],
    progress: (completed: number) => void,
  ): unknown | Promise<unknown>;
}
type Stage = 'crop' | 'mask' | 'brush' | 'compose';
interface Components {
  CropEditor: CanvasComponent;
  Annotation: CanvasComponent;
  Composite: CanvasComponent;
}

/** Local editing draft: applying a tool does not upload or overwrite the source. */
export function CanvasImageStudio(_runtime: unknown, props: Props, components: Components) {
  return createPortal(<ImageStudioContent {...props} components={components} />, document.body);
}
function ImageStudioContent(props: Props & { components: Components }) {
  const components = props.components;
  const { node, mode = 'editor', onClose, onSave, projectId, sources = [] } = props;
  const { CropEditor, Annotation, Composite } = components;
  const root = React.useRef<HTMLDivElement>(null);
  const [stage, setStage] = React.useState<Stage | null>(null);
  const [versions, setVersions] = React.useState<CropOutput[]>([]);
  const [position, setPosition] = React.useState(-1);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const active = React.useRef(true);
  const lock = React.useRef(false);
  React.useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  React.useEffect(() => {
    if (mode !== 'editor' || stage || !root.current) return;
    return activateModal(root.current, onClose);
  }, [mode, stage, onClose]);
  if (!node?.resultUrl) return null;
  const current = versions[position];
  const working = { ...node, resultUrl: current?.data || node.resultUrl };
  const apply = (output: CropOutput) => {
    const next = [...versions.slice(0, position + 1), output].slice(-50);
    setVersions(next);
    setPosition(next.length - 1);
    setStage(null);
  };
  if (mode === 'angle')
    return (
      <CanvasImageAngle
        node={node}
        onClose={onClose}
        onApply={(id, angle) => {
          if (!props.onAngle) throw new Error('当前画布不可创建图片，请重新打开项目。');
          props.onAngle(id, angle);
        }}
      />
    );
  if (mode === 'panorama-generate')
    return <PanoramaGenerate node={node} onClose={onClose} onGenerate={props.onPanorama} />;
  if (mode !== 'editor') return <CropEditor {...props} variant={mode} />;
  if (stage === 'crop')
    return (
      <CropEditor
        node={working}
        projectId={projectId}
        variant={stage}
        saveLabel="应用裁剪"
        onClose={() => setStage(null)}
        onSave={async (id: string, outputs: CropOutput[], progress: (n: number) => void) => {
          if (outputs.length === 1) apply(outputs[0]);
          else {
            await onSave(id, outputs, progress);
            onClose();
          }
        }}
      />
    );
  if (stage === 'mask' || stage === 'brush')
    return (
      <Annotation
        node={working}
        projectId={projectId}
        initialMask={stage === 'mask'}
        saveLabel="应用编辑"
        onClose={() => setStage(null)}
        onSave={(_id: string, data: string, size: { width: number; height: number }) =>
          apply({ data, ...size, row: 0, column: 0 })
        }
      />
    );
  if (stage === 'compose')
    return (
      <Composite
        saveLabel="应用组合"
        onClose={() => setStage(null)}
        payload={{
          nodeId: node.id,
          layers: [
            working,
            ...sources.filter((s) => s.id !== node.id && selected.includes(s.id)),
          ].map((s) => ({ nodeId: s.id, url: s.resultUrl, title: s.title })),
          onSave: async (_id: string, data: string) => {
            const image = new Image();
            image.src = data;
            await image.decode();
            if (active.current)
              apply({
                data,
                width: image.naturalWidth,
                height: image.naturalHeight,
                row: 0,
                column: 0,
              });
          },
        }}
      />
    );
  return (
    <div
      ref={root}
      className="af-image-studio"
      role="dialog"
      aria-modal="true"
      aria-label="图片编辑"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <header>
        <strong>图片编辑</strong>
        <span>应用工具后可继续编辑，保存时生成新图片</span>
        <button aria-label="关闭图片编辑" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <nav aria-label="编辑模式">
        {(
          [
            ['crop', '裁剪', Crop],
            ['mask', '蒙版', Scan],
            ['brush', '笔刷', Paintbrush],
            ['compose', '组合', Layers],
          ] as const
        ).map(([value, title, Icon]) => (
          <button key={value} disabled={saving} onClick={() => setStage(value)}>
            <Icon size={17} />
            {title}
          </button>
        ))}
      </nav>
      <main>
        <img src={working.resultUrl} alt="当前编辑图片" />
      </main>
      {sources.some((s) => s.id !== node.id) && (
        <details>
          <summary>组合素材 · 已选 {selected.length} 张</summary>
          <div className="af-image-sources">
            {sources
              .filter((s) => s.id !== node.id)
              .map((s) => (
                <button
                  key={s.id}
                  aria-pressed={selected.includes(s.id)}
                  disabled={saving}
                  onClick={() =>
                    setSelected((old) =>
                      old.includes(s.id) ? old.filter((id) => id !== s.id) : [...old, s.id],
                    )
                  }
                >
                  <img src={s.resultUrl} alt={s.title || '素材'} />
                  <span>{s.title || '未命名图片'}</span>
                </button>
              ))}
          </div>
        </details>
      )}
      <footer>
        <button
          aria-label="撤销编辑"
          disabled={saving || position < 0}
          onClick={() => setPosition(position - 1)}
        >
          <Undo2 size={17} />
        </button>
        <button
          aria-label="重做编辑"
          disabled={saving || position >= versions.length - 1}
          onClick={() => setPosition(position + 1)}
        >
          <Redo2 size={17} />
        </button>
        <span role="status">
          {error || (current ? `${current.width} × ${current.height}` : '原图')}
        </span>
        <button
          className="primary"
          disabled={saving || !current}
          onClick={async () => {
            if (lock.current || !current) return;
            lock.current = true;
            setSaving(true);
            setError('');
            try {
              await onSave(node.id, [current], () => {});
              if (active.current) onClose();
            } catch (cause) {
              if (active.current)
                setError(cause instanceof Error ? cause.message : '保存失败，请重试');
            } finally {
              lock.current = false;
              if (active.current) setSaving(false);
            }
          }}
        >
          {saving ? '正在保存…' : '保存为新图片'}
        </button>
      </footer>
    </div>
  );
}
