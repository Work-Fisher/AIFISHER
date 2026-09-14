import { useEffect, useRef } from 'react';
import { createUpdateDownloadFallback } from '../../../../src/update/updateDownloadFallback';

export function UpdateDownloadFallback() {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = createUpdateDownloadFallback(document);
    container.current?.append(element);
    return () => element.remove();
  }, []);
  return <div ref={container} />;
}
