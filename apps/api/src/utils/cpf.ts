// Re-export CPF utilities from @auditar/shared for local convenience.
// The validation/format algorithms live in the shared package and are the
// single source of truth — do NOT duplicate them here.
export { validarCPF, formatarCPF, desformatarCPF } from '@auditar/shared';
