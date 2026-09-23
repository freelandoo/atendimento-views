# Atendimento Views

Plataforma de **atendimento e vendas por WhatsApp com agente de IA**, mais o CRM comercial em
volta dele: aquisição de leads, banco de leads, conversas, follow-ups, central de ligações,
agenda, comissão e equipes — tudo **multiempresa**.

O agente recebe mensagens pela Evolution API, mantém conversa e perfil no PostgreSQL, decide a
próxima ação por um pipeline determinístico e usa Anthropic ou OpenAI para redigir a resposta.

## As duas partes

| | O que é | Stack | Deploy |
|---|---|---|---|
| **`backend/`** | API, regra de negócio, agente de IA, workers, integrações, banco | Node 20 + Express 5 + PostgreSQL (`pg`) | Railway, Root Directory `backend/` |
| **`frontend/`** | Interface do produto (operação comercial) | Next.js 14 (App Router) + React 18 + Tailwind | Vercel, Root Directory `frontend` |

O frontend fala com o backend por HTTP direto (`NEXT_PUBLIC_API_URL`), com JWT no header.
Não há BFF nem proxy.

> ⚠️ **O backend serve duas gerações de produto ao mesmo tempo.** Além da API multiempresa
> (`/api/empresas/:empresaId/*`) que o `frontend/` consome, ele ainda serve um **dashboard
> estático legado** em `backend/public/` sobre rotas `/dashboard/*`, com outra autenticação.
> Ele está vivo e em uso, mas **cercado**: não pode crescer. Código novo nasce sempre na
> geração multiempresa. Ver `docs/project-map.md`.

## Rodando localmente

**1. Infraestrutura** (Postgres + Redis + Evolution API):

```bash
docker compose up -d postgres redis evolution-api
```

O compose também define um serviço `webhook`, que sobe o **backend dentro do Docker**. Para
desenvolver, prefira subir só a infraestrutura acima e rodar o backend no host (passo 2) —
assim você edita e reinicia sem rebuild de imagem.

O `docker-compose.override.yml` publica o Postgres em **5433** no host (a 5432 costuma estar
ocupada pelo Postgres nativo).

**2. Backend** — crie `backend/.env` a partir de `backend/.env.example`:

```bash
cd backend
npm install
npm start          # porta 3000
```

Obrigatórias no boot (sem elas o processo aborta, por `validarSecretsBoot` em `index.js`):

| Variável | Para quê |
|---|---|
| `ANTHROPIC_KEY`/`ANTHROPIC_API_KEY` **ou** `OPENAI_KEY`/`OPENAI_API_KEY` | ao menos um provedor de IA |
| `EVOLUTION_API_KEY` | integração com o WhatsApp |
| `REPROCESS_SECRET` | mín. 8 caracteres — protege `/dashboard/*` e `/webhook` |
| `DASHBOARD_ADMIN_EMAIL` e `DASHBOARD_ADMIN_PASSWORD` | primeiro admin (senha mín. 12) |
| `JWT_SECRET` | obrigatória **em produção** — assina o login do SaaS |

⚠️ **O boot aplica as 91 migrations** no banco apontado por `DATABASE_URL`. Confira para onde
seu `.env` aponta antes de rodar `npm start`.

**3. Frontend:**

```bash
cd frontend
npm install
npm run dev -- -p 3001     # SEMPRE 3001
```

⚠️ Rode **um** `next dev` por vez: duas instâncias compartilhando `.next` corrompem o build e a
tela passa a "não fazer nada". Aponte `NEXT_PUBLIC_API_URL=http://localhost:3000` no
`frontend/.env.local`.

## Validação

Não existe `build` nem `lint` no backend, e o frontend **não tem ESLint configurado**
(`npm run lint` abre prompt interativo e trava). O portão real é:

```bash
# backend/
npm run typecheck      # tsc --noEmit
npm test               # ~2.955 testes — deve sair com exit 0, sem falha tolerada
npm run smoke:preco    # smoke de precificação (não toca o banco)

# frontend/
npx tsc --noEmit
npm test               # node --test lib/*.test.js
npm run build
```

⚠️ **Nunca rode `node --test` sem argumento** no backend: o padrão de descoberta do Node captura
`scripts/test-evolution-send.js`, que **envia mensagem real de WhatsApp**. O `npm test` usa o
glob `test/*.test.js` justamente para não alcançá-lo.

Além dos testes de regra, a suíte tem guardas estruturais que quebram o build de propósito:
o **contrato das 427 rotas** montadas, a **cerca da geração legada**, a **integridade das
migrations** e a **autorização por capacidade** rota a rota.

**Tudo isso roda automaticamente** em todo push e pull request
(`.github/workflows/ci.yml`) — sem nenhum segredo configurado, porque a suíte é hermética. Há
ainda um job que carrega a aplicação no **Node 20**, o runtime do Docker, para incompatibilidade
com produção aparecer no CI e não na subida do container.

## Onde ler o quê

| Documento | Para quê |
|---|---|
| **`AGENTS.md`** | **fonte viva.** Decisões, defeitos corrigidos e o porquê de cada regra. Quando algo divergir, ele vence |
| `CLAUDE.md` | como agentes de IA devem trabalhar neste repositório |
| `docs/project-map.md` | mapa de pastas e responsabilidades, com números medidos |
| `docs/architecture-rules.md` | a lei técnica (o que pode e o que não pode) |
| `docs/GUIA-VISUAL-PJ-CODEWORKS.md` | padrão visual — obrigatório em qualquer tarefa de tela |
| `ARCHITECTURE_AUDIT.md` | auditoria arquitetural de 2026-09-21 |
| `LEGACY_REVIEW.md` | o que parece morto e aguarda decisão — **não apague nada dali sem revisar** |
| `docs/historico/` | iniciativas encerradas. Não descrevem o sistema atual |
