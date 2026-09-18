'use strict'
// BACKFILL de `prospectador.prospects.nicho_id` — pre-requisito das Equipes por Nicho.
// Ver docs/analise-equipes-por-nicho.md (decisao D1) e a migration 087.
//
// ─── O QUE ELE FAZ ───────────────────────────────────────────────────────────────────────
// Liga cada lead ao nicho do catalogo (`app.nichos`) cujo NOME e' igual ao texto que a coleta
// observou em `prospects.nicho`, dentro da MESMA empresa. O casamento e' exato, ignorando caixa e
// espaco nas pontas — a MESMA regra de `nichosDosLeads` (src/db/nichos.js) e de
// `uq_nichos_empresa_nome` (migration 038). Reusar o casamento importa: duas reguas fariam a tela
// de nichos e o recorte por equipe discordarem sobre qual lead pertence a que.
//
// ─── A REGRA QUE ELE RESPEITA: NAO SE ADIVINHA NICHO ─────────────────────────────────────
// Nao ha fuzzy, nao ha "parece com", nao ha prefixo. Texto que nao casar EXATAMENTE fica em NULL
// e aparece no relatorio para uma pessoa decidir. Isto e' a decisao D1 levada a serio: o motivo de
// existir `nicho_id` foi justamente recusar o casamento por aproximacao, que tiraria leads do
// recorte em silencio. Gravar um palpite aqui reintroduziria o problema em repouso, e pior —
// com aparencia de dado estruturado.
//
// ─── `--criar-nichos` NAO E' ADIVINHACAO, E E' OPT-IN ────────────────────────────────────
// Ele cria no catalogo os nomes que os leads JA declaram, escritos exatamente como observados.
// Promover um valor observado a entrada de catalogo nao e' inventar vinculo; e' o oposto de
// inferir. Ainda assim e' explicito, porque escreve numa tabela de configuracao que uma pessoa
// administra — e porque o catalogo dela pode ter um recorte proprio, mais enxuto que a realidade
// crua da coleta.
//
// ─── GARANTIAS (mesmo padrao de backfill:vendas-empresa) ─────────────────────────────────
//   * **SIMULA por padrao.** So grava com `-- --aplicar`.
//   * **Um COMMIT por lote**, nunca um UPDATE massivo em transacao unica.
//   * Idempotente: so' toca linhas com `nicho_id IS NULL`; rodar de novo nao muda nada.
//   * **Nunca sobrescreve vinculo existente** e **nunca vincula lead sem empresa**.
//   * Nenhuma chamada externa, nenhuma chamada paga, nenhuma dependencia nova.
//   * Relatorio **sem PII**: nome de nicho e contagem; nunca nome de lead, telefone ou endereco.
//   * `DATABASE_URL` explicita — o script nunca escolhe banco sozinho.
//   * SQL de rollback impresso ao final.
//
// Uso:
//   npm run backfill:prospects-nicho                          # simula (nao grava)
//   npm run backfill:prospects-nicho -- --aplicar             # grava os vinculos
//   npm run backfill:prospects-nicho -- --criar-nichos        # simula, mostrando o que criaria
//   npm run backfill:prospects-nicho -- --aplicar --criar-nichos
//   npm run backfill:prospects-nicho -- --empresa=<uuid> --lote=500

const { Pool } = require('pg')

const LOTE_PADRAO = 1000

// O casamento. UMA expressao, usada na contagem, no UPDATE e no relatorio — para as tres nunca
// discordarem sobre o que "casa".
const CASAMENTO = `lower(TRIM(n.nome)) = lower(TRIM(p.nicho))`

// ─── Apresentacao (PURA — testada em test/backfill-prospects-nicho.test.js) ──────────────

function tabela(cabecalho, linhas) {
  const todas = [cabecalho, ...linhas].map((l) => l.map((c) => String(c == null ? '' : c)))
  const larguras = cabecalho.map((_, i) => Math.max(...todas.map((l) => (l[i] || '').length)))
  const linha = (l) => l.map((c, i) => (i === 0 ? c.padEnd(larguras[i]) : c.padStart(larguras[i]))).join('  ')
  return [linha(todas[0]), larguras.map((w) => '-'.repeat(w)).join('  '), ...todas.slice(1).map(linha)].join('\n')
}

/**
 * A leitura de negocio do resultado.
 *
 * "Sem nicho no catalogo" NAO e' erro: e' a resposta honesta para um texto que ninguem cadastrou,
 * e precisa aparecer como NUMERO para o operador decidir se cria o nicho ou se aquele termo era
 * lixo de busca.
 */
function montarAchados({ totalLeads, semTexto, casaveis, semCatalogo, criados }, { aplicar, criarNichos }) {
  const achados = []
  achados.push(`${totalLeads} lead(s) sem nicho_id; ${casaveis} casa(m) com o catalogo; ${semCatalogo} com texto fora do catalogo; ${semTexto} sem texto de nicho.`)

  if (!aplicar) achados.push('SIMULACAO: nada foi gravado. Rode com -- --aplicar para persistir.')
  if (criarNichos && criados > 0) {
    achados.push(`${criados} nicho(s) ${aplicar ? 'criado(s)' : 'seriam criados'} no catalogo a partir do texto observado nos leads.`)
  }
  if (semCatalogo > 0 && !criarNichos) {
    achados.push('Lead com texto fora do catalogo fica em NULL de proposito — casamento por aproximacao foi recusado na decisao D1. Use --criar-nichos para promover os textos observados a catalogo, ou cadastre-os a mao.')
  }
  if (semTexto > 0) {
    achados.push('Lead sem texto de nicho (captacao social, por exemplo) nao tem como ser vinculado por este script.')
  }
  if (totalLeads > 0 && casaveis === 0 && !criarNichos) {
    achados.push('ATENCAO: nenhum lead casou. O catalogo app.nichos pode estar vazio — confira antes de concluir que os dados estao errados.')
  }
  return achados
}

// ─── Execucao ────────────────────────────────────────────────────────────────────────────

/** O raio-x: cada texto de nicho, quantos leads tem e se ja existe no catalogo. */
async function levantar(pool, { empresaId }) {
  // ⚠️ A agregacao vem numa CTE, e a CTE se chama `p` com a coluna `nicho` de proposito.
  //
  // A versao anterior agrupava por `TRIM(p.nicho)` e o `EXISTS` referenciava `p.nicho` cru —
  // Postgres recusa com "subquery uses ungrouped column". Agrupar pela coluna CRUA resolveria o
  // erro e criaria outro: " Energia Solar" e "Energia Solar" virariam duas linhas do relatorio
  // para o mesmo nicho.
  //
  // Com a CTE, `p.nicho` JA' e' o texto normalizado e e' a chave do grupo, entao o `EXISTS` le
  // uma coluna legitima — e `CASAMENTO` continua sendo usado LETRA POR LETRA, aqui e no UPDATE.
  // Reescrever a expressao so' neste ponto faria o relatorio e a gravacao discordarem sobre o
  // que "casa", que e' exatamente o defeito que este script existe para nao cometer.
  const { rows } = await pool.query(
    `WITH p AS (
       SELECT empresa_id,
              TRIM(nicho) AS nicho,
              COUNT(*)::int AS leads
         FROM prospectador.prospects
        WHERE nicho_id IS NULL
          AND empresa_id IS NOT NULL
          AND NULLIF(TRIM(nicho), '') IS NOT NULL
          AND ($1::uuid IS NULL OR empresa_id = $1::uuid)
        GROUP BY empresa_id, TRIM(nicho)
     )
     SELECT p.empresa_id,
            p.nicho AS texto,
            p.leads,
            EXISTS (
              SELECT 1 FROM app.nichos n
               WHERE n.empresa_id = p.empresa_id AND ${CASAMENTO}
            ) AS no_catalogo
       FROM p
      ORDER BY p.leads DESC`,
    [empresaId]
  )
  return rows
}

/** Leads que este script NAO consegue vincular: sem texto de nicho, ou sem empresa. */
async function contarSemTexto(pool, { empresaId }) {
  const { rows: [r] } = await pool.query(
    `SELECT COUNT(*)::int AS total
       FROM prospectador.prospects p
      WHERE p.nicho_id IS NULL
        AND ($1::uuid IS NULL OR p.empresa_id = $1::uuid)
        AND (p.empresa_id IS NULL OR NULLIF(TRIM(p.nicho), '') IS NULL)`,
    [empresaId]
  )
  return r.total
}

/**
 * Cria no catalogo os textos que os leads declaram e que ainda nao existem.
 * `ON CONFLICT DO NOTHING` sobre `uq_nichos_empresa_nome`: rodar de novo nao duplica.
 */
async function criarNichosFaltantes(pool, faltantes, { aplicar }) {
  if (!aplicar) return faltantes.length
  let criados = 0
  for (const f of faltantes) {
    const { rowCount } = await pool.query(
      `INSERT INTO app.nichos (empresa_id, nome, descricao)
       VALUES ($1::uuid, $2, $3)
       ON CONFLICT DO NOTHING`,
      [f.empresa_id, f.texto, 'Criado por backfill:prospects-nicho a partir do texto observado nos leads.']
    )
    criados += rowCount
  }
  return criados
}

/**
 * Liga os leads, em lotes, com um COMMIT por lote.
 *
 * O UPDATE exige `p.empresa_id = n.empresa_id`: e' o mesmo isolamento que a FK composta da
 * migration 087 garante no schema. Repetido aqui de proposito — o script tem de ser correto
 * mesmo que alguem rode contra um banco onde a FK nao foi aplicada.
 */
async function vincular(pool, { empresaId, lote, aplicar }) {
  const out = { vinculados: 0, lotes: 0 }
  if (!aplicar) return out
  for (;;) {
    const { rowCount } = await pool.query(
      `UPDATE prospectador.prospects AS alvo
          SET nicho_id = sub.nicho_id
         FROM (
           SELECT p.id, n.id AS nicho_id
             FROM prospectador.prospects p
             JOIN app.nichos n
               ON n.empresa_id = p.empresa_id AND ${CASAMENTO}
            WHERE p.nicho_id IS NULL
              AND p.empresa_id IS NOT NULL
              AND NULLIF(TRIM(p.nicho), '') IS NOT NULL
              AND ($1::uuid IS NULL OR p.empresa_id = $1::uuid)
            LIMIT $2
         ) AS sub
        WHERE alvo.id = sub.id
          AND alvo.nicho_id IS NULL`,
      [empresaId, lote]
    )
    out.lotes += 1
    if (!rowCount) break
    out.vinculados += rowCount
  }
  return out
}

function imprimir(raiox, resumo, opcoes) {
  const L = (s = '') => console.log(s)
  L()
  L('════ BACKFILL — prospects.nicho_id (Equipes por Nicho, pre-requisito) ════')
  L(opcoes.aplicar ? 'MODO: APLICAR (grava)' : 'MODO: SIMULACAO (nao grava)')
  if (opcoes.criarNichos) L('       --criar-nichos ligado')
  if (opcoes.empresaId) L(`       empresa: ${String(opcoes.empresaId).slice(0, 8)}…`)
  L()
  if (raiox.length) {
    L(tabela(
      ['nicho (texto observado)', 'leads', 'no catalogo?'],
      raiox.slice(0, 40).map((r) => [r.texto, r.leads, r.no_catalogo ? 'sim' : 'NAO'])
    ))
    if (raiox.length > 40) L(`  … e mais ${raiox.length - 40} texto(s).`)
  } else {
    L('  Nenhum lead pendente de vinculo.')
  }
  L()
  L('════ ACHADOS ════')
  for (const a of montarAchados(resumo, opcoes)) L(`  • ${a}`)
  L()
  if (opcoes.aplicar && resumo.vinculados > 0) {
    L('════ ROLLBACK ════')
    L('  Para desfazer SOMENTE os vinculos (o texto em prospects.nicho nao foi tocado):')
    L(opcoes.empresaId
      ? `    UPDATE prospectador.prospects SET nicho_id = NULL WHERE empresa_id = '${opcoes.empresaId}';`
      : '    UPDATE prospectador.prospects SET nicho_id = NULL;')
    L('  ⚠️ Isso apaga TODOS os vinculos, inclusive os que ja existiam antes deste backfill.')
    if (opcoes.criarNichos && resumo.criados > 0) {
      L('  Os nichos criados no catalogo NAO sao removidos por este rollback — apague-os a mao se')
      L('  quiser, conferindo antes se alguma campanha ou equipe ja os referencia.')
    }
    L()
  }
}

async function main(argv = process.argv.slice(2)) {
  const aplicar = argv.includes('--aplicar')
  const criarNichos = argv.includes('--criar-nichos')
  const loteArg = argv.find((a) => a.startsWith('--lote='))
  const empresaArg = argv.find((a) => a.startsWith('--empresa='))
  const lote = Math.min(Math.max(parseInt((loteArg || '').split('=')[1], 10) || LOTE_PADRAO, 1), 10000)
  const empresaId = empresaArg ? (empresaArg.split('=')[1] || null) : null

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
  const resumo = { totalLeads: 0, semTexto: 0, casaveis: 0, semCatalogo: 0, criados: 0, vinculados: 0, lotes: 0 }
  try {
    raiox = await levantar(pool, { empresaId })
    resumo.semTexto = await contarSemTexto(pool, { empresaId })
    resumo.totalLeads = raiox.reduce((s, r) => s + r.leads, 0) + resumo.semTexto
    resumo.casaveis = raiox.filter((r) => r.no_catalogo).reduce((s, r) => s + r.leads, 0)
    resumo.semCatalogo = raiox.filter((r) => !r.no_catalogo).reduce((s, r) => s + r.leads, 0)

    if (criarNichos) {
      const faltantes = raiox.filter((r) => !r.no_catalogo)
      resumo.criados = await criarNichosFaltantes(pool, faltantes, { aplicar })
      // Depois de criar, o que estava fora do catalogo passou a casar.
      if (aplicar && resumo.criados > 0) {
        resumo.casaveis += resumo.semCatalogo
        resumo.semCatalogo = 0
      }
    }

    const v = await vincular(pool, { empresaId, lote, aplicar })
    resumo.vinculados = v.vinculados
    resumo.lotes = v.lotes
  } finally {
    await pool.end()
  }

  imprimir(raiox, resumo, { aplicar, criarNichos, empresaId })
}

if (require.main === module) {
  main().catch((e) => {
    console.error('\nFalhou:', e && e.message ? e.message : e)
    process.exit(1)
  })
}

module.exports = { CASAMENTO, tabela, montarAchados, levantar, vincular, criarNichosFaltantes, contarSemTexto }
