// Re-export business-day utilities from @auditar/shared.
// The algorithms (national holidays, weekend skipping) live in the shared
// package and are the single source of truth — do NOT duplicate them here.
export { isDiaUtil, calcularPrazoFinal, calcularDiasRestantes } from '@auditar/shared';
