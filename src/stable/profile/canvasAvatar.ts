const gradients = [
  ['#f6d365', '#fda085'],
  ['#f093fb', '#f5576c'],
  ['#5ee7df', '#b490ca'],
  ['#c3cfe2', '#c3cfe2'],
  ['#89f7fe', '#66a6ff'],
  ['#4facfe', '#00f2fe'],
  ['#667eea', '#764ba2'],
  ['#ff0844', '#ffb199'],
  ['#b224ef', '#7579ff'],
  ['#16a085', '#f4d03f'],
  ['#ff9a9e', '#fecfef'],
  ['#a18cd1', '#fbc2eb'],
  ['#84fab0', '#8fd3f4'],
  ['#a1c4fd', '#c2e9fb'],
  ['#ffecd2', '#fcb69f'],
  ['#cfd9df', '#e2ebf0'],
  ['#fdfbfb', '#ebedee'],
  ['#e0c3fc', '#8ec5fc'],
];

/** Keep the existing per-user display palette; this value never establishes identity. */
export function avatarColor(id: string) {
  let hash = 0;
  for (let index = 0; index < id.length; index++)
    hash = id.charCodeAt(index) + ((hash << 5) - hash);
  const [start, end] = gradients[Math.abs(hash) % gradients.length];
  return `linear-gradient(135deg, ${start} 0%, ${end} 100%)`;
}

export function avatarText(name: string) {
  return name.trim().slice(0, 2).toUpperCase() || '?';
}

export function avatarClass(name: string, size = 40) {
  const twoLetters = name.trim().slice(0, 2).length >= 2;
  if (size >= 64) return twoLetters ? 'text-lg' : 'text-xl';
  if (size >= 48) return twoLetters ? 'text-sm' : 'text-base';
  return twoLetters ? 'text-[10px]' : 'text-xs';
}
