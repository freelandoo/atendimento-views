// @ts-check
'use strict'

// A linha ANCORA de `vendas.dashboard_users` — o que a agenda do BOT precisa para existir.
//
// ══ POR QUE ESTE MODULO EXISTE ══
// `vendas.agenda_eventos.usuario_id` e' `BIGINT NOT NULL REFERENCES vendas.dashboard_users(id)`
// (sql/init.sql:567). Dois caminhos LEEM "o primeiro usuario ativo" dali:
//   * `src/agenda.js` (`criarEventoAgenda`) — toda reuniao marcada pelo bot;
//   * `src/services/agenda-espelho.js` — o espelho do BLOQUEIO de agenda (migration 090), que e'
//     o que faz um feriado criado na tela valer tambem no WhatsApp.
// Sem nenhuma linha ativa, o espelho devolve `vale_para_bot: false` e o bloqueio para de valer —
// **em silencio**, que e' exatamente o defeito que a 090 corrigiu.
//
// ══ O QUE E' DE QUEM (e por que este modulo nao cria tabela) ══
// O SCHEMA e' do `sql/init.sql` (linhas 246-280), que roda no boot e **sobrevive** a
// aposentadoria do dashboard legado. `dashboardAuth.js` repetia aquele mesmo `CREATE TABLE IF
// NOT EXISTS` — redundante. O unico elo real entre a agenda e o dashboard legado era a SEMENTE
// da primeira linha, e e' so' ela que mora aqui.
//
// ⚠️ A tabela nasceu como "usuarios do dashboard legado". O que a mantem viva hoje e' a AGENDA.
// Quando as rotas `/dashboard/*` sairem, este modulo continua de pe sozinho.
//
// ══ POR QUE A SEMENTE MANTEM E-MAIL E SENHA ══
// Comportamento preservado: e' a MESMA semente que `ensureDashboardAuthReady` fazia, com as
// MESMAS variaveis (`DASHBOARD_ADMIN_EMAIL`/`DASHBOARD_ADMIN_PASSWORD`, ja obrigatorias no
// boot). `password_hash` e' NOT NULL no schema, entao a linha precisa de um. Trocar isso por uma
// ancora sem credencial e' possivel — e e' decisao de produto, nao efeito colateral de um
// desacoplamento. O hash vem de `src/auth.js` (o scrypt da camada que FICA), nao do modulo
// legado, justamente para este arquivo nao morrer junto com ele.

// ⚠️ `hashPassword` e' carregado DENTRO da funcao, nao aqui. `src/auth.js` faz
// `require('./db')` no topo, e `db.js` passa a importar este modulo — no topo, o ciclo
// devolveria os exports AINDA VAZIOS de db.js para auth.js (o `module.exports` de db.js e' a
// ultima linha do arquivo), deixando `pool` indefinido na autenticacao do SaaS. No momento da
// CHAMADA (dentro de initDB) db.js ja esta completo, e o require resolve normalmente.
const { logger } = require('../logger')

const MIN_SENHA = 12

/**
 * Garante que existe ao menos UMA linha ativa em `vendas.dashboard_users`.
 * Idempotente: sai cedo quando ja ha uma. Nao cria tabela (isso e' do sql/init.sql).
 * @param {any} pool
 * @param {Record<string, any>} [env]
 */
async function garantirAncoraDaAgenda(pool, env = process.env) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM vendas.dashboard_users WHERE ativo = true`
  )
  if (rows[0] && rows[0].total > 0) return { criada: false, motivo: 'ja_existe' }

  const email = String(env.DASHBOARD_ADMIN_EMAIL || '').trim().toLowerCase()
  const senha = String(env.DASHBOARD_ADMIN_PASSWORD || '')
  if (!email || !senha) {
    throw new Error(
      'DASHBOARD_ADMIN_EMAIL e DASHBOARD_ADMIN_PASSWORD sao obrigatorios: sem uma linha ativa em ' +
      'vendas.dashboard_users a agenda do bot nao consegue criar evento (usuario_id e NOT NULL).'
    )
  }
  if (senha.length < MIN_SENHA) {
    throw new Error(`DASHBOARD_ADMIN_PASSWORD precisa ter ao menos ${MIN_SENHA} caracteres`)
  }

  const { hashPassword } = require('../auth') // tardio de proposito — ver o topo do arquivo
  const passwordHash = await hashPassword(senha)
  await pool.query(
    `INSERT INTO vendas.dashboard_users (email, nome, role, password_hash, ativo)
     VALUES ($1, $2, 'admin', $3, true)
     ON CONFLICT (email) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       ativo = true,
       role = 'admin',
       atualizado_em = NOW()`,
    [email, email, passwordHash]
  )
  logger.info('Ancora da agenda criada em vendas.dashboard_users')
  return { criada: true, motivo: 'semeada' }
}

module.exports = { garantirAncoraDaAgenda, MIN_SENHA }
