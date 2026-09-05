import { mailer, fromAddress } from '../../config/mailer.js';
import { env } from '../../config/env.js';

/**
 * Helper de envio do e-mail de recuperação de senha do Cidadão (Req. 7.3, 7.4).
 *
 * O link de redefinição aponta para o Portal do Cidadão (`WEB_URL`), na rota
 * `/nova-senha/:token`, de onde o frontend chama o endpoint de redefinição da
 * API. O token é armazenado no Redis (uso único, expiração de 1h).
 */

/** Dados mínimos do cidadão necessários para compor o e-mail. */
export interface DestinatarioRecuperacao {
  nome: string;
  email: string;
}

/** Cor primária do design system usada no template do e-mail. */
const COR_PRIMARIA = '#0066CC';

/** Monta a URL de redefinição de senha exibida ao cidadão. */
export function montarLinkRecuperacao(token: string): string {
  const base = env.WEB_URL.replace(/\/+$/, '');
  return `${base}/nova-senha/${token}`;
}

/** Gera o corpo HTML do e-mail de recuperação de senha. */
export function montarHtmlRecuperacao(nome: string, link: string): string {
  return `
  <div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #1f2933;">
    <div style="background: ${COR_PRIMARIA}; padding: 24px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 20px;">Auditar</h1>
    </div>
    <div style="padding: 24px; background: #ffffff;">
      <p>Olá, ${nome},</p>
      <p>Recebemos uma solicitação para redefinir a senha da sua conta no Portal do Cidadão. Para criar uma nova senha, clique no botão abaixo:</p>
      <p style="text-align: center; margin: 32px 0;">
        <a href="${link}"
           style="background: ${COR_PRIMARIA}; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; display: inline-block; font-weight: bold;">
          Redefinir minha senha
        </a>
      </p>
      <p>Ou copie e cole o endereço a seguir no seu navegador:</p>
      <p style="word-break: break-all;"><a href="${link}" style="color: ${COR_PRIMARIA};">${link}</a></p>
      <p style="color: #616e7c; font-size: 13px;">Este link é de uso único e expira em 1 hora. Se você não solicitou esta alteração, ignore este e-mail — sua senha permanecerá inalterada.</p>
    </div>
    <div style="padding: 16px; text-align: center; color: #9aa5b1; font-size: 12px;">
      Auditar — Sistema de Gestão de Processos Administrativos Municipais
    </div>
  </div>`;
}

/**
 * Envia o e-mail de recuperação de senha ao cidadão.
 *
 * @param cidadao Nome e e-mail do destinatário.
 * @param token   Token de redefinição de uso único.
 */
export async function enviarEmailRecuperacao(
  cidadao: DestinatarioRecuperacao,
  token: string,
): Promise<void> {
  const link = montarLinkRecuperacao(token);
  await mailer.sendMail({
    from: fromAddress,
    to: cidadao.email,
    subject: 'Redefinição de senha — Auditar',
    html: montarHtmlRecuperacao(cidadao.nome, link),
    text:
      `Olá, ${cidadao.nome}.\n\n` +
      `Recebemos uma solicitação para redefinir a senha da sua conta no Auditar.\n` +
      `Acesse o link a seguir para criar uma nova senha (válido por 1 hora):\n${link}\n\n` +
      `Se você não solicitou esta alteração, ignore este e-mail.`,
  });
}
