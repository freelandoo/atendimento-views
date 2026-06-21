# Entrega A — Identidade & Acesso (Design)

Data: 2026-06-20
Status: aprovado (Abordagem 1, delegação de decisões pelo usuário)
Escopo: primeira de duas entregas do redesenho multi-tenant. A Entrega B (Motor de
Leads Compartilhado) é uma spec separada e depende desta.

---

## 1. Objetivo

Transformar o agente em SaaS multiusuário com três papéis, onde:

- Qualquer pessoa pode se cadastrar (signup público) como **usuário normal** e entra
  com a plataforma **zerada** — configura a própria empresa, instância e contexto.
- **Admins** (Pércio, João, Alex) têm seu próprio espaço isolado (instâncias/conversas)
  mas, na Entrega B, compartilham o banco de leads.
- O **superadmin** cria/promove contas e enxerga tudo.

Cada usuário só vê os próprios dados. Billing/planos ficam **fora** desta entrega —
apenas deixamos ganchos no schema.

## 2. Abordagem escolhida

**Abordagem 1 — Uma empresa por conta.** Reusa a infra multiempresa existente
(`app.empresas`, `app.usuarios`, `app.usuarios_empresas`, `empresa_id` nas tabelas
`vendas.*`, middleware `requireAuth`/`requireEmpresaAccess`, JWT). O "espaço isolado"
de cada conta é a empresa criada no signup. Roles em `app.usuarios` controlam o gating
de páginas. Mudança de menor risco, 100% aditiva.

## 3. Modelo de dados

Migration nova idempotente: `sql/migrations/005_identidade_acesso.sql`.

```sql
-- Ganchos de billing (sem lógica nesta entrega)
ALTER TABLE app.usuarios ADD COLUMN IF NOT EXISTS plano TEXT NOT NULL DEFAULT 'free';
ALTER TABLE app.usuarios ADD COLUMN IF NOT EXISTS assinatura_status TEXT NOT NULL DEFAULT 'ativa';
ALTER TABLE app.usuarios ADD COLUMN IF NOT EXISTS onboarding_completo BOOLEAN NOT NULL DEFAULT false;

-- Dono direto da empresa (atalho; o vínculo N:N continua sendo a fonte de verdade de acesso)
ALTER TABLE app.empresas ADD COLUMN IF NOT EXISTS criada_por UUID REFERENCES app.usuarios(id);

CREATE INDEX IF NOT EXISTS idx_empresas_criada_por ON app.empresas (criada_por);
```

Constraints relevantes já existentes:
- `app.usuarios.role` ∈ (`superadmin`, `admin`, `user`)
- `app.usuarios_empresas.role` ∈ (`owner`, `admin`, `member`)
- `app.usuarios.email` UNIQUE; `app.empresas.slug` UNIQUE

Mapa de papéis (semântico):
- `user` — conta normal isolada (signup público cai aqui).
- `admin` — compartilha o banco de leads (Entrega B); empresa/instância próprias.
- `superadmin` — gerencia contas, enxerga tudo (já tratado em `requireEmpresaAccess`).

## 4. Signup + onboarding zerado

### 4.1 Endpoint `POST /api/auth/signup`
Body: `{ email, password, nome }`.

Validações:
- `email` formato válido e único (409 `EMAIL_EXISTS` se já existir).
- `password` ≥ 8 caracteres (400 `WEAK_PASSWORD`).
- `nome` obrigatório (usado como nome inicial da empresa).

Fluxo (transação única):
1. `INSERT app.usuarios (email, nome, password_hash, role='user')`.
2. `INSERT app.empresas (nome, slug, criada_por)` — `slug` = slugify(nome) + sufixo
   curto aleatório, garantindo unicidade.
3. `INSERT app.usuarios_empresas (usuario_id, empresa_id, role='owner')`.
4. Retorna `{ token, usuario, empresas:[empresa] }` (auto-login).

`role` é **sempre** `user` no signup — ignora qualquer `role` vindo do cliente
(previne escalonamento). Só o superadmin promove (seção 6).

### 4.2 Onboarding zerado
A empresa nova nasce sem conversas, leads, instância ou contexto — a plataforma já
fica naturalmente vazia. O front mostra um wizard enquanto `onboarding_completo=false`:
1. Empresa & contexto (briefing).
2. Conectar WhatsApp (criar instância Evolution via tela de Empresa).

`onboarding_completo` vira `true` quando a conta tem ≥1 instância ativa **e** ≥1
contexto salvo (checado no backend ao salvar contexto/instância).

## 5. Gating de páginas (front + back)

### 5.1 Backend — `requireRole(...roles)`
Novo middleware em `src/middleware/tenant.js`. Usa `req.usuario.role` (já populado por
`requireAuth`). `superadmin` passa em tudo. Retorna 403 `FORBIDDEN` caso contrário.

Aplicado aos grupos de rota **admin-only**:
- Relatórios (`api-relatorios`)
- Custos / uso LLM (`api-llm`, `api-llm-uso`)
- Aquisição / prospecção (rotas de prospecting)
- Banco de leads (rotas de prospects)

### 5.2 Frontend — gating por role
`GET /api/auth/me` já retorna `role`. No carregamento do dashboard:
- Um helper em `core.js` lê o role e alterna elementos marcados com `data-role="admin"`
  / `data-role="superadmin"` (esconde o que o usuário não pode ver).
- Cada página admin-only verifica o role no load e redireciona para Visão Geral se não
  autorizado (defesa no front; a autorização real é no backend).

Mapa página → papel:

| Página              | user | admin | superadmin |
|---------------------|:----:|:-----:|:----------:|
| Visão Geral         |  ✅  |  ✅   |    ✅      |
| Conversas           |  ✅  |  ✅   |    ✅      |
| Lead Scans (quentes)|  ✅  |  ✅   |    ✅      |
| Agenda              |  ✅  |  ✅   |    ✅      |
| Empresa             |  ✅  |  ✅   |    ✅      |
| Relatórios          |  —   |  ✅   |    ✅      |
| Custos / LLM        |  —   |  ✅   |    ✅      |
| Aquisição           |  —   |  ✅   |    ✅      |
| Banco de Leads      |  —   |  ✅   |    ✅      |
| Gestão de Contas    |  —   |  —    |    ✅      |

"Lead Scans" = página de **leads quentes do próprio usuário**: lista os leads das
conversas dele, mantendo score de interesse e score de temperatura, destacando quem
está respondendo bem. Escopada por `empresa_id` (a empresa da conta).

## 6. Tela de superadmin (gestão de contas)

Rotas atrás de `requireRole('superadmin')`:
- `GET /api/admin/usuarios` — lista (email, nome, role, ativo, último login).
- `POST /api/admin/usuarios` — cria conta escolhendo o role (`user`/`admin`).
- `PATCH /api/admin/usuarios/:id` — altera role e ativa/desativa.

UI simples: tabela de usuários + formulário de criação + toggle de role/ativo.

## 7. Erros, segurança e testes

### 7.1 Padrão de erro
`{ ok:false, error:{ code, message } }` (consistente com o restante da API).

### 7.2 Segurança
- `JWT_SECRET` **obrigatório** em produção (hoje cai num default `CHANGE_ME` — boot
  deve falhar/avisar se não definido em prod).
- Signup nunca aceita `role` do cliente (sempre `user`).
- Rate-limit básico em `signup` e `login` (mitiga brute force / abuso de cadastro).
- Isolamento por `empresa_id` em toda rota de dados; nunca confiar em `empresa_id` do
  cliente sem `requireEmpresaAccess`.
- Senha ≥ 8; hashing scrypt já existente.

### 7.3 Testes
- `signup` cria usuário+empresa+vínculo `owner` e `role='user'`; rejeita email duplicado
  e senha fraca; ignora `role` malicioso no body.
- `requireRole` retorna 403 para role insuficiente e passa para `superadmin`.
- Isolamento: usuário da empresa A não lê dados da empresa B (estende
  `test/multitenant.test.js`).
- Rotas de superadmin: 403 para não-superadmin; criação/promoção funcionam.

## 8. Fora de escopo (futuro)
- Billing, assinatura paga e planos com preços (apenas ganchos `plano`/`assinatura_status`).
- Entrega B: banco de leads compartilhado, trava de 15 dias, separação aquisição↔abordagem.
- Recuperação de senha / verificação de email (anotar como follow-up).

## 9. Arquivos impactados (previsão)
- `sql/migrations/005_identidade_acesso.sql` (novo)
- `src/routes/api-auth.js` (+ signup)
- `src/db/usuarios.js` (+ criar usuário, criar empresa, onboarding)
- `src/middleware/tenant.js` (+ `requireRole`)
- `src/routes/api-admin-usuarios.js` (novo) + registro em `src/routes.js`
- Aplicar `requireRole` nas rotas admin existentes (relatórios, llm, prospecting, prospects)
- `public/dashboard/` — gating de nav/páginas + telas de signup, onboarding, gestão de contas
- `test/` — novos testes (signup, requireRole, isolamento, superadmin)
