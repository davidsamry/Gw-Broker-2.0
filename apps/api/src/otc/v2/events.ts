// Fase 4 — back-compat shim. The real implementation moved to
// ./stream/bus.js. Kept here so routes.ts (and any future caller that
// imports from './events.js') keeps working without changes.

export * from './stream/bus.js'
