import type * as ReactTypes from 'react';
import type { DashboardRuntime } from './dashboardRuntime';

interface RenameProps {
  id: string;
  label: string;
  isRenaming?: boolean;
  onRename(id: string, value: string): Promise<boolean>;
  onRenameComplete?(): void;
}
export function useDashboardRename(React: DashboardRuntime, props: RenameProps) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(props.label);
  const [pending, setPending] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);
  const currentRef = React.useRef(props);
  React.useLayoutEffect(() => {
    currentRef.current = props;
  });
  const stateRef = React.useRef({
    alive: false,
    finished: true,
    pending: false,
  });
  React.useEffect(() => {
    const instance = { alive: true, finished: true, pending: false };
    stateRef.current = instance;
    return () => {
      instance.alive = false;
    };
  }, [props.id]);
  const startRename = () => {
    if (stateRef.current.pending) return;
    stateRef.current.finished = false;
    setDraft(currentRef.current.label);
    setEditing(true);
  };
  React.useEffect(() => {
    if (props.isRenaming) startRename();
  }, [props.isRenaming, props.id]);
  React.useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);
  const cancel = () => {
    if (stateRef.current.pending) return;
    stateRef.current.finished = true;
    setDraft(currentRef.current.label);
    setEditing(false);
    currentRef.current.onRenameComplete?.();
  };
  const commit = async () => {
    const instance = stateRef.current;
    if (!instance.alive || instance.finished || instance.pending) return;
    const value = draft.trim();
    if (!value || value === currentRef.current.label) {
      cancel();
      return;
    }
    instance.pending = true;
    setPending(true);
    let saved: boolean;
    try {
      saved = await currentRef.current.onRename(currentRef.current.id, value);
    } catch {
      saved = false;
    }
    if (!instance.alive || stateRef.current !== instance) return;
    instance.pending = false;
    setPending(false);
    if (saved) {
      instance.finished = true;
      setEditing(false);
      currentRef.current.onRenameComplete?.();
    } else input.current?.focus();
  };
  const keyDown = (event: ReactTypes.KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      void commit();
    }
  };
  return {
    editing,
    draft,
    setDraft,
    pending,
    input,
    startRename,
    commit,
    keyDown,
  };
}
