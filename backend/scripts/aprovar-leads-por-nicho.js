'use strict'
// APROVAR EM LOTE os leads de UM nicho — a "liberacao de nicho" para a equipe comercial.
// Ver docs/ai-task-start-log.md (2026-09-19), a migration 071 (a PORTA) e a 087/088 (o recorte).
//
// ─── O PROBLEMA QUE ELE RESOLVE ──────────────────────────────────────────────────────────
// Sao DOIS cadeados, e confundi-los e' o erro facil deste tema:
//   • `nicho_id`  abre o **Banco de Leads** para quem esta em equipe. Quem cuida dele e'
//     `scripts/backfill-prospects-nicho.js` — NAO este script, que nunca escreve `nicho_id`.
//   • `qualificacao = 'aprovado'` abre a **Central de Ligacoes**, que e' ESTRITA (`sqlAprovado`:
//     `legado` nao passa) e tambem o recorte comercial do Banco de Leads.
// O decision log de 2026-09-18 ja declarava a consequencia: "Equipe de Energia Solar sem lead
// aprovado desse nicho = tela vazia". Este script e' a saida em lote para essa carencia, e ela
// **pula a triagem 1 a 1** daqueles leads — decisao do operador, registrada na auditoria.
//
// ─── A REGRA QUE NAO SE NEGOCIA: SO' PROMOVE ─────────────────────────────────────────────
// Toca **apenas** `pendente` e `legado`. Lead `descartado` NUNCA e' ressuscitado: alguem o
// recusou, e decidir de novo o que uma pessoa ja decidiu e' exatamente o defeito "lead descartado
// volta por nova importacao" (R9, tratado em `qualificacaoAoRecoletar`). Lead ja `aprovado` nao
// e' tocado — nem a data, nem o autor (`COALESCE`), que sao a prova de QUEM triou primeiro.
//
// ─── APROVAR E' ATO HUMANO: `--usuario` E' OBRIGATORIO PARA GRAVAR ───────────────────────
// `qualificado_por` existe para responder "quem triou". Um script nao tria — uma pessoa decide, e
// o script executa a decisao dela em lote. Por isso exigimos uma pessoa REAL, com vinculo ATIVO
// na empresa e com a capacidade `LEAD_TRIAR` — a MESMA que `PATCH /leads/:id/icp` exige por rota.
// Gravar `NULL` ali seria afirmar que ninguem aprovou; inventar um id seria pior.
//
// ─── GARANTIAS (mesmo padrao de backfill:prospects-nicho) ────────────────────────────────
//   * **SIMULA por padrao.** So grava com `-- --aplicar`.
//   * **Um COMMIT por lote**, nunca um UPDATE massivo em transacao unica.
//   * Idempotente: rodar de novo nao muda nada (o WHERE so' alcanca `pendente`/`legado`).
//   * `DATABASE_URL` explicita — o script nunca escolhe banco sozinho.
//   * Nenhuma chamada externa, nenhuma chamada paga, nenhuma dependencia nova.
//   * Uma linha em `app.auditoria_eventos` POR LEAD, na MESMA transacao do lote, sem PII.
//   * Relatorio sem PII (nome do nicho e contagens; nunca nome de lead, telefone ou endereco).
//   * SQL de rollback impresso ao final — e ele e' EXATO, porque a auditoria guarda o estado
//     anterior de cada lead.
//
// Uso:
//   npm run aprovar:leads-nicho -- --nicho="Energia Solar"                     # simula
//   npm run aprovar:leads-nicho -- --nicho="Energia Solar" --usuario=fulano@x --aplicar
//   npm run aprovar:leads-nicho -- --nicho=<uuid> --empresa=<uuid> --usuario=<uuid> --aplicar
//   npm run aprovar:leads-nicho -- --nicho="Energia Solar" --lote=500
//
// O `--` ANTES dos argumentos e' obrigatorio: `npm run ... --aplicar` (sem o `--`) e' engolido
// pelo npm e NUNCA chega ao script — o sintoma e' o modo pedido simplesmente nao valer.

const { Pool } = require('pg')
const { QUALIFICACAO } = require('../src/services/lead-qualificacao')
const { CAPACIDADES, avaliarCapacidade } = require('../src/services/acesso-capacidades')
// Reuso deliberado: `tabela` ja existe e e' testada no script irmao. Uma segunda copia divergiria
// na primeira vez que alguem ajustasse o alinhamento de uma delas.
const { tabela } = require('./backfill-prospects-nicho')

const LOTE_PADRAO = 500
const ACAO_AUDITORIA = 'lead_qualificacao_aprovada_em_lote'

// ⚠️ `TRIM()` do Postgres remove SO' ESPACO. O nome do nicho digitado no `--nicho` e o nome
// gravado no catalogo podem diferir por tab ou quebra de linha — foi esse caractere invisivel que
// fez "funilaria e pintura automotiva" aparecer duas vezes no raio-x do backfill (2026-09-18).
const BRANCOS = `chr(32)||chr(9)||chr(10)||chr(13)`
const limpo = (coluna) => `BTRIM(${coluna}, ${BRANCOS})`

// ─── As duas regras de negocio, como constantes de texto ─────────────────────────────────
// Dono unico das expressoes coladas no WHERE, para o raio-x, o UPDATE e o relatorio nunca
// discordarem sobre QUEM seria afetado — que e' o defeito que o script irmao registrou em
// comentario depois de anunciar um numero e gravar outro.

/** Os unicos valores que este script PROMOVE. `descartado` e `aprovado` ficam de fora. */
const PROMOVIVEIS = Object.freeze([QUALIFICACAO.PENDENTE, QUALIFICACAO.LEGADO])
const SQL_PROMOVIVEL = `p.qualificacao IN ('${PROMOVIVEIS.join("', '")}')`

/**
 * A promocao de `status`, com a MESMA lista fechada de `PATCH /leads/:id/icp`.
 * `status` so' sobe: rebaixar apagaria trabalho humano (e `enviado` significa que o lead ja foi
 * abordado — trocar isso por `aprovado` faria o funil andar para tras).
 */
const SQL_STATUS_PROMOVIDO = `CASE WHEN status IN ('coletado', 'contato_encontrado', 'aguardando') THEN 'aprovado' ELSE status END`

// ─── Apresentacao (PURA — testada em test/aprovar-leads-por-nicho.test.js) ───────────────

/**
 * A leitura de negocio do resultado.
 *
 * "X descartado(s)" NAO e' erro nem pendencia: e' trabalho humano sendo preservado, e precisa
 * aparecer como NUMERO para o operador nao concluir que o script falhou com aqueles leads.
 */
function montarAchados({ total, promoviveis, jaAprovados, descartados, aprovados }, { aplicar, nichoNome }) {
  const achados = []
  achados.push(`${total} lead(s) no nicho "${nichoNome}": ${promoviveis} a aprovar, ${jaAprovados} ja aprovado(s), ${descartados} descartado(s).`)

  if (descartados > 0) {
    achados.push(`${descartados} lead(s) descartado(s) NAO sao tocados — alguem os recusou na triagem, e reaprova-los desfaria essa decisao.`)
  }
  if (aplicar) {
    achados.push(`${aprovados || 0} lead(s) aprovados nesta execucao.`)
    if (aprovados > 0) {
      achados.push('Eles entram AGORA na Central de Ligacoes e no recorte comercial do Banco de Leads.')
    }
  } else {
    achados.push('SIMULACAO: nada foi gravado. Rode com -- --aplicar para persistir.')
  }
  if (total === 0) {
    achados.push('ATENCAO: nenhum lead neste nicho. Se voce esperava leads aqui, rode antes `npm run backfill:prospects-nicho` — lead sem nicho_id fica fora do recorte por equipe (e deste script).')
  } else if (promoviveis === 0 && jaAprovados > 0 && !aplicar) {
    achados.push('Nada a fazer: todo lead deste nicho que podia ser aprovado ja esta aprovado.')
  }
  return achados
}

/** O aviso de que a aprovacao em lote pula a triagem. Nunca some — nem em simulacao. */
function avisoDeTriagem(quantidade) {
  if (!quantidade) return null
  return `Esta acao APROVA ${quantidade} lead(s) sem passar pela triagem 1 a 1 (curadoria/ICP). E' uma decisao de negocio: ela abre o disparo e a fila de ligacoes para todos eles.`
}

// ─── Execucao ────────────────────────────────────────────────────────────────────────────

/**
 * Acha o nicho no catalogo por UUID ou por NOME.
 *
 * Nome ambiguo entre empresas e' recusado, nunca "resolvido" pela primeira linha: escolher um
 * tenant por conta propria e' a classe de defeito que o fallback da PJ produziu (migration 060).
 */
async function resolverNicho(pool, { nicho, empresaId }) {
  const { rows } = await pool.query(
    `SELECT n.id, n.empresa_id, n.nome
       FROM app.nichos n
      WHERE ($2::uuid IS NULL OR n.empresa_id = $2::uuid)
        AND (n.id::text = $1 OR lower(${limpo('n.nome')}) = lower(${limpo('$1')}))
      ORDER BY n.nome`,
    [nicho, empresaId]
  )
  if (!rows.length) {
    throw new Error(`Nicho "${nicho}" nao existe no catalogo (app.nichos)${empresaId ? ' desta empresa' : ''}. Confira o nome exato na tela de Equipes Comerciais.`)
  }
  if (rows.length > 1) {
    const empresas = rows.map((r) => String(r.empresa_id).slice(0, 8)).join(', ')
    throw new Error(`Nicho "${nicho}" existe em ${rows.length} empresas (${empresas}…). Informe --empresa=<uuid> para dizer de qual.`)
  }
  return rows[0]
}

/**
 * Acha a pessoa que esta aprovando, por UUID ou e-mail, e CONFERE que ela pode triar.
 *
 * A capacidade e' a mesma que a rota de ICP exige (`LEAD_TRIAR`). Sem esta checagem, o script
 * seria uma porta lateral para aprovar em lote o que a tela recusa — que e' precisamente o motivo
 * de `PATCH /leads/:id/icp` ter gate POR ROTA e nao so' no mount.
 */
async function resolverUsuario(pool, { usuario, empresaId }) {
  const { rows } = await pool.query(
    `SELECT u.id, u.nome, u.email, u.role AS papel_plataforma,
            ue.role AS papel, ue.permissoes, ue.ativo
       FROM app.usuarios u
       LEFT JOIN app.usuarios_empresas ue
         ON ue.usuario_id = u.id AND ue.empresa_id = $2::uuid
      WHERE (u.id::text = $1 OR lower(u.email) = lower($1))
      LIMIT 2`,
    [usuario, empresaId]
  )
  if (!rows.length) throw new Error(`Usuario "${usuario}" nao encontrado. Passe o e-mail dele ou o UUID.`)
  if (rows.length > 1) throw new Error(`Mais de um usuario casou com "${usuario}". Passe o UUID.`)
  const u = rows[0]
  if (!u.papel || u.ativo !== true) {
    throw new Error(`O usuario ${u.email} nao tem vinculo ATIVO com esta empresa. Aprovar lead de uma empresa exige pertencer a ela.`)
  }
  const veredito = avaliarCapacidade(
    { papel: u.papel, permissoes: u.permissoes, papelPlataforma: u.papel_plataforma },
    CAPACIDADES.LEAD_TRIAR
  )
  if (!veredito.permitido) {
    throw new Error(`O usuario ${u.email} (papel "${u.papel}") nao pode triar leads (capacidade ${CAPACIDADES.LEAD_TRIAR}; motivo: ${veredito.motivo}). Escolha quem de fato tomou esta decisao.`)
  }
  return u
}

/** O raio-x: quantos leads do nicho em cada estado da porta. */
async function levantar(pool, { empresaId, nichoId }) {
  const { rows } = await pool.query(
    `SELECT p.qualificacao, COUNT(*)::int AS leads
       FROM prospectador.prospects p
      WHERE p.empresa_id = $1::uuid
        AND p.nicho_id = $2::uuid
      GROUP BY p.qualificacao
      ORDER BY leads DESC`,
    [empresaId, nichoId]
  )
  return rows
}

/**
 * Aprova em lotes, com um COMMIT por lote.
 *
 * A auditoria e' gravada DENTRO da transacao do lote, e nao best-effort como a telemetria: aqui a
 * linha nao e' metrica, e' a PROVA de quem aprovou e de qual era o estado anterior — e e' dela que
 * o rollback exato sai. Um lead aprovado sem esse registro seria indistinguivel de um lead triado
 * a mao.
 */
async function aprovar(pool, { empresaId, nichoId, usuarioId, lote, aplicar }) {
  const out = { aprovados: 0, lotes: 0 }
  if (!aplicar) return out
  for (;;) {
    const client = await pool.connect()
    let doLote = 0
    try {
      await client.query('BEGIN')
      const { rows } = await client.query(
        `UPDATE prospectador.prospects AS alvo
            SET status = ${SQL_STATUS_PROMOVIDO},
                qualificacao = '${QUALIFICACAO.APROVADO}',
                qualificado_em = COALESCE(qualificado_em, NOW()),
                qualificado_por = COALESCE(qualificado_por, $3::uuid),
                updated_at = NOW()
           FROM (
             SELECT p.id, p.qualificacao AS anterior
               FROM prospectador.prospects p
              WHERE p.empresa_id = $1::uuid
                AND p.nicho_id = $2::uuid
                AND ${SQL_PROMOVIVEL}
              ORDER BY p.id
              LIMIT $4
              FOR UPDATE
           ) AS sub
          WHERE alvo.id = sub.id
        RETURNING alvo.id, sub.anterior`,
        [empresaId, nichoId, usuarioId, lote]
      )
      doLote = rows.length
      if (doLote) {
        await client.query(
          `INSERT INTO app.auditoria_eventos
             (empresa_id, usuario_id, entidade_tipo, entidade_id, acao, estado_anterior, estado_novo, contexto)
           SELECT $1::uuid, $2::uuid, 'prospect', x.id, $3, x.anterior, '${QUALIFICACAO.APROVADO}', $4::jsonb
             FROM UNNEST($5::uuid[], $6::text[]) AS x(id, anterior)`,
          [
            empresaId, usuarioId, ACAO_AUDITORIA,
            JSON.stringify({ origem: 'script_aprovar_leads_por_nicho', nicho_id: nichoId }),
            rows.map((r) => r.id), rows.map((r) => r.anterior),
          ]
        )
      }
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {})
      throw e
    } finally {
      client.release()
    }
    out.lotes += 1
    if (!doLote) break
    out.aprovados += doLote
  }
  return out
}

function imprimir(raiox, resumo, opcoes) {
  const L = (s = '') => console.log(s)
  L()
  L('════ APROVAR EM LOTE — leads de um nicho ════')
  L(opcoes.aplicar ? 'MODO: APLICAR (grava)' : 'MODO: SIMULACAO (nao grava)')
  L(`       nicho: ${opcoes.nichoNome}`)
  L(`       empresa: ${String(opcoes.empresaId || '').slice(0, 8)}…`)
  if (opcoes.usuarioEmail) L(`       aprovando como: ${opcoes.usuarioEmail}`)
  L()
  if (raiox.length) {
    L(tabela(
      ['qualificacao', 'leads', 'este script...'],
      raiox.map((r) => [
        r.qualificacao,
        r.leads,
        PROMOVIVEIS.includes(r.qualificacao) ? 'APROVA' : 'nao toca',
      ])
    ))
  } else {
    L('  Nenhum lead vinculado a este nicho.')
  }
  L()
  const aviso = avisoDeTriagem(resumo.promoviveis)
  if (aviso) {
    L('════ ATENCAO ════')
    L(`  ${aviso}`)
    L()
  }
  L('════ ACHADOS ════')
  for (const a of montarAchados(resumo, opcoes)) L(`  • ${a}`)
  L()
  if (opcoes.aplicar && resumo.aprovados > 0) {
    L('════ ROLLBACK ════')
    L("  Desfaz SO' o que esta execucao aprovou, devolvendo cada lead ao estado ANTERIOR real")
    L("  (a auditoria guarda qual era). `status` nao e' revertido — ele so' sobe, e reverte-lo")
    L('  apagaria trabalho posterior.')
    L('    UPDATE prospectador.prospects p')
    L('       SET qualificacao = a.estado_anterior, qualificado_em = NULL, qualificado_por = NULL')
    L('      FROM app.auditoria_eventos a')
    L(`     WHERE a.acao = '${ACAO_AUDITORIA}'`)
    L(`       AND a.empresa_id = '${opcoes.empresaId}'`)
    L(`       AND a.contexto->>'nicho_id' = '${opcoes.nichoId}'`)
    L("       AND a.ocorrido_em >= NOW() - INTERVAL '1 hour'")
    L('       AND p.id = a.entidade_id;')
    L('  ⚠️ Ajuste a janela de tempo se rodar depois. Confira antes com SELECT COUNT(*).')
    L()
  }
}

async function main(argv = process.argv.slice(2)) {
  const aplicar = argv.includes('--aplicar')
  const valor = (nome) => {
    const a = argv.find((x) => x.startsWith(`--${nome}=`))
    return a ? a.slice(nome.length + 3) || null : null
  }
  const nicho = valor('nicho')
  const empresaArg = valor('empresa')
  const usuarioArg = valor('usuario')
  const lote = Math.min(Math.max(parseInt(valor('lote'), 10) || LOTE_PADRAO, 1), 10000)

  if (!nicho) {
    console.error('Informe --nicho="<nome do catalogo>" ou --nicho=<uuid>. Este script nunca aprova "todos os leads".')
    process.exit(1)
  }
  if (aplicar && !usuarioArg) {
    console.error('Informe --usuario=<e-mail ou uuid>. Aprovar lead e ato humano: alguem tem de assinar a decisao em qualificado_por.')
    process.exit(1)
  }

  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL nao definida. Passe explicitamente qual banco alterar — este script nunca escolhe um sozinho.')
    process.exit(1)
  }

  // ⚠️ DIVIDA DECLARADA (pre-existente): `rejectUnauthorized: false` e' o que os scripts irmaos
  // ja fazem para alcancar o proxy publico do Railway. A correcao vale para TODOS e e' tarefa
  // propria — ver o comentario em scripts/medir-qualificacao-lead.js.
  const pool = new Pool({
    connectionString: url,
    ssl: /railway|amazonaws|supabase|neon|render/i.test(url) ? { rejectUnauthorized: false } : undefined,
  })

  let raiox = []
  const resumo = { total: 0, promoviveis: 0, jaAprovados: 0, descartados: 0, aprovados: 0, lotes: 0 }
  const opcoes = { aplicar, empresaId: empresaArg, nichoId: null, nichoNome: nicho, usuarioEmail: null }
  try {
    const alvo = await resolverNicho(pool, { nicho, empresaId: empresaArg })
    opcoes.nichoId = alvo.id
    opcoes.nichoNome = alvo.nome
    opcoes.empresaId = alvo.empresa_id

    let usuarioId = null
    if (usuarioArg) {
      const u = await resolverUsuario(pool, { usuario: usuarioArg, empresaId: alvo.empresa_id })
      usuarioId = u.id
      opcoes.usuarioEmail = u.email
    }

    raiox = await levantar(pool, { empresaId: alvo.empresa_id, nichoId: alvo.id })
    resumo.total = raiox.reduce((s, r) => s + r.leads, 0)
    resumo.promoviveis = raiox.filter((r) => PROMOVIVEIS.includes(r.qualificacao)).reduce((s, r) => s + r.leads, 0)
    resumo.jaAprovados = raiox.filter((r) => r.qualificacao === QUALIFICACAO.APROVADO).reduce((s, r) => s + r.leads, 0)
    resumo.descartados = raiox.filter((r) => r.qualificacao === QUALIFICACAO.DESCARTADO).reduce((s, r) => s + r.leads, 0)

    const a = await aprovar(pool, { empresaId: alvo.empresa_id, nichoId: alvo.id, usuarioId, lote, aplicar })
    resumo.aprovados = a.aprovados
    resumo.lotes = a.lotes
  } finally {
    await pool.end()
  }

  imprimir(raiox, resumo, opcoes)
}

if (require.main === module) {
  main().catch((e) => {
    console.error('\nFalhou:', e && e.message ? e.message : e)
    process.exit(1)
  })
}

module.exports = {
  PROMOVIVEIS,
  SQL_PROMOVIVEL,
  SQL_STATUS_PROMOVIDO,
  ACAO_AUDITORIA,
  montarAchados,
  avisoDeTriagem,
  resolverNicho,
  resolverUsuario,
  levantar,
  aprovar,
}
