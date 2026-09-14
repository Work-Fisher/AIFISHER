/** Decode OpenAI-compatible events as they arrive, preserving split UTF-8. */
export async function* chatPayloads(response, maximum = Infinity) {
  const streaming = response.headers.get('content-type')?.includes('text/event-stream');
  const decoder = new TextDecoder();
  let buffer = '', size = 0;
  const done = Symbol('done');
  function parse(line) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return null;
    const data = trimmed.slice(5).trim();
    return data === '[DONE]' ? done : !data ? null : JSON.parse(data);
  }
  for await (const bytes of response.body) {
    const chunk = decoder.decode(bytes, { stream: true });
    size += chunk.length;
    if (size > maximum) throw new Error('文本模型响应超过大小限制。');
    buffer += chunk;
    if (!streaming) continue;
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const payload = parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      // Returning closes the body iterator too; some relays keep HTTP open after DONE.
      if (payload === done) return;
      if (payload) yield { payload, streaming: true };
    }
  }
  buffer += decoder.decode();
  if (streaming) {
    const payload = parse(buffer);
    if (payload === done) return;
    if (payload) yield { payload, streaming: true };
  } else {
    yield { payload: JSON.parse(buffer), streaming: false };
  }
}
