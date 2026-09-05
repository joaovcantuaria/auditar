import { mailer, fromAddress } from '../../config/mailer.js';
import { env } from '../../config/env.js';

/**
 * Helper de envio do e-mail de confirmação de alteração de e-mail do Cidadão
 * (Req. 7.2). O link aponta para o Portal do Cidadão (`WEB_URL`), na rota
 * `/confirmar-email/:token`, de onde o frontend chama o endpoint de confirmação
 * da API. O link tem validade de 24 horas (Req. 7.2, 7.8).
 */

/** Cor primária do design system usada no template do e-mail. */
const COR_PRIMARIA = '#0066CC';

/** Monta a URL de confirmação de alteração de e-mail exibida ao cidadão. */
export function montarLinkConfirmacaoEmail(token: string): string {
  const base = env.WEB_URL.replace(/\/+$/, '');
  return `${base}/confirmar-email/${token}`;
}

/** Gera o corpo HTML do e-mail de confirmação de novo e-mail. */
export function montarHtmlConfirmacaoNovoEmail(nome: string, link: string): string {
  return `
  <div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #1f2933;">
    <div style="background: ${COR_PRIMARIA}; padding: 24px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 20px;">Auditar</h1>
    </div>
    <div style="padding: 24px; background: #ffffff;">
      <p>Olá, ${nome},</p>
      <p>Recebemos uma solicitação para alterar o e-mail da sua conta no Portal do Cidadão para este endereço. Para confirmar a alteração, clique no botão abaixo:</p>
      <p style="text-align: center; margin: 32px 0;">
        <a href="${link}"
           style="background: ${COR_PRIMARIA}; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; display: inline-block; font-weight: bold;">
          Confirmar novo e-mail
        </a>
      </p>
      <p>Ou copie e cole o endereço a seguir no seu navegador:</p>
      <p style="word-break: break-all;"><a href="${link}" style="color: ${COR_PRIMARIA};">${link}</a></p>
      <p style="color: #616e7c; font-size: 13px;">Este link é de uso único e expira em 24 horas. Até a confirmação, o e-mail anterior permanece ativo. Se você não solicitou esta alteração, ignore este e-mail.</p>
    </div>
    <div style="padding: 16px; text-align: center; color: #9aa5b1; font-size: 12px;">
      Auditar — Sistema de Gestão de Processos Administrativos Municipais
    </div>
  </div>`;
}

/**
 * Envia o e-mail de confirmação de alteração de e-mail para o NOVO endereço.
 *
 * @param nome      Nome do cidadão.
 * @param novoEmail Novo endereço de e-mail (destinatário).
 * @param token     Token de confirmação de uso único (válido por 24 horas).
 */
export async function enviarConfirmacaoNovoEmail(
  nome: string,
  novoEmail: string,
  token: string,
): Promise<void> {
  const link = montarLinkConfirmacaoEmail(token);
  await mailer.sendMail({
    from: fromAddress,
    to: novoEmail,
    subject: 'Confirme seu novo e-mail no Auditar',
    html: montarHtmlConfirmacaoNovoEmail(nome, link),
    text:
      `Olá, ${nome}.\n\n` +
      `Recebemos uma solicitação para alterar o e-mail da sua conta no Auditar para este endereço. ` +
      `Para confirmar (link válido por 24 horas), acesse:\n${link}\n\n` +
      `Até a confirmação, o e-mail anterior permanece ativo. Se você não solicitou esta alteração, ignore este e-mail.`,
  });
}
