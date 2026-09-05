// Utility functions shared between API and frontend
// ---------------------------------------------------------------------------
// CPF Validation — Receita Federal algorithm
// ---------------------------------------------------------------------------
/**
 * Strips all non-digit characters from a CPF string.
 */
export function desformatarCPF(cpf) {
    return cpf.replace(/\D/g, '');
}
/**
 * Formats an 11-digit CPF string to the canonical XXX.XXX.XXX-XX display format.
 * Does not validate; call validarCPF first if needed.
 */
export function formatarCPF(cpf) {
    const digits = desformatarCPF(cpf);
    return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
}
/**
 * Validates a CPF string according to the Receita Federal digit-verification algorithm.
 *
 * Rules:
 *  1. Strip non-digit characters.
 *  2. Must have exactly 11 digits.
 *  3. Must not be a sequence of all identical digits (e.g. 00000000000).
 *  4. First check digit: weight 10→2 applied to the first 9 digits.
 *  5. Second check digit: weight 11→2 applied to the first 10 digits.
 *
 * Returns true only when both check digits are correct.
 */
export function validarCPF(cpf) {
    const digits = desformatarCPF(cpf);
    if (digits.length !== 11)
        return false;
    // Reject sequences like 00000000000, 11111111111, etc.
    if (/^(\d)\1{10}$/.test(digits))
        return false;
    // Validate first check digit
    let sum = 0;
    for (let i = 0; i < 9; i++) {
        sum += parseInt(digits[i], 10) * (10 - i);
    }
    let remainder = (sum * 10) % 11;
    if (remainder === 10 || remainder === 11)
        remainder = 0;
    if (remainder !== parseInt(digits[9], 10))
        return false;
    // Validate second check digit
    sum = 0;
    for (let i = 0; i < 10; i++) {
        sum += parseInt(digits[i], 10) * (11 - i);
    }
    remainder = (sum * 10) % 11;
    if (remainder === 10 || remainder === 11)
        remainder = 0;
    if (remainder !== parseInt(digits[10], 10))
        return false;
    return true;
}
// ---------------------------------------------------------------------------
// Protocol utilities (Req 4.8)
// ---------------------------------------------------------------------------
/** Regex that matches the protocol format AAAA-NNNNN */
export const protocoloRegex = /^\d{4}-\d{5}$/;
/**
 * Formats a year + sequential number into the canonical protocol string.
 *
 * @param ano  - 4-digit year (e.g. 2025)
 * @param seq  - sequential number (e.g. 42 → "00042")
 * @returns    - "2025-00042"
 */
export function formatarProtocolo(ano, seq) {
    return `${ano}-${String(seq).padStart(5, '0')}`;
}
// ---------------------------------------------------------------------------
// Flow deadline calculation (Req 15.5)
// ---------------------------------------------------------------------------
/**
 * Returns the total deadline in business days for a flow, calculated as the
 * arithmetic sum of the prazosDiasUteis of all stages.
 *
 * Accepts any array of objects that have a prazosDiasUteis property so the
 * function can be used in both the API (full Etapa objects) and the frontend
 * (partial stage objects).
 */
export function calcularPrazoTotalFluxo(etapas) {
    return etapas.reduce((total, etapa) => total + etapa.prazosDiasUteis, 0);
}
// ---------------------------------------------------------------------------
// Business day utilities
// ---------------------------------------------------------------------------
const FERIADOS_NACIONAIS = [
    { month: 1, day: 1 }, // Confraternização Universal
    { month: 4, day: 21 }, // Tiradentes
    { month: 5, day: 1 }, // Dia do Trabalho
    { month: 9, day: 7 }, // Independência
    { month: 10, day: 12 }, // N.S. Aparecida
    { month: 11, day: 2 }, // Finados
    { month: 11, day: 15 }, // Proclamação da República
    { month: 12, day: 25 }, // Natal
];
/**
 * Returns true if the given date falls on a business day (Mon–Fri, not a
 * national public holiday).
 */
export function isDiaUtil(date) {
    const dow = date.getDay(); // 0 = Sunday, 6 = Saturday
    if (dow === 0 || dow === 6)
        return false;
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return !FERIADOS_NACIONAIS.some((f) => f.month === month && f.day === day);
}
/**
 * Adds `dias` business days to `start`, returning the resulting date.
 * The start date itself is not counted.
 */
export function calcularPrazoFinal(start, dias) {
    const result = new Date(start);
    let remaining = dias;
    while (remaining > 0) {
        result.setDate(result.getDate() + 1);
        if (isDiaUtil(result)) {
            remaining--;
        }
    }
    return result;
}
/**
 * Counts the number of business days between `start` (exclusive) and `end`
 * (inclusive).
 */
export function calcularDiasRestantes(start, end) {
    if (end <= start)
        return 0;
    const cursor = new Date(start);
    let count = 0;
    while (cursor < end) {
        cursor.setDate(cursor.getDate() + 1);
        if (isDiaUtil(cursor)) {
            count++;
        }
    }
    return count;
}
// ---------------------------------------------------------------------------
// Async sleep helper (useful in tests and retry logic)
// ---------------------------------------------------------------------------
export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=index.js.map