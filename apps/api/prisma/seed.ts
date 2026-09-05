/**
 * Script de SEED do Prisma para o backend `apps/api`.
 *
 * Objetivo: popular o banco com DADOS DE DEMONSTRAÇÃO completos para que seja
 * possível explorar TODAS as telas (portal do cidadão e painel administrativo)
 * com dados reais, sem telas vazias.
 *
 * Observações importantes:
 *  - O login do Servidor é feito por CPF + senha (ver `auth.servidor.service.ts`).
 *    O admin criado aqui loga com o CPF '00000000000' e a senha 'Admin@123'.
 *  - Definimos `senhaTemporaria: false` para permitir login liso em dev, sem o
 *    fluxo obrigatório de troca de senha (o login retorna `mustChangePassword`
 *    a partir de `senhaTemporaria`).
 *  - NÃO importamos `./config/env.ts` de propósito: ele valida muitas variáveis
 *    de ambiente via Zod que podem não estar setadas ao rodar o seed. O Prisma
 *    Client lê `DATABASE_URL` sozinho do ambiente, mantendo o seed autossuficiente.
 *  - Usamos LITERAIS de string/Int para os enums de `@auditar/shared`, evitando
 *    problemas de import ESM no contexto do tsx. Cada literal traz o comentário
 *    com o enum de origem.
 *
 * Idempotência: se já existir QUALQUER Servidor administrador (nivelAcesso === 1),
 * o seed loga "Seed já aplicado, ignorando." e encerra sem criar nada.
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// -----------------------------------------------------------------------------
// Constantes de enums (literais de @auditar/shared, usados como valores diretos)
// -----------------------------------------------------------------------------

/** NivelAcesso.ADMINISTRADOR = 1 (Int) */
const NIVEL_ADMINISTRADOR = 1;
/** NivelAcesso.ANALISTA = 5 (Int) */
const NIVEL_ANALISTA = 5;

/** Custo do bcrypt usado no projeto (env.BCRYPT_ROUNDS default = 12). */
const BCRYPT_ROUNDS = 12;

/**
 * Permissao (string) — de @auditar/shared. Conjunto que permite ao analista
 * tramitar processos de ponta a ponta.
 */
const PERMISSOES_ANALISTA = [
  'visualizar',
  'editar',
  'mover_etapa',
  'solicitar_documentos',
  'observacao_publica',
  'observacao_interna',
  'aprovar',
  'rejeitar',
  'atribuir',
] as const;

async function main(): Promise<void> {
  // ---------------------------------------------------------------------------
  // Guard de idempotência: se já existir um Administrador, não faz nada.
  // ---------------------------------------------------------------------------
  const adminExistente = await prisma.servidor.findFirst({
    where: { nivelAcesso: NIVEL_ADMINISTRADOR },
    select: { id: true },
  });

  if (adminExistente) {
    console.log('Seed já aplicado, ignorando.');
    return;
  }

  // Helpers de data para os prazos dos processos.
  const hoje = new Date();
  const addDias = (d: number): Date =>
    new Date(hoje.getTime() + d * 24 * 60 * 60 * 1000);

  // ---------------------------------------------------------------------------
  // 1. UNIDADES
  // ---------------------------------------------------------------------------
  // Reaproveita a "Prefeitura Municipal" se já existir (compatibilidade com
  // execuções anteriores parciais); caso contrário, cria.
  let prefeitura = await prisma.unidade.findFirst({
    where: { nome: 'Prefeitura Municipal' },
    select: { id: true },
  });

  if (!prefeitura) {
    prefeitura = await prisma.unidade.create({
      data: {
        nome: 'Prefeitura Municipal',
        secretaria: 'Administração Geral',
      },
      select: { id: true },
    });
    console.log('Unidade "Prefeitura Municipal" criada.');
  } else {
    console.log('Unidade "Prefeitura Municipal" já existente, reaproveitando.');
  }

  const secretariaObras = await prisma.unidade.create({
    data: {
      nome: 'Secretaria de Obras',
      secretaria: 'Obras e Infraestrutura',
    },
    select: { id: true },
  });
  console.log('Unidade "Secretaria de Obras" criada.');

  // ---------------------------------------------------------------------------
  // 2. CATEGORIAS
  // ---------------------------------------------------------------------------
  const categoriaLicencas = await prisma.categoria.create({
    data: {
      nome: 'Licenças',
      icone: 'file',
      cor: '#2563eb',
      ativa: true,
    },
    select: { id: true },
  });

  const categoriaObras = await prisma.categoria.create({
    data: {
      nome: 'Obras',
      icone: 'building',
      cor: '#16a34a',
      ativa: true,
    },
    select: { id: true },
  });
  console.log('Categorias "Licenças" e "Obras" criadas.');

  // ---------------------------------------------------------------------------
  // 3. SERVIDORES (admin primeiro, pois é o criadoPorId de fluxo/formulário)
  // ---------------------------------------------------------------------------
  const senhaHashAdmin = await bcrypt.hash('Admin@123', BCRYPT_ROUNDS);
  const admin = await prisma.servidor.create({
    data: {
      nome: 'Administrador',
      cpf: '00000000000', // 11 dígitos, apenas números
      email: 'admin@auditar.local',
      senhaHash: senhaHashAdmin,
      nivelAcesso: NIVEL_ADMINISTRADOR,
      senhaTemporaria: false, // login liso em dev
      ativo: true,
      unidadeId: prefeitura.id,
    },
    select: { id: true },
  });
  console.log('Servidor Administrador criado (CPF 00000000000).');

  const senhaHashAnalista = await bcrypt.hash('Analista@123', BCRYPT_ROUNDS);
  const analista = await prisma.servidor.create({
    data: {
      nome: 'Ana Analista',
      cpf: '11111111111',
      email: 'ana@auditar.local',
      senhaHash: senhaHashAnalista,
      nivelAcesso: NIVEL_ANALISTA, // NivelAcesso.ANALISTA = 5
      senhaTemporaria: false,
      ativo: true,
      unidadeId: secretariaObras.id,
    },
    select: { id: true },
  });
  console.log('Servidor Analista "Ana Analista" criado (CPF 11111111111).');

  // Concede as permissões que permitem à analista tramitar processos.
  await prisma.permissaoServidor.createMany({
    data: PERMISSOES_ANALISTA.map((permissao) => ({
      servidorId: analista.id,
      permissao,
      concedida: true,
    })),
  });
  console.log(`Permissões concedidas à analista: ${PERMISSOES_ANALISTA.join(', ')}.`);

  // ---------------------------------------------------------------------------
  // 4. FLUXO padrão + ETAPAS (Triagem -> Análise -> Decisão)
  // ---------------------------------------------------------------------------
  const fluxo = await prisma.fluxo.create({
    data: {
      nome: 'Fluxo Padrão',
      versao: 1,
      criadoPorId: admin.id,
    },
    select: { id: true },
  });

  const etapaTriagem = await prisma.etapa.create({
    data: { nome: 'Triagem', prazosDiasUteis: 2, ordem: 1, fluxoId: fluxo.id },
    select: { id: true },
  });
  const etapaAnalise = await prisma.etapa.create({
    data: { nome: 'Análise', prazosDiasUteis: 5, ordem: 2, fluxoId: fluxo.id },
    select: { id: true },
  });
  const etapaDecisao = await prisma.etapa.create({
    data: { nome: 'Decisão', prazosDiasUteis: 3, ordem: 3, fluxoId: fluxo.id },
    select: { id: true },
  });
  console.log('Fluxo "Fluxo Padrão" criado com etapas Triagem, Análise e Decisão.');

  // ---------------------------------------------------------------------------
  // 5. TIPOS DE PROCESSO
  // ---------------------------------------------------------------------------
  const tipoAlvara = await prisma.tipoProcesso.create({
    data: {
      nome: 'Alvará de Funcionamento',
      prazoTotalDiasUteis: 10,
      categoriaId: categoriaLicencas.id,
      fluxoId: fluxo.id,
      ativo: true,
    },
    select: { id: true },
  });

  const tipoLicencaConstrucao = await prisma.tipoProcesso.create({
    data: {
      nome: 'Licença de Construção',
      prazoTotalDiasUteis: 15,
      categoriaId: categoriaObras.id,
      fluxoId: fluxo.id,
      ativo: true,
    },
    select: { id: true },
  });
  console.log('Tipos de processo "Alvará de Funcionamento" e "Licença de Construção" criados.');

  // ---------------------------------------------------------------------------
  // 6. TipoProcessoUnidade (associa tipos às unidades — necessário para o
  //    formulário público e para a criação de processos)
  // ---------------------------------------------------------------------------
  await prisma.tipoProcessoUnidade.createMany({
    data: [
      // Ambos os tipos disponíveis na Secretaria de Obras.
      { tipoProcessoId: tipoAlvara.id, unidadeId: secretariaObras.id },
      { tipoProcessoId: tipoLicencaConstrucao.id, unidadeId: secretariaObras.id },
      // Também disponibilizados na Prefeitura Municipal.
      { tipoProcessoId: tipoAlvara.id, unidadeId: prefeitura.id },
      { tipoProcessoId: tipoLicencaConstrucao.id, unidadeId: prefeitura.id },
    ],
  });
  console.log('Associações Tipo x Unidade criadas.');

  // ---------------------------------------------------------------------------
  // 7. FORMULÁRIO DINÂMICO para "Alvará de Funcionamento" na Secretaria de Obras
  // ---------------------------------------------------------------------------
  const formulario = await prisma.formularioDinamico.create({
    data: {
      tipoProcessoId: tipoAlvara.id,
      unidadeId: secretariaObras.id,
      criadoPorId: admin.id,
      ativo: true,
    },
    select: { id: true },
  });

  await prisma.campoFormulario.createMany({
    data: [
      {
        formularioId: formulario.id,
        tipo: 'texto_curto', // TipoCampo.texto_curto
        rotulo: 'Nome do Estabelecimento',
        obrigatorio: true,
        ordem: 1,
      },
      {
        formularioId: formulario.id,
        tipo: 'texto_longo', // TipoCampo.texto_longo
        rotulo: 'Descrição da Atividade',
        obrigatorio: true,
        ordem: 2,
      },
      {
        formularioId: formulario.id,
        tipo: 'numero', // TipoCampo.numero
        rotulo: 'Área (m²)',
        obrigatorio: false,
        ordem: 3,
      },
    ],
  });
  console.log('Formulário dinâmico do "Alvará de Funcionamento" criado com 3 campos.');

  // ---------------------------------------------------------------------------
  // 8. CIDADÃO de teste (ativado, pronto para login)
  // ---------------------------------------------------------------------------
  const senhaHashCidadao = await bcrypt.hash('Cidadao@123', BCRYPT_ROUNDS);
  const joao = await prisma.cidadao.create({
    data: {
      nome: 'João Cidadão',
      cpf: '22222222222',
      email: 'joao@auditar.local',
      telefone: '11999990000',
      logradouro: 'Rua das Flores',
      numero: '100',
      cep: '01001000',
      cidade: 'São Paulo',
      estado: 'SP',
      senhaHash: senhaHashCidadao,
      ativo: true,
      emailConfirmado: true,
    },
    select: { id: true },
  });
  console.log('Cidadão de teste "João Cidadão" criado (CPF 22222222222).');

  // ---------------------------------------------------------------------------
  // 9. PROCESSOS de exemplo (do João, na Secretaria de Obras, tipo Alvará)
  // ---------------------------------------------------------------------------

  // Processo 2026-00001 — em andamento, na etapa "Análise", responsável Ana.
  const processo1 = await prisma.processo.create({
    data: {
      protocolo: '2026-00001',
      status: 'em_andamento', // StatusProcesso.em_andamento
      cidadaoId: joao.id,
      tipoProcessoId: tipoAlvara.id,
      unidadeId: secretariaObras.id,
      fluxoVersaoId: fluxo.id,
      servidorResponsavelId: analista.id,
      etapaAtualId: etapaAnalise.id,
      prazoFinal: addDias(10),
    },
    select: { id: true },
  });

  // Movimentações do processo 1 (autor: Ana).
  await prisma.movimentacaoProcesso.create({
    data: {
      processoId: processo1.id,
      servidorId: analista.id,
      etapaDestinoId: etapaTriagem.id,
      observacao: 'Processo recebido',
      tipoObservacao: 'publica',
    },
  });
  await prisma.movimentacaoProcesso.create({
    data: {
      processoId: processo1.id,
      servidorId: analista.id,
      etapaOrigemId: etapaTriagem.id,
      etapaDestinoId: etapaAnalise.id,
      observacao: 'Documentação conferida',
      tipoObservacao: 'publica',
    },
  });

  // Mensagens do processo 1.
  await prisma.mensagem.create({
    data: {
      processoId: processo1.id,
      canal: 'publico',
      conteudo: 'Gostaria de saber o andamento.',
      remetenteCidadaoId: joao.id,
    },
  });
  await prisma.mensagem.create({
    data: {
      processoId: processo1.id,
      canal: 'publico',
      conteudo: 'Seu processo está em análise.',
      remetenteServidorId: analista.id,
    },
  });
  await prisma.mensagem.create({
    data: {
      processoId: processo1.id,
      canal: 'interno',
      conteudo: 'Verificar planta anexa.',
      remetenteServidorId: analista.id,
    },
  });
  console.log('Processo 2026-00001 (em andamento) criado com movimentações e mensagens.');

  // Processo 2026-00002 — aprovado, na etapa "Decisão", responsável Ana.
  const processo2 = await prisma.processo.create({
    data: {
      protocolo: '2026-00002',
      status: 'aprovado', // StatusProcesso.aprovado
      cidadaoId: joao.id,
      tipoProcessoId: tipoAlvara.id,
      unidadeId: secretariaObras.id,
      fluxoVersaoId: fluxo.id,
      servidorResponsavelId: analista.id,
      etapaAtualId: etapaDecisao.id,
      prazoFinal: addDias(3),
    },
    select: { id: true },
  });
  await prisma.movimentacaoProcesso.create({
    data: {
      processoId: processo2.id,
      servidorId: analista.id,
      etapaOrigemId: etapaAnalise.id,
      etapaDestinoId: etapaDecisao.id,
      observacao: 'Solicitação aprovada',
      tipoObservacao: 'publica',
    },
  });
  console.log('Processo 2026-00002 (aprovado) criado com movimentação de aprovação.');

  // Processo 2026-00003 — aberto, na fila (sem responsável), etapa "Triagem".
  await prisma.processo.create({
    data: {
      protocolo: '2026-00003',
      status: 'aberto', // StatusProcesso.aberto
      cidadaoId: joao.id,
      tipoProcessoId: tipoAlvara.id,
      unidadeId: secretariaObras.id,
      fluxoVersaoId: fluxo.id,
      etapaAtualId: etapaTriagem.id,
      prazoFinal: addDias(10),
    },
  });
  console.log('Processo 2026-00003 (aberto, na fila) criado.');

  // ---------------------------------------------------------------------------
  // Resumo final com quadro de credenciais.
  // ---------------------------------------------------------------------------
  console.log('');
  console.log('=== DADOS DE DEMONSTRAÇÃO CRIADOS ===');
  console.log('ADMIN    → CPF 00000000000 | senha Admin@123 | /admin/login');
  console.log('ANALISTA → CPF 11111111111 | senha Analista@123 | /admin/login');
  console.log('CIDADÃO  → CPF 22222222222 | senha Cidadao@123 | /login');
  console.log('Processos de exemplo: 2026-00001, 2026-00002, 2026-00003');
  console.log('(Credenciais apenas para desenvolvimento.)');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
