export function createStableElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
  documentRoot: Document = document,
): HTMLElementTagNameMap[K] {
  const element = documentRoot.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

export function createStableTextElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = '',
  className = '',
  documentRoot: Document = document,
): HTMLElementTagNameMap[K] {
  return createStableElement(tag, className, text, documentRoot);
}
