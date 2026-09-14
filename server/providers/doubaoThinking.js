// Preserve the stored `reasoning` UI field while mapping each API protocol explicitly.
export function doubaoThinkingParameters(effort, responses = false) {
  if (effort === undefined) return {};
  if (!['minimal', 'low', 'medium', 'high'].includes(effort)) {
    throw new Error('豆包不支持所选思考强度。');
  }
  return {
    thinking: { type: effort === 'minimal' ? 'disabled' : 'enabled' },
    ...(responses ? { reasoning: { effort } } : { reasoning_effort: effort }),
  };
}
