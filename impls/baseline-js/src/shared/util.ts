/** The order of every list that a system builds or iterates in a fixed order (SPEC §5.6). */
export const byGameId = (a: { gameId: number }, b: { gameId: number }) => a.gameId - b.gameId

/** Appends `value` to the list at `key` and creates the list when the key is new. */
export const pushTo = <K, V>(map: Map<K, V[]>, key: K, value: V): void => {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}
