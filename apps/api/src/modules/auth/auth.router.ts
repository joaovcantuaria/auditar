import { Router } from 'express';
import { cidadaoAuthRouter } from './auth.cidadao.router.js';
import { authServidorRouter } from './auth.servidor.router.js';

/**
 * Agregador de rotas de autenticação. Montado em `/api/v1/auth`.
 *
 * Contém as rotas do Cidadão (cadastro/ativação/login — tasks 3.1/3.3) e do
 * Servidor (login/logout/troca de senha — task 3.7).
 */
export const authRouter: Router = Router();

authRouter.use('/cidadao', cidadaoAuthRouter);
authRouter.use('/servidor', authServidorRouter);
