// Forex module shutdown — re-exports for symmetry with boot.ts. Kept as a
// separate file because future phases will add candle flush, snapshot save,
// WS server close ordering, etc., and putting them in boot.ts would muddy
// the lifecycle file.

export { stopForexRuntime } from './boot.js'
