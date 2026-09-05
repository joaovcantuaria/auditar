# Guia de Deploy — DEMO / Homologação do Auditar

Este guia leva do zero a uma demonstração funcional do sistema **Auditar**, hospedando:

- **Frontend** (React + Vite) na **Vercel**
- **Backend / API** (Express + TypeScript) no **Render**
- **Banco Postgres** no **Neon**
- **Redis** no **Upstash** (BullMQ + Socket.io)
- **Storage S3-compatível** no **Cloudflare R2** (documentos e relatórios)
- **E-mail (SMTP)** no **Resend**

> Tudo pode ser feito no **plano gratuito** de cada serviço — suficiente para uma demo. Veja a seção [Custos e limites](#j-custos-e-limites) no final.

Ordem recomendada: **a → b → c → d → e → f → g → h → i**. Alguns valores só existem depois de um passo (ex.: a URL do Vercel), então haverá um momento de "voltar e ajustar" — está sinalizado.

---

## a. Pré-requisito: subir o código para o GitHub

Render e Vercel fazem deploy **puxando o código de um repositório Git** (GitHub é o mais simples). Se o projeto ainda não está no GitHub:

1. Crie um repositório vazio no GitHub (ex.: `auditar`), **sem** README/licença.
2. Na raiz do projeto (`e:/Auditar`), rode:

```bash
git init
git add .
git commit -m "chore: preparacao para deploy da demo"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/auditar.git
git push -u origin main
```

> Confira que o `.gitignore` já ignora `.env`, `node_modules` e `dist`. **Nunca** comite segredos. Os arquivos `.env.production.example`, `render.yaml` e `vercel.json` (na raiz, criados por este guia) **devem** ir para o repositório — eles não contêm segredos.

---

## b. Banco de dados no Neon → `DATABASE_URL`

1. Crie uma conta em [neon.tech](https://neon.tech) e um novo **Project** (Postgres).
2. Escolha a região mais próxima. Um banco (`neondb`) já vem criado.
3. Em **Dashboard → Connection Details**, copie a **connection string** no formato:

```
postgresql://USUARIO:SENHA@HOST.neon.tech/neondb?sslmode=require
```

4. Garanta o parâmetro `?sslmode=require` no final (o Neon exige SSL).
5. Guarde esse valor — ele vira a variável **`DATABASE_URL`** no Render.

> As migrations do Prisma serão aplicadas automaticamente no build do Render (`prisma migrate deploy`). Você não precisa rodar nada aqui.

---

## c. Redis no Upstash → `REDIS_URL` / `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD`

1. Crie uma conta em [upstash.com](https://upstash.com) e um novo **Redis Database**.
2. Escolha a região e crie. Na tela do banco, seção **Connect / Details**, você verá a URL de conexão TLS:

```
rediss://default:<SENHA>@<HOST>.upstash.io:6379
```

3. Derive as variáveis a partir dessa URL:
   - **`REDIS_URL`** = a URL completa `rediss://default:<SENHA>@<HOST>.upstash.io:6379`
   - **`REDIS_HOST`** = `<HOST>.upstash.io`
   - **`REDIS_PORT`** = `6379` (a porta que aparecer)
   - **`REDIS_PASSWORD`** = `<SENHA>` (o token após `default:`)

### TLS obrigatório (`rediss://`)

O Upstash usa **TLS** (esquema `rediss://`). O cliente `ioredis` do projeto **não** ligava TLS por padrão — ele conectava por `host/port/password` puros. Isso foi ajustado durante a preparação deste deploy:

- Adicionada a variável **`REDIS_TLS`** (em `apps/api/src/config/env.ts`).
- `apps/api/src/config/redis.ts` e `apps/api/src/config/bullmq.ts` agora habilitam TLS **quando** `REDIS_TLS=true` **ou** quando `REDIS_URL` começa com `rediss://`.
- No ambiente **local** (Redis em Docker, `redis://`) nada muda — TLS continua desligado.

Portanto, no Render, além dos 4 valores acima, defina **`REDIS_TLS=true`** (já vem sugerido no `render.yaml`).

---

## d. Storage no Cloudflare R2 → variáveis `MINIO_*`

O código usa a biblioteca `minio`, que é compatível com qualquer storage S3 (incluindo R2).

1. No painel da [Cloudflare](https://dash.cloudflare.com), vá em **R2**.
2. Crie **dois buckets**, por exemplo:
   - `auditar-processos`
   - `auditar-relatorios`
3. Em **R2 → Manage R2 API Tokens**, crie um **API Token** com permissão de leitura/escrita (Object Read & Write) nos buckets. Anote:
   - **Access Key ID**
   - **Secret Access Key**
4. No **Overview** do R2, copie o **endpoint** da sua conta, no formato:

```
https://<ACCOUNTID>.r2.cloudflarestorage.com
```

5. Mapeie para as variáveis (a lib usa host + porta + SSL, **sem** `https://`):

| Variável | Valor |
| --- | --- |
| `MINIO_ENDPOINT` | `<ACCOUNTID>.r2.cloudflarestorage.com` (só o host, **sem** `https://`) |
| `MINIO_PORT` | `443` |
| `MINIO_USE_SSL` | `true` |
| `MINIO_REGION` | `auto` |
| `MINIO_ROOT_USER` | Access Key ID |
| `MINIO_ROOT_PASSWORD` | Secret Access Key |
| `MINIO_BUCKET_PROCESSOS` | `auditar-processos` |
| `MINIO_BUCKET_RELATORIOS` | `auditar-relatorios` |

### `region: 'auto'` obrigatório para R2

O cliente `minio` do projeto não passava `region`. Para o R2 assinar corretamente e gerar **presigned URLs** válidas, é necessário informar a região. Isso foi ajustado:

- Adicionada a variável opcional **`MINIO_REGION`** (em `apps/api/src/config/env.ts`).
- `apps/api/src/config/minio.ts` só aplica `region` **quando** `MINIO_REGION` está definida — logo, o MinIO local continua funcionando sem a variável.
- Para R2, use **`MINIO_REGION=auto`**.

### CORS no bucket R2 (upload direto do navegador)

O frontend envia arquivos **direto do navegador para o R2** via presigned URL (método `PUT`, fora do axios). Para isso o **bucket precisa de CORS configurado**. No painel do bucket, em **Settings → CORS Policy**, cole (ajustando a origem para a URL real do Vercel):

```json
[
  {
    "AllowedOrigins": ["https://SEU-PROJETO.vercel.app"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

> Aplique a política **nos dois buckets** (processos e relatórios) se ambos receberem upload/download pelo navegador. A URL do Vercel só existe após o passo **g** — volte aqui para ajustar depois.

---

## e. E-mail no Resend → variáveis `SMTP_*`

1. Crie uma conta em [resend.com](https://resend.com).
2. **Opção A (recomendada):** verifique um domínio em **Domains** (adicione os registros DNS pedidos). Assim você pode enviar de `nao-responder@seudominio.com.br`.
3. **Opção B (teste rápido):** sem domínio verificado, use o remetente de teste `onboarding@resend.dev`.
4. Em **API Keys**, gere uma chave (`re_...`).
5. Configure as variáveis SMTP:

| Variável | Valor |
| --- | --- |
| `SMTP_HOST` | `smtp.resend.com` |
| `SMTP_PORT` | `587` |
| `SMTP_SECURE` | `false` |
| `SMTP_USER` | `resend` |
| `SMTP_PASS` | sua API Key (`re_...`) |
| `SMTP_FROM_NAME` | `Auditar` |
| `SMTP_FROM_ADDRESS` | e-mail do domínio verificado **ou** `onboarding@resend.dev` |

> **Limitação do modo teste:** usando `onboarding@resend.dev` (sem domínio verificado), o Resend costuma permitir envio **apenas para o e-mail dono da conta**. Para receber e-mails em endereços arbitrários (ex.: cadastro de cidadãos na demo), verifique um domínio (Opção A).

---

## f. Deploy da API no Render

1. Em [render.com](https://render.com), clique em **New + → Blueprint**.
2. Conecte sua conta do GitHub e selecione o repositório `auditar`.
3. O Render detecta o arquivo **`render.yaml`** na raiz e propõe criar o serviço **`auditar-api`** (Node, plano free).
4. Antes de finalizar, preencha todas as variáveis marcadas como **"sync: false"** (aba Environment) com os valores dos passos anteriores:
   - `DATABASE_URL` (Neon — passo b)
   - `REDIS_URL`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` (Upstash — passo c). `REDIS_TLS` já vem `true`.
   - `MINIO_ENDPOINT`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_BUCKET_PROCESSOS`, `MINIO_BUCKET_RELATORIOS` (R2 — passo d). `MINIO_PORT/USE_SSL/REGION` já vêm preenchidos.
   - `SMTP_PASS`, `SMTP_FROM_ADDRESS` (Resend — passo e). Os demais SMTP já vêm preenchidos.
   - `JWT_SECRET` → gere um segredo forte (32+ caracteres):
     ```bash
     openssl rand -base64 48
     ```
     (No Windows sem `openssl`, use PowerShell: `[Convert]::ToBase64String((1..48 | ForEach-Object {Get-Random -Max 256}))`.)
   - `API_URL` → a URL pública **deste** serviço. O Render mostra o nome do serviço; a URL será algo como `https://auditar-api.onrender.com`. Você pode preencher agora com o valor esperado e confirmar após o primeiro deploy.
   - `WEB_URL` e `CORS_ORIGINS` → **URL do Vercel**, que ainda não existe. **Deixe um valor provisório** (ex.: `https://localhost`) e **volte no passo g** para colocar a URL real. Sem isso, o CORS bloqueará o frontend.
5. Confirme e deixe o Render buildar. O build roda, nesta ordem:
   - `npm ci` (instala o monorepo)
   - build do `@auditar/shared`
   - `prisma generate` + build da API
   - `prisma migrate deploy` (aplica as migrations no Neon)
   - start: `node dist/index.js`
6. Após o deploy, confirme a **URL pública** do serviço (ex.: `https://auditar-api.onrender.com`) e teste o health check abrindo `https://auditar-api.onrender.com/health` → deve responder `{"status":"ok",...}`.
7. Se `API_URL` estava provisória, ajuste-a agora para a URL real e salve (o Render redeploya).

> **Cold start (plano free):** o serviço "dorme" após ~15 min sem tráfego. A **primeira** requisição depois disso pode levar **~30s** para responder enquanto o serviço acorda. Normal na demo — avise quem for testar.

> **Sobre a porta:** a API lê `env.API_PORT`. O `render.yaml` fixa `API_PORT=10000`, que é a porta padrão exposta pelo Render. Se o Render indicar outra porta para o seu serviço, ajuste `API_PORT` para bater com ela.

---

## g. Deploy do Frontend no Vercel

1. Em [vercel.com](https://vercel.com), clique em **Add New → Project** e importe o mesmo repositório do GitHub.
2. **Root Directory:** deixe na **raiz do repositório** (não `apps/web`). Isso é necessário para o Vercel instalar os workspaces do monorepo e buildar o `@auditar/shared` antes do web.
   - Com Root Directory = raiz, o Vercel lê o **`vercel.json` da RAIZ** do repositório (não o de `apps/web`). O arquivo **`vercel.json`** (raiz) já define:
     - `installCommand`: `npm ci`
     - `buildCommand`: `npm run build --workspace @auditar/shared && npm run build --workspace @auditar/web` (builda **só** shared + web; a **API não é buildada** no Vercel — ela roda no Render)
     - `outputDirectory`: `apps/web/dist`
     - `rewrites`: todas as rotas → `/index.html` (para o React Router funcionar em URLs profundas)
   - Se o Vercel não aplicar automaticamente esses comandos (por causa do Root Directory), cole-os manualmente nas configurações de **Build & Development Settings**, com **Output Directory = `apps/web/dist`**.
3. Em **Settings → Environment Variables**, adicione:
   - **`VITE_API_URL`** = `https://SEU-SERVICO-API.onrender.com/api/v1` (URL da API do passo f **+ o sufixo `/api/v1`**).
   > O axios e o Socket.io do frontend usam essa variável. Sem o sufixo `/api/v1`, as chamadas falham.
4. Faça o deploy. Ao final, anote a **URL do Vercel** (ex.: `https://auditar.vercel.app`).
5. **Volte ao Render** e atualize (aba Environment do `auditar-api`):
   - `CORS_ORIGINS` = `https://auditar.vercel.app`
   - `WEB_URL` = `https://auditar.vercel.app`
   - Salve (dispara redeploy).
6. **Volte ao Cloudflare R2** e atualize a **CORS Policy** dos buckets com a URL real do Vercel (passo d).

---

## h. Rodar o seed em produção (admin inicial)

O seed cria o **administrador inicial** e dados de demonstração. Ele é **idempotente**: se já existir um admin, ele não faz nada.

1. No Render, abra o serviço `auditar-api` → aba **Shell** (ou crie um **Job** único).
2. Rode:

```bash
npm run prisma:seed --workspace @auditar/api
```

3. Credenciais criadas pelo seed:

| Perfil | Login | Senha | Tela |
| --- | --- | --- | --- |
| **Admin** | CPF `00000000000` | `Admin@123` | `/admin/login` |
| Analista | CPF `11111111111` | `Analista@123` | `/admin/login` |
| Cidadão | CPF `22222222222` | `Cidadao@123` | `/login` |

> **Segurança:** essas credenciais são públicas neste guia. **Troque a senha do admin** logo após o primeiro login da demo. Não use este seed como base para produção real.

---

## i. Checklist final de teste

1. Abra a **URL do Vercel** no navegador (lembre do cold start do Render na 1ª chamada).
2. **Login do admin:** `/admin/login` com CPF `00000000000` / `Admin@123`.
3. **Cadastro de cidadão:** faça um novo cadastro pelo portal e verifique se o **e-mail de confirmação chega** (via Resend). Se estiver em modo teste do Resend, use o e-mail dono da conta Resend.
4. **Criar um processo** (pelo painel admin ou pelo portal do cidadão).
5. **Upload de documento:** anexe um arquivo a um processo — valida a integração com o R2 (presigned URL + CORS do bucket).
6. **Tempo real:** confirme que notificações/atualizações chegam (Socket.io usando o Redis do Upstash).

Se o upload falhar com erro de CORS no console do navegador, revise a **CORS Policy do bucket R2** (passo d) e o `CORS_ORIGINS` no Render (passo g).

---

## j. Custos e limites

Tudo abaixo cabe no **free tier** e é adequado para uma **demo**:

- **Render (free):** o serviço **dorme** após ~15 min sem tráfego; 1ª requisição ~30s. Horas de execução mensais limitadas.
- **Vercel (Hobby):** builds e hospedagem grátis para projetos pessoais/demo; limites de banda generosos.
- **Neon (free):** 1 projeto, storage limitado, o banco pode **suspender** após inatividade (religa sozinho na próxima conexão).
- **Upstash (free):** limite diário de comandos Redis (suficiente para demo).
- **Cloudflare R2 (free):** cota mensal de armazenamento e operações; **sem** custo de egress para a demo.
- **Resend (free):** ~**100 e-mails/dia** e ~3.000/mês; modo teste (sem domínio verificado) só envia para o e-mail dono da conta.

> Para uso além de demo/homologação, revise os planos pagos e endureça a configuração (segredos rotacionados, senha de admin trocada, backups do banco, domínio de e-mail verificado).

---

## Resumo dos arquivos deste deploy

- `render.yaml` (raiz) — Blueprint do serviço da API no Render.
- `vercel.json` (raiz) — build/rewrite do frontend na Vercel. Fica na **raiz** porque o Root Directory do projeto Vercel é a raiz do repo; buildCommand builda só `@auditar/shared` + `@auditar/web` (nunca a API). O build do web usa apenas `vite build` (sem type-check bloqueante); o type-check roda localmente/CI via `npm run typecheck:build --workspace @auditar/web`.
- `.env.production.example` (raiz) — template de todas as variáveis de produção.
- `apps/api/package.json` — novo script `prisma:migrate:deploy`.
- Ajustes de código para provedores gerenciados (retrocompatíveis com o local):
  - `apps/api/src/config/env.ts` — novas vars `REDIS_TLS` e `MINIO_REGION`.
  - `apps/api/src/config/redis.ts` e `config/bullmq.ts` — TLS para Upstash (`rediss://`).
  - `apps/api/src/config/minio.ts` — `region` para Cloudflare R2.
