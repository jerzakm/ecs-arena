// The component that all games use. The store is sized for the largest world: the factory `works` scenario (150,000 machines and their drones).
export const GameId = { id: new Int32Array(1 << 18) }
