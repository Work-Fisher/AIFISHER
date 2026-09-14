import type { PromptRuntime } from './promptComponents';
export function usePromptMutation(React: PromptRuntime) {
  const aliveRef = React.useRef(false),
    activeRef = React.useRef<AbortController | null>(null);
  const [busy, setBusy] = React.useState(false),
    [error, setError] = React.useState('');
  React.useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      activeRef.current?.abort();
      activeRef.current = null;
    };
  }, []);
  const run = React.useCallback(
    async (
      task: (signal: AbortSignal) => Promise<{ success: true }>,
      commit: () => void,
    ): Promise<boolean> => {
      if (!aliveRef.current || activeRef.current) return false;
      const request = new AbortController();
      activeRef.current = request;
      setBusy(true);
      setError('');
      let cancel = () => {};
      const aborted = new Promise<never>((_, reject) => {
        cancel = () => reject(Error('请求未确认，请重新打开预设列表核对结果'));
        request.signal.addEventListener('abort', cancel, { once: true });
      });
      const timer = setTimeout(() => request.abort(), 60000);
      try {
        const result = await Promise.race([task(request.signal), aborted]);
        if (!aliveRef.current || activeRef.current !== request) return false;
        if (request.signal.aborted || result?.success !== true)
          throw Error('未收到操作成功回执，请重新打开预设列表核对结果');
        commit();
        return true;
      } catch (cause) {
        if (aliveRef.current && activeRef.current === request)
          setError(
            request.signal.aborted || cause instanceof TypeError
              ? '请求未确认，请重新打开预设列表核对结果'
              : cause instanceof Error
                ? cause.message
                : '操作结果未确认，请重新打开预设列表核对',
          );
        return false;
      } finally {
        clearTimeout(timer);
        request.signal.removeEventListener('abort', cancel);
        if (activeRef.current === request) {
          activeRef.current = null;
          if (aliveRef.current) setBusy(false);
        }
      }
    },
    [],
  );
  return { busy, error, setError, run };
}
