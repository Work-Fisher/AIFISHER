export interface PrepareCanvasResult {
  prepared: boolean;
  message: string;
}
export interface OpenCanvasResult {
  opened: boolean;
  message: string;
}

interface CanvasEntryBridge {
  prepare(): Promise<PrepareCanvasResult>;
  open(userInitiated: boolean): Promise<OpenCanvasResult>;
}

/** Coordinates main-process calls for one launcher. Identity stays authoritative in the main process. */
export function createCanvasEntry(bridge: CanvasEntryBridge) {
  let generation = 0;
  let accepting = true;
  let preparation: Promise<PrepareCanvasResult | null> | null = null;
  let opening: Promise<OpenCanvasResult | null> | null = null;
  const invalidate = () => {
    accepting = false;
    generation += 1;
    preparation = null;
    opening = null;
  };

  const prepare = (): Promise<PrepareCanvasResult | null> => {
    if (!accepting) return Promise.resolve(null);
    if (preparation) return preparation;
    const expected = generation;
    preparation = bridge
      .prepare()
      .catch(() => ({
        prepared: false,
        message: '本机画布预热未完成，进入时将重试。',
      }))
      .then((result) => (expected === generation && accepting ? result : null));
    return preparation;
  };

  return {
    prepare,
    invalidate,
    reset() {
      invalidate();
      accepting = true;
    },
    open(userInitiated = false): Promise<OpenCanvasResult | null> {
      if (!accepting) return Promise.resolve(null);
      if (opening) return opening;
      const expected = generation;
      const operation = (async () => {
        await prepare();
        if (!accepting || expected !== generation) return null;
        // A failed warm-up is only an optimization failure; the main process revalidates on open.
        const result = await bridge.open(userInitiated).catch((error: unknown) => {
          if (!accepting || expected !== generation) return null;
          throw error;
        });
        return accepting && expected === generation ? result : null;
      })();
      opening = operation;
      void operation.then(
        () => {
          if (opening === operation) opening = null;
        },
        () => {
          if (opening === operation) opening = null;
        },
      );
      return operation;
    },
    async leave<T>(signOut: () => Promise<T>): Promise<T> {
      invalidate();
      const expected = generation;
      // Dispatch before navigation can destroy this realm. The main process
      // stops the backend and reloads the launcher on logout.
      try {
        return await signOut();
      } catch (error) {
        if (expected === generation) accepting = true;
        throw error;
      }
    },
  };
}
