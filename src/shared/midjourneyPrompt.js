/** Combine parameter blocks after all prose. Reference weights stay attached to their codes. */
export function normalizeMidjourneyPrompt(value) {
  const text = String(value || '');
  const flags = [...text.matchAll(/(?:^|\s)--([a-z][a-z-]*)(?=\s|$)/gi)];
  if (!flags.length) return text.trim();
  const parameters = new Map();
  for (let index = 0; index < flags.length; index++) {
    const flag = flags[index];
    let name = flag[1].toLowerCase();
    if (name === 'preview') continue;
    if (name === 'p' || name === 'personalize') name = 'profile';
    const value = text.slice(flag.index + flag[0].length, flags[index + 1]?.index ?? text.length).trim();
    if (name === 'sref' || name === 'profile') {
      const previous = parameters.get(name) || '';
      parameters.set(name, [...new Set(`${previous} ${value}`.split(/\s+/).filter(Boolean))].join(' '));
    } else {
      // Scalar settings cannot stack; the final explicit selection wins.
      parameters.set(name, value);
    }
  }
  const suffix = [...parameters].map(([name, value]) => `--${name}${value ? ` ${value}` : ''}`).join(' ');
  return [text.slice(0, flags[0].index).trim(), suffix].filter(Boolean).join('\n');
}

export function removeMidjourneyPreview(value) {
  return String(value || '').replace(/(?:^|\s)--preview(?=\s|$)/gi, '').trim();
}
