'use strict'
// MEDICAO READ-ONLY da distribuicao de leads por EQUIPE (2026-09-23).
//
// POR QUE ESTE SCRIPT EXISTE
// A distribuicao por equipe (rebalanceamento ao entrar, "Puxar mais leads", devolucao ao sair e,
// desde 2026-09-23, a transferencia entre membros) so' foi validada LENDO o SQL — nunca contra os
// dados reais. E duas vezes o sintoma "a equipe nao recebeu os leads" teve causa que a tela nao
// mostrava: `nicho_id` nulo (2026-09-21) e lead atribuido em `legado` a quem so' enxerga lead
// aprovado (a Pousada, 2026-09-22). Este script responde, por equipe ativa, se a distribuicao
// esta' CERTA — e onde nao esta', por que.
//
// Para cada equipe ativa ele mede a carteira do nicho e confere SEIS invariantes:
//   1. nenhum lead atribuido que a pessoa nao enxerga (legado + sem acesso a base bruta);
//   2. nenhum lead do nicho na mao de quem nao e' da equipe;
//   3. nenhum lead do nicho parado na triagem;
//   4. carteira equilibrada (ninguem com menos da metade da media);
//   5. a soma fecha: membros + fila + fora da equipe = carteira do nicho (a propria consulta);
//   6. todo lead com dono tem RASTRO de quem o entregou (`app.lead_responsavel_historico`).
// E, para a empresa: leads aprovados sem nicho (nao chegam a equipe nenhuma) e quantas
// operacoes de distribuicao foram registradas nos ultimos 30 dias (a funcionalidade esta em uso?).
//
// ⚠️ OS PREDICADOS SAO OS DA PRODUCAO, IMPORTADOS — nao reescritos. `sqlRedistribuivel`,
// `sqlMotivoProtegido`, `sqlAbordavel` e `podeCapacidade` vem dos mesmos modulos PUROS que a
// distribuicao e a tela usam (sem banco, sem HTTP, sem worker). Uma copia aqui mediria uma regra
// parecida com a de producao, e a validacao nao provaria nada.
//
// O QUE ELE **NAO** FAZ: nao move, nao atribui, nao aprova e nao devolve lead nenhum; nao chama
// Evolution, Meta, Bright Data, provedor de e-mail nem IA. Ele MEDE.
//
// GARANTIAS DE SEGURANCA (as mesmas dos irmaos medir-*.js)
//   - Roda inteiro em `BEGIN TRANSACTION READ ONLY` e termina em `ROLLBACK`: o proprio Postgres
//     recusa escrita nesta sessao. Guarda em `test/medir-distribuicao-equipes.test.js`.
//   - Imprime SOMENTE contagens e ids MASCARADOS. Nenhum nome de pessoa, telefone, e-mail ou
//     dado de lead e' selecionado. Nome de EQUIPE e de NICHO saem: sao rotulos de organizacao.
//   - O script NUNCA escolhe banco sozinho: usa exatamente a `DATABASE_URL` que voce passar.
//
// Uso:
//   npm run medir:distribuicao-equipes
//   DATABASE_URL=<url> node scripts/medir-distribuicao-equipes.js
//   DATABASE_URL=<url> node scripts/medir-distribuicao-equipes.js --json

const { Pool } = require('pg')
const D = require('../src/services/lead-distribuicao')
const Q = require('../src/services/lead-qualificacao')
const { podeCapacidade, CAPACIDADES: CAP } = require('../src/services/acesso-capacidades')

// As acoes de auditoria das operacoes de distribuicao. Vocabulario gravado por
// `src/db/lead-distribuicao.js`; ha teste conferindo que as tres aparecem la'.
const ACOES_DISTRIBUICAO = Object.freeze([
  'equipe_comercial_leads_rebalanceados',
  'equipe_comercial_leads_puxados',
  'equipe_comercial_leads_transferidos',
])

// ─── Apresentacao e veredito (funcoes PURAS — testadas) ────────────────────────────────────

/** Mascara um UUID para o prefixo identificavel. Ausencia vira rotulo explicito, nunca ''. */
function mascarar(valor, rotuloVazio = '(sem dono)') {
  if (valor == null || valor === '') return rotuloVazio
  const s = String(valor)
  return s.length <= 8 ? s : `${s.slice(0, 8)}…`
}

/** Tabela de largura fixa, sem dependencia. */
function tabela(cabecalho, linhas) {
  const todas = [cabecalho, ...linhas].map((l) => l.map((c) => String(c == null ? '' : c)))
  const larguras = cabecalho.map((_, i) => Math.max(...todas.map((l) => (l[i] || '').length)))
  const linha = (l) => l.map((c, i) => (i === 0 ? c.padEnd(larguras[i]) : c.padStart(larguras[i]))).join('  ')
  return [linha(todas[0]), larguras.map((w) => '-'.repeat(w)).join('  '), ...todas.slice(1).map(linha)].join('\n')
}

/**
 * Junta o que o banco devolveu numa leitura por equipe. Recebe linhas cruas, devolve contagens.
 *
 * `membros` = [{usuario_id, papel, permissoes, papel_plataforma}] (ativos na equipe);
 * `carteira` = [{responsavel_id, leads, intocados, legado, sem_rastro}] do nicho, por dono.
 */
function resumirEquipe({ membros = [], carteira = [], aguardandoTriagem = 0, protegidos = [] } = {}) {
  const ids = new Set(membros.map((m) => String(m.usuario_id)))
  const veBruta = new Map(membros.map((m) => [String(m.usuario_id), podeCapacidade(
    { papel: m.papel, permissoes: m.permissoes, papelPlataforma: m.papel_plataforma },
    CAP.LEAD_VER_BRUTOS
  )]))
  const porDono = new Map(carteira.map((c) => [String(c.responsavel_id), c]))
  const num = (v) => Number(v) || 0

  const pessoas = membros.map((m) => {
    const c = porDono.get(String(m.usuario_id)) || {}
    const ve = veBruta.get(String(m.usuario_id)) === true
    return {
      usuario: mascarar(m.usuario_id),
      leads: num(c.leads),
      intocados: num(c.intocados),
      legado: num(c.legado),
      ve_base_bruta: ve,
      // O que a pessoa TEM e NAO VE: legado na mao de quem so' enxerga aprovado.
      invisiveis: ve ? 0 : num(c.legado),
      sem_rastro: num(c.sem_rastro),
    }
  })

  const fila = porDono.get('null') || {}
  const deFora = carteira.filter((c) => c.responsavel_id != null && !ids.has(String(c.responsavel_id)))
  const totalNicho = carteira.reduce((t, c) => t + num(c.leads), 0)
  const somaPartes = pessoas.reduce((t, p) => t + p.leads, 0) + num(fila.leads)
    + deFora.reduce((t, c) => t + num(c.leads), 0)

  const cargas = pessoas.map((p) => p.leads)
  const media = cargas.length ? cargas.reduce((t, x) => t + x, 0) / cargas.length : 0
  const abaixo = pessoas.filter((p) => cargas.length >= 2 && media > 0 && p.leads < media / 2).length

  return {
    membros: pessoas.length,
    total_nicho: totalNicho,
    na_fila: num(fila.leads),
    livres_intocados: num(fila.intocados),
    fora_da_equipe: { leads: deFora.reduce((t, c) => t + num(c.leads), 0), pessoas: deFora.length },
    aguardando_triagem: num(aguardandoTriagem),
    invisiveis: pessoas.reduce((t, p) => t + p.invisiveis, 0),
    sem_rastro: pessoas.reduce((t, p) => t + p.sem_rastro, 0),
    abaixo_da_metade: abaixo,
    media: Math.round(media * 10) / 10,
    soma_fecha: somaPartes === totalNicho,
    protegidos: protegidos.map((p) => ({ motivo: String(p.motivo), total: num(p.total) })),
    pessoas,
  }
}

/**
 * As SEIS verificacoes, com veredito e explicacao. `ok: true` e' o esperado.
 * Nenhuma delas afirma defeito de codigo sozinha: a maioria e' DADO que precisa de acao humana.
 */
function verificar(r) {
  const x = r || {}
  const fora = x.fora_da_equipe || { leads: 0, pessoas: 0 }
  return [
    {
      chave: 'visibilidade',
      ok: !x.invisiveis,
      rotulo: 'Todo lead atribuido aparece para quem o recebeu',
      detalhe: x.invisiveis
        ? `${x.invisiveis} lead(s) em legado na mao de quem so enxerga aprovado — aprovar resolve.`
        : 'ok',
    },
    {
      chave: 'fora_da_equipe',
      ok: !fora.leads,
      rotulo: 'Nenhum lead do nicho com quem nao e da equipe',
      detalhe: fora.leads ? `${fora.leads} lead(s) com ${fora.pessoas} pessoa(s) de fora.` : 'ok',
    },
    {
      chave: 'triagem',
      ok: !x.aguardando_triagem,
      rotulo: 'Nenhum lead do nicho parado na triagem',
      detalhe: x.aguardando_triagem ? `${x.aguardando_triagem} aguardando aprovacao — nao distribuem ate alguem aprovar.` : 'ok',
    },
    {
      chave: 'equilibrio',
      ok: !x.abaixo_da_metade,
      rotulo: 'Carteira equilibrada entre os membros',
      detalhe: x.abaixo_da_metade ? `${x.abaixo_da_metade} pessoa(s) com menos da metade da media (${x.media}).` : 'ok',
    },
    {
      chave: 'soma',
      ok: x.soma_fecha !== false,
      rotulo: 'A soma fecha (membros + fila + fora = nicho)',
      // Esta, sim, apontaria defeito da CONSULTA, e nao do dado.
      detalhe: x.soma_fecha === false ? 'DIVERGENCIA — a consulta da carteira perde leads. Investigar.' : 'ok',
    },
    {
      chave: 'rastro',
      ok: !x.sem_rastro,
      rotulo: 'Todo lead com dono tem registro de quem o entregou',
      detalhe: x.sem_rastro
        ? `${x.sem_rastro} lead(s) sem historico coerente — em geral atribuidos antes da migration 072.`
        : 'ok',
    },
  ]
}

// ─── Coleta (SOMENTE LEITURA) ──────────────────────────────────────────────────────────────

async function coletar(client) {
  const { rows: equipes } = await client.query(
    `SELECT e.id, e.empresa_id, e.nome, e.nicho_id, n.nome AS nicho_nome
       FROM app.equipes_comerciais e
       JOIN app.nichos n ON n.id = e.nicho_id AND n.empresa_id = e.empresa_id
      WHERE e.status = 'ativa'
      ORDER BY e.empresa_id, e.nome`
  )

  const porEquipe = []
  for (const eq of equipes) {
    const { rows: membros } = await client.query(
      `SELECT em.usuario_id, ue.role AS papel, ue.permissoes, u.role AS papel_plataforma
         FROM app.equipe_comercial_membros em
         JOIN app.usuarios_empresas ue ON ue.id = em.usuario_empresa_id
         JOIN app.usuarios u ON u.id = em.usuario_id
        WHERE em.empresa_id = $1 AND em.equipe_id = $2::uuid AND em.saiu_em IS NULL
          AND ue.ativo = true`,
      [eq.empresa_id, eq.id]
    )
    const { rows: carteira } = await client.query(
      `SELECT p.responsavel_id,
              COUNT(*)::int AS leads,
              COUNT(*) FILTER (WHERE ${D.sqlRedistribuivel('p', '$2')})::int AS intocados,
              COUNT(*) FILTER (WHERE p.qualificacao = $3)::int AS legado,
              COUNT(*) FILTER (
                WHERE p.responsavel_id IS NOT NULL
                  AND NOT EXISTS (
                    SELECT 1 FROM app.lead_responsavel_historico h
                     WHERE h.prospect_id = p.id AND h.responsavel_novo_id = p.responsavel_id
                  )
              )::int AS sem_rastro
         FROM prospectador.prospects p
        WHERE p.empresa_id = $1
          AND p.nicho_id = $2::uuid
          AND ${Q.sqlAbordavel('p')}
        GROUP BY p.responsavel_id`,
      [eq.empresa_id, eq.nicho_id, Q.QUALIFICACAO.LEGADO]
    )
    const { rows: triagem } = await client.query(
      `SELECT COUNT(*)::int AS total
         FROM prospectador.prospects p
        WHERE p.empresa_id = $1 AND p.nicho_id = $2::uuid AND p.qualificacao = $3`,
      [eq.empresa_id, eq.nicho_id, Q.QUALIFICACAO.PENDENTE]
    )
    const { rows: protegidos } = await client.query(
      `SELECT motivo, COUNT(*)::int AS total FROM (
         SELECT ${D.sqlMotivoProtegido('p', '$2')} AS motivo
           FROM prospectador.prospects p
          WHERE p.empresa_id = $1 AND p.nicho_id = $2::uuid
       ) x
        WHERE x.motivo IS NOT NULL
        GROUP BY motivo
        ORDER BY total DESC`,
      [eq.empresa_id, eq.nicho_id]
    )
    const resumo = resumirEquipe({
      membros, carteira, aguardandoTriagem: triagem[0]?.total || 0, protegidos,
    })
    porEquipe.push({
      empresa: mascarar(eq.empresa_id, '(sem empresa)'),
      equipe: eq.nome,
      nicho: eq.nicho_nome,
      ...resumo,
      verificacoes: verificar(resumo),
    })
  }

  const { rows: semNicho } = await client.query(
    `SELECT p.empresa_id, COUNT(*)::int AS total
       FROM prospectador.prospects p
      WHERE p.nicho_id IS NULL AND ${Q.sqlAbordavel('p')}
      GROUP BY p.empresa_id
      ORDER BY total DESC`
  )
  const { rows: operacoes } = await client.query(
    `SELECT a.empresa_id, a.acao, COUNT(*)::int AS total
       FROM app.auditoria_eventos a
      WHERE a.acao = ANY($1::text[])
        AND a.ocorrido_em >= NOW() - INTERVAL '30 days'
      GROUP BY a.empresa_id, a.acao
      ORDER BY a.empresa_id, a.acao`,
    [ACOES_DISTRIBUICAO]
  )

  return {
    equipes: porEquipe,
    sem_nicho: semNicho.map((r) => ({ empresa: mascarar(r.empresa_id, '(sem empresa)'), total: r.total })),
    operacoes_30d: operacoes.map((r) => ({ empresa: mascarar(r.empresa_id, '(sem empresa)'), acao: r.acao, total: r.total })),
  }
}

// ─── Relatorio ─────────────────────────────────────────────────────────────────────────────

function relatorio(dados) {
  const L = []
  L.push('DISTRIBUICAO DE LEADS POR EQUIPE — medicao somente leitura')
  L.push('')
  if (!dados.equipes.length) L.push('Nenhuma equipe ativa.')
  for (const eq of dados.equipes) {
    const falhas = eq.verificacoes.filter((v) => !v.ok).length
    L.push(`■ ${eq.equipe} · nicho ${eq.nicho} · empresa ${eq.empresa} — ${eq.membros} membro(s)`)
    L.push(`  carteira do nicho: ${eq.total_nicho} · na fila: ${eq.na_fila} (${eq.livres_intocados} livres e intocados)`)
    if (eq.pessoas.length) {
      L.push(tabela(
        ['  pessoa', 'leads', 'intocados', 'legado', 've legado?', 'invisiveis', 'sem rastro'],
        eq.pessoas.map((p) => [`  ${p.usuario}`, p.leads, p.intocados, p.legado, p.ve_base_bruta ? 'sim' : 'nao', p.invisiveis, p.sem_rastro])
      ))
    }
    if (eq.protegidos.length) {
      L.push(`  protegidos: ${eq.protegidos.map((p) => `${p.total} ${D.rotuloMotivoProtegido(p.motivo)}`).join(' · ')}`)
    }
    for (const v of eq.verificacoes) L.push(`  ${v.ok ? '✔' : '⚠'} ${v.rotulo}${v.ok ? '' : ` — ${v.detalhe}`}`)
    L.push(`  ${falhas ? `${falhas} ponto(s) de atencao.` : 'Distribuicao correta nesta equipe.'}`)
    L.push('')
  }
  L.push('Leads aprovados SEM nicho (nao chegam a equipe nenhuma):')
  L.push(dados.sem_nicho.length ? tabela(['  empresa', 'leads'], dados.sem_nicho.map((r) => [`  ${r.empresa}`, r.total])) : '  nenhum')
  L.push('')
  L.push('Operacoes de distribuicao registradas nos ultimos 30 dias:')
  L.push(dados.operacoes_30d.length
    ? tabela(['  empresa', 'operacao', 'vezes'], dados.operacoes_30d.map((r) => [`  ${r.empresa}`, r.acao, r.total]))
    : '  nenhuma — a distribuicao ainda nao foi usada neste banco.')
  L.push('')
  L.push('Nada foi gravado: a sessao roda em READ ONLY e termina em ROLLBACK.')
  return L.join('\n')
}

async function main(argv = process.argv.slice(2)) {
  const comoJson = argv.includes('--json')
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL nao definida. Passe explicitamente qual banco medir — este script nunca escolhe um sozinho.')
    process.exit(1)
  }
  // Mesma politica de TLS dos irmaos medir-*.js (divida declarada neles): o proxy publico do
  // Railway apresenta certificado fora da cadeia padrao. Trafegam so' contagens sem PII.
  const pool = new Pool({
    connectionString: url,
    ssl: /railway|amazonaws|supabase|neon|render/i.test(url) ? { rejectUnauthorized: false } : undefined,
  })
  const client = await pool.connect()
  let dados
  try {
    await client.query('BEGIN TRANSACTION READ ONLY')
    dados = await coletar(client)
    await client.query('ROLLBACK')
  } finally {
    client.release()
    await pool.end()
  }
  console.log(comoJson ? JSON.stringify(dados, null, 2) : relatorio(dados))
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Falha na medicao:', err.message)
    process.exit(1)
  })
}

module.exports = { mascarar, tabela, resumirEquipe, verificar, relatorio, ACOES_DISTRIBUICAO }
