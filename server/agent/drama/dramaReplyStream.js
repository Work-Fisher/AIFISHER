/** Preview only the leading reply string. Plans and tool arguments stay private
 * until the existing final parser validates the entire response. */
export function createDramaReplyStream(onToken) {
  let mode = 'prefix', pending = '', highSurrogate = '';
  return (chunk) => {
    if (mode === 'done') return;
    pending += chunk;
    if (mode === 'prefix') {
      const text = pending.trimStart();
      if (!text) return;
      const start = /^\s*(?:```(?:json)?\s*)?\{\s*"reply"\s*:\s*"/.exec(pending);
      if (start) { pending = pending.slice(start[0].length); mode = 'string'; }
      else if (/^[{[`]/.test(text)) {
        // Different field order or structured output: use the validated final reply.
        if (pending.length > 128) { mode = 'done'; pending = ''; }
        return;
      } else mode = 'plain';
    }
    if (mode === 'plain') { onToken(pending); pending = ''; return; }
    let output = '', index = 0;
    while (index < pending.length) {
      const char = pending[index];
      if (char === '"') { mode = 'done'; index = pending.length; break; }
      if (char === '\\') {
        const length = pending[index + 1] === 'u' ? 6 : 2;
        if (index + length > pending.length) break;
        try { output += JSON.parse(`"${pending.slice(index, index + length)}"`); }
        catch { mode = 'done'; pending = ''; return; }
        index += length;
      } else { output += char; index++; }
    }
    pending = pending.slice(index);
    output = highSurrogate + output;
    highSurrogate = /[\uD800-\uDBFF]$/.test(output) ? output.slice(-1) : '';
    if (highSurrogate) output = output.slice(0, -1);
    if (output) onToken(output);
  };
}
