import { mailer, fromAddress } from '../../config/mailer.js';
import { env } from '../../config/env.js';

/**
 * Helper de envio do e-mail de ativação de conta do Cidadão (Req. 1.5, 1.8).
 *
 * O link de ativação aponta para o Portal do Cidadão (`WEB_URL`), na rota
 * `/ativar/:token`, de onde o frontend chama o endpoint de ativação da API.
 */

/** Dados mínimos do cidadão necessários para compor o e-mail. */
export interface DestinatarioAtivacao {
  nome: string;
  email: string;
}

/** Cor primária do design system usada no template do e-mail. */
const COR_PRIMARIA = '#0066CC';

/** Monta a URL de ativação exibida ao cidadão. */
export function montarLinkAtivacao(token: string): string {
  const base = env.WEB_URL.replace(/\/+$/, '');
  return `${base}/ativar/${token}`;
}

/** Gera o corpo HTML do e-mail de ativação. */
export function montarHtmlAtivacao(nome: string, link: string): string {
  return `
  <div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #1f2933;">
    <div style="background: ${COR_PRIMARIA}; padding: 24px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 20px;">Auditar</h1>
    </div>
    <div style="padding: 24px; background: #ffffff;">
      <p>Olá, ${nome},</p>
      <p>Recebemos uma solicitação de cadastro no Portal do Cidadão. Para ativar sua conta, clique no botão abaixo:</p>
      <p style="text-align: center; margin: 32px 0;">
        <a href="${link}"
           style="background: ${COR_PRIMARIA}; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; display: inline-block; font-weight: bold;">
          Ativar minha conta
        </a>
      </p>
      <p>Ou copie e cole o endereço a seguir no seu navegador:</p>
      <p style="word-break: break-all;"><a href="${link}" style="color: ${COR_PRIMARIA};">${link}</a></p>
      <p style="color: #616e7c; font-size: 13px;">Este link é de uso único e expira em 48 horas. Se você não solicitou este cadastro, ignore este e-mail.</p>
    </div>
    <div style="padding: 16px; text-align: center; color: #9aa5b1; font-size: 12px;">
      Auditar — Sistema de Gestão de Processos Administrativos Municipais
    </div>
  </div>`;
}

/**
 * Envia o e-mail de ativação de conta ao cidadão.
 *
 * @param cidadao Nome e e-mail do destinatário.
 * @param token   Token de ativação de uso único.
 */
export async function enviarEmailAtivacao(
  cidadao: DestinatarioAtivacao,
  token: string,
): Promise<void> {
  const link = montarLinkAtivacao(token);
  await mailer.sendMail({
    from: fromAddress,
    to: cidadao.email,
    subject: 'Ative sua conta no Auditar',
    html: montarHtmlAtivacao(cidadao.nome, link),
    text:
      `Olá, ${cidadao.nome}.\n\n` +
      `Para ativar sua conta no Auditar, acesse o link a seguir (válido por 48 horas):\n${link}\n\n` +
      `Se você não solicitou este cadastro, ignore este e-mail.`,
  });
}

// ---------------------------------------------------------------------------
// Notificação de bloqueio de conta (Req. 2.3)
// ---------------------------------------------------------------------------

/** Dados mínimos para compor o e-mail de bloqueio. */
export interface DestinatarioBloqueio {
  nome: string;
  email: string;
}

/** Gera o corpo HTML do e-mail de notificação de bloqueio de conta. */
export function montarHtmlBloqueio(nome: string, minutos: number): string {
  return `
  <div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #1f2933;">
    <div style="background: ${COR_PRIMARIA}; padding: 24px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 20px;">Auditar</h1>
    </div>
    <div style="padding: 24px; background: #ffffff;">
      <p>Olá, ${nome},</p>
      <p>Detectamos várias tentativas de acesso malsucedidas à sua conta no Portal do Cidadão.</p>
      <p>Por segurança, o acesso foi <strong>temporariamente bloqueado por ${minutos} minutos</strong>.
      Após esse período você poderá tentar novamente.</p>
      <p style="color: #616e7c; font-size: 13px;">Se você não reconhece estas tentativas, recomendamos redefinir sua senha assim que o acesso for restabelecido.</p>
    </div>
    <div style="padding: 16px; text-align: center; color: #9aa5b1; font-size: 12px;">
      Auditar — Sistema de Gestão de Processos Administrativos Municipais
    </div>
  </div>`;
}

/**
 * Envia e-mail ao cidadão informando o bloqueio temporário da conta após
 * tentativas de login malsucedidas (Req. 2.3).
 *
 * @param cidadao Nome e e-mail do destinatário.
 * @param minutos Duração do bloqueio em minutos.
 */
export async function enviarEmailBloqueio(
  cidadao: DestinatarioBloqueio,
  minutos: number,
): Promise<void> {
  await mailer.sendMail({
    from: fromAddress,
    to: cidadao.email,
    subject: 'Sua conta no Auditar foi bloqueada temporariamente',
    html: montarHtmlBloqueio(cidadao.nome, minutos),
    text:
      `Olá, ${cidadao.nome}.\n\n` +
      `Detectamos várias tentativas de acesso malsucedidas à sua conta no Portal do Cidadão. ` +
      `Por segurança, o acesso foi bloqueado temporariamente por ${minutos} minutos.\n\n` +
      `Se você não reconhece estas tentativas, redefina sua senha assim que o acesso for restabelecido.`,
  });
}
