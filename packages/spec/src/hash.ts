/** SPEC §9: FNV-1a 32 over each int32 as 4 little-endian bytes. Returns 8 hex chars. */
export const hashState = (state: ArrayLike<number>): string => {
  let h = 0x811c9dc5
  for (let i = 0; i < state.length; i++) {
    const v = state[i]
    h = Math.imul(h ^ (v & 255), 0x01000193)
    h = Math.imul(h ^ ((v >> 8) & 255), 0x01000193)
    h = Math.imul(h ^ ((v >> 16) & 255), 0x01000193)
    h = Math.imul(h ^ ((v >>> 24) & 255), 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
