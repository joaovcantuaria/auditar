/**
 * Strips all non-digit characters from a CPF string.
 */
export declare function desformatarCPF(cpf: string): string;
/**
 * Formats an 11-digit CPF string to the canonical XXX.XXX.XXX-XX display format.
 * Does not validate; call validarCPF first if needed.
 */
export declare function formatarCPF(cpf: string): string;
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
export declare function validarCPF(cpf: string): boolean;
/** Regex that matches the protocol format AAAA-NNNNN */
export declare const protocoloRegex: RegExp;
/**
 * Formats a year + sequential number into the canonical protocol string.
 *
 * @param ano  - 4-digit year (e.g. 2025)
 * @param seq  - sequential number (e.g. 42 → "00042")
 * @returns    - "2025-00042"
 */
export declare function formatarProtocolo(ano: number, seq: number): string;
/**
 * Returns the total deadline in business days for a flow, calculated as the
 * arithmetic sum of the prazosDiasUteis of all stages.
 *
 * Accepts any array of objects that have a prazosDiasUteis property so the
 * function can be used in both the API (full Etapa objects) and the frontend
 * (partial stage objects).
 */
export declare function calcularPrazoTotalFluxo(etapas: ReadonlyArray<{
    prazosDiasUteis: number;
}>): number;
/**
 * Returns true if the given date falls on a business day (Mon–Fri, not a
 * national public holiday).
 */
export declare function isDiaUtil(date: Date): boolean;
/**
 * Adds `dias` business days to `start`, returning the resulting date.
 * The start date itself is not counted.
 */
export declare function calcularPrazoFinal(start: Date, dias: number): Date;
/**
 * Counts the number of business days between `start` (exclusive) and `end`
 * (inclusive).
 */
export declare function calcularDiasRestantes(start: Date, end: Date): number;
export declare function sleep(ms: number): Promise<void>;
//# sourceMappingURL=index.d.ts.map