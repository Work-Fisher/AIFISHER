import { useEffect, useLayoutEffect, useRef } from 'react';
import { extractVideoLastFrame } from '../generation/canvasGeneration';
import {
  mountGenerationRecovery,
  mountVideoFrameRecovery,
  type GenerationRecoveryBinding,
  type GenerationRecoverySession,
} from '../generation/generationRecovery';

export type RecoveryOptions = {
  nodes: ReturnType<GenerationRecoveryBinding['getNodes']>;
  updateNode: GenerationRecoveryBinding['updateNode'];
};

/** Keep recovery mounted while callbacks change; dispose with the owning canvas. */
export function useRecovery(options: RecoveryOptions, framesOnly: boolean) {
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });
  const session = useRef<GenerationRecoverySession | null>(null);
  useEffect(() => {
    const binding: GenerationRecoveryBinding = {
      getNodes: () => latest.current.nodes,
      updateNode: (id, patch) => latest.current.updateNode(id, patch),
      extractLastFrame: extractVideoLastFrame,
    };
    const mounted = framesOnly
      ? mountVideoFrameRecovery(binding)
      : mountGenerationRecovery(binding);
    session.current = mounted;
    return () => {
      mounted.dispose();
      session.current = null;
    };
  }, [framesOnly]);
  useEffect(() => {
    session.current?.scan();
  }, [options.nodes]);
}
