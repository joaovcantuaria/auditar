import { Router } from 'express';
import { authenticate, requireServidor } from '../../middleware/auth.js';
import {
  postLoginServidor,
  postLogoutServidor,
  postTrocarSenha,
} from './auth.servidor.controller.js';

/**
 * Rotas de autenticação de Servidores.
 * Montado sob `/api/v1/auth/servidor` pelo agregador de rotas.
 *
 *   POST /login          — público
 *   POST /logout         — autenticado (servidor)
 *   POST /trocar-senha   — autenticado (servidor)
 *
 * Requisitos: 8.1, 8.3, 8.5, 8.7, 8.8, 21.3
 */
export const authServidorRouter = Router();

authServidorRouter.post('/login', postLoginServidor);
authServidorRouter.post('/logout', authenticate, requireServidor, postLogoutServidor);
authServidorRouter.post('/trocar-senha', authenticate, requireServidor, postTrocarSenha);

export default authServidorRouter;
