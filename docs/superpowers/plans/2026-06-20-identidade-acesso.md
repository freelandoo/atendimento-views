# Entrega A — Identidade & Acesso Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Habilitar SaaS multiusuário com signup público (usuário normal entra zerado), isolamento por empresa, gating de páginas por papel (`user`/`admin`/`superadmin`) e tela de superadmin para gerenciar contas.

**Architecture:** Abordagem 1 — uma empresa por conta, reusando a infra multiempresa existente (`app.empresas`, `app.usuarios`, `app.usuarios_empresas`, `empresa_id`, JWT, `requireAuth`/`requireEmpresaAccess`). Mudanças aditivas: migration 005, endpoint de signup transacional, middleware `requireRole`, rotas de gestão de contas, gating no front estático.

**Tech Stack:** Node.js 20, Express 5, PostgreSQL 15 (`pg`), `jsonwebtoken`, scrypt (crypto nativo), testes com `node:test`, dashboard estático (HTML + vanilla JS).

**Nota de ambiente:** o repositório local ainda não tem git inicializado. Os passos de `git commit` assumem `git init` feito no diretório `atendimento-views-master`. Se não for usar git, trate os passos de commit como checkpoints lógicos.

---

## File Structure

- `sql/migrations/005_identidade_acesso.sql` — **novo**: colunas de gancho + `criada_por` + índice.
- `src/string-utils.js` — **modificar**: `slugify` + `gerarSlugEmpresa`.
- `src/middleware/tenant.js` — **modificar**: `requireRole(...roles)`.
- `src/db/usuarios.js` — **modificar**: `existsEmail`, `signupUsuario` (transacional), `listUsuarios`, `createUsuarioPorAdmin`, `updateUsuarioRole`, `setUsuarioAtivo`, `marcarOnboardingCompleto`.
- `src/auth-validation.js` — **novo**: `validarSignup(body)` (validação pura, testável sem DB).
- `src/routes/api-auth.js` — **modificar**: `POST /signup`.
- `src/routes/api-admin-usuarios.js` — **novo**: CRUD de contas (superadmin).
- `src/rate-limit.js` — **novo**: limiter em memória (sem dependência nova).
- `src/routes.js` — **modificar**: registrar rotas novas; aplicar `requireRole` nos grupos admin.
- `public/dashboard/js/core.js` — **modificar**: helper de gating por papel.
- `public/dashboard/signup.html` + `public/dashboard/js/signup.js` — **novo**: tela de cadastro.
- `public/dashboard/js/onboarding.js` — **novo**: wizard de onboarding.
- `public/dashboard/contas.html` + `public/dashboard/js/contas.js` — **novo**: gestão de contas (superadmin).
- `test/auth-signup.test.js`, `test/require-role.test.js`, `test/slug.test.js` — **novos**.

---

## Task 1: Migration 005 (modelo de dados)

**Files:**
- Create: `sql/migrations/005_identidade_acesso.sql`

- [ ] **Step 1: Escrever a migration idempotente**

```sql
-- Migration 005: Identidade & Acesso
-- Idempotente. Apenas aditiva — nunca dropa colunas/tabelas.

-- Ganchos de billing (sem lógica nesta entrega)
ALTER TABLE app.usuarios ADD COLUMN IF NOT EXISTS plano TEXT NOT NULL DEFAULT 'free';
ALTER TABLE app.usuarios ADD COLUMN IF NOT EXISTS assinatura_status TEXT NOT NULL DEFAULT 'ativa';
ALTER TABLE app.usuarios ADD COLUMN IF NOT EXISTS onboarding_completo BOOLEAN NOT NULL DEFAULT false;

-- Dono direto da empresa (atalho de leitura; o vínculo N:N segue sendo a fonte de verdade de acesso)
ALTER TABLE app.empresas ADD COLUMN IF NOT EXISTS criada_por UUID REFERENCES app.usuarios(id);

CREATE INDEX IF NOT EXISTS idx_empresas_criada_por ON app.empresas (criada_por);
```

- [ ] **Step 2: Verificar que o runner de migrations aplica o arquivo**

Run: `node -e "console.log(require('fs').readFileSync('sql/migrations/005_identidade_acesso.sql','utf8').length)"`
Expected: imprime um número > 0 (arquivo legível). O `src/db/migrations.js` aplica todos os `.sql` de `sql/migrations` em ordem e registra em `app.schema_migrations`.

- [ ] **Step 3: Commit**

```bash
git add sql/migrations/005_identidade_acesso.sql
git commit -m "feat(db): migration 005 identidade & acesso (ganchos billing + criada_por)"
```

---

## Task 2: `slugify` e `gerarSlugEmpresa`

**Files:**
- Modify: `src/string-utils.js`
- Test: `test/slug.test.js`

- [ ] **Step 1: Escrever o teste que falha**

```js
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { slugify, gerarSlugEmpresa } = require('../src/string-utils')

test('slugify — minúsculas, sem acento, hífens', () => {
  assert.equal(slugify('Barbearia Top Ltda'), 'barbearia-top-ltda')
  assert.equal(slugify('Açaí & Cia'), 'acai-cia')
  assert.equal(slugify('  espaços   extras  '), 'espacos-extras')
})

test('slugify — string vazia vira fallback', () => {
  assert.equal(slugify(''), '')
  assert.equal(slugify(null), '')
})

test('gerarSlugEmpresa — anexa sufixo aleatório e nunca vazio', () => {
  const s = gerarSlugEmpresa('Minha Empresa')
  assert.match(s, /^minha-empresa-[a-z0-9]{6}$/)
  const s2 = gerarSlugEmpresa('')
  assert.match(s2, /^empresa-[a-z0-9]{6}$/)
})
```

- [ ] **Step 2: Rodar o teste e confirmar a falha**

Run: `node --test test/slug.test.js`
Expected: FAIL — `slugify`/`gerarSlugEmpresa is not a function`.

- [ ] **Step 3: Implementar em `src/string-utils.js`**

Adicionar ao final do arquivo (antes do `module.exports`, e incluir os nomes no export existente):

```js
function slugify(texto) {
  if (!texto) return ''
  return String(texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function gerarSlugEmpresa(nome) {
  const base = slugify(nome) || 'empresa'
  const sufixo = Math.random().toString(36).slice(2, 8).padEnd(6, '0')
  return `${base}-${sufixo}`
}
```

Garantir no `module.exports`: `module.exports = { ...(exports já existentes), slugify, gerarSlugEmpresa }`.

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `node --test test/slug.test.js`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/string-utils.js test/slug.test.js
git commit -m "feat(utils): slugify e gerarSlugEmpresa"
```

---

## Task 3: Middleware `requireRole`

**Files:**
- Modify: `src/middleware/tenant.js`
- Test: `test/require-role.test.js`

- [ ] **Step 1: Escrever o teste que falha**

```js
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { requireRole } = require('../src/middleware/tenant')

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
  }
}

test('requireRole — 401 se não houver req.usuario', () => {
  const res = mockRes()
  let nextCalled = false
  requireRole('admin')({}, res, () => { nextCalled = true })
  assert.equal(res.statusCode, 401)
  assert.equal(nextCalled, false)
})

test('requireRole — 403 para papel insuficiente', () => {
  const res = mockRes()
  let nextCalled = false
  requireRole('admin')({ usuario: { role: 'user' } }, res, () => { nextCalled = true })
  assert.equal(res.statusCode, 403)
  assert.equal(nextCalled, false)
})

test('requireRole — passa para papel permitido', () => {
  const res = mockRes()
  let nextCalled = false
  requireRole('admin')({ usuario: { role: 'admin' } }, res, () => { nextCalled = true })
  assert.equal(nextCalled, true)
})

test('requireRole — superadmin passa em qualquer rota admin', () => {
  const res = mockRes()
  let nextCalled = false
  requireRole('admin')({ usuario: { role: 'superadmin' } }, res, () => { nextCalled = true })
  assert.equal(nextCalled, true)
})
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `node --test test/require-role.test.js`
Expected: FAIL — `requireRole is not a function`.

- [ ] **Step 3: Implementar em `src/middleware/tenant.js`**

Adicionar a função e incluí-la no `module.exports`:

```js
// Exige que req.usuario.role esteja entre os papéis permitidos.
// superadmin sempre passa. Deve rodar após requireAuth.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.usuario || !req.usuario.role) {
      return res.status(401).json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Autenticação necessária.' } })
    }
    if (req.usuario.role === 'superadmin' || roles.includes(req.usuario.role)) {
      return next()
    }
    return res.status(403).json({ ok: false, error: { code: 'FORBIDDEN', message: 'Acesso restrito.' } })
  }
}
```

Atualizar export: `module.exports = { requireAuth, requireEmpresaAccess, resolveEmpresaFromWebhook, requireRole }`.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/require-role.test.js`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/middleware/tenant.js test/require-role.test.js
git commit -m "feat(auth): middleware requireRole"
```

---

## Task 4: Validação pura de signup

**Files:**
- Create: `src/auth-validation.js`
- Test: `test/auth-signup.test.js`

- [ ] **Step 1: Escrever o teste que falha**

```js
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { validarSignup } = require('../src/auth-validation')

test('validarSignup — rejeita email inválido', () => {
  const r = validarSignup({ email: 'naoEmail', password: 'segredo12', nome: 'Ana' })
  assert.equal(r.ok, false)
  assert.equal(r.error.code, 'BAD_REQUEST')
})

test('validarSignup — rejeita senha curta', () => {
  const r = validarSignup({ email: 'a@b.com', password: '123', nome: 'Ana' })
  assert.equal(r.ok, false)
  assert.equal(r.error.code, 'WEAK_PASSWORD')
})

test('validarSignup — exige nome', () => {
  const r = validarSignup({ email: 'a@b.com', password: 'segredo12', nome: '  ' })
  assert.equal(r.ok, false)
  assert.equal(r.error.code, 'BAD_REQUEST')
})

test('validarSignup — normaliza e aceita entrada válida; role nunca vem do cliente', () => {
  const r = validarSignup({ email: '  A@B.COM ', password: 'segredo12', nome: ' Ana ', role: 'superadmin' })
  assert.equal(r.ok, true)
  assert.equal(r.data.email, 'a@b.com')
  assert.equal(r.data.nome, 'Ana')
  assert.equal(r.data.role, 'user')
})
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `node --test test/auth-signup.test.js`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/auth-validation.js`**

```js
'use strict'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD = 8

// Valida e normaliza o corpo do signup. role é SEMPRE 'user' (anti-escalonamento).
function validarSignup(body) {
  const email = String(body?.email || '').trim().toLowerCase()
  const password = String(body?.password || '')
  const nome = String(body?.nome || '').trim()

  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: { code: 'BAD_REQUEST', message: 'Email inválido.' } }
  }
  if (!nome) {
    return { ok: false, error: { code: 'BAD_REQUEST', message: 'Nome obrigatório.' } }
  }
  if (password.length < MIN_PASSWORD) {
    return { ok: false, error: { code: 'WEAK_PASSWORD', message: `Senha precisa de ao menos ${MIN_PASSWORD} caracteres.` } }
  }
  return { ok: true, data: { email, password, nome, role: 'user' } }
}

module.exports = { validarSignup, MIN_PASSWORD }
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/auth-signup.test.js`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/auth-validation.js test/auth-signup.test.js
git commit -m "feat(auth): validação pura de signup (anti-escalonamento de role)"
```

---

## Task 5: Funções de DB para signup e contas

**Files:**
- Modify: `src/db/usuarios.js`

> Sem teste unitário automatizado (depende de DB real). Validação por integração na Task 11 / smoke manual.

- [ ] **Step 1: Adicionar funções em `src/db/usuarios.js`**

Importar `gerarSlugEmpresa` no topo e o `hashPassword` (de `../auth`) quando necessário no caller; aqui usamos `password_hash` já pronto.

```js
const { gerarSlugEmpresa } = require('../string-utils')

async function existsEmail(email) {
  const { rows } = await pool.query('SELECT 1 FROM app.usuarios WHERE email = $1', [email])
  return rows.length > 0
}

// Cria usuário (role 'user') + empresa própria + vínculo owner, numa transação.
// Retorna { usuario, empresa }.
async function signupUsuario({ email, nome, password_hash }) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: [usuario] } = await client.query(
      `INSERT INTO app.usuarios (email, nome, password_hash, role)
       VALUES ($1, $2, $3, 'user')
       RETURNING id, email, nome, role`,
      [email, nome, password_hash]
    )
    // slug único com no máx. algumas tentativas
    let empresa = null
    for (let i = 0; i < 5 && !empresa; i++) {
      const slug = gerarSlugEmpresa(nome)
      try {
        const { rows: [e] } = await client.query(
          `INSERT INTO app.empresas (nome, slug, criada_por)
           VALUES ($1, $2, $3) RETURNING *`,
          [nome, slug, usuario.id]
        )
        empresa = e
      } catch (err) {
        if (err.code !== '23505') throw err // 23505 = unique_violation no slug → tenta de novo
      }
    }
    if (!empresa) throw new Error('Não foi possível gerar slug único de empresa.')

    await client.query(
      `INSERT INTO app.usuarios_empresas (usuario_id, empresa_id, role)
       VALUES ($1, $2, 'owner')`,
      [usuario.id, empresa.id]
    )
    await client.query('COMMIT')
    return { usuario, empresa }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function listUsuarios() {
  const { rows } = await pool.query(
    `SELECT id, email, nome, role, ativo, plano, assinatura_status, onboarding_completo,
            ultimo_login_em, criado_em
     FROM app.usuarios ORDER BY criado_em DESC`
  )
  return rows
}

// Criação por superadmin: role pode ser 'user' ou 'admin'.
async function createUsuarioPorAdmin({ email, nome, password_hash, role }) {
  const roleFinal = role === 'admin' ? 'admin' : 'user'
  const { rows: [u] } = await pool.query(
    `INSERT INTO app.usuarios (email, nome, password_hash, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, nome, role, ativo`,
    [email, nome, password_hash, roleFinal]
  )
  return u
}

async function updateUsuarioRole(id, role) {
  if (!['user', 'admin', 'superadmin'].includes(role)) throw new Error('Role inválido.')
  const { rows: [u] } = await pool.query(
    `UPDATE app.usuarios SET role = $2, atualizado_em = NOW()
     WHERE id = $1 RETURNING id, email, nome, role, ativo`,
    [id, role]
  )
  return u || null
}

async function setUsuarioAtivo(id, ativo) {
  const { rows: [u] } = await pool.query(
    `UPDATE app.usuarios SET ativo = $2, atualizado_em = NOW()
     WHERE id = $1 RETURNING id, email, nome, role, ativo`,
    [id, !!ativo]
  )
  return u || null
}

// Marca onboarding como completo se a empresa já tem >=1 instância ativa e >=1 contexto.
async function marcarOnboardingCompleto(usuario_id, empresa_id) {
  const { rows: [r] } = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM app.empresa_whatsapp_instances WHERE empresa_id = $1 AND ativo = true) AS inst,
       (SELECT COUNT(*) FROM app.empresa_contextos WHERE empresa_id = $1 AND ativo = true) AS ctx`,
    [empresa_id]
  )
  if (Number(r.inst) > 0 && Number(r.ctx) > 0) {
    await pool.query('UPDATE app.usuarios SET onboarding_completo = true WHERE id = $1', [usuario_id])
    return true
  }
  return false
}
```

Atualizar o `module.exports` para incluir: `existsEmail, signupUsuario, listUsuarios, createUsuarioPorAdmin, updateUsuarioRole, setUsuarioAtivo, marcarOnboardingCompleto` (além dos já exportados).

- [ ] **Step 2: Sanidade — o módulo carrega sem erro de sintaxe**

Run: `node -e "const m=require('./src/db/usuarios'); console.log(Object.keys(m).sort().join(','))"`
Expected: imprime a lista incluindo `signupUsuario`, `listUsuarios`, `requireRole`-NA (não), etc. Sem stack trace.

- [ ] **Step 3: Commit**

```bash
git add src/db/usuarios.js
git commit -m "feat(db): signup transacional + funções de gestão de contas"
```

---

## Task 6: Endpoint `POST /api/auth/signup`

**Files:**
- Modify: `src/routes/api-auth.js`

- [ ] **Step 1: Adicionar a rota de signup**

No topo, importar o necessário:

```js
const { hashPassword } = require('../auth')
const { validarSignup } = require('../auth-validation')
const { existsEmail, signupUsuario } = require('../db/usuarios')
const { signupLimiter, loginLimiter } = require('../rate-limit')
```

Adicionar a rota (antes do `module.exports`):

```js
// POST /api/auth/signup — cadastro público (cria usuário 'user' + empresa própria)
router.post('/signup', signupLimiter, async (req, res) => {
  const v = validarSignup(req.body || {})
  if (!v.ok) return res.status(400).json({ ok: false, error: v.error })

  try {
    if (await existsEmail(v.data.email)) {
      return res.status(409).json({ ok: false, error: { code: 'EMAIL_EXISTS', message: 'Email já cadastrado.' } })
    }
    const password_hash = await hashPassword(v.data.password)
    const { usuario, empresa } = await signupUsuario({
      email: v.data.email, nome: v.data.nome, password_hash,
    })
    const token = signJwt({ sub: usuario.id, role: usuario.role })
    return res.status(201).json({
      ok: true,
      data: {
        token,
        usuario: { id: usuario.id, email: usuario.email, nome: usuario.nome, role: usuario.role },
        empresas: [{ ...empresa, role_usuario: 'owner' }],
      },
    })
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ ok: false, error: { code: 'EMAIL_EXISTS', message: 'Email já cadastrado.' } })
    }
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL', message: 'Falha ao criar conta.' } })
  }
})
```

Adicionar também o `loginLimiter` na rota `/login` existente: trocar `router.post('/login', async (req, res)` por `router.post('/login', loginLimiter, async (req, res)`.

- [ ] **Step 2: Sanidade de carregamento**

Run: `node -e "require('./src/routes/api-auth'); console.log('ok')"`
Expected: `ok` (depende da Task 7 criar `src/rate-limit.js` antes — se rodar isolado, criar o rate-limit primeiro).

- [ ] **Step 3: Commit**

```bash
git add src/routes/api-auth.js
git commit -m "feat(auth): endpoint POST /api/auth/signup com auto-login"
```

---

## Task 7: Rate limiter em memória

**Files:**
- Create: `src/rate-limit.js`

- [ ] **Step 1: Implementar limiter simples (sem dependência nova)**

```js
'use strict'

// Limiter em memória por IP. Janela deslizante simples. Suficiente para mitigar
// brute force/abuso de cadastro num único processo. (Multi-instância → trocar por Redis.)
function criarLimiter({ windowMs, max, code = 'RATE_LIMITED', message = 'Muitas tentativas. Tente mais tarde.' }) {
  const hits = new Map() // ip → [timestamps]
  return (req, res, next) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'desconhecido'
    const agora = Date.now()
    const lista = (hits.get(ip) || []).filter(t => agora - t < windowMs)
    lista.push(agora)
    hits.set(ip, lista)
    if (lista.length > max) {
      return res.status(429).json({ ok: false, error: { code, message } })
    }
    next()
  }
}

const signupLimiter = criarLimiter({ windowMs: 60 * 60 * 1000, max: 10 })  // 10 cadastros/h por IP
const loginLimiter = criarLimiter({ windowMs: 15 * 60 * 1000, max: 20 })   // 20 logins/15min por IP

module.exports = { criarLimiter, signupLimiter, loginLimiter }
```

- [ ] **Step 2: Sanidade**

Run: `node -e "const m=require('./src/rate-limit'); console.log(typeof m.signupLimiter, typeof m.loginLimiter)"`
Expected: `function function`.

- [ ] **Step 3: Commit**

```bash
git add src/rate-limit.js
git commit -m "feat(security): rate limiter em memória para signup/login"
```

---

## Task 8: Rotas de gestão de contas (superadmin)

**Files:**
- Create: `src/routes/api-admin-usuarios.js`

- [ ] **Step 1: Implementar o router**

```js
'use strict'
const { Router } = require('express')
const { hashPassword } = require('../auth')
const { requireAuth, requireRole } = require('../middleware/tenant')
const {
  listUsuarios, createUsuarioPorAdmin, updateUsuarioRole, setUsuarioAtivo, existsEmail,
} = require('../db/usuarios')

const router = Router()
router.use(requireAuth, requireRole('superadmin'))

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// GET /api/admin/usuarios
router.get('/usuarios', async (_req, res) => {
  try {
    return res.json({ ok: true, data: await listUsuarios() })
  } catch {
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL', message: 'Falha ao listar usuários.' } })
  }
})

// POST /api/admin/usuarios  { email, nome, password, role }
router.post('/usuarios', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  const nome = String(req.body?.nome || '').trim()
  const password = String(req.body?.password || '')
  const role = req.body?.role === 'admin' ? 'admin' : 'user'

  if (!EMAIL_RE.test(email) || !nome || password.length < 8) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Email, nome e senha (≥8) obrigatórios.' } })
  }
  try {
    if (await existsEmail(email)) {
      return res.status(409).json({ ok: false, error: { code: 'EMAIL_EXISTS', message: 'Email já cadastrado.' } })
    }
    const password_hash = await hashPassword(password)
    const u = await createUsuarioPorAdmin({ email, nome, password_hash, role })
    return res.status(201).json({ ok: true, data: u })
  } catch {
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL', message: 'Falha ao criar conta.' } })
  }
})

// PATCH /api/admin/usuarios/:id  { role?, ativo? }
router.patch('/usuarios/:id', async (req, res) => {
  const { id } = req.params
  try {
    let atual = null
    if (typeof req.body?.role === 'string') {
      atual = await updateUsuarioRole(id, req.body.role)
    }
    if (typeof req.body?.ativo === 'boolean') {
      atual = await setUsuarioAtivo(id, req.body.ativo)
    }
    if (!atual) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Usuário não encontrado ou nada a alterar.' } })
    return res.json({ ok: true, data: atual })
  } catch (err) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: err.message } })
  }
})

function registerAdminUsuariosRoutes(app) {
  app.use('/api/admin', router)
}

module.exports = { registerAdminUsuariosRoutes, router }
```

- [ ] **Step 2: Sanidade**

Run: `node -e "require('./src/routes/api-admin-usuarios'); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add src/routes/api-admin-usuarios.js
git commit -m "feat(admin): rotas de gestão de contas (superadmin)"
```

---

## Task 9: Registrar rotas e aplicar `requireRole` nos grupos admin

**Files:**
- Modify: `src/routes.js`
- Modify: arquivos de rota admin (relatórios, LLM, prospecting, prospects)

> O registro exato das rotas admin depende de como cada módulo monta seus paths. Padrão: cada grupo admin recebe `requireAuth, requireRole('admin')` no `app.use` correspondente, OU dentro do próprio módulo. Abaixo o registro central das novas rotas; a aplicação do `requireRole` nas rotas existentes segue o mesmo padrão de `router.use(...)`.

- [ ] **Step 1: Registrar `api-auth` e `api-admin-usuarios` em `src/routes.js`**

```js
'use strict'

module.exports = function registerRoutes(app) {
  const { registerHttpRoutes } = require('./agent')
  const { registerProspectingRoutes } = require('./prospecting')
  const { registerAgendaRoutes } = require('./agenda')
  const { registerAIRoutes } = require('./ai-routes')
  const apiAuth = require('./routes/api-auth')
  const { registerAdminUsuariosRoutes } = require('./routes/api-admin-usuarios')

  app.use('/api/auth', apiAuth)
  registerAdminUsuariosRoutes(app)

  registerHttpRoutes(app)
  registerProspectingRoutes(app)
  registerAgendaRoutes(app)
  registerAIRoutes(app)
}
```

- [ ] **Step 2: Proteger as rotas admin-only**

Em cada módulo de rota admin (relatórios, custos/LLM `api-llm`/`api-llm-uso`, prospecting, prospects), localizar o `Router()` correspondente e adicionar, logo após a criação do router:

```js
const { requireAuth, requireRole } = require('../middleware/tenant')
router.use(requireAuth, requireRole('admin'))
```

Para rotas montadas direto em `app` (sem Router próprio), envolver o handler com `requireAuth, requireRole('admin')` na assinatura. Conferir cada path de: Relatórios, Aquisição/Prospecção, Banco de Leads, Custos/LLM.

- [ ] **Step 3: Sanidade — app inicia o registro de rotas sem lançar**

Run: `node -e "const e=require('express'); const a=e(); require('./src/routes')(a); console.log('rotas ok')"`
Expected: `rotas ok` (sem stack trace). Conexões a DB só ocorrem em runtime das rotas, não no registro.

- [ ] **Step 4: Commit**

```bash
git add src/routes.js src/routes/ src/prospecting.js
git commit -m "feat(auth): registrar signup/admin e aplicar requireRole nas rotas admin"
```

---

## Task 10: Boot guard de `JWT_SECRET` em produção

**Files:**
- Modify: `src/auth.js`
- Modify: `index.js` (validação de env no boot)

- [ ] **Step 1: Falhar o boot se `JWT_SECRET` ausente em produção**

Em `index.js`, junto às validações de env existentes, adicionar:

```js
if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'CHANGE_ME_IN_PRODUCTION')) {
  console.error('FATAL: JWT_SECRET não definido em produção.')
  process.exit(1)
}
```

- [ ] **Step 2: Sanidade — em dev não falha**

Run: `node -e "process.env.NODE_ENV='development'; require('./src/auth'); console.log('ok dev')"`
Expected: `ok dev`.

- [ ] **Step 3: Commit**

```bash
git add index.js
git commit -m "fix(security): exigir JWT_SECRET em produção"
```

---

## Task 11: Frontend — signup, gating por papel, onboarding e gestão de contas

**Files:**
- Create: `public/dashboard/signup.html`, `public/dashboard/js/signup.js`
- Modify: `public/dashboard/js/core.js`
- Create: `public/dashboard/js/onboarding.js`
- Create: `public/dashboard/contas.html`, `public/dashboard/js/contas.js`
- Modify: as páginas/nav existentes para marcar itens admin com `data-role`

> Front estático: validação manual no navegador (sem framework de teste front).

- [ ] **Step 1: Helper de gating em `core.js`**

Adicionar função que busca `/api/auth/me`, guarda `role` e aplica gating:

```js
async function carregarSessao() {
  const token = localStorage.getItem('token')
  if (!token) { window.location.href = '/dashboard/login.html'; return null }
  const r = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } })
  if (!r.ok) { localStorage.removeItem('token'); window.location.href = '/dashboard/login.html'; return null }
  const { data } = await r.json()
  aplicarGating(data.usuario.role)
  return data
}

function aplicarGating(role) {
  const nivel = { user: 1, admin: 2, superadmin: 3 }[role] || 0
  document.querySelectorAll('[data-role]').forEach(el => {
    const req = el.getAttribute('data-role') // 'admin' | 'superadmin'
    const reqNivel = req === 'superadmin' ? 3 : 2
    if (nivel < reqNivel) el.style.display = 'none'
  })
}

// Guarda de página: chamar no topo das páginas admin-only.
function exigirPapel(role, minimo) {
  const nivel = { user: 1, admin: 2, superadmin: 3 }[role] || 0
  const min = { admin: 2, superadmin: 3 }[minimo] || 2
  if (nivel < min) { window.location.href = '/dashboard/'; return false }
  return true
}
```

- [ ] **Step 2: Marcar itens de nav admin com `data-role`**

Nos arquivos de layout/nav do dashboard, adicionar `data-role="admin"` aos links de Relatórios, Custos/LLM, Aquisição e Banco de Leads; `data-role="superadmin"` ao link de Gestão de Contas. Em cada página admin-only, chamar `exigirPapel(role, 'admin')` (ou `'superadmin'`) após `carregarSessao()`.

- [ ] **Step 3: Tela de signup (`signup.html` + `signup.js`)**

`signup.js`:

```js
document.getElementById('form-signup').addEventListener('submit', async (e) => {
  e.preventDefault()
  const body = {
    nome: document.getElementById('nome').value,
    email: document.getElementById('email').value,
    password: document.getElementById('password').value,
  }
  const r = await fetch('/api/auth/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const j = await r.json()
  const erro = document.getElementById('erro')
  if (!j.ok) { erro.textContent = j.error?.message || 'Falha no cadastro.'; return }
  localStorage.setItem('token', j.data.token)
  window.location.href = '/dashboard/?onboarding=1'
})
```

`signup.html`: form com campos `nome`, `email`, `password`, botão submit, `<div id="erro">`, e `<script src="js/signup.js">`.

- [ ] **Step 4: Wizard de onboarding (`onboarding.js`)**

Mostra passos (contexto da empresa → conectar WhatsApp) quando `?onboarding=1` ou quando `data.usuario.onboarding_completo === false`. Reusa as telas existentes de Empresa/Contexto e Instância. Ao concluir, redireciona para Visão Geral.

- [ ] **Step 5: Gestão de contas (`contas.html` + `contas.js`)**

`contas.js` consome `/api/admin/usuarios` (GET/POST/PATCH) com `Authorization: Bearer`. Tabela com email, nome, role (select para promover/rebaixar), toggle ativo, e form de criação com escolha `user`/`admin`. Página chama `exigirPapel(role, 'superadmin')` no load.

- [ ] **Step 6: Verificação manual no navegador**

Com o backend rodando e DB disponível:
1. Acessar `/dashboard/signup.html`, criar conta → cai logado e zerado, sem itens admin no nav.
2. Como superadmin, abrir Gestão de Contas, promover a conta para `admin` → após relogar, itens admin aparecem.
3. Tentar acessar `/api/admin/usuarios` com token de `user` → 403.

- [ ] **Step 7: Commit**

```bash
git add public/dashboard/
git commit -m "feat(front): signup, gating por papel, onboarding e gestão de contas"
```

---

## Task 12: Testes de regressão e suíte completa

**Files:**
- Modify: `test/multitenant.test.js` (adicionar caso de `requireRole` no fluxo de tenant)

- [ ] **Step 1: Rodar toda a suíte**

Run: `npm test`
Expected: PASS — incluindo `slug`, `require-role`, `auth-signup` e os testes existentes. Testes que dependem de DB real não são unitários e não rodam aqui (validados na verificação manual da Task 11).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: sem erros (os arquivos novos são JS; `tsc --noEmit` não deve quebrar).

- [ ] **Step 3: Commit final**

```bash
git add -A
git commit -m "test: suíte verde para Entrega A (identidade & acesso)"
```

---

## Self-Review (cobertura × spec)

- §3 Modelo de dados → Task 1. ✅
- §4.1 Signup → Tasks 4, 5, 6. ✅
- §4.2 Onboarding zerado → Task 5 (`marcarOnboardingCompleto`) + Task 11 (wizard). ✅
- §5.1 `requireRole` back → Tasks 3, 9. ✅
- §5.2 Gating front + mapa de páginas → Task 11. ✅
- §6 Superadmin gestão de contas → Tasks 8, 11. ✅
- §7.2 Segurança (JWT_SECRET, anti-escalonamento, rate-limit, senha) → Tasks 4, 7, 10. ✅
- §7.3 Testes → Tasks 2, 3, 4, 12. ✅
- §8 Fora de escopo (billing) → apenas ganchos na Task 1. ✅

Sem placeholders pendentes. Nomes/assinaturas consistentes entre tasks (`signupUsuario`, `requireRole`, `validarSignup`, `gerarSlugEmpresa`, `signupLimiter`/`loginLimiter`).
```
