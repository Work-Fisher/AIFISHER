import type * as ReactTypes from 'react';
import { getGenerationConcurrency } from '../generation/generationClient';
type Runtime = Pick<typeof ReactTypes, 'useState' | 'useEffect'>;
interface Availability {
  checking: boolean;
  blocked: boolean;
  warning: string;
}
export function useGenerationAvailability(React: Runtime, model: string, mode: string) {
  const key = JSON.stringify([model, mode]);
  const [state, setState] = React.useState<Availability & { key: string }>({
    key,
    checking: true,
    blocked: false,
    warning: '',
  });
  React.useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | undefined;
    const check = async () => {
      if (disposed) return;
      request = new AbortController();
      const current = request;
      timeout = setTimeout(() => current.abort(), 10000);
      try {
        const result = await getGenerationConcurrency(model, mode, current.signal);
        if (!disposed)
          setState({
            key,
            checking: false,
            blocked: result.blocked,
            warning: result.blocked
              ? `${result.modelId || model} 并发已满 ${result.inFlight}/${result.maxConcurrent}`
              : '',
          });
      } catch {
        if (!disposed)
          setState({
            key,
            checking: false,
            blocked: false,
            warning: '暂时无法读取并发状态，生成前会再次检查',
          });
      } finally {
        clearTimeout(timeout);
        if (!disposed) timer = setTimeout(() => void check(), 2000);
      }
    };
    setState({ key, checking: true, blocked: false, warning: '' });
    if (model) void check();
    else setState({ key, checking: false, blocked: true, warning: '请先连接模型' });
    return () => {
      disposed = true;
      clearTimeout(timer);
      clearTimeout(timeout);
      request?.abort();
    };
  }, [model, mode, key]);
  return state.key === key ? state : { checking: true, blocked: false, warning: '' };
}
