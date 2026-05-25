// Fase 4 — back-compat shim. The real implementation moved to
// ./recovery/bootstrap.js, and loadLatestCandlePerTimeframe moved to
// ./storage/candles.js.

export { bootstrapHistoricalCandles }    from './recovery/bootstrap.js'
export { loadLatestCandlePerTimeframe }  from './storage/candles.js'
