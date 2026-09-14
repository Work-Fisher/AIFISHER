type EnhancementObserver = (records: readonly MutationRecord[]) => void;

type DocumentLifecycle = {
  callbacks: Set<EnhancementObserver>;
  observer: MutationObserver;
};

const lifecycles = new WeakMap<Document, DocumentLifecycle>();

function createLifecycle(documentRoot: Document): DocumentLifecycle {
  const callbacks = new Set<EnhancementObserver>();
  const Observer = documentRoot.defaultView?.MutationObserver ?? MutationObserver;
  const lifecycle: DocumentLifecycle = {
    callbacks,
    observer: new Observer((records) => {
      for (const callback of [...callbacks]) callback(records);
    }),
  };
  lifecycle.observer.observe(documentRoot.body ?? documentRoot.documentElement, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  lifecycles.set(documentRoot, lifecycle);
  return lifecycle;
}

export function observeStableEnhancement(
  callback: EnhancementObserver,
  documentRoot: Document = document,
) {
  const lifecycle = lifecycles.get(documentRoot) ?? createLifecycle(documentRoot);
  lifecycle.callbacks.add(callback);
  callback([]);

  return () => {
    lifecycle.callbacks.delete(callback);
    if (lifecycle.callbacks.size > 0) return;
    lifecycle.observer.disconnect();
    lifecycles.delete(documentRoot);
  };
}
