'use strict'
// BACKFILL de `empresa_id` nas tabelas `vendas.*` — CRM em equipe, Etapa 11.2.
// Ver docs/plano-execucao-crm-equipe.md §6 (Etapa 11) e a migration 077.
//
// ─── O QUE ELE FAZ ───────────────────────────────────────────────────────────────────────
// Preenche `empresa_id` em 5 tabelas do schema legado que a operação em equipe alcança por rota:
// `agenda_eventos`, `eventos_comerciais`, `followup_auto_agendamentos`, `lead_contextos` e
// `agenda_lembretes`.
//
// ─── A REGRA QUE ELE RESPEITA: NÃO SE INVENTA DONO ───────────────────────────────────────
// O tenant é RESOLVIDO a partir de uma linha que já tem dono provado — a conversa ou o perfil do
// lead —, dentro do próprio SQL. **Linha sem dono resolvível fica NULA.**
//
// Isto não é cautela genérica: é a lição registrada no AGENTS.md. As migrations 005 e 006 puseram
// `DEFAULT '<PJ>'` e o resultado medido foi *"todo lead de toda empresa nascia marcado como PJ"*,
// com perda de conversão para os outros tenants. A migration 058 teve de desfazer isso.
// Aqui, "não sei de quem é" é um resultado legítimo e fica visível no relatório.
//
// ─── GARANTIAS (mesmo padrão de backfill:lead-profiles-empresa) ──────────────────────────
//   * **SIMULA por padrão.** Só grava com `-- --aplicar`.
//   * **Um COMMIT por lote**, nunca um UPDATE massivo em transação única.
//   * Idempotente: só toca linhas com `empresa_id IS NULL`; rodar de novo não muda nada.
//   * Nenhuma chamada externa, nenhuma dependência nova.
//   * Relatório **sem PII**: só contagens e ids mascarados.
//   * `DATABASE_URL` explícita — o script nunca escolhe banco sozinho.
//   * SQL de rollback impresso ao final.
//
// Uso:
//   npm run backfill:vendas-empresa                 # simula (nao grava)
//   npm run backfill:vendas-empresa -- --aplicar    # grava
//   npm run backfill:vendas-empresa -- --lote=500

const { Pool } = require('pg')

const LOTE_PADRAO = 1000

// ─── O mapa de resolução ─────────────────────────────────────────────────────────────────
//
// Cada entrada diz COMO o dono daquela tabela é provado. A fonte é sempre uma linha que já tem
// `empresa_id`: `vendas.conversas` ou `vendas.lead_profiles` (ambas preenchidas pela migration 006
// e corrigidas pela 058). Nenhuma entrada usa telefone solto, "a empresa mais provável" ou
// qualquer heurística.
const TABELAS = Object.freeze([
  {
    nome: 'agenda_eventos',
    // A agenda do bot tem `conversa_id` e `lead_id`. A conversa é a fonte preferida (é dela que a
    // própria `lead_profiles.empresa_id` é derivada, ver migration 058); o lead é o fallback para
    // evento criado sem conversa.
    origem: `COALESCE(
      (SELECT c.empresa_id FROM vendas.conversas c WHERE c.id = t.conversa_id),
      (SELECT lp.empresa_id FROM vendas.lead_profiles lp WHERE lp.id = t.lead_id)
    )`,
  },
  {
    nome: 'eventos_comerciais',
    // Chaveada por telefone/numero da conversa.
    origem: `(SELECT c.empresa_id FROM vendas.conversas c WHERE c.numero = t.numero)`,
  },
  {
    nome: 'followup_auto_agendamentos',
    origem: `(SELECT c.empresa_id FROM vendas.conversas c WHERE c.numero = t.numero)`,
  },
  {
    nome: 'lead_contextos',
    origem: `(SELECT c.empresa_id FROM vendas.conversas c WHERE c.numero = t.numero)`,
  },
  {
    nome: 'agenda_lembretes',
    // O lembrete pertence ao evento que o gerou.
    origem: `(SELECT e.empresa_id FROM vendas.agenda_eventos e WHERE e.id = t.evento_id)`,
  },
])

// ─── Apresentação (PURA — testada em test/backfill-vendas-empresa.test.js) ───────────────

function mascarar(valor) {
  if (valor == null || valor === '') return '(sem empresa)'
  const s = String(valor)
  return s.length <= 8 ? s : `${s.slice(0, 8)}…`
}

function tabela(cabecalho, linhas) {
  const todas = [cabecalho, ...linhas].map((l) => l.map((c) => String(c == null ? '' : c)))
  const larguras = cabecalho.map((_, i) => Math.max(...todas.map((l) => (l[i] || '').length)))
  const linha = (l) => l.map((c, i) => (i === 0 ? c.padEnd(larguras[i]) : c.padStart(larguras[i]))).join('  ')
  return [linha(todas[0]), larguras.map((w) => '-'.repeat(w)).join('  '), ...todas.slice(1).map(linha)].join('\n')
}

/**
 * A leitura de negócio do resultado.
 * "Sem dono resolvível" NÃO é erro: é a resposta honesta para uma linha órfã, e precisa aparecer
 * como número para o operador decidir se investiga.
 */
function montarAchados(resultados, aplicou) {
  const achados = []
  const total = resultados.reduce((s, r) => s + r.candidatas, 0)
  const resolvidas = resultados.reduce((s, r) => s + r.resolvidas, 0)
  const orfas = total - resolvidas

  achados.push(`${total} linha(s) sem empresa; ${resolvidas} com dono resolvivel; ${orfas} orfa(s).`)
  if (!aplicou) achados.push('SIMULACAO: nada foi gravado. Rode com -- --aplicar para persistir.')
  if (orfas > 0) {
    achados.push('Linha orfa fica NULA de proposito: inventar dono foi o defeito que as migrations 005/006 produziram e a 058 teve de desfazer.')
  }
  for (const r of resultados) {
    if (r.erro) achados.push(`FALHOU em vendas.${r.nome}: ${r.erro}`)
  }
  return achados
}

// ─── Execução ────────────────────────────────────────────────────────────────────────────

/**
 * Processa UMA tabela, em lotes, com um COMMIT por lote.
 *
 * Keyset por `ctid`? Não: usamos `LIMIT` sobre `empresa_id IS NULL`, e como o próprio UPDATE
 * remove a linha do conjunto candidato, o laço converge sem cursor. É o mesmo desenho do backfill
 * de `lead_profiles`, e evita a necessidade de uma chave estável (nem todas estas tabelas têm id
 * comparável).
 */
async function processarTabela(pool, spec, { aplicar, lote }) {
  const out = { nome: spec.nome, candidatas: 0, resolvidas: 0, lotes: 0, erro: null }
  try {
    const { rows: [existe] } = await pool.query(
      `SELECT 1 AS ok FROM information_schema.columns
        WHERE table_schema = 'vendas' AND table_name = $1 AND column_name = 'empresa_id' LIMIT 1`,
      [spec.nome]
    )
    if (!existe) { out.erro = 'coluna empresa_id ausente (migration 077 nao aplicada?)'; return out }

    // Quantas linhas estão sem dono, e de quantas dá para provar o dono.
    const { rows: [contagem] } = await pool.query(
      `SELECT COUNT(*)::int AS candidatas,
              COUNT(*) FILTER (WHERE ${spec.origem} IS NOT NULL)::int AS resolvidas
         FROM vendas.${spec.nome} t
        WHERE t.empresa_id IS NULL`
    )
    out.candidatas = contagem.candidatas
    out.resolvidas = contagem.resolvidas
    if (!aplicar || out.resolvidas === 0) return out

    // Grava em lotes, um COMMIT por lote. Um UPDATE massivo numa transação só travaria as tabelas
    // por tempo indeterminado num banco em produção.
    let restantes = out.resolvidas
    while (restantes > 0) {
      const { rowCount } = await pool.query(
        `UPDATE vendas.${spec.nome} AS alvo
            SET empresa_id = sub.dono
           FROM (
             SELECT t.ctid AS linha, ${spec.origem} AS dono
               FROM vendas.${spec.nome} t
              WHERE t.empresa_id IS NULL AND ${spec.origem} IS NOT NULL
              LIMIT $1
           ) AS sub
          WHERE alvo.ctid = sub.linha`,
        [lote]
      )
      out.lotes += 1
      if (!rowCount) break
      restantes -= rowCount
    }
    return out
  } catch (e) {
    out.erro = e && e.message ? e.message : String(e)
    return out
  }
}

function imprimir(resultados, { aplicar }) {
  const L = (s = '') => console.log(s)
  L()
  L('════ BACKFILL — empresa_id em vendas.* (Etapa 11.2) ════')
  L(aplicar ? 'MODO: APLICAR (grava)' : 'MODO: SIMULACAO (nao grava)')
  L()
  L(tabela(
    ['tabela', 'sem empresa', 'resolviveis', 'orfas', 'lotes'],
    resultados.map((r) => [
      `vendas.${r.nome}`, r.candidatas, r.resolvidas, r.candidatas - r.resolvidas, r.lotes,
    ])
  ))
  L()
  L('════ ACHADOS ════')
  for (const a of montarAchados(resultados, aplicar)) L(`  • ${a}`)
  L()
  if (aplicar) {
    L('════ ROLLBACK ════')
    L('  Para desfazer, rode (uma tabela por vez, conferindo a contagem antes):')
    for (const r of resultados) {
      if (r.lotes > 0) L(`    UPDATE vendas.${r.nome} SET empresa_id = NULL;  -- ${r.resolvidas} linha(s)`)
    }
    L('  ⚠️ O rollback apaga TODAS as atribuicoes da tabela, inclusive as que ja existiam antes')
    L('     deste backfill. Se isso importar, filtre por um intervalo de tempo conhecido.')
    L()
  }
}

async function main(argv = process.argv.slice(2)) {
  const aplicar = argv.includes('--aplicar')
  const loteArg = argv.find((a) => a.startsWith('--lote='))
  const lote = Math.min(Math.max(parseInt((loteArg || '').split('=')[1], 10) || LOTE_PADRAO, 1), 10000)

  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL nao definida. Passe explicitamente qual banco alterar — este script nunca escolhe um sozinho.')
    process.exit(1)
  }

  // ⚠️ DIVIDA DECLARADA (pre-existente): `rejectUnauthorized: false` e' o que os scripts irmaos
  // ja fazem para alcancar o proxy publico do Railway. Ver o comentario em
  // scripts/medir-qualificacao-lead.js — a correcao vale para TODOS e e' tarefa propria.
  const pool = new Pool({
    connectionString: url,
    ssl: /railway|amazonaws|supabase|neon|render/i.test(url) ? { rejectUnauthorized: false } : undefined,
  })

  const resultados = []
  try {
    for (const spec of TABELAS) {
      resultados.push(await processarTabela(pool, spec, { aplicar, lote }))
    }
  } finally {
    await pool.end()
  }

  imprimir(resultados, { aplicar })
  if (resultados.some((r) => r.erro)) process.exit(1)
}

if (require.main === module) {
  main().catch((e) => {
    console.error('\nFalhou:', e && e.message ? e.message : e)
    process.exit(1)
  })
}

module.exports = { TABELAS, mascarar, tabela, montarAchados, processarTabela }
