# Requirements Document

## Introduction

O **Auditar** é uma plataforma integrada de gestão de processos administrativos municipais destinada a prefeituras. O sistema centraliza toda a tramitação de processos entre a administração pública e a população, eliminando processos físicos em papel e oferecendo transparência total ao cidadão. A plataforma é composta por dois módulos principais: o **Portal do Cidadão** (acesso público) e o **Painel Administrativo** (acesso restrito a servidores municipais). O sistema garante rastreabilidade completa de todas as ações, padroniza fluxos entre secretarias e gera métricas para melhoria contínua da eficiência pública.

---

## Glossary

- **Auditar**: Nome do sistema de gestão de processos administrativos municipais descrito neste documento.
- **Portal_do_Cidadão**: Módulo público do sistema, acessível via navegador por qualquer cidadão.
- **Painel_Administrativo**: Módulo restrito a servidores municipais para gestão e tramitação de processos.
- **Cidadão**: Pessoa física que utiliza o Portal_do_Cidadão para abrir e acompanhar processos.
- **Servidor**: Funcionário público municipal que utiliza o Painel_Administrativo.
- **Processo**: Solicitação administrativa aberta por um Cidadão ou Servidor em nome de um Cidadão, com número de protocolo único, tramitação definida e prazo.
- **Protocolo**: Identificador único de um Processo no formato `AAAA-NNNNN` (ano com 4 dígitos, hífen, sequencial com 5 dígitos).
- **Categoria**: Agrupamento temático de tipos de processos (ex.: Saúde, Educação, Infraestrutura).
- **Tipo_de_Processo**: Classificação específica dentro de uma Categoria, com formulário, fluxo de etapas, documentos e prazos próprios.
- **Unidade**: Departamento ou secretaria municipal responsável por processar determinado tipo de processo.
- **Etapa**: Fase individual dentro do fluxo de tramitação de um Tipo_de_Processo, com prazo, responsável e condições de avanço.
- **Fluxo**: Sequência ordenada de Etapas definida para um Tipo_de_Processo.
- **Analista**: Servidor com nível de acesso 5, responsável por processar Processos atribuídos.
- **Inspetor**: Servidor com nível de acesso 6, com acesso restrito a inspeções e pareceres técnicos.
- **Gestor_de_Unidade**: Servidor com nível de acesso 4, que gerencia uma Unidade específica.
- **Gestor_de_Categoria**: Servidor com nível de acesso 3, que gerencia uma Categoria específica.
- **Gestor_Geral**: Servidor com nível de acesso 2, com acesso a dashboards e relatórios agregados.
- **Administrador**: Servidor com nível de acesso 1, com acesso total ao sistema.
- **Visualizador**: Servidor com nível de acesso 7, com acesso somente leitura.
- **CPF**: Cadastro de Pessoa Física, identificador único de 11 dígitos do cidadão brasileiro.
- **2FA**: Autenticação de dois fatores, mecanismo adicional de segurança no login.
- **LGPD**: Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018).
- **Notificação**: Mensagem automática enviada ao Cidadão ou Servidor sobre eventos relevantes de um Processo.
- **Dashboard**: Painel visual com indicadores e métricas de desempenho.
- **Formulário_Dinâmico**: Conjunto de campos personalizados configurados por Tipo_de_Processo e Unidade.
- **Módulo_de_Auditoria**: Componente do sistema responsável por registrar e disponibilizar o histórico completo de todas as ações realizadas.
- **Fila_Geral**: Mecanismo de atribuição onde qualquer Servidor da Unidade pode assumir um Processo não atribuído.
- **Atribuição_Automática**: Mecanismo que distribui Processos ao Servidor disponível com menor carga de trabalho na Unidade.
- **Permissão_Granular**: Autorização individual concedida a um Servidor para executar uma ação específica no sistema, independente do nível de acesso, dentre o conjunto definido no Requisito 8.6 e no Requisito 23.
- **Tarefa**: Item de trabalho interno criado por um Servidor autorizado, com título, descrição, prazo com data e horário, status e destinatários, podendo ou não estar vinculado a um Processo.
- **Atribuição_de_Tarefa**: Associação entre uma Tarefa e um Servidor destinatário, com status de acompanhamento individual próprio para cada destinatário.
- **Organizador_de_Tarefas**: Componente do Painel_Administrativo que permite criar, atribuir, acompanhar e concluir Tarefas da equipe.
- **Edição_Corretiva**: Alteração de dados previamente lançados em um Processo por um Servidor autorizado, com registro obrigatório de valor anterior e valor posterior no Módulo_de_Auditoria.
- **PDF_do_Processo**: Documento consolidado em formato PDF contendo os dados completos de um Processo, gerado sob demanda para download.
- **Painel_de_Desempenho**: Seção do Dashboard que apresenta indicadores de produtividade individual e comparativa dos Servidores da equipe.
- **Prefixo_de_Protocolo**: Sigla curta associada a uma Categoria ou Unidade, prefixada ao número de Protocolo para identificação de origem (ex.: `OBR` para Obras).

---

## Requirements

---

### Requisito 1: Cadastro de Cidadão

**User Story:** Como cidadão, quero me cadastrar no sistema com meus dados pessoais, para que eu possa abrir e acompanhar processos administrativos.

#### Critérios de Aceitação

1. THE Portal_do_Cidadão SHALL exigir os seguintes campos obrigatórios no cadastro: nome completo (máximo 150 caracteres), CPF (11 dígitos numéricos), email (máximo 254 caracteres, formato local@domínio), telefone (entre 10 e 11 dígitos numéricos) e endereço completo (logradouro com máximo 200 caracteres, número, CEP com 8 dígitos numéricos, cidade e estado).
2. WHEN o Cidadão submete o formulário de cadastro, THE Portal_do_Cidadão SHALL validar o formato e os dígitos verificadores do CPF informado antes de prosseguir.
3. IF o CPF informado já estiver associado a uma conta existente, THEN THE Portal_do_Cidadão SHALL exibir mensagem de erro indicando duplicidade de CPF e impedir a criação da nova conta, mantendo os demais dados preenchidos no formulário.
4. IF o formulário de cadastro for submetido com algum campo obrigatório ausente ou com formato inválido, THEN THE Portal_do_Cidadão SHALL indicar cada campo inválido individualmente e impedir o prosseguimento do cadastro.
5. WHEN o cadastro é submetido com todos os dados válidos, THE Portal_do_Cidadão SHALL enviar um email de confirmação contendo um link de ativação de uso único para o endereço informado, em até 60 segundos após a submissão.
6. WHEN o Cidadão acessa o link de ativação dentro do prazo de validade, THE Portal_do_Cidadão SHALL ativar a conta e redirecionar o Cidadão para a tela de login.
7. IF o link de ativação não for acessado dentro de 48 horas após o envio, THEN THE Portal_do_Cidadão SHALL invalidar o link e exibir mensagem indicando a expiração com opção para reenvio de novo link de ativação.
8. IF o Cidadão solicitar o reenvio do link de ativação, THEN THE Portal_do_Cidadão SHALL invalidar o link anterior, gerar novo link de ativação e enviá-lo ao email cadastrado em até 60 segundos, limitando a no máximo 3 reenvios por período de 24 horas.
9. WHILE a conta não estiver ativada, THE Portal_do_Cidadão SHALL impedir o login do Cidadão e exibir mensagem indicando que a conta aguarda ativação por email.

---

### Requisito 2: Autenticação do Cidadão

**User Story:** Como cidadão, quero realizar login com CPF e senha, para que eu possa acessar minha conta com segurança.

#### Critérios de Aceitação

1. WHEN o Cidadão submete CPF com 11 dígitos numéricos válidos e senha com 8 a 128 caracteres, THE Portal_do_Cidadão SHALL autenticar o Cidadão e iniciar uma sessão ativa.
2. IF o Cidadão submete CPF ou senha incorretos, THEN THE Portal_do_Cidadão SHALL exibir mensagem de erro genérica sem indicar qual campo está incorreto e SHALL manter o CPF preenchido no formulário sem limpar o campo.
3. WHEN o Cidadão submete CPF ou senha incorretos pela 5ª tentativa consecutiva, THE Portal_do_Cidadão SHALL bloquear o acesso à conta por exatamente 15 minutos, impedir novas tentativas de login durante o bloqueio e enviar notificação por email ao endereço cadastrado no CPF informado.
4. IF o Cidadão tenta realizar login enquanto a conta está bloqueada, THEN THE Portal_do_Cidadão SHALL rejeitar a tentativa e exibir mensagem indicando o bloqueio temporário e o tempo restante em minutos inteiros.
5. WHERE o Cidadão habilitar a autenticação de dois fatores, WHEN o Cidadão valida CPF e senha com sucesso, THE Portal_do_Cidadão SHALL solicitar código de verificação de 6 dígitos numéricos enviado ao canal escolhido pelo Cidadão (email ou SMS) com validade de 10 minutos.
6. IF o código de verificação de dois fatores expirar ou for inválido, THEN THE Portal_do_Cidadão SHALL rejeitar a autenticação e exibir mensagem indicando o motivo da falha, sem contabilizar a tentativa no limite de bloqueio por senha incorreta.
7. WHEN o Cidadão marca a opção "Manter conectado" e conclui a autenticação com sucesso, THE Portal_do_Cidadão SHALL manter a sessão ativa por exatamente 7 dias corridos sem exigir novo login, desde que não haja encerramento manual pelo Cidadão.
8. WHILE o Cidadão estiver autenticado sem a opção "Manter conectado" ativa e não realizar nenhuma ação no Portal_do_Cidadão por 30 minutos consecutivos, THE Portal_do_Cidadão SHALL encerrar a sessão automaticamente e redirecionar o Cidadão para a tela de login.
9. WHEN a sessão for encerrada por inatividade, THE Portal_do_Cidadão SHALL exibir mensagem informando que o encerramento ocorreu por inatividade de 30 minutos antes de redirecionar para a tela de login.

---

### Requisito 3: Painel Pessoal do Cidadão

**User Story:** Como cidadão autenticado, quero visualizar um painel com resumo dos meus processos, para que eu acompanhe rapidamente o status das minhas solicitações.

#### Critérios de Aceitação

1. WHEN o Cidadão acessa o painel pessoal, THE Portal_do_Cidadão SHALL exibir os totais de Processos nas situações: abertos, em andamento e finalizados, com contagem numérica exata para cada situação.
2. WHEN o Cidadão acessa o painel pessoal, THE Portal_do_Cidadão SHALL listar os 5 Processos mais recentes ordenados por data de abertura decrescente, contendo: número de Protocolo, categoria, tipo, data de abertura no formato DD/MM/AAAA, status com indicação visual por cor conforme critério 7, e prazo com número de dias corridos restantes.
3. WHEN o Cidadão acessa o painel pessoal e possui Processos com prazo vencendo em até 3 dias úteis, THE Portal_do_Cidadão SHALL exibir alerta identificando o número de Protocolo e a data de vencimento de cada Processo afetado.
4. WHEN o Cidadão acessa o painel pessoal e possui Processos com documentos pendentes de envio pelo Cidadão, THE Portal_do_Cidadão SHALL exibir alerta identificando o número de Protocolo e a quantidade de documentos pendentes de cada Processo afetado.
5. WHEN o Cidadão acessa o painel pessoal, THE Portal_do_Cidadão SHALL disponibilizar botão de ação rápida "Novo Processo" visível sem necessidade de rolagem de tela.
6. WHEN o Cidadão acessa o histórico completo, THE Portal_do_Cidadão SHALL exibir todos os Processos do Cidadão autenticado com filtros por status, período de abertura e Categoria, apresentando no mínimo os mesmos campos listados no critério 2.
7. THE Portal_do_Cidadão SHALL representar o status de cada Processo com indicação visual por cor: verde para aprovado/finalizado, amarelo para em andamento, vermelho para vencido ou rejeitado e azul para aguardando ação do Cidadão.
8. IF o Cidadão autenticado não possui nenhum Processo registrado, THEN THE Portal_do_Cidadão SHALL exibir mensagem indicando ausência de processos e manter o botão de ação rápida "Novo Processo" visível.

---

### Requisito 4: Criação de Processo pelo Cidadão

**User Story:** Como cidadão autenticado, quero abrir uma solicitação administrativa seguindo um fluxo guiado, para que eu forneça todas as informações necessárias corretamente.

#### Critérios de Aceitação

1. THE Portal_do_Cidadão SHALL conduzir a criação de um novo Processo em exatamente 6 etapas sequenciais: (1) seleção de Categoria, (2) seleção de Tipo_de_Processo, (3) seleção de Unidade, (4) preenchimento do Formulário_Dinâmico, (5) anexação de documentos e (6) revisão e confirmação.
2. WHEN o Cidadão seleciona uma Categoria, THE Portal_do_Cidadão SHALL exibir apenas os Tipos_de_Processo disponíveis para aquela Categoria.
3. WHEN o Cidadão seleciona um Tipo_de_Processo, THE Portal_do_Cidadão SHALL exibir as Unidades disponíveis com nome, endereço, telefone e horário de funcionamento.
4. WHEN o Cidadão seleciona uma Unidade, THE Portal_do_Cidadão SHALL carregar o Formulário_Dinâmico configurado para aquele Tipo_de_Processo e Unidade.
5. THE Portal_do_Cidadão SHALL permitir a anexação de documentos nos formatos PDF, JPG, PNG, DOC e DOCX, com tamanho máximo de 10 MB por arquivo, 50 MB no total por Processo e no máximo 20 arquivos por Processo.
6. IF o Cidadão tentar avançar sem preencher um campo obrigatório do Formulário_Dinâmico, THEN THE Portal_do_Cidadão SHALL exibir mensagem de erro identificando cada campo pendente e impedir o avanço.
7. IF o Cidadão tentar anexar um arquivo em formato não permitido, excedente ao limite por arquivo ou que ultrapasse o limite total ou de quantidade, THEN THE Portal_do_Cidadão SHALL exibir mensagem de erro descritiva indicando o motivo, rejeitar o arquivo e preservar os arquivos já anexados.
8. WHEN o Cidadão confirma a submissão na etapa 6, THE Portal_do_Cidadão SHALL gerar um número de Protocolo único e exibi-lo ao Cidadão em até 5 segundos.
8a. THE Auditar SHALL gerar o número de Protocolo no formato `[PREFIXO-]AAAA-NNNNN`, onde `PREFIXO` é o Prefixo_de_Protocolo opcional de 2 a 5 letras maiúsculas associado à Unidade ou Categoria do Processo, `AAAA` é o ano com 4 dígitos e `NNNNN` é o sequencial com no mínimo 5 dígitos, mantendo a sequência independente por ano e, quando houver Prefixo_de_Protocolo configurado, por Prefixo_de_Protocolo.
8b. THE Auditar SHALL garantir que nenhum par de Processos distintos compartilhe o mesmo número de Protocolo, mesmo sob criação simultânea de múltiplos Processos.
8c. WHERE nenhum Prefixo_de_Protocolo estiver configurado para a Unidade ou Categoria do Processo, THE Auditar SHALL gerar o Protocolo no formato `AAAA-NNNNN`, preservando a compatibilidade com os Processos já existentes.
9. WHEN o Processo é criado com sucesso, THE Portal_do_Cidadão SHALL enviar Notificação ao Cidadão com o número de Protocolo gerado pelo canal de notificação cadastrado.
10. THE Portal_do_Cidadão SHALL permitir que o Cidadão navegue entre as etapas anteriores sem perder os dados já preenchidos.
11. IF a submissão do Processo falhar após a confirmação, THEN THE Portal_do_Cidadão SHALL exibir mensagem de erro, preservar todos os dados preenchidos e permitir nova tentativa de envio.
12. IF na etapa 1 não houver nenhuma Categoria disponível, THEN THE Portal_do_Cidadão SHALL exibir mensagem informando a indisponibilidade temporária e impedir o avanço no fluxo.
13. IF na etapa 3 não houver nenhuma Unidade disponível para o Tipo_de_Processo selecionado, THEN THE Portal_do_Cidadão SHALL exibir mensagem informando a indisponibilidade e orientar o Cidadão a contatar a prefeitura.

---

### Requisito 5: Acompanhamento de Processo pelo Cidadão

**User Story:** Como cidadão, quero acompanhar em tempo real o andamento do meu processo, para que eu saiba exatamente em qual etapa ele está e quais ações são necessárias da minha parte.

#### Critérios de Aceitação

1. WHEN o Cidadão acessa um Processo, THE Portal_do_Cidadão SHALL exibir as seguintes abas: Informações, Histórico, Documentos, Comunicação e Prazos.
2. WHEN o Cidadão acessa a aba Informações, THE Portal_do_Cidadão SHALL exibir número de Protocolo, Categoria, Tipo_de_Processo, Unidade responsável, data de abertura, status atual e dados do formulário submetido, com cada campo identificado por rótulo.
3. WHEN o Cidadão acessa a aba Histórico, THE Portal_do_Cidadão SHALL exibir a cronologia de todas as movimentações do Processo em ordem cronológica crescente, contendo data, hora e identificação do responsável por cada ação.
4. WHEN o Cidadão acessa a aba Documentos, THE Portal_do_Cidadão SHALL exibir a lista de todos os arquivos anexados ao Processo, indicando nome do arquivo e data de anexação, com opção de download individual para cada arquivo.
5. WHEN o Cidadão acessa a aba Comunicação, THE Portal_do_Cidadão SHALL exibir todas as mensagens trocadas entre o Cidadão e os Servidores em ordem cronológica crescente, identificando remetente, data e hora de cada mensagem.
6. WHEN o Cidadão envia uma mensagem na aba Comunicação, THE Portal_do_Cidadão SHALL registrar a mensagem com data, hora e identificação do remetente, exibi-la imediatamente na conversa, e notificar o Servidor responsável pelo Processo em até 60 segundos.
7. IF o Cidadão envia uma mensagem na aba Comunicação e o envio falha, THEN THE Portal_do_Cidadão SHALL exibir uma mensagem de erro indicando a falha no envio e preservar o texto digitado pelo Cidadão no campo de entrada.
8. WHEN o Cidadão acessa a aba Prazos, THE Portal_do_Cidadão SHALL exibir um calendário visual com as datas de cada Etapa do Processo, codificadas por cor: verde para prazo cumprido, amarelo para prazo com vencimento em até 3 dias corridos, e vermelho para prazo vencido.
9. WHEN o status de um Processo é atualizado por um Servidor, THE Portal_do_Cidadão SHALL refletir a mudança para o Cidadão em até 5 segundos, sem necessidade de recarregar a página.
10. IF o Cidadão acessa um Processo ao qual não está associado, THEN THE Portal_do_Cidadão SHALL negar o acesso e exibir uma mensagem de erro indicando que o Processo não foi encontrado ou não está disponível para o Cidadão autenticado.

---

### Requisito 6: Notificações ao Cidadão

**User Story:** Como cidadão, quero receber notificações sobre o andamento dos meus processos, para que eu me mantenha informado sem precisar acessar o sistema continuamente.

#### Critérios de Aceitação

1. WHEN um dos seguintes eventos ocorrer — criação de Processo, movimentação de Etapa, solicitação de documentos adicionais, aprovação, rejeição, recebimento de mensagem ou vencimento de prazo —, THE Portal_do_Cidadão SHALL gerar uma Notificação ao Cidadão responsável pelo Processo em até 60 segundos após o evento.
2. THE Portal_do_Cidadão SHALL suportar os seguintes canais de Notificação: email, SMS, notificação no painel e push notification (aplicativo móvel).
3. WHEN o Cidadão acessa as configurações de conta, THE Portal_do_Cidadão SHALL permitir que o Cidadão selecione, para cada tipo de evento listado no critério 1, um ou mais canais de Notificação dentre os disponíveis no critério 2, e persista a preferência em até 5 segundos após a confirmação.
4. WHERE o Cidadão configurar horários de silêncio, THE Portal_do_Cidadão SHALL reter as Notificações geradas durante esse período e entregá-las ao canal preferido do Cidadão em até 60 segundos após o término do horário de silêncio configurado.
5. IF o envio de Notificação por SMS ou email falhar após 3 tentativas com intervalo mínimo de 30 segundos entre elas, THEN THE Portal_do_Cidadão SHALL registrar a falha com indicação do canal, tipo de evento e timestamp, e exibir a Notificação no painel do sistema como canal de fallback em até 60 segundos após a última tentativa.
6. WHEN uma Etapa que requer ação do Cidadão apresentar prazo de vencimento com 3 dias úteis ou menos de antecedência, THE Portal_do_Cidadão SHALL enviar uma Notificação de alerta de prazo ao Cidadão pelo canal preferido configurado para o evento de vencimento de prazo, em até 60 segundos após atingir esse limiar.
7. IF o Cidadão não possuir canal de Notificação configurado para um determinado tipo de evento, THEN THE Portal_do_Cidadão SHALL entregar a Notificação desse evento exclusivamente no painel do sistema.

---

### Requisito 7: Gerenciamento de Conta do Cidadão

**User Story:** Como cidadão autenticado, quero gerenciar minha conta e meus dados pessoais, para que eu mantenha minhas informações atualizadas e exerça meus direitos conforme a LGPD.

#### Critérios de Aceitação

1. WHEN o Cidadão acessa as configurações de conta, THE Portal_do_Cidadão SHALL permitir a edição de nome completo (máximo 150 caracteres), email (máximo 254 caracteres, formato válido), telefone (10 ou 11 dígitos numéricos), endereço (logradouro com máximo 200 caracteres, CEP com 8 dígitos numéricos) e senha.
2. WHEN o Cidadão altera o email, THE Portal_do_Cidadão SHALL enviar link de confirmação para o novo endereço com validade de 24 horas e manter o email anterior ativo até a confirmação.
3. WHEN o Cidadão altera a senha, THE Portal_do_Cidadão SHALL exigir a senha atual e aceitar a nova senha somente se ela tiver entre 8 e 64 caracteres.
4. IF o Cidadão informa a senha atual incorretamente ao tentar alterar a senha, THEN THE Portal_do_Cidadão SHALL rejeitar a alteração e exibir mensagem de erro sem revelar a senha atual.
5. THE Portal_do_Cidadão SHALL exibir o histórico dos últimos 10 acessos do Cidadão em ordem cronológica decrescente, contendo data, hora e endereço IP de cada acesso.
6. WHEN o Cidadão solicita a exclusão da conta, THE Portal_do_Cidadão SHALL exibir os impactos da exclusão, solicitar confirmação e registrar a solicitação para processamento em até 15 dias úteis, conforme a LGPD.
7. IF existirem Processos em andamento no momento da solicitação de exclusão de conta, THEN THE Portal_do_Cidadão SHALL exibir a lista desses Processos — com número de Protocolo e tipo de Processo — e exigir confirmação explícita antes de registrar a solicitação.
8. IF o link de confirmação de alteração de email não for acessado dentro de 24 horas, THEN THE Portal_do_Cidadão SHALL invalidar o link e manter o email anterior como ativo, exibindo indicação de que a alteração foi cancelada por expiração.

---

### Requisito 8: Autenticação e Controle de Acesso de Servidores

**User Story:** Como servidor municipal, quero acessar o Painel_Administrativo com credenciais seguras, para que eu possa realizar minhas funções com as permissões adequadas ao meu nível de acesso.

#### Critérios de Aceitação

1. THE Painel_Administrativo SHALL autenticar Servidores mediante CPF com 11 dígitos numéricos válidos e senha com mínimo de 8 caracteres fornecidos pelo Administrador no momento do cadastro.
2. THE Painel_Administrativo SHALL reconhecer os seguintes 7 níveis de acesso: Administrador (1), Gestor_Geral (2), Gestor_de_Categoria (3), Gestor_de_Unidade (4), Analista (5), Inspetor (6) e Visualizador (7).
3. WHEN o Servidor realiza login com sucesso, THE Painel_Administrativo SHALL carregar a interface e as permissões correspondentes ao nível de acesso daquele Servidor em até 3 segundos.
4. IF um Servidor tenta acessar uma funcionalidade não autorizada para o seu nível de acesso, THEN THE Painel_Administrativo SHALL bloquear a ação e retornar mensagem de acesso negado sem revelar detalhes da funcionalidade restrita.
5. WHEN o Servidor informa credenciais incorretas por 5 tentativas consecutivas, THE Painel_Administrativo SHALL bloquear o acesso por 30 minutos e notificar o Administrador com a identificação do Servidor e o horário do bloqueio.
6. THE Painel_Administrativo SHALL permitir que o Administrador configure permissões granulares individualmente por Servidor, incluindo: visualizar, editar, mover etapa, rejeitar, solicitar documentos, registrar observações públicas, registrar observações internas, acessar relatórios, gerenciar usuários, configurar fluxos, acessar auditoria, atribuir e aprovar.
7. WHILE o Servidor estiver inativo por 60 minutos consecutivos, THE Painel_Administrativo SHALL encerrar a sessão automaticamente e invalidar o token de sessão.
8. IF o CPF informado no login não corresponder a nenhum Servidor cadastrado, THEN THE Painel_Administrativo SHALL exibir a mesma mensagem de erro genérica utilizada para credenciais incorretas, sem indicar que o CPF não existe.
9. WHEN o Administrador configura permissões granulares de um Servidor, THE Painel_Administrativo SHALL registrar no Módulo_de_Auditoria a identidade do Administrador, a identidade do Servidor afetado, as permissões alteradas com valores anterior e posterior, e a data e hora da alteração.

---

### Requisito 9: Dashboard Administrativo por Perfil

**User Story:** Como servidor municipal, quero visualizar um dashboard com indicadores relevantes ao meu perfil, para que eu tome decisões baseadas em dados atualizados.

#### Critérios de Aceitação

1. WHEN um Analista acessa o Dashboard, THE Painel_Administrativo SHALL exibir os Processos atribuídos ao Analista agrupados por status, os Processos com prazo de vencimento dentro das próximas 24 horas, o tempo médio de resolução do Analista em horas calculado sobre os últimos 30 dias, e o gráfico de produtividade diária dos últimos 30 dias.
2. WHEN um Gestor_de_Unidade acessa o Dashboard, THE Painel_Administrativo SHALL exibir o total de Processos agrupados por status na Unidade, a contagem de Processos atribuídos por Servidor ativo na Unidade, a taxa percentual de aprovação e a taxa percentual de rejeição da Unidade calculadas sobre os Processos concluídos nos últimos 30 dias, e o gráfico de volume de Processos abertos por dia nos últimos 30 dias.
3. WHEN um Gestor_de_Categoria acessa o Dashboard, THE Painel_Administrativo SHALL exibir o total de Processos por status agrupados por Unidade dentro da Categoria, o tempo médio de resolução em horas por Tipo_de_Processo calculado sobre os últimos 30 dias, e a comparação percentual da taxa de aprovação e do tempo médio de resolução entre as Unidades da Categoria.
4. WHEN um Gestor_Geral acessa o Dashboard, THE Painel_Administrativo SHALL exibir o total de Processos por status agrupado por Categoria, o volume total de Processos abertos por semana nos últimos 90 dias, e a comparação do volume total e da taxa de aprovação entre períodos de 30 dias consecutivos para todas as Categorias.
5. WHILE o Painel_Administrativo estiver aberto, THE Painel_Administrativo SHALL atualizar os dados exibidos automaticamente a cada 5 minutos sem recarregar a página, preservando a posição de rolagem e os filtros ativos no momento da atualização.
6. IF os dados de um indicador não puderem ser carregados durante a atualização automática ou o acesso inicial ao Dashboard, THEN THE Painel_Administrativo SHALL exibir uma indicação de erro no indicador afetado informando que os dados estão indisponíveis, mantendo os demais indicadores visíveis com os últimos dados carregados com sucesso.
7. WHEN um Servidor com permissão de acesso ao Dashboard o acessa, THE Painel_Administrativo SHALL exibir cards de resumo com a contagem numérica exata de Processos, respeitando o escopo de acesso do Servidor, nas seguintes situações: total, abertos, em andamento, aguardando documentos, atrasados, aprovados, finalizados e rejeitados.
8. WHEN um Servidor com permissão de acesso ao Dashboard o acessa, THE Painel_Administrativo SHALL exibir um indicador de prazos contendo a quantidade e a identificação dos Processos com prazo vencendo nos próximos 3 dias úteis e a quantidade e a identificação dos Processos com prazo vencido, respeitando o escopo de acesso do Servidor.
9. WHEN um Gestor_de_Unidade, Gestor_de_Categoria, Gestor_Geral ou Administrador acessa o Dashboard, THE Painel_Administrativo SHALL exibir um Painel_de_Desempenho que apresenta, para cada Servidor dentro do escopo de acesso, no período selecionado: número de Processos atribuídos, número de Processos em andamento, número de Processos concluídos, número de Processos atrasados sob sua responsabilidade, tempo médio de conclusão em horas e número de Tarefas pendentes.
10. WHEN um Servidor visualiza o Painel_de_Desempenho, THE Painel_Administrativo SHALL permitir a comparação lado a lado dos indicadores entre os Servidores exibidos, ordenável por qualquer um dos indicadores apresentados.
11. THE Painel_Administrativo SHALL permitir filtrar os indicadores do Dashboard e do Painel_de_Desempenho por Unidade, Categoria e período, aplicando os filtros combinados e atualizando os indicadores em até 5 segundos após a aplicação.
12. IF um Gestor_de_Unidade acessa o Dashboard, THEN THE Painel_Administrativo SHALL restringir todos os indicadores, cards e o Painel_de_Desempenho exclusivamente aos Processos e Servidores da Unidade sob sua responsabilidade, enquanto o Administrador SHALL visualizar todas as Unidades e Categorias.

---

### Requisito 10: Listagem e Busca de Processos no Painel Administrativo

**User Story:** Como servidor municipal, quero pesquisar e filtrar processos de forma eficiente, para que eu localize rapidamente qualquer solicitação sem precisar navegar por listas extensas.

#### Critérios de Aceitação

1. THE Painel_Administrativo SHALL exibir Processos em lista paginada com 20 registros por página.
2. THE Painel_Administrativo SHALL permitir filtrar a listagem por: Categoria, Tipo_de_Processo, status, data de abertura (intervalo com data inicial e data final), prazo (intervalo com data inicial e data final), Servidor responsável, nome do Cidadão, CPF do Cidadão, Unidade e prioridade, suportando combinação simultânea de múltiplos filtros.
3. THE Painel_Administrativo SHALL permitir ordenar a listagem por qualquer coluna exibida, de forma crescente ou decrescente.
4. THE Painel_Administrativo SHALL exibir em cada linha da listagem: número de Protocolo, nome do Cidadão, Categoria, Tipo_de_Processo, status com cor correspondente ao status, prazo, Servidor responsável e data da última movimentação.
5. WHEN o Servidor informa um termo na busca rápida com no mínimo 3 caracteres, THE Painel_Administrativo SHALL filtrar a listagem por correspondência parcial em número de Protocolo, nome do Cidadão ou CPF do Cidadão, exibindo os resultados em até 1 segundo.
6. IF o Servidor informa um termo na busca rápida com menos de 3 caracteres, THEN THE Painel_Administrativo SHALL exibir mensagem orientando o Servidor a inserir no mínimo 3 caracteres e não realizar a busca.
7. WHILE filtros estiverem aplicados, THE Painel_Administrativo SHALL exibir identificação de cada filtro ativo com seu respectivo valor e disponibilizar botão para limpar todos os filtros simultaneamente.
8. IF os filtros aplicados não retornarem nenhum Processo, THEN THE Painel_Administrativo SHALL exibir mensagem indicando ausência de resultados para os critérios informados, mantendo os filtros visíveis.

---

### Requisito 11: Tramitação de Processos pelo Servidor

**User Story:** Como analista, quero mover um processo entre etapas, registrar observações e solicitar documentos, para que eu conduza a análise de forma organizada e rastreável.

#### Critérios de Aceitação

1. WHEN o Analista acessa um Processo atribuído, THE Painel_Administrativo SHALL exibir a Etapa atual, as Etapas anteriores concluídas e a próxima Etapa prevista no Fluxo.
2. WHEN o Analista move um Processo para a próxima Etapa, THE Painel_Administrativo SHALL registrar no Módulo_de_Auditoria: data, hora, identificação do Servidor, Etapa de origem e Etapa de destino.
3. IF a Etapa atual exigir documentos obrigatórios e esses documentos não estiverem presentes, THEN THE Painel_Administrativo SHALL impedir o avanço para a próxima Etapa e exibir a lista de documentos pendentes identificando cada documento ausente por nome e tipo.
4. WHEN o Analista registra uma observação interna, THE Painel_Administrativo SHALL armazenar a observação com visibilidade restrita a Servidores e com limite máximo de 2.000 caracteres, registrando data, hora e identificação do Servidor autor.
5. WHEN o Analista registra uma observação pública, THE Painel_Administrativo SHALL armazenar a observação com visibilidade para Servidores e para o Cidadão vinculado ao Processo, com limite máximo de 2.000 caracteres, registrando data, hora e identificação do Servidor autor.
6. WHEN o Analista solicita documentos adicionais ao Cidadão, THE Painel_Administrativo SHALL registrar a solicitação com data, hora e identificação do Servidor solicitante, alterar o status do Processo para "Aguardando Documentos" e enviar Notificação ao Cidadão contendo a lista dos documentos solicitados.
7. IF o Analista tentar rejeitar um Processo sem ter o nível de permissão de rejeição configurado, THEN THE Painel_Administrativo SHALL bloquear a ação e exibir mensagem orientando o Servidor a contatar o Gestor responsável.
8. WHEN um Processo atinge o prazo de uma Etapa sem ser avançado, THE Painel_Administrativo SHALL alterar o status da Etapa para "Vencido" e notificar o Gestor_de_Unidade responsável por meio do canal de Notificação configurado para alertas de prazo.
9. IF o Analista tentar mover um Processo para a próxima Etapa e o registro no Módulo_de_Auditoria não puder ser concluído, THEN THE Painel_Administrativo SHALL impedir o avanço do Processo e exibir mensagem de erro indicando falha no registro de auditoria.

---

### Requisito 12: Atribuição de Processos

**User Story:** Como gestor de unidade, quero controlar como os processos são distribuídos entre os analistas, para que a carga de trabalho seja equilibrada e nenhum processo fique sem responsável.

#### Critérios de Aceitação

1. THE Painel_Administrativo SHALL suportar três modos de atribuição de Processos: Atribuição_Automática, atribuição manual pelo Gestor e Fila_Geral, sendo configurável por Unidade individualmente.
2. WHEN o modo Atribuição_Automática está configurado para uma Unidade e um novo Processo chega, THE Painel_Administrativo SHALL atribuir o Processo ao Servidor ativo da Unidade com o menor número de Processos com status "em andamento" no momento da chegada, resolvendo empates pelo critério de menor tempo desde a última atribuição recebida.
3. IF o modo Atribuição_Automática está configurado e nenhum Servidor ativo está disponível na Unidade no momento da chegada do Processo, THEN THE Painel_Administrativo SHALL mover o Processo automaticamente para a Fila_Geral da Unidade e registrar o evento no Módulo_de_Auditoria.
4. WHEN um Gestor_de_Unidade realiza atribuição manual, THE Painel_Administrativo SHALL exibir, para cada Servidor disponível na Unidade, o número de Processos ativos atribuídos a ele antes da confirmação da atribuição.
5. WHEN o modo Fila_Geral está configurado para uma Unidade e um novo Processo chega, THE Painel_Administrativo SHALL disponibilizar o Processo na Fila_Geral para que qualquer Servidor com status "disponível" da Unidade o assuma voluntariamente, exibindo o Processo na fila em ordem cronológica de chegada.
6. IF um Processo permanece na Fila_Geral sem ser assumido por nenhum Servidor por mais de 24 horas, THEN THE Painel_Administrativo SHALL notificar o Gestor_de_Unidade por Notificação interna indicando o Processo pendente e o tempo decorrido.
7. WHEN um Processo é atribuído a um Servidor, THE Painel_Administrativo SHALL notificar o Servidor por Notificação interna em até 60 segundos após a atribuição e registrar a atribuição no Módulo_de_Auditoria contendo identificador do Processo, identificador do Servidor, modo de atribuição utilizado e data/hora da atribuição.
8. WHEN um Gestor_de_Unidade reatribui um Processo de um Servidor para outro, THE Painel_Administrativo SHALL exigir o preenchimento de uma justificativa com no mínimo 20 e no máximo 500 caracteres antes de confirmar a reatribuição.
9. IF a justificativa de reatribuição não atender ao requisito de tamanho, THEN THE Painel_Administrativo SHALL impedir a confirmação da reatribuição e exibir uma mensagem de erro indicando o intervalo de caracteres aceito, sem alterar a atribuição vigente do Processo.
10. WHEN a reatribuição é confirmada com justificativa válida, THE Painel_Administrativo SHALL registrar no Módulo_de_Auditoria o identificador do Processo, o Servidor de origem, o Servidor de destino, a justificativa fornecida e a data/hora da reatribuição.

---

### Requisito 13: Comunicação Interna e com o Cidadão

**User Story:** Como servidor municipal, quero me comunicar com o cidadão e com outros servidores diretamente pelo sistema, para que todas as tratativas fiquem registradas no histórico do processo.

#### Critérios de Aceitação

1. THE Painel_Administrativo SHALL disponibilizar canal de mensagens dentro de cada Processo para troca de mensagens entre Servidores e o Cidadão, mantendo todas as mensagens vinculadas ao identificador do Processo e visíveis ao Servidor responsável e ao Cidadão relacionado ao Processo.
2. THE Painel_Administrativo SHALL disponibilizar canal de mensagens internas dentro de cada Processo exclusivamente para comunicação entre Servidores, ocultando essas mensagens de qualquer visualização acessível ao Cidadão.
3. WHEN um Servidor envia uma mensagem ao Cidadão, THE Painel_Administrativo SHALL registrar a mensagem com data, hora e identificação do Servidor no histórico do Processo, e enviar Notificação ao Cidadão em até 60 segundos após o envio.
4. WHEN o Cidadão responde a uma mensagem, THE Painel_Administrativo SHALL exibir a resposta no canal de mensagens do Processo ao Servidor responsável em até 60 segundos após a recepção, e registrar a resposta com data, hora e identificação do Cidadão no Módulo_de_Auditoria.
5. THE Painel_Administrativo SHALL permitir que o Servidor anexe arquivos de até 10 MB por mensagem nos formatos PDF, JPG, PNG, DOC e DOCX, e IF o arquivo exceder 10 MB ou estiver em formato não permitido, THEN THE Painel_Administrativo SHALL rejeitar o anexo e exibir mensagem de erro indicando o motivo da rejeição antes do envio da mensagem.
6. WHEN um Servidor envia uma mensagem interna direcionada a outro Servidor específico, THE Painel_Administrativo SHALL notificar o Servidor destinatário em até 60 segundos após o envio e registrar a mensagem com data, hora e identificação do Servidor remetente no histórico interno do Processo.
7. IF o Cidadão não possui conta ativa no sistema no momento do envio de uma mensagem pelo Servidor, THEN THE Painel_Administrativo SHALL registrar a mensagem no histórico do Processo e exibir indicação ao Servidor de que a Notificação não pôde ser entregue.
8. WHILE um Processo estiver com status encerrado, THE Painel_Administrativo SHALL impedir o envio de novas mensagens no canal público e no canal interno desse Processo, exibindo indicação de que o Processo está encerrado.

---

### Requisito 14: Configuração de Categorias, Tipos e Unidades

**User Story:** Como administrador, quero configurar categorias, tipos de processos e unidades, para que o sistema reflita a estrutura organizacional da prefeitura.

#### Critérios de Aceitação

1. THE Painel_Administrativo SHALL permitir que o Administrador crie, edite e desative Categorias informando obrigatoriamente: nome (máximo 100 caracteres), e opcionalmente: descrição (máximo 500 caracteres), ícone, cor de identificação, secretaria responsável e Gestor responsável.
2. IF o Administrador tentar salvar uma Categoria com nome ausente ou com nome idêntico a uma Categoria já existente, THEN THE Painel_Administrativo SHALL rejeitar a operação e exibir mensagem de erro indicando o conflito, sem persistir as alterações.
3. THE Painel_Administrativo SHALL permitir que o Administrador crie, edite e desative Tipos_de_Processo dentro de uma Categoria, informando obrigatoriamente: nome (máximo 100 caracteres), prazo total em dias úteis (mínimo 1, máximo 365) e Unidades atendentes; e opcionalmente: formulário, Fluxo, documentos obrigatórios e opcionais.
4. IF o Administrador tentar salvar um Tipo_de_Processo com nome ausente ou com nome idêntico a um Tipo_de_Processo existente na mesma Categoria, THEN THE Painel_Administrativo SHALL rejeitar a operação e exibir mensagem de erro indicando o conflito, sem persistir as alterações.
5. THE Painel_Administrativo SHALL permitir que o Administrador crie, edite e desative Unidades informando obrigatoriamente: nome (máximo 100 caracteres), secretaria e Gestor responsável; e opcionalmente: endereço (máximo 300 caracteres), telefone com DDD (10 a 11 dígitos numéricos) e horário de funcionamento.
6. IF o Administrador tentar desativar uma Categoria, Tipo_de_Processo ou Unidade com Processos em andamento, THEN THE Painel_Administrativo SHALL exibir o número de Processos impactados e exigir confirmação antes de prosseguir.
7. WHEN uma Categoria, Tipo_de_Processo ou Unidade é desativado, THE Painel_Administrativo SHALL impedir a criação de novos Processos associados a esse item, sem alterar o status, os dados ou o fluxo dos Processos já existentes.

---

### Requisito 15: Configuração Visual de Fluxos de Processo

**User Story:** Como administrador ou gestor de categoria, quero configurar o fluxo de etapas de cada tipo de processo de forma visual, para que eu adapte os procedimentos administrativos sem necessidade de programação.

#### Critérios de Aceitação

1. THE Painel_Administrativo SHALL disponibilizar um editor visual de Fluxos com funcionalidade de arrastar e soltar (drag-and-drop) para criação e reordenação de Etapas, suportando no mínimo 1 e no máximo 50 Etapas por Fluxo.
2. WHEN o Administrador adiciona uma Etapa ao Fluxo, THE Painel_Administrativo SHALL permitir configurar para aquela Etapa: nome com até 100 caracteres, prazo entre 1 e 365 dias úteis, Servidor responsável padrão, lista de documentos obrigatórios com até 20 itens, observações obrigatórias com até 1.000 caracteres, e automações de Notificação.
3. THE Painel_Administrativo SHALL permitir configurar automações por Etapa, incluindo: envio de email ao Cidadão, envio de alerta interno ao Servidor responsável e alteração automática de status, sendo que cada Etapa pode ter no máximo 10 automações configuradas.
4. WHEN o Administrador salva um Fluxo editado, THE Painel_Administrativo SHALL aplicar o novo Fluxo apenas aos Processos criados a partir daquela data, mantendo os Processos existentes vinculados à versão anterior do Fluxo.
5. THE Painel_Administrativo SHALL exibir o prazo total estimado do Fluxo como a soma dos prazos em dias úteis de todas as Etapas configuradas, atualizando o valor exibido em até 1 segundo após qualquer alteração de prazo de Etapa.
6. IF o Administrador tentar salvar um Fluxo sem pelo menos uma Etapa configurada, THEN THE Painel_Administrativo SHALL exibir mensagem de erro indicando a ausência de Etapas e impedir o salvamento.
7. IF o Administrador tentar salvar uma Etapa com o campo nome vazio ou com prazo fora do intervalo de 1 a 365 dias úteis, THEN THE Painel_Administrativo SHALL exibir mensagem de erro indicando o campo inválido e impedir o salvamento do Fluxo.
8. WHEN o Administrador salva um Fluxo com sucesso, THE Painel_Administrativo SHALL exibir confirmação de salvamento e registrar a data e hora da alteração e a identidade do Administrador responsável pela modificação.

---

### Requisito 16: Formulários Dinâmicos

**User Story:** Como administrador, quero configurar formulários personalizados para cada tipo de processo, para que o cidadão forneça exatamente os dados necessários para aquela solicitação.

#### Critérios de Aceitação

1. THE Painel_Administrativo SHALL permitir que o Administrador crie Formulários_Dinâmicos associados a um Tipo_de_Processo e Unidade, com campos do tipo: texto curto (máximo 255 caracteres), texto longo (máximo 4.000 caracteres), número (inteiro ou decimal), data, seleção única, seleção múltipla, upload de arquivo e CPF; sendo permitido no máximo 50 campos por formulário.
2. WHEN o Administrador configura um campo do Formulário_Dinâmico, THE Painel_Administrativo SHALL permitir definir: rótulo (máximo 100 caracteres), descrição auxiliar (máximo 300 caracteres), obrigatoriedade (sim/não), validação de formato (expressão aplicável ao tipo do campo) e valor padrão compatível com o tipo do campo.
3. IF o Administrador submeter a configuração de um campo com rótulo ausente ou com valor padrão incompatível com o tipo do campo, THEN THE Painel_Administrativo SHALL rejeitar o envio e exibir mensagem de erro indicando o campo inválido, sem salvar as alterações.
4. THE Painel_Administrativo SHALL permitir reordenar campos do Formulário_Dinâmico por arrastar e soltar, persistindo a nova ordem imediatamente após o reposicionamento.
5. WHEN o Cidadão acessa a etapa de preenchimento, THE Portal_do_Cidadão SHALL renderizar o Formulário_Dinâmico correspondente ao Tipo_de_Processo e Unidade selecionados, exibindo todos os campos na ordem configurada pelo Administrador.
6. IF o Portal_do_Cidadão não obtiver o Formulário_Dinâmico correspondente ao Tipo_de_Processo e Unidade selecionados, THEN THE Portal_do_Cidadão SHALL exibir mensagem de erro indicando a indisponibilidade e impedir o avanço na solicitação.
7. WHEN o Cidadão sai de um campo do Formulário_Dinâmico, THE Portal_do_Cidadão SHALL validar o valor preenchido e, IF o campo for inválido, THEN THE Portal_do_Cidadão SHALL exibir mensagem de erro indicando a regra violada adjacente ao campo, sem remover o valor preenchido.

---

### Requisito 17: Módulo de Auditoria e Rastreabilidade

**User Story:** Como administrador, quero ter rastreabilidade completa de todas as ações realizadas no sistema, para que eu garanta conformidade e investigue qualquer irregularidade.

#### Critérios de Aceitação

1. THE Módulo_de_Auditoria SHALL registrar todas as ações realizadas no sistema em até 2 segundos após a ação, incluindo: login e logout, criação e edição de Processos, movimentações de Etapa, atribuições, mensagens enviadas, alterações de configuração e acessos a relatórios.
2. WHEN o Administrador acessa o Módulo_de_Auditoria, THE Painel_Administrativo SHALL exibir o log de auditoria paginado em até 100 registros por página, com filtros por: data e hora, tipo de ação, identificação do Servidor ou Cidadão, número de Protocolo e módulo do sistema, retornando os resultados em até 5 segundos após a aplicação dos filtros.
3. THE Módulo_de_Auditoria SHALL registrar para cada ação: data e hora em UTC com precisão de milissegundos, identificação do ator (Servidor ou Cidadão), endereço IP, descrição da ação, identificador do objeto afetado e os valores anterior e posterior para campos alterados (máximo 1.000 caracteres por valor).
4. THE Módulo_de_Auditoria SHALL reter os registros de auditoria por no mínimo 5 anos, mantendo-os consultáveis e exportáveis durante todo o período de retenção.
5. WHEN o Administrador solicita a exportação dos registros de auditoria, THE Painel_Administrativo SHALL gerar o arquivo no formato solicitado (CSV ou PDF) em até 30 segundos para conjuntos de até 10.000 registros, e notificar o Administrador quando o arquivo estiver disponível para conjuntos maiores.
6. THE Módulo_de_Auditoria SHALL ser somente leitura para todos os níveis de acesso, incluindo o Administrador, bloqueando as operações de criação, edição e exclusão de registros existentes.
7. IF a exportação dos registros de auditoria falhar, THEN THE Painel_Administrativo SHALL exibir mensagem de erro indicando a falha e permitir nova tentativa sem exigir redefinição dos filtros.
8. IF o Módulo_de_Auditoria não puder registrar uma ação por falha interna, THEN THE Módulo_de_Auditoria SHALL registrar um evento de falha com data, hora e descrição do erro, sem interromper a operação original que estava sendo auditada.

---

### Requisito 18: Relatórios e Métricas

**User Story:** Como gestor, quero gerar relatórios sobre o desempenho dos processos, para que eu identifique gargalos e tome decisões para melhorar a eficiência administrativa.

#### Critérios de Aceitação

1. THE Painel_Administrativo SHALL disponibilizar relatórios de desempenho contendo: volume de Processos por período, tempo médio de resolução por Tipo_de_Processo, taxa de aprovação e rejeição por Unidade, Processos vencidos por Servidor e volume de Processos por Categoria.
2. WHEN o Servidor acessa a área de relatórios, THE Painel_Administrativo SHALL exibir os dados com período padrão dos últimos 30 dias e SHALL permitir filtrar por: período (intervalo de datas), Categoria, Tipo_de_Processo, Unidade e Servidor, atualizando os dados em até 5 segundos após a aplicação dos filtros.
3. THE Painel_Administrativo SHALL exibir os relatórios em formato de gráfico e em formato de tabela, com opção de alternância entre os formatos sem recarregar a página.
4. THE Painel_Administrativo SHALL permitir a exportação de relatórios nos formatos CSV e PDF, e IF a exportação falhar, THEN THE Painel_Administrativo SHALL exibir mensagem de erro e preservar os filtros ativos para nova tentativa.
5. WHILE o Servidor gera um relatório com mais de 10.000 registros, THE Painel_Administrativo SHALL processar a geração em segundo plano e notificar o Servidor quando o arquivo estiver disponível para download.
6. WHEN a exportação envolve até 10.000 registros, THE Painel_Administrativo SHALL concluir a geração do arquivo em até 30 segundos.
7. IF o Servidor informar um intervalo de datas inválido para o filtro de período — com data final anterior à data inicial ou com intervalo superior a 366 dias —, THEN THE Painel_Administrativo SHALL exibir mensagem de erro indicando o problema e impedir a geração do relatório.

---

### Requisito 19: Acessibilidade e Responsividade da Interface

**User Story:** Como cidadão ou servidor, quero acessar o sistema em qualquer dispositivo com interface adaptada e acessível, para que eu utilize o sistema independentemente do dispositivo ou de necessidades especiais.

#### Critérios de Aceitação

1. THE Auditar SHALL adaptar o layout para larguras de tela de 320px, 768px, 1024px e 1440px, sem truncar conteúdo, sem sobreposição de elementos e sem exigir rolagem horizontal em nenhuma das resoluções suportadas.
2. THE Portal_do_Cidadão SHALL implementar o padrão WCAG 2.1 nível AA, garantindo: contraste mínimo de 4,5:1 para texto normal, contraste mínimo de 3:1 para texto grande, compatibilidade com leitores de tela e navegação completa por teclado.
3. THE Auditar SHALL exibir todos os botões e campos de formulário com altura mínima de 44px e largura mínima de 44px em todas as resoluções suportadas.
4. THE Auditar SHALL garantir que todos os elementos interativos sejam acessíveis via teclado, com indicador de foco visível, e que a ordem de tabulação siga a sequência lógica do conteúdo em todas as páginas.
5. IF um elemento interativo não puder ser renderizado de forma acessível para tecnologia assistiva, THEN THE Auditar SHALL exibir alternativa textual equivalente e preservar todos os dados do usuário que estiverem preenchidos no momento do erro de renderização.

---

### Requisito 20: Segurança e Proteção de Dados

**User Story:** Como administrador do sistema, quero que o sistema proteja os dados dos cidadãos e servidores, para que a prefeitura cumpra a LGPD e garanta a integridade das informações.

#### Critérios de Aceitação

1. THE Auditar SHALL transmitir todas as comunicações entre cliente e servidor utilizando protocolo HTTPS com certificado TLS 1.2 ou superior.
2. THE Auditar SHALL armazenar senhas utilizando algoritmo de hash bcrypt com fator de custo mínimo 12.
3. THE Auditar SHALL validar e sanitizar todas as entradas de dados provenientes de Cidadãos e Servidores, rejeitando entradas que contenham scripts, comandos SQL, ou caracteres de controle, antes de processar ou persistir as informações.
4. THE Auditar SHALL implementar proteção contra ataques de Cross-Site Request Forgery (CSRF) em todos os formulários e endpoints de mutação de dados por meio de tokens de sessão únicos por requisição.
5. THE Auditar SHALL aplicar rate limiting de no máximo 100 requisições por minuto por endereço IP nas APIs públicas do Portal_do_Cidadão, rejeitando as requisições excedentes com indicação de erro e informando o tempo de espera até a liberação do limite.
6. WHEN um Cidadão solicita a exclusão de conta, THE Auditar SHALL anonimizar os dados pessoais do Cidadão — incluindo nome, CPF, e-mail e telefone — nos Processos históricos em até 30 dias, preservando apenas os campos estritamente necessários para fins de auditoria.
7. THE Auditar SHALL manter logs de segurança de tentativas de acesso não autorizadas por no mínimo 1 ano, contendo data, hora, endereço IP de origem e identificador do recurso acessado.
8. IF um Cidadão ou Servidor realiza 5 tentativas de autenticação consecutivas sem sucesso em um intervalo de 5 minutos, THEN THE Auditar SHALL bloquear o acesso daquela conta pelo período de 15 minutos e registrar o evento no log de segurança.
9. IF a validação ou sanitização de uma entrada de dados falhar, THEN THE Auditar SHALL rejeitar a requisição, retornar uma mensagem de erro indicando que a entrada é inválida, e não persistir nenhum dado parcial referente àquela requisição.

---

### Requisito 21: Gestão de Servidores pelo Administrador

**User Story:** Como administrador, quero cadastrar, editar e gerenciar os servidores municipais no sistema, para que eu controle quem tem acesso ao Painel_Administrativo e com quais permissões.

#### Critérios de Aceitação

1. THE Painel_Administrativo SHALL permitir que o Administrador cadastre novos Servidores informando: nome completo (máximo 150 caracteres), CPF (11 dígitos numéricos válidos conforme dígitos verificadores), email institucional (máximo 254 caracteres, formato válido), telefone (10 ou 11 dígitos numéricos), nível de acesso selecionado dentre os 7 níveis definidos e Unidade de lotação selecionada dentre as unidades cadastradas.
2. IF o Administrador submeter o formulário de cadastro de Servidor com CPF já vinculado a uma conta existente, THEN THE Painel_Administrativo SHALL rejeitar o cadastro e exibir uma mensagem de erro indicando duplicidade de CPF, sem criar o registro.
3. WHEN o Administrador cadastra um novo Servidor com sucesso, THE Painel_Administrativo SHALL gerar uma senha temporária de no mínimo 8 caracteres e enviá-la por email ao endereço institucional informado, e o sistema SHALL exigir a troca dessa senha no primeiro login do Servidor.
4. IF o envio do email com a senha temporária falhar, THEN THE Painel_Administrativo SHALL informar ao Administrador que o envio não foi concluído e disponibilizar a opção de reenvio, sem desfazer o cadastro já criado.
5. THE Painel_Administrativo SHALL permitir que o Administrador edite nome completo, email institucional, telefone, nível de acesso, permissões granulares e Unidade de lotação de qualquer Servidor, mantendo o CPF imutável após o cadastro.
6. THE Painel_Administrativo SHALL permitir que o Administrador desative a conta de um Servidor sem excluí-la, preservando todo o histórico de ações associado àquele Servidor.
7. IF existirem Processos atribuídos ao Servidor cuja desativação foi solicitada, THEN THE Painel_Administrativo SHALL exibir a lista desses Processos ao Administrador e solicitar a reatribuição de cada um a outro Servidor ativo antes de confirmar a desativação.
8. WHEN a desativação de um Servidor é confirmada, THE Painel_Administrativo SHALL encerrar todas as sessões ativas daquele Servidor em até 5 segundos após a confirmação.
9. IF o Administrador tentar cadastrar ou reativar um Servidor com nível Administrador quando já existirem 3 contas com esse nível ativas, THEN THE Painel_Administrativo SHALL rejeitar a operação e exibir uma mensagem de erro indicando que o limite de 3 administradores ativos simultâneos foi atingido.
10. IF um Servidor sem a Permissão_Granular "gerenciar usuários" e sem o nível Administrador tentar acessar o cadastro de Servidores, criar, editar, desativar ou alterar permissões de qualquer Servidor, THEN THE Painel_Administrativo SHALL bloquear a ação e retornar mensagem de acesso negado.
11. WHEN um Servidor autorizado abre o formulário de cadastro ou edição de um Servidor, THE Painel_Administrativo SHALL exibir, além dos campos de identificação, um seletor individual para cada Permissão_Granular definida no Requisito 8.6 e no Requisito 23, permitindo conceder ou revogar cada permissão de forma independente.
12. WHEN um Servidor autorizado seleciona um nível de acesso no formulário de cadastro ou edição, THE Painel_Administrativo SHALL preencher automaticamente o conjunto de Permissões_Granulares sugerido como padrão para aquele nível, permitindo que o Servidor autorizado ajuste individualmente cada Permissão_Granular antes de salvar.
13. WHEN um Servidor autorizado salva o conjunto de Permissões_Granulares de um Servidor, THE Painel_Administrativo SHALL persistir exatamente as permissões marcadas, aplicar as permissões atualizadas na próxima requisição autenticada do Servidor afetado, e registrar no Módulo_de_Auditoria a identidade do autor, a identidade do Servidor afetado e as permissões alteradas com valores anterior e posterior.

---

### Requisito 22: Disponibilidade e Desempenho

**User Story:** Como cidadão ou servidor, quero que o sistema esteja disponível e responsivo a qualquer momento, para que eu não seja prejudicado por indisponibilidade ou lentidão na tramitação de processos.

#### Critérios de Aceitação

1. THE Auditar SHALL estar disponível para acesso 24 horas por dia, 7 dias por semana, com disponibilidade mínima de 99% medida mensalmente, excluindo janelas de manutenção programada previamente comunicadas.
2. WHEN o Portal_do_Cidadão recebe uma requisição de carregamento de página com até 500 usuários simultâneos, THE Auditar SHALL retornar a resposta em até 3 segundos.
3. WHEN o Painel_Administrativo recebe uma requisição de carregamento de página com até 500 usuários simultâneos, THE Auditar SHALL retornar a resposta em até 2 segundos.
4. WHEN uma busca de Processos é realizada com filtros com até 500 usuários simultâneos e conjunto de até 10.000 Processos, THE Painel_Administrativo SHALL retornar os resultados em até 1 segundo.
5. THE Auditar SHALL suportar no mínimo 500 usuários simultâneos mantendo os tempos de resposta definidos nos critérios 2 e 3.
6. IF o sistema precisar de manutenção programada, THEN THE Auditar SHALL exibir aviso prévio com no mínimo 24 horas de antecedência para os usuários autenticados, informando data, hora e duração estimada da interrupção.
7. WHEN ocorrer indisponibilidade não programada com duração superior a 1 hora, THE Auditar SHALL registrar o incidente com data, hora de início, hora de encerramento e causa identificada, para fins de apuração do índice mensal de disponibilidade.

---

### Requisito 23: Abertura de Processo pelo Servidor no Painel Administrativo

**User Story:** Como servidor municipal autorizado, quero abrir um processo em nome de um cidadão diretamente pelo Painel_Administrativo, para que eu registre solicitações recebidas presencialmente, por telefone ou por outros canais.

#### Critérios de Aceitação

1. IF um Servidor sem a Permissão_Granular "editar" e sem o nível Administrador tentar abrir um novo Processo pelo Painel_Administrativo, THEN THE Painel_Administrativo SHALL bloquear a ação e retornar mensagem de acesso negado.
2. WHEN um Servidor autorizado inicia a abertura de um Processo, THE Painel_Administrativo SHALL permitir a busca de um Cidadão por CPF de 11 dígitos numéricos válidos e exibir os dados de identificação do Cidadão encontrado antes de prosseguir.
3. IF o CPF informado na busca não corresponder a nenhum Cidadão cadastrado, THEN THE Painel_Administrativo SHALL exibir mensagem indicando que o Cidadão não foi encontrado e disponibilizar a opção de cadastrar um novo Cidadão antes de prosseguir.
4. WHEN um Servidor autorizado seleciona o Cidadão, THE Painel_Administrativo SHALL conduzir a abertura do Processo com seleção de Categoria, Tipo_de_Processo e Unidade e preenchimento do Formulário_Dinâmico correspondente, aplicando as mesmas validações de campos obrigatórios definidas no Requisito 4.
5. WHEN um Servidor autorizado confirma a abertura do Processo, THE Painel_Administrativo SHALL gerar um número de Protocolo único conforme o Requisito 4.8a e calcular o prazo final utilizando o mesmo motor de criação de Processo empregado no Portal_do_Cidadão.
6. WHEN o Processo é aberto pelo Servidor com sucesso, THE Painel_Administrativo SHALL registrar no Módulo_de_Auditoria a identidade do Servidor que abriu o Processo, o Cidadão vinculado, a data e hora, e enviar Notificação ao Cidadão contendo o número de Protocolo gerado.
7. IF a abertura do Processo falhar após a confirmação, THEN THE Painel_Administrativo SHALL exibir mensagem de erro, preservar todos os dados preenchidos e permitir nova tentativa de envio.

---

### Requisito 24: Detalhe Completo e Edição Corretiva de Processo no Painel Administrativo

**User Story:** Como servidor municipal, quero visualizar todos os detalhes de um processo com sua trilha de auditoria e corrigir dados lançados de forma equivocada, para que o processo reflita informações corretas com total rastreabilidade.

#### Critérios de Aceitação

1. WHEN um Servidor autorizado acessa o detalhe de um Processo no Painel_Administrativo, THE Painel_Administrativo SHALL exibir os dados do Processo, as respostas do Formulário_Dinâmico, a Etapa atual, o Servidor responsável e os prazos do Processo.
2. WHEN um Servidor autorizado acessa o detalhe de um Processo, THE Painel_Administrativo SHALL exibir a trilha de auditoria do Processo em ordem cronológica, apresentando, para cada movimentação e ação registrada, a identidade do autor, a descrição da ação, os valores anterior e posterior quando aplicável, e a data e hora.
3. WHEN um Servidor autorizado acessa o detalhe de um Processo, THE Painel_Administrativo SHALL exibir uma seção de ações pendentes contendo a próxima Etapa prevista, os documentos solicitados ainda não enviados e as ações necessárias para o avanço do Processo.
4. IF um Servidor sem a Permissão_Granular "editar" tentar realizar uma Edição_Corretiva em um Processo, THEN THE Painel_Administrativo SHALL bloquear a ação e retornar mensagem de acesso negado, mantendo os dados do Processo inalterados.
5. WHEN um Servidor com a Permissão_Granular "editar" salva uma Edição_Corretiva de dados de um Processo, THE Painel_Administrativo SHALL persistir os novos valores e registrar no Módulo_de_Auditoria a identidade do Servidor, o campo alterado, o valor anterior, o valor posterior e a data e hora da alteração.
6. WHEN um Servidor com a Permissão_Granular "solicitar documentos" solicita documentos adicionais em um Processo, THE Painel_Administrativo SHALL exibir a pendência no detalhe do Processo e disponibilizar uma área para anexação dos documentos solicitados, conforme o Requisito 25.
7. IF uma Edição_Corretiva não puder ser registrada no Módulo_de_Auditoria, THEN THE Painel_Administrativo SHALL impedir a persistência da alteração e exibir mensagem de erro indicando falha no registro de auditoria.

---

### Requisito 25: Anexação de Documentos ao Processo no Painel Administrativo

**User Story:** Como servidor municipal, quero anexar documentos a um processo quando forem solicitados, para que a documentação necessária fique disponível vinculada ao processo.

#### Critérios de Aceitação

1. WHEN um Servidor autorizado acessa um Processo com documentos solicitados pendentes, THE Painel_Administrativo SHALL exibir a lista de documentos pendentes e disponibilizar a área de anexação de arquivos.
2. THE Painel_Administrativo SHALL permitir a anexação de documentos ao Processo nos formatos PDF, JPG, PNG, DOC e DOCX, com tamanho máximo de 10 MB por arquivo, 50 MB no total por Processo e no máximo 20 arquivos por Processo.
3. IF o Servidor tentar anexar um arquivo em formato não permitido, excedente ao limite por arquivo ou que ultrapasse o limite total ou de quantidade, THEN THE Painel_Administrativo SHALL exibir mensagem de erro descritiva indicando o motivo, rejeitar o arquivo e preservar os arquivos já anexados.
4. WHEN um Servidor anexa um documento a um Processo com sucesso, THE Painel_Administrativo SHALL vincular o arquivo ao Processo, registrar a identidade do Servidor que anexou, a data e hora, e atualizar a lista de documentos pendentes do Processo.
5. WHEN todos os documentos solicitados de um Processo forem anexados, THE Painel_Administrativo SHALL remover a pendência de documentos do detalhe do Processo e permitir o avanço da Etapa que dependia desses documentos.

---

### Requisito 26: Geração de PDF Consolidado do Processo

**User Story:** Como servidor municipal, quero gerar e baixar um PDF consolidado de um processo, para que eu tenha um documento completo para arquivamento físico ou compartilhamento oficial.

#### Critérios de Aceitação

1. WHEN um Servidor autorizado solicita a geração do PDF_do_Processo, THE Painel_Administrativo SHALL gerar um documento PDF contendo: cabeçalho com número de Protocolo, Tipo_de_Processo, Unidade e status; dados do Cidadão; respostas do Formulário_Dinâmico; histórico completo de movimentações com autor, data, hora e observações; mensagens públicas; e a lista de documentos anexados.
2. WHEN o PDF_do_Processo é gerado com sucesso, THE Painel_Administrativo SHALL disponibilizar o arquivo para download direto ao Servidor solicitante.
3. THE Painel_Administrativo SHALL registrar no Módulo_de_Auditoria a identidade do Servidor que gerou o PDF_do_Processo, o identificador do Processo e a data e hora da geração.
4. THE PDF_do_Processo SHALL conter exclusivamente as mensagens públicas do Processo, omitindo integralmente as mensagens do canal interno entre Servidores.
5. IF a geração do PDF_do_Processo falhar, THEN THE Painel_Administrativo SHALL exibir mensagem de erro indicando a falha e permitir nova tentativa sem alterar os dados do Processo.
6. IF um Servidor sem a Permissão_Granular "visualizar" sobre o Processo tentar gerar o PDF_do_Processo, THEN THE Painel_Administrativo SHALL bloquear a ação e retornar mensagem de acesso negado.

---

### Requisito 27: Organizador de Tarefas da Equipe

**User Story:** Como servidor municipal responsável por coordenar a equipe, quero criar e atribuir tarefas com prazos aos servidores, para que as atividades sejam acompanhadas, cobradas e concluídas dentro dos prazos.

#### Critérios de Aceitação

1. IF um Servidor sem a Permissão_Granular "gerenciar tarefas" e sem o nível Administrador tentar criar ou atribuir uma Tarefa, THEN THE Painel_Administrativo SHALL bloquear a ação e retornar mensagem de acesso negado.
2. WHEN um Servidor autorizado cria uma Tarefa, THE Painel_Administrativo SHALL exigir os campos obrigatórios: título (máximo 150 caracteres), prazo com data e horário, e ao menos um destinatário; e opcionalmente: descrição (máximo 2.000 caracteres), prioridade e vínculo a um Processo.
3. WHEN um Servidor autorizado atribui uma Tarefa, THE Painel_Administrativo SHALL permitir direcioná-la a um único Servidor, a vários Servidores específicos ou a todos os Servidores ativos, criando uma Atribuição_de_Tarefa por destinatário com status de acompanhamento individual próprio.
4. WHEN uma Tarefa direcionada a todos os Servidores ativos é criada, THE Painel_Administrativo SHALL criar exatamente uma Atribuição_de_Tarefa para cada Servidor ativo no momento da criação.
5. WHEN um Servidor autorizado cria e atribui uma Tarefa, THE Painel_Administrativo SHALL enviar a cada destinatário uma Notificação de atribuição de Tarefa pelo canal configurado em até 60 segundos após a criação.
6. WHEN um Servidor acessa seu Dashboard, THE Painel_Administrativo SHALL exibir as Tarefas atribuídas a ele agrupadas pelos status: pendente, em andamento e concluída.
7. WHEN um Servidor destinatário altera o status de uma de suas Atribuições_de_Tarefa entre pendente, em andamento e concluída, THE Painel_Administrativo SHALL persistir o novo status apenas para a Atribuição_de_Tarefa daquele Servidor, sem alterar o status das demais Atribuições_de_Tarefa da mesma Tarefa, e registrar a data e hora da conclusão quando o status for definido como concluída.
8. WHEN a data e horário de prazo de uma Atribuição_de_Tarefa não concluída estiver a 24 horas ou menos de vencer, THE Painel_Administrativo SHALL enviar ao Servidor destinatário uma Notificação de proximidade de vencimento pelo canal configurado, exatamente uma vez por Atribuição_de_Tarefa.
9. WHEN a data e horário de prazo de uma Atribuição_de_Tarefa é atingida e a Atribuição_de_Tarefa permanece não concluída, THE Painel_Administrativo SHALL enviar ao Servidor destinatário uma Notificação de Tarefa vencida pelo canal configurado, exatamente uma vez por Atribuição_de_Tarefa enquanto ela permanecer não concluída.
10. WHEN um Servidor acessa o Organizador_de_Tarefas, THE Painel_Administrativo SHALL permitir filtrar as Tarefas por status, por prazo e por vínculo a Processo.
11. WHERE uma Tarefa estiver vinculada a um Processo, THE Painel_Administrativo SHALL exibir o número de Protocolo do Processo vinculado na visualização da Tarefa e permitir a navegação direta para o detalhe do Processo.
12. IF um Servidor autorizado tentar criar uma Tarefa com prazo cuja data e horário sejam anteriores ao instante da criação, THEN THE Painel_Administrativo SHALL rejeitar a criação e exibir mensagem de erro indicando que o prazo deve ser futuro.
