'use strict'
// CORRECAO HISTORICA — alinha `vendas.lead_profiles.empresa_id` com a empresa da CONVERSA.
//
// Contexto: a migration 006 pos `DEFAULT '<PJ>'` na coluna e nenhum dos quatro caminhos de
// INSERT informava empresa. Resultado: todo lead de toda empresa nasceu marcado como PJ.
// A migration 058 tirou o DEFAULT e o codigo passou a gravar a empresa da conversa — mas as
// linhas JA GRAVADAS continuam erradas. Este script corrige essas linhas.
//
// Ele:
//   - NAO faz nenhuma chamada externa (nada de Meta, nada pago, nada de rede);
//   - e' IDEMPOTENTE: a segunda execucao nao encontra mais nada para corrigir;
//   - roda em LOTES por keyset (id), um COMMIT por lote — nunca um UPDATE massivo numa
//     transacao unica que segure a tabela do atendimento;
//   - grava o valor ANTERIOR de cada linha em `vendas.lead_profiles_empresa_backfill`
//     ANTES de alterar, na MESMA transacao do lote. E' o rollback;
//   - so' grava com `--aplicar`. Sem a flag, e' simulacao e nada e' escrito;
//   - NAO imprime telefone, nome nem qualquer dado do lead — so' contagens agregadas.
//
// Uso:
//   npm run backfill:lead-profiles-empresa                      # simulacao (padrao)
//   npm run backfill:lead-profiles-empresa -- --aplicar         # grava
//   npm run backfill:lead-profiles-empresa -- --lote=200        # tamanho do lote (padrao 500)
//   npm run backfill:lead-profiles-empresa -- --empresa=<uuid>  # so' linhas HOJE marcadas assim
//
// ANTES DE APLICAR EM PRODUCAO: pause o envio da Meta (META_CONVERSOES_PAUSADO=on). Uma
// mudanca de atribuicao no meio do ciclo faria o motor registrar/enviar conversao com a
// empresa antiga, e evento aceito pela Meta nao se estorna.

const crypto = require('crypto')
const { pool } = require('../src/db')
const { EMPRESA_PADRAO_PJ } = require('../src/db/lead-profile-empresa')

function lerArgs(argv) {
  const args = { aplicar: false, lote: 500, empresa: null }
  for (const bruto of argv.slice(2)) {
    const arg = String(bruto)
    if (arg === '--aplicar') args.aplicar = true
    else if (arg === '--dry-run' || arg === '--simular') args.aplicar = false
    else if (arg.startsWith('--lote=')) {
      // `parseInt('0')` e' 0 (falsy): sem o teste explicito, `--lote=0` cairia no default.
      const n = Number.parseInt(arg.slice(7), 10)
      args.lote = Number.isFinite(n) ? Math.max(1, Math.min(5000, n)) : 500
    } else if (arg.startsWith('--empresa=')) args.empresa = arg.slice(10).trim() || null
    else throw new Error(`argumento desconhecido: ${arg}`)
  }
  return args
}

function novoRelatorio() {
  return {
    analisados: 0,
    corrigidos: 0,          // empresa_id mudou de empresa
    ja_corretos: 0,         // empresa_id e procedencia ja corretos
    sem_conversa: 0,        // impossivel: perfil orfao (nao deveria existir — ha FK)
    conversa_sem_empresa: 0,// impossivel: a conversa tambem nao sabe de quem e'
    so_procedencia: 0,      // empresa certa, so' o carimbo de confianca faltava/mudou
    saiu_da_pj: 0,          // recorte do que interessa: deixou de ser PJ por engano
    confiaveis: 0,          // ficarao como 'conversa_confirmada'
    nao_confiaveis: 0,      // ficarao como 'conversa_nao_confirmada' — a Fase B recusa
  }
}

/**
 * Decide o estado CORRETO de uma linha. Funcao PURA — e' o que garante a idempotencia:
 * o mesmo input sempre devolve o mesmo alvo, e rodar de novo nao encontra nada a fazer.
 *
 * A conversa e' a autoridade (mesma regra do codigo de escrita, ver
 * src/db/lead-profile-empresa.js). Sem conversa ou sem empresa na conversa, NADA e'
 * alterado: inventar dono seria pior do que deixar visivel que ninguem sabe.
 */
function alvoDaLinha(row) {
  const atual = row.empresa_id || null
  const daConversa = row.empresa_conversa || null
  const origemAtual = row.empresa_id_origem || null
  // MESMA regra do codigo de escrita: "veio da conversa" so' e' confiavel se a instancia
  // WhatsApp da conversa apontar para a mesma empresa. Sem isso, o carimbo mentiria —
  // em producao, 3 dos 4 perfis de conversas da PJ estao exatamente nesse caso.
  const origem = row.empresa_confirmada_pela_instancia ? 'conversa_confirmada' : 'conversa_nao_confirmada'

  if (!row.tem_conversa) return { acao: 'sem_conversa' }
  if (!daConversa) return { acao: 'conversa_sem_empresa' }
  if (atual === daConversa) {
    return origemAtual === origem
      ? { acao: 'ja_correto', origem }
      : { acao: 'so_procedencia', empresaId: daConversa, origem }
  }
  return { acao: 'corrigir', empresaId: daConversa, empresaAnterior: atual, origem }
}

/**
 * A migration 058 ja rodou neste banco?
 *
 * Existe para permitir SIMULAR antes do deploy: a simulacao so' le, e ler
 * `empresa_id_origem` num banco que ainda nao tem a coluna quebraria a consulta inteira
 * — a pessoa ficaria sem os numeros justamente quando eles decidem se vale aplicar.
 * Sem a coluna, toda linha e' tratada como procedencia desconhecida (que e' a verdade).
 *
 * APLICAR sem a migration e' RECUSADO: sem a coluna e sem a tabela de backup, o script
 * gravaria sem ter onde registrar o "antes" — ou seja, sem rollback.
 */
async function estadoDoSchema() {
  const { rows } = await pool.query(`
    SELECT to_regclass('vendas.lead_profiles_empresa_backfill') IS NOT NULL AS tem_backup,
           EXISTS (
             SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'vendas' AND table_name = 'lead_profiles'
                AND column_name = 'empresa_id_origem'
           ) AS tem_coluna
  `)
  return { temBackup: !!rows[0].tem_backup, temColuna: !!rows[0].tem_coluna }
}

async function processar(args, rel, execucaoId, schema) {
  // Cursor por id (keyset): estavel mesmo com o UPDATE mudando as linhas sob o cursor.
  let ultimoId = 0
  let lote = 0
  const colunaOrigem = schema.temColuna ? 'lp.empresa_id_origem' : 'NULL::text AS empresa_id_origem'

  for (;;) {
    const params = [ultimoId, args.lote]
    let filtroEmpresa = ''
    if (args.empresa) {
      params.push(args.empresa)
      filtroEmpresa = `AND lp.empresa_id = $${params.length}::uuid`
    }
    const { rows } = await pool.query(
      `SELECT lp.id,
              lp.empresa_id,
              ${colunaOrigem},
              c.numero IS NOT NULL AS tem_conversa,
              c.empresa_id          AS empresa_conversa,
              (i.evolution_instance IS NOT NULL AND i.empresa_id = c.empresa_id)
                                    AS empresa_confirmada_pela_instancia
         FROM vendas.lead_profiles lp
         LEFT JOIN vendas.conversas c ON c.numero = lp.numero
         LEFT JOIN app.empresa_whatsapp_instances i ON i.evolution_instance = c.evolution_instance
        WHERE lp.id > $1 ${filtroEmpresa}
        ORDER BY lp.id
        LIMIT $2`,
      params
    )
    if (!rows.length) break
    lote += 1
    ultimoId = rows[rows.length - 1].id

    const paraGravar = []
    for (const row of rows) {
      rel.analisados += 1
      const alvo = alvoDaLinha(row)
      if (alvo.acao === 'sem_conversa') { rel.sem_conversa += 1; continue }
      if (alvo.acao === 'conversa_sem_empresa') { rel.conversa_sem_empresa += 1; continue }
      if (alvo.origem === 'conversa_confirmada') rel.confiaveis += 1
      else rel.nao_confiaveis += 1
      if (alvo.acao === 'ja_correto') { rel.ja_corretos += 1; continue }
      const gravar = {
        id: row.id,
        empresaId: alvo.empresaId,
        origem: alvo.origem,
        anterior: row.empresa_id,
        origemAnterior: row.empresa_id_origem,
      }
      if (alvo.acao === 'so_procedencia') { rel.so_procedencia += 1; paraGravar.push(gravar); continue }
      rel.corrigidos += 1
      if (alvo.empresaAnterior === EMPRESA_PADRAO_PJ) rel.saiu_da_pj += 1
      paraGravar.push(gravar)
    }

    if (args.aplicar && paraGravar.length) {
      // Um lote = uma transacao curta: backup e correcao entram juntos ou nao entram.
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query(
          `INSERT INTO vendas.lead_profiles_empresa_backfill
             (execucao_id, lead_profile_id, empresa_id_anterior, empresa_id_origem_anterior, empresa_id_novo)
           SELECT $1::uuid, d.id, d.anterior, d.origem_anterior, d.nova
             FROM unnest($2::int[], $3::uuid[], $4::text[], $5::uuid[])
                  AS d(id, anterior, origem_anterior, nova)`,
          [
            execucaoId,
            paraGravar.map((r) => r.id),
            paraGravar.map((r) => r.anterior),
            paraGravar.map((r) => r.origemAnterior),
            paraGravar.map((r) => r.empresaId),
          ]
        )
        await client.query(
          `UPDATE vendas.lead_profiles lp
              SET empresa_id        = d.nova,
                  empresa_id_origem = d.origem
             FROM unnest($1::int[], $2::uuid[], $3::text[]) AS d(id, nova, origem)
            WHERE lp.id = d.id`,
          [
            paraGravar.map((r) => r.id),
            paraGravar.map((r) => r.empresaId),
            paraGravar.map((r) => r.origem),
          ]
        )
        await client.query('COMMIT')
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {})
        throw e
      } finally {
        client.release()
      }
    }

    process.stdout.write(
      `${args.aplicar ? '[aplicando]' : '[simulacao]'} lote ${lote} · ` +
      `${rel.analisados} analisados · ${rel.corrigidos} a corrigir\n`
    )
    if (rows.length < args.lote) break
  }
}

/** Mensagem de recusa quando se tenta APLICAR sem a migration 058. */
function motivoRecusaAplicar(schema) {
  if (schema.temColuna && schema.temBackup) return null
  const faltando = [
    schema.temColuna ? null : 'coluna vendas.lead_profiles.empresa_id_origem',
    schema.temBackup ? null : 'tabela vendas.lead_profiles_empresa_backfill (o rollback)',
  ].filter(Boolean)
  return (
    `a migration 058 ainda nao rodou neste banco — falta: ${faltando.join(' e ')}.\n` +
    'Aplicar sem ela gravaria sem ter onde registrar o "antes", ou seja, sem rollback.\n' +
    'A SIMULACAO funciona normalmente: rode sem --aplicar para ver os numeros.'
  )
}

function imprimirRelatorio(args, rel, execucaoId) {
  const n = (v) => String(v).padStart(7)
  console.log('')
  console.log('─────────────────────────────────────────────────────────')
  console.log(` EMPRESA_ID DE lead_profiles ${args.aplicar ? '(APLICADO)' : '(SIMULACAO — nada gravado)'}`)
  console.log('─────────────────────────────────────────────────────────')
  console.log(` Analisados ............................ ${n(rel.analisados)}`)
  console.log(` ${args.aplicar ? 'Corrigidos' : 'Seriam corrigidos'} ${'.'.repeat(args.aplicar ? 24 : 17)} ${n(rel.corrigidos)}`)
  console.log(`   destes, deixaram de ser PJ .......... ${n(rel.saiu_da_pj)}`)
  console.log(` Ja corretos ........................... ${n(rel.ja_corretos)}`)
  console.log(` So' carimbo de confianca .............. ${n(rel.so_procedencia)}`)
  console.log('')
  console.log(' Confianca da atribuicao (o que a Fase B vai ler):')
  console.log(`   conversa_confirmada (confiavel) ..... ${n(rel.confiaveis)}`)
  console.log(`   conversa_nao_confirmada (recusar) ... ${n(rel.nao_confiaveis)}`)
  console.log('')
  console.log(' Impossiveis (NADA foi alterado nestes):')
  console.log(`   perfil sem conversa ................. ${n(rel.sem_conversa)}`)
  console.log(`   conversa sem empresa_id ............. ${n(rel.conversa_sem_empresa)}`)
  console.log('─────────────────────────────────────────────────────────')
  if (!args.aplicar) {
    console.log(' Nenhum registro foi gravado.')
    console.log(' Para aplicar:  npm run backfill:lead-profiles-empresa -- --aplicar')
    console.log(' ANTES de aplicar em producao: META_CONVERSOES_PAUSADO=on.')
  } else {
    console.log(` Execucao: ${execucaoId}`)
    console.log(' ROLLBACK desta execucao (copie e cole):')
    console.log('   UPDATE vendas.lead_profiles lp')
    console.log('      SET empresa_id        = b.empresa_id_anterior,')
    console.log('          empresa_id_origem = b.empresa_id_origem_anterior')
    console.log('     FROM vendas.lead_profiles_empresa_backfill b')
    console.log('    WHERE b.lead_profile_id = lp.id')
    console.log(`      AND b.execucao_id = '${execucaoId}';`)
  }
  console.log('')
}

async function main() {
  const args = lerArgs(process.argv)
  const rel = novoRelatorio()
  const execucaoId = crypto.randomUUID()
  const schema = await estadoDoSchema()
  if (args.aplicar) {
    const recusa = motivoRecusaAplicar(schema)
    if (recusa) throw new Error(recusa)
  }
  console.log(
    `Backfill de empresa_id em vendas.lead_profiles · modo=${args.aplicar ? 'APLICAR' : 'SIMULACAO'} · ` +
    `lote=${args.lote}${args.empresa ? ` · so' linhas hoje marcadas como ${args.empresa}` : ' · base inteira'}` +
    `${schema.temColuna ? '' : ' · migration 058 AUSENTE: toda linha conta como procedencia desconhecida'}`
  )
  await processar(args, rel, execucaoId, schema)
  imprimirRelatorio(args, rel, execucaoId)
}

if (require.main === module) {
  main()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error('\nFalhou:', err && err.message ? err.message : err)
      await pool.end().catch(() => {})
      process.exit(1)
    })
}

module.exports = { lerArgs, alvoDaLinha, novoRelatorio, motivoRecusaAplicar }
