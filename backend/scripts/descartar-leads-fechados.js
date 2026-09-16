'use strict'
// CORRECAO HISTORICA — descarta leads que o GOOGLE declara fechados.
//
// ─── O QUE ESTE SCRIPT NAO E' ────────────────────────────────────────────────────────────
// Ele **nao** implementa o filtro de recencia de 6 meses. Medicao de 2026-09-16 em producao:
// dos 4.631 prospects, ZERO tem data de atividade gravada (nem `reviews` com data, nem
// `latest_review_date`, nem foto datada — as fotos chegam como URL em texto). Sem data, a
// regra de 6 meses de `calcularAtividadeGoogle` nunca e' avaliada. Inventar inatividade a
// partir de AUSENCIA de dado seria o mesmo defeito que este repositorio ja removeu duas vezes
// (o fallback da PJ no webhook, a escolha de instancia por `atualizado_em`): concluir dono/
// veredito onde nao ha prova.
//
// ─── O QUE ELE E' ────────────────────────────────────────────────────────────────────────
// Ele age so' sobre FATO DECLARADO PELA FONTE: `businessStatus` / `permanently_closed` /
// `temporarily_closed`. Quem julga e' `services/google-business-activity.js` — o script nao
// tem criterio proprio, de proposito: um segundo criterio divergiria do que a Aquisicao e a
// curadoria ja usam para pontuar.
//
// Ele:
//   - NAO faz nenhuma chamada externa (nada de Bright Data, nada pago, nada de rede);
//   - e' IDEMPOTENTE: quem ja esta descartado nao e' tocado de novo;
//   - roda em LOTES com keyset por id, um COMMIT por lote (nunca um UPDATE massivo);
//   - PRESERVA a decisao humana: lead `aprovado` por uma pessoa e' pulado e apenas RELATADO,
//     salvo `--incluir-aprovados`. Descartar por cima de quem aprovou e' decisao de gente;
//   - grava o estado ANTERIOR em `app.auditoria_eventos` (contexto JSONB, sem migration nova),
//     o que torna o descarte auditavel e reversivel — importante porque a recoleta NUNCA
//     promove um descartado de volta (`qualificacaoAoRecoletar`);
//   - so' grava com `--aplicar`. Sem a flag, e' SIMULACAO e nao escreve nada.
//
// Uso:
//   node scripts/descartar-leads-fechados.js                      # simulacao (padrao)
//   node scripts/descartar-leads-fechados.js -- --aplicar         # grava
//   node scripts/descartar-leads-fechados.js --temporarios        # inclui CLOSED_TEMPORARILY
//   node scripts/descartar-leads-fechados.js --nicho=solar        # restringe por nicho (ILIKE)
//   node scripts/descartar-leads-fechados.js --empresa=<uuid>     # restringe a uma empresa
//   node scripts/descartar-leads-fechados.js --lote=200           # tamanho do lote (padrao 500)
//
// `--temporarios` NAO e' o padrao de proposito: negocio fechado temporariamente pode reabrir, e
// como a recoleta nao promove de volta, incluir por omissao seria decidir pelo operador.
// Decisao do operador em 2026-09-16: incluir. Por isso a flag existe — e fica registrada.

const { pool } = require('../src/db')
const { calcularAtividadeGoogle } = require('../src/services/google-business-activity')
const { QUALIFICACAO } = require('../src/services/lead-qualificacao')

// As faixas que significam "a FONTE declarou fechado". Vem do classificador, nao daqui.
const FAIXAS_FECHADO_PERMANENTE = new Set(['fechado'])
const FAIXAS_FECHADO_TEMPORARIO = new Set(['fechado_temporario'])

function lerArgs(argv) {
  const args = { aplicar: false, lote: 500, empresa: null, nicho: null, temporarios: false, incluirAprovados: false }
  for (const bruto of argv.slice(2)) {
    const arg = String(bruto)
    if (arg === '--') continue
    else if (arg === '--aplicar') args.aplicar = true
    else if (arg === '--temporarios') args.temporarios = true
    else if (arg === '--incluir-aprovados') args.incluirAprovados = true
    else if (arg === '--dry-run' || arg === '--simular') args.aplicar = false
    else if (arg.startsWith('--lote=')) {
      const n = Number.parseInt(arg.slice(7), 10)
      args.lote = Number.isFinite(n) ? Math.max(1, Math.min(5000, n)) : 500
    }
    else if (arg.startsWith('--empresa=')) args.empresa = arg.slice(10).trim() || null
    else if (arg.startsWith('--nicho=')) args.nicho = arg.slice(8).trim() || null
    else throw new Error(`argumento desconhecido: ${arg}`)
  }
  return args
}

// PURA: decide o destino de UMA linha. O mesmo input sempre da o mesmo veredito — e' o que
// garante que a simulacao e a aplicacao concordem.
function vereditoDaLinha(row, args) {
  const atividade = calcularAtividadeGoogle(row)
  const permanente = FAIXAS_FECHADO_PERMANENTE.has(atividade.faixa)
  const temporario = FAIXAS_FECHADO_TEMPORARIO.has(atividade.faixa)

  if (!permanente && !temporario) return { acao: 'manter', motivo: 'sem_fechamento_declarado', atividade }
  if (temporario && !args.temporarios) return { acao: 'manter', motivo: 'fechado_temporario_fora_do_escopo', atividade }
  if (row.qualificacao === QUALIFICACAO.DESCARTADO) return { acao: 'manter', motivo: 'ja_descartado', atividade }
  if (row.qualificacao === QUALIFICACAO.APROVADO && !args.incluirAprovados) {
    return { acao: 'pular_aprovado', motivo: 'aprovado_por_uma_pessoa', atividade }
  }
  return { acao: 'descartar', motivo: permanente ? 'fechado_permanente' : 'fechado_temporario', atividade }
}

async function main() {
  const args = lerArgs(process.argv)
  const rel = {
    analisados: 0, descartados: 0, mantidos: 0, pulados_aprovados: 0,
    por_motivo: { fechado_permanente: 0, fechado_temporario: 0 },
  }

  console.log(args.aplicar ? '>>> MODO APLICAR — vai gravar no banco.' : '>>> SIMULACAO — nada sera gravado.')
  console.log(`>>> escopo: temporarios=${args.temporarios} aprovados=${args.incluirAprovados}`
    + ` nicho=${args.nicho || '(todos)'} empresa=${args.empresa || '(todas)'}`)

  const filtros = ["qualificacao <> 'descartado'"]
  const params = []
  if (args.empresa) { params.push(args.empresa); filtros.push(`empresa_id = $${params.length}::uuid`) }
  if (args.nicho) { params.push(`%${args.nicho}%`); filtros.push(`nicho ILIKE $${params.length}`) }

  let ultimoId = '00000000-0000-0000-0000-000000000000'
  for (;;) {
    const p = [...params, ultimoId, args.lote]
    const { rows } = await pool.query(
      `SELECT id, empresa_id, nicho, qualificacao, status, raw_json
         FROM prospectador.prospects
        WHERE ${filtros.join(' AND ')} AND id > $${p.length - 1}::uuid
        ORDER BY id
        LIMIT $${p.length}`,
      p
    )
    if (!rows.length) break
    ultimoId = rows[rows.length - 1].id

    const aDescartar = []
    for (const row of rows) {
      rel.analisados++
      const v = vereditoDaLinha(row, args)
      if (v.acao === 'descartar') {
        rel.descartados++
        rel.por_motivo[v.motivo]++
        aDescartar.push({ row, veredito: v })
      } else if (v.acao === 'pular_aprovado') {
        rel.pulados_aprovados++
      } else {
        rel.mantidos++
      }
    }

    if (args.aplicar && aDescartar.length) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        for (const { row, veredito } of aDescartar) {
          // `qualificado_em` e' obrigatorio pela CHECK prospects_qualificado_em_chk (migration
          // 071). `qualificado_por` fica NULO: nao houve usuario — foi manutencao. Inventar um
          // autor seria mentir sobre quem decidiu.
          await client.query(
            `UPDATE prospectador.prospects
                SET qualificacao = $2, status = 'rejeitado', qualificado_em = NOW(), updated_at = NOW()
              WHERE id = $1::uuid AND qualificacao <> 'descartado'`,
            [row.id, QUALIFICACAO.DESCARTADO]
          )
          // Auditoria na MESMA transacao: sem o estado anterior registrado, o descarte vira
          // irreversivel de fato. Sem PII — nem nome, nem telefone, nem endereco.
          await client.query(
            `INSERT INTO app.auditoria_eventos
               (empresa_id, usuario_id, entidade_tipo, entidade_id, acao, estado_anterior, estado_novo, contexto)
             VALUES ($1::uuid, NULL, 'prospect', $2::uuid, 'lead_descartado_fechado_no_google', $3, $4, $5::jsonb)`,
            [
              row.empresa_id, row.id, row.qualificacao, QUALIFICACAO.DESCARTADO,
              JSON.stringify({
                origem: 'script:descartar-leads-fechados',
                motivo: veredito.motivo,
                faixa_atividade: veredito.atividade.faixa,
                status_anterior: row.status,
                nicho: row.nicho,
              }),
            ]
          )
        }
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }
    }

    if (rows.length < args.lote) break
  }

  console.log('\n=== RELATORIO ===')
  console.table([rel])
  console.log('por motivo:', rel.por_motivo)
  if (rel.pulados_aprovados) {
    console.log(`\n!! ${rel.pulados_aprovados} lead(s) fechado(s) no Google estao APROVADOS por uma pessoa.`)
    console.log('   Nao foram tocados. Use --incluir-aprovados se a decisao for sobrepor.')
  }
  if (!args.aplicar) console.log('\n(simulacao — nada foi gravado. Rode com --aplicar para valer.)')
  else console.log('\nRollback: app.auditoria_eventos guarda o estado anterior de cada linha'
    + " (acao = 'lead_descartado_fechado_no_google').")
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('ERRO:', err.message); process.exit(1) })
