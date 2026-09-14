import type { DashboardRuntime } from './dashboardRuntime';
import { createDashboardClient, type DashboardData } from './projectDashboardData';

/** Reads may be retried; a write is sent exactly once, and a failed refresh never replays it. */
export function useProjectDashboard(
  React: DashboardRuntime,
  client: ReturnType<typeof createDashboardClient>,
) {
  const [data, setData] = React.useState<DashboardData>({
    projects: [],
    folders: [],
  });
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [loaded, setLoaded] = React.useState(false);
  const ownerRef = React.useRef({
    alive: false,
    read: null as AbortController | null,
    write: null as AbortController | null,
    timers: new Set<ReturnType<typeof setTimeout>>(),
  });
  const timer = React.useCallback((fn: () => void, delay: number) => {
    const id = setTimeout(() => {
      ownerRef.current.timers.delete(id);
      fn();
    }, delay);
    ownerRef.current.timers.add(id);
    return id;
  }, []);
  const clearTimer = React.useCallback((id: ReturnType<typeof setTimeout>) => {
    clearTimeout(id);
    ownerRef.current.timers.delete(id);
  }, []);
  const refresh = React.useCallback(
    async function readDashboard(attempt = 0): Promise<boolean> {
      const state = ownerRef.current;
      if (!state.alive) return false;
      state.read?.abort();
      const read = new AbortController();
      state.read = read;
      setLoading(true);
      const deadline = timer(() => read.abort(), 30_000);
      try {
        const next = await client.load(read.signal);
        if (!state.alive || state.read !== read || read.signal.aborted) return false;
        setData(next);
        setLoaded(true);
        setError('');
        return true;
      } catch (failure) {
        if (!state.alive || state.read !== read) return false;
        setError(
          failure instanceof Error && !read.signal.aborted
            ? failure.message
            : '项目列表读取超时，请刷新重试',
        );
        if (attempt > 0)
          timer(() => {
            if (state.alive && state.read === read && !state.write) void readDashboard(attempt - 1);
          }, 1000);
        return false;
      } finally {
        clearTimer(deadline);
        if (state.alive && state.read === read) setLoading(false);
      }
    },
    [client, timer, clearTimer],
  );
  React.useEffect(() => {
    const state = ownerRef.current;
    state.alive = true;
    void refresh(4);
    return () => {
      state.alive = false;
      state.read?.abort();
      state.write?.abort();
      state.read = null;
      state.write = null;
      state.timers.forEach(clearTimeout);
      state.timers.clear();
    };
  }, [refresh]);
  const mutate = async <T>(
    operation: (signal: AbortSignal) => Promise<T>,
    commit?: (result: T) => void,
    reload = true,
  ): Promise<boolean> => {
    const state = ownerRef.current;
    if (!state.alive || state.write) return false;
    state.read?.abort();
    state.read = null;
    const write = new AbortController();
    state.write = write;
    const deadline = timer(() => write.abort(), 60_000);
    setBusy(true);
    setLoading(false);
    setError('');
    try {
      const result = await operation(write.signal);
      if (!state.alive || state.write !== write || write.signal.aborted) return false;
      // The server has acknowledged the operation. Commit before refreshing so a read
      // failure cannot leave a destructive confirmation ready to repeat the same write.
      commit?.(result);
      if (reload && !(await refresh()) && state.alive && state.write === write)
        setError('操作已完成，但列表刷新失败，请刷新列表核对');
      return true;
    } catch (failure) {
      if (state.alive && state.write === write)
        setError(
          write.signal.aborted
            ? '操作等待超时，结果尚未确认，请先刷新列表核对'
            : failure instanceof Error
              ? failure.message
              : '操作结果未确认，请先刷新列表核对',
        );
      return false;
    } finally {
      clearTimer(deadline);
      if (state.alive && state.write === write) {
        state.write = null;
        setBusy(false);
      }
    }
  };
  return {
    ...data,
    setData,
    loading,
    loaded,
    busy,
    error,
    refresh: () => refresh(),
    mutate,
  };
}
