/** First text is immediate; subsequent bursts share one short render window.
 * Keep the complete text outside React state so a pending render cannot lose tokens.
 */
export function createAgentTextBuffer(publish: (text: string) => void) {
  let text = '', published = '', first = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { clearTimeout(timer); timer = undefined; };
  const flush = () => {
    cancel();
    if (text !== published) { published = text; publish(text); }
  };
  return {
    push(token: string) {
      if (!token) return;
      text += token;
      if (first) { first = false; flush(); }
      else if (timer === undefined) timer = setTimeout(flush, 32);
    },
    flush,
    cancel,
  };
}
