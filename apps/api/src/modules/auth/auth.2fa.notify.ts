import { mailer, fromAddress } from '../../config/mailer.js';
import type { Canal2fa } from './auth.2fa.service.js';

/**
 * Envio do código de verificação de dois fatores (2FA) ao Cidadão (Req. 2.5).
 *
 * Suporta dois canais:
 *  - `email`: envia o código via SMTP (mailer configurado).
 *  - `sms`: stub — ainda não há gateway de SMS integrado; o envio é apenas
 *    registrado (log estruturado) para posterior integração. A troca por um
 *    provedor real (ex.: fila de notificações) não altera a assinatura desta
 *    função.
 */

/** Dados mínimos do cidadão necessários para compor a mensagem. */
export interface Destinatario2fa {
  nome: string;
  email: string;
  telefone: string | null;
}

/** Cor primária do design system usada no template do e-mail. */
const COR_PRIMARIA = '#0066CC';

/** Gera o corpo HTML do e-mail com o código 2FA. */
export function montarHtmlCodigo2fa(nome: string, codigo: string): string {
  return `
  <div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #1f2933;">
    <div style="background: ${COR_PRIMARIA}; padding: 24px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 20px;">Auditar</h1>
    </div>
    <div style="padding: 24px; background: #ffffff;">
      <p>Olá, ${nome},</p>
      <p>Use o código abaixo para concluir seu login. Ele é válido por 10 minutos:</p>
      <p style="text-align: center; margin: 32px 0;">
        <span style="font-size: 32px; letter-spacing: 8px; font-weight: bold; color: ${COR_PRIMARIA};">${codigo}</span>
      </p>
      <p style="color: #616e7c; font-size: 13px;">Se você não tentou fazer login, ignore este e-mail e considere alterar sua senha.</p>
    </div>
    <div style="padding: 16px; text-align: center; color: #9aa5b1; font-size: 12px;">
      Auditar — Sistema de Gestão de Processos Administrativos Municipais
    </div>
  </div>`;
}

/** Envia o código 2FA por e-mail. */
async function enviarPorEmail(destinatario: Destinatario2fa, codigo: string): Promise<void> {
  await mailer.sendMail({
    from: fromAddress,
    to: destinatario.email,
    subject: 'Seu código de verificação no Auditar',
    html: montarHtmlCodigo2fa(destinatario.nome, codigo),
    text:
      `Olá, ${destinatario.nome}.\n\n` +
      `Seu código de verificação é: ${codigo}\n` +
      `Ele é válido por 10 minutos.\n\n` +
      `Se você não tentou fazer login, ignore esta mensagem.`,
  });
}

/**
 * Stub de envio por SMS. Registra a intenção de envio até que um gateway de SMS
 * seja integrado. NÃO loga o código em produção real; aqui apenas o comprimento
 * é registrado para evitar vazamento em logs.
 */
async function enviarPorSms(destinatario: Destinatario2fa, codigo: string): Promise<void> {
  console.info(
    JSON.stringify({
      level: 'info',
      scope: 'auth.2fa',
      event: 'sms_stub_envio',
      destino: destinatario.telefone ? `***${destinatario.telefone.slice(-4)}` : null,
      codigoLen: codigo.length,
    }),
  );
}

/**
 * Envia o código 2FA pelo canal escolhido.
 *
 * @param destinatario dados do cidadão (nome, email, telefone).
 * @param canal `email` ou `sms`.
 * @param codigo código de 6 dígitos a enviar.
 */
export async function enviarCodigo2fa(
  destinatario: Destinatario2fa,
  canal: Canal2fa,
  codigo: string,
): Promise<void> {
  if (canal === 'sms') {
    await enviarPorSms(destinatario, codigo);
    return;
  }
  await enviarPorEmail(destinatario, codigo);
}
