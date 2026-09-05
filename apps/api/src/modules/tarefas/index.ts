/**
 * Barrel do módulo de Tarefas (Organizador de Tarefas da Equipe — Req. 27).
 * Reexporta o router e a superfície pública do serviço.
 */
export { tarefasRouter, default } from './tarefas.router.js';
export * from './tarefas.service.js';
