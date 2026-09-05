// Barrel export do módulo de autenticação.
// Task 3.1: cadastro e ativação de conta do Cidadão.
export * from './auth.cidadao.schema.js';
export * from './auth.cidadao.service.js';
export * from './auth.cidadao.login.service.js';
export * from './auth.cidadao.email.js';
export { cidadaoAuthRouter } from './auth.cidadao.router.js';

// Task 3.5: autenticação de dois fatores (2FA) do Cidadão.
export * from './auth.2fa.service.js';
export * from './auth.2fa.notify.js';

// Task 3.7: autenticação do Servidor (login/logout/troca de senha).
export * from './auth.servidor.schema.js';
export * from './auth.servidor.service.js';
export { authServidorRouter } from './auth.servidor.router.js';

export { authRouter } from './auth.router.js';
