'use strict'
// CORRECAO HISTORICA — descarta leads que o GOOGLE declara fechados e, opcionalmente, leads
// cuja ULTIMA ATIVIDADE PUBLICA e' antiga demais para valer energia de abordagem.
//
// ─── A REGRA QUE GOVERNA O SCRIPT ────────────────────────────────────────────────────────
// So' se descarta contra PROVA. Sao duas provas, e nunca uma terceira:
//   1. a fonte DECLARA fechado (`permanently_closed` / `temporarily_closed` / `businessStatus`);
//   2. existe uma DATA de atividade e ela e' mais velha que o corte (`--recencia`).
//
// AUSENCIA de data NAO e' prova de inatividade, e este script nunca descarta por ela. Um lead
// sem review nenhuma pode ser um negocio novo, ou um negocio que simplesmente ninguem avaliou.
// Concluir veredito onde nao ha prova e' o mesmo defeito que este repositorio ja removeu duas
// vezes (o fallback da PJ no webhook, a escolha de instancia por `atualizado_em`). Por isso as
// faixas `ativo_sem_data` e `possivelmente_inativo` sao MANTIDAS mesmo com `--recencia`.
//
// ─── HISTORICO (por que este cabecalho mudou) ────────────────────────────────────────────
// Ate 2026-09-16 este script se chamava `descartar-leads-fechados.js` e declarava que o filtro
// de recencia era INCALCULAVEL: dos 4.631 prospects, ZERO tinham data de atividade. A causa nao
// era a fonte, era o adaptador — a Bright Data devolve a data em `top_reviews[].review_date`, e
// o adaptador lia `reviews`. Com o registro cru preservado em `fonte_bruta` e a colecao correta
// varrida, 205 de 262 registros da coleta de `Energia Solar`/Goiania passaram a ter data. O
// filtro deixou de ser hipotese, e o script passou a poder implementa-lo.
//
// Quem julga continua sendo `services/google-business-activity.js` — o script nao tem criterio
// proprio, de proposito: um segundo criterio divergiria do que a Aquisicao e a curadoria ja
// usam para pontuar. O corte de `--recencia` escolhe QUAL faixa vira descarte, nao como o lead
// e' classificado.
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
//   node scripts/descartar-leads-inativos.js                      # simulacao (padrao)
//   node scripts/descartar-leads-inativos.js -- --aplicar         # grava
//   node scripts/descartar-leads-inativos.js --temporarios        # inclui CLOSED_TEMPORARILY
//   node scripts/descartar-leads-inativos.js --recencia           # + sem atividade ha >365 dias
//   node scripts/descartar-leads-inativos.js --recencia=183       # + sem atividade ha >183 dias
//   node scripts/descartar-leads-inativos.js --nicho=solar        # restringe por nicho (ILIKE)
//   node scripts/descartar-leads-inativos.js --empresa=<uuid>     # restringe a uma empresa
//   node scripts/descartar-leads-inativos.js --lote=200           # tamanho do lote (padrao 500)
//
// `--temporarios` NAO e' o padrao de proposito: negocio fechado temporariamente pode reabrir, e
// como a recoleta nao promove de volta, incluir por omissao seria decidir pelo operador.
// Decisao do operador em 2026-09-16: incluir. Por isso a flag existe — e fica registrada.
//
// `--recencia` tambem NAO e' o padrao, pelo mesmo motivo e com um agravante: o corte e' uma
// decisao COMERCIAL (quanto tempo parado ainda vale uma ligacao?), nao um fato tecnico. O
// default de 365 dias e' deliberadamente conservador — 183 (os "6 meses") descarta tambem a
// faixa `atividade_morna`, que e' zona cinzenta, e isso precisa ser escolhido, nao herdado.

const { pool } = require('../src/db')
const { calcularAtividadeGoogle } = require('../src/services/google-business-activity')
const { QUALIFICACAO } = require('../src/services/lead-qualificacao')

// As faixas que significam "a FONTE declarou fechado". Vem do classificador, nao daqui.
const FAIXAS_FECHADO_PERMANENTE = new Set(['fechado'])
const FAIXAS_FECHADO_TEMPORARIO = new Set(['fechado_temporario'])

// Corte padrao de `--recencia`, em dias. Conservador de proposito (ver cabecalho).
const RECENCIA_PADRAO_DIAS = 365

// A acao gravada na auditoria SEPARA os dois fatos, de proposito. "A fonte declarou fechado" e
// "esta parado ha muito tempo" tem forcas diferentes: o primeiro e' declaracao do Google, o
// segundo e' inferencia nossa a partir de um corte que uma pessoa escolheu. Somar os dois numa
// acao unica faria uma reversao futura nao saber o que esta revertendo. O nome antigo e'
// preservado para o fechamento porque ja existem linhas gravadas com ele.
const ACAO_FECHADO = 'lead_descartado_fechado_no_google'
const ACAO_INATIVO = 'lead_descartado_por_inatividade'

function acaoAuditoria(motivo) {
  return motivo === 'atividade_antiga' ? ACAO_INATIVO : ACAO_FECHADO
}

function lerArgs(argv) {
  // `recenciaDias = null` significa "nao descartar por recencia" — e' o padrao.
  const args = { aplicar: false, lote: 500, empresa: null, nicho: null, temporarios: false, incluirAprovados: false, recenciaDias: null }
  for (const bruto of argv.slice(2)) {
    const arg = String(bruto)
    if (arg === '--') continue
    else if (arg === '--aplicar') args.aplicar = true
    else if (arg === '--temporarios') args.temporarios = true
    else if (arg === '--incluir-aprovados') args.incluirAprovados = true
    else if (arg === '--recencia') args.recenciaDias = RECENCIA_PADRAO_DIAS
    else if (arg.startsWith('--recencia=')) {
      const n = Number.parseInt(arg.slice(11), 10)
      // Corte invalido ABORTA em vez de cair no default: `--recencia=abc` virando 365 dias
      // descartaria leads por um numero que o operador nao escolheu.
      if (!Number.isFinite(n) || n < 1) throw new Error(`--recencia precisa de um numero de dias >= 1 (recebido: ${arg.slice(11)})`)
      args.recenciaDias = n
    }
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

  // Recencia: so' conta quando existe DATA. `dias_desde_atividade == null` significa "ninguem
  // sabe", e "nao sei" nunca vira descarte — e' a regra central deste script.
  const dias = atividade.dias_desde_atividade
  const velhoDemais =
    args.recenciaDias != null && typeof dias === 'number' && Number.isFinite(dias) && dias > args.recenciaDias

  if (!permanente && !temporario && !velhoDemais) {
    return { acao: 'manter', motivo: dias == null ? 'sem_prova_de_inatividade' : 'atividade_dentro_do_corte', atividade }
  }
  if (temporario && !args.temporarios && !velhoDemais) {
    return { acao: 'manter', motivo: 'fechado_temporario_fora_do_escopo', atividade }
  }
  if (row.qualificacao === QUALIFICACAO.DESCARTADO) return { acao: 'manter', motivo: 'ja_descartado', atividade }
  if (row.qualificacao === QUALIFICACAO.APROVADO && !args.incluirAprovados) {
    return { acao: 'pular_aprovado', motivo: 'aprovado_por_uma_pessoa', atividade }
  }
  // Fechamento declarado tem precedencia sobre recencia no MOTIVO: e' o fato mais forte, e e'
  // ele que o operador precisa ler na auditoria.
  const motivo = permanente ? 'fechado_permanente' : (temporario ? 'fechado_temporario' : 'atividade_antiga')
  return { acao: 'descartar', motivo, atividade }
}

async function main() {
  const args = lerArgs(process.argv)
  const rel = {
    analisados: 0, descartados: 0, mantidos: 0, pulados_aprovados: 0,
    por_motivo: { fechado_permanente: 0, fechado_temporario: 0, atividade_antiga: 0 },
  }

  console.log(args.aplicar ? '>>> MODO APLICAR — vai gravar no banco.' : '>>> SIMULACAO — nada sera gravado.')
  console.log(`>>> escopo: temporarios=${args.temporarios} aprovados=${args.incluirAprovados}`
    + ` recencia=${args.recenciaDias == null ? '(desligada)' : args.recenciaDias + ' dias'}`
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
             VALUES ($1::uuid, NULL, 'prospect', $2::uuid, $6, $3, $4, $5::jsonb)`,
            [
              row.empresa_id, row.id, row.qualificacao, QUALIFICACAO.DESCARTADO,
              JSON.stringify({
                origem: 'script:descartar-leads-inativos',
                motivo: veredito.motivo,
                faixa_atividade: veredito.atividade.faixa,
                dias_desde_atividade: veredito.atividade.dias_desde_atividade,
                corte_recencia_dias: args.recenciaDias,
                status_anterior: row.status,
                nicho: row.nicho,
              }),
              acaoAuditoria(veredito.motivo),
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
    console.log(`\n!! ${rel.pulados_aprovados} lead(s) elegivel(is) a descarte estao APROVADOS por uma pessoa.`)
    console.log('   Nao foram tocados. Use --incluir-aprovados se a decisao for sobrepor.')
  }
  if (!args.aplicar) console.log('\n(simulacao — nada foi gravado. Rode com --aplicar para valer.)')
  else console.log('\nRollback: app.auditoria_eventos guarda o estado anterior de cada linha'
    + ` (acao IN ('${ACAO_FECHADO}', '${ACAO_INATIVO}')).`)
}

// Exportado para teste: `vereditoDaLinha` e `lerArgs` sao PUROS e concentram a regra inteira.
// Sem isto, a unica forma de verificar "ausencia de data nunca descarta" seria rodar o script
// contra um banco — e essa e' justamente a garantia que nao pode depender de ambiente.
module.exports = { vereditoDaLinha, lerArgs, acaoAuditoria, RECENCIA_PADRAO_DIAS, ACAO_FECHADO, ACAO_INATIVO }

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => { console.error('ERRO:', err.message); process.exit(1) })
}
