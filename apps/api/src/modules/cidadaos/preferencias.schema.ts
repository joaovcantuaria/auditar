import { z } from 'zod';
import { TipoEvento, CanalNotificacao } from '@auditar/shared';

/**
 * Schemas de validação (Zod) para as Preferências de Notificação do Cidadão
 * (Req. 6.3, 6.4).
 *
 * Cada preferência associa um tipo de evento a um ou mais canais de notificação
 * (mínimo 1). O horário de silêncio é opcional e, quando informado, deve estar
 * no formato de 24 horas `HH:MM` (00:00..23:59).
 *
 * Requisitos: 6.3, 6.4
 */

/** Horário no formato de 24 horas `HH:MM` (00:00..23:59). */
export const HORARIO_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Mensagem de erro reutilizada para horários fora do formato `HH:MM`. */
const HORARIO_MSG = 'Horário deve estar no formato HH:MM (00:00 a 23:59)';

/**
 * Uma preferência: um tipo de evento e os canais escolhidos para ele. Exige
 * pelo menos um canal (Req. 6.3).
 */
export const preferenciaSchema = z.object({
  tipoEvento: z.nativeEnum(TipoEvento, {
    errorMap: () => ({ message: 'Tipo de evento inválido' }),
  }),
  canais: z
    .array(
      z.nativeEnum(CanalNotificacao, {
        errorMap: () => ({ message: 'Canal de notificação inválido' }),
      }),
    )
    .min(1, 'Selecione ao menos um canal de notificação'),
});

export type PreferenciaInput = z.infer<typeof preferenciaSchema>;

/**
 * Payload de salvamento das preferências (Req. 6.3, 6.4). Contém a lista de
 * preferências por evento e, opcionalmente, o horário de silêncio (início/fim)
 * no formato `HH:MM`.
 */
export const salvarPreferenciasSchema = z.object({
  preferencias: z.array(preferenciaSchema),
  inicioSilencio: z
    .string()
    .trim()
    .regex(HORARIO_HHMM, HORARIO_MSG)
    .optional(),
  fimSilencio: z
    .string()
    .trim()
    .regex(HORARIO_HHMM, HORARIO_MSG)
    .optional(),
});

export type SalvarPreferenciasInput = z.infer<typeof salvarPreferenciasSchema>;
