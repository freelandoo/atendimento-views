// @ts-check
'use strict'
// Painel comercial — LEITURA agregada (Fase 1). Ver docs/propostas/2026-09-29-*.md.
//
// Reusa a view app.vw_ligacoes_analiticas (mig. 051, feita p/ este painel: "o futuro Painel de
// Gestão Comercial lê SÓ daqui"). Cada fonte é agrupada por (dia, canal) numa consulta; o serviço
// puro (services/painel-comercial.js) deriva série e por-canal das MESMAS linhas.
//
// Dimensões (nicho/cidade/canal) vêm de prospectador.prospects por prospect_id. Evento sem
// prospect vinculado NÃO é atribuível a canal — cai em 'desconhecido' e, se houver filtro de
// dimensão, é corretamente excluído (o LEFT JOIN + WHERE p.x vira INNER).

const { sqlTelefoneNormalizado: TELN } = require('../telefone-br')

const TZ = 'America/Sao_Paulo'

/** Condições de dimensão do lead no alias `p`. Empurra params e devolve o trecho SQL. */
function condLead(p, filtros, params) {
  let sql = ''
  if (filtros.nichoId) { params.push(filtros.nichoId); sql += ` AND ${p}.nicho_id = $${params.length}` }
  if (filtros.cidade) { params.push(filtros.cidade); sql += ` AND ${p}.cidade ILIKE $${params.length}` }
  if (filtros.canal) { params.push(filtros.canal); sql += ` AND ${p}.origem = $${params.length}` }
  if (filtros.pais) { params.push(filtros.pais); sql += ` AND ${p}.pais = $${params.length}` }
  return sql
}

// true quando nenhum filtro de dimensão impede atribuir a reunião do bot (que não tem prospect
// vinculado, logo não tem nicho/cidade/canal/PAÍS, nem pessoa). País entra aqui de propósito: com
// o padrão BR, a reunião do bot — cujo país não dá para provar — fica de fora, e a tela avisa.
function botAtribuivel(filtros) {
  return !filtros.nichoId && !filtros.cidade && !filtros.canal && !filtros.pais && !filtros.pessoa
}

async function serieMensagens(pool, filtros) {
  const params = [filtros.empresaId, filtros.de, filtros.ate]
  let pessoa = ''
  if (filtros.pessoa) { params.push(filtros.pessoa); pessoa = ` AND d.usuario_id = $${params.length}` }
  const lead = condLead('p', filtros, params)
  const { rows } = await pool.query(
    `SELECT date_trunc('day', d.criado_em AT TIME ZONE '${TZ}')::date AS dia,
            COALESCE(p.origem, 'desconhecido') AS canal, COUNT(*)::int AS n
       FROM prospectador.lead_disparos d
       JOIN prospectador.prospects p ON p.id = d.prospect_id
      WHERE d.empresa_id = $1 AND d.status = 'enviado'
        AND d.criado_em >= $2 AND d.criado_em < $3${pessoa}${lead}
      GROUP BY 1, 2`,
    params
  )
  return rows
}

async function serieLigacoes(pool, filtros) {
  const params = [filtros.empresaId, filtros.de, filtros.ate]
  let pessoa = ''
  if (filtros.pessoa) { params.push(filtros.pessoa); pessoa = ` AND l.usuario_id = $${params.length}` }
  const lead = condLead('p', filtros, params)
  const { rows } = await pool.query(
    `SELECT date_trunc('day', l.encerrada_em AT TIME ZONE '${TZ}')::date AS dia,
            COALESCE(p.origem, 'desconhecido') AS canal,
            COUNT(*)::int AS n,
            COUNT(*) FILTER (WHERE l.resultado = 'atendeu')::int AS atendidas
       FROM app.vw_ligacoes_analiticas l
       LEFT JOIN prospectador.prospects p ON p.id = l.prospect_id
      WHERE l.empresa_id = $1 AND l.encerrada_em >= $2 AND l.encerrada_em < $3${pessoa}${lead}
      GROUP BY 1, 2`,
    params
  )
  return rows
}

async function serieReunioesHumano(pool, filtros) {
  const params = [filtros.empresaId, filtros.de, filtros.ate]
  let pessoa = ''
  if (filtros.pessoa) { params.push(filtros.pessoa); pessoa = ` AND a.responsavel_id = $${params.length}` }
  const lead = condLead('p', filtros, params)
  const { rows } = await pool.query(
    `SELECT date_trunc('day', a.data_inicio AT TIME ZONE '${TZ}')::date AS dia,
            COALESCE(p.origem, 'desconhecido') AS canal, COUNT(*)::int AS n
       FROM app.agenda_eventos a
       LEFT JOIN prospectador.prospects p ON p.id = a.prospect_id
      WHERE a.empresa_id = $1 AND a.tipo = 'reuniao' AND a.excluido_em IS NULL
        AND a.status <> 'cancelado'
        AND a.data_inicio >= $2 AND a.data_inicio < $3${pessoa}${lead}
      GROUP BY 1, 2`,
    params
  )
  return rows
}

// "Conversou": conversas cuja PRIMEIRA resposta do lead (migration 109) caiu no período. Dimensões
// (nicho/cidade/canal) vêm de prospects por telefone normalizado — mesmo normalizador de banco-leads
// e follow-ups (nunca uma 2ª régua). Pessoa = responsavel_id da conversa (migration 074).
// ponytail: o join por telefone normalizado não é indexado → hashjoin conversas×prospects; ok no
// volume do painel. Se pesar, materializar telefone_digitos na conversa.
async function serieConversou(pool, filtros) {
  const params = [filtros.empresaId, filtros.de, filtros.ate]
  let pessoa = ''
  if (filtros.pessoa) { params.push(filtros.pessoa); pessoa = ` AND c.responsavel_id = $${params.length}` }
  const lead = condLead('p', filtros, params)
  const { rows } = await pool.query(
    `SELECT date_trunc('day', c.primeira_resposta_em AT TIME ZONE '${TZ}')::date AS dia,
            COALESCE(p.origem, 'desconhecido') AS canal, COUNT(*)::int AS n
       FROM vendas.conversas c
       LEFT JOIN prospectador.prospects p
         ON ${TELN('p.telefone')} = ${TELN('c.numero')} AND p.empresa_id = c.empresa_id
      WHERE c.empresa_id = $1 AND c.primeira_resposta_em >= $2 AND c.primeira_resposta_em < $3${pessoa}${lead}
      GROUP BY 1, 2`,
    params
  )
  return rows
}

// Funil "onde os leads param": SNAPSHOT (não por período) dos atendimentos ATIVOS por estágio.
// "Onde estão parados agora" = onde o estágio deles ficou. Respeita os mesmos filtros de dimensão
// (nicho/cidade/canal/país por prospect) e pessoa (responsavel_id da conversa). Sem data: é foto do
// momento, não fluxo — misturar período aqui confundiria "estão parados" com "entraram no período".
async function porEstagio(pool, filtros) {
  const params = [filtros.empresaId]
  let pessoa = ''
  if (filtros.pessoa) { params.push(filtros.pessoa); pessoa = ` AND c.responsavel_id = $${params.length}` }
  const lead = condLead('p', filtros, params)
  const { rows } = await pool.query(
    `SELECT COALESCE(NULLIF(BTRIM(c.estagio), ''), 'primeiro_contato') AS estagio, COUNT(*)::int AS n
       FROM vendas.conversas c
       LEFT JOIN prospectador.prospects p
         ON ${TELN('p.telefone')} = ${TELN('c.numero')} AND p.empresa_id = c.empresa_id
      WHERE c.empresa_id = $1 AND c.status = 'ativo'${pessoa}${lead}
      GROUP BY 1`,
    params
  )
  return rows
}

// Reunião do bot: dado SEPARADO (decisão do operador). Empresa resolvida por
// vendas.conversas.empresa_id = metadata->>'lead_numero' (a mesma ligação de meta-dispatch).
// Sem canal/pessoa/prospect — por isso só entra quando não há filtro que exija atribuição.
async function serieReunioesBot(pool, filtros) {
  const { rows } = await pool.query(
    `SELECT date_trunc('day', a.data_inicio AT TIME ZONE '${TZ}')::date AS dia, COUNT(*)::int AS n
       FROM vendas.agenda_eventos a
       JOIN vendas.conversas c ON c.numero = a.metadata->>'lead_numero'
      WHERE c.empresa_id = $1 AND a.tipo = 'reuniao'
        AND a.data_inicio >= $2 AND a.data_inicio < $3
      GROUP BY 1`,
    [filtros.empresaId, filtros.de, filtros.ate]
  )
  return rows
}

/** Roda as fontes em paralelo. reunioesBot só quando atribuível (senão fica []). */
async function coletar(pool, filtros) {
  const usaBot = botAtribuivel(filtros)
  const [mensagens, ligacoes, reunioesHumano, conversou, reunioesBot] = await Promise.all([
    serieMensagens(pool, filtros),
    serieLigacoes(pool, filtros),
    serieReunioesHumano(pool, filtros),
    serieConversou(pool, filtros),
    usaBot ? serieReunioesBot(pool, filtros) : Promise.resolve([]),
  ])
  return { mensagens, ligacoes, reunioesHumano, conversou, reunioesBot, bot_atribuivel: usaBot }
}

// Cidades distintas dos leads da empresa — alimenta o SELETOR de cidade do painel (o operador
// pediu seleção, não texto livre). prospects tem `cidade` (NOT NULL) mas NÃO tem UF/estado, então
// estado não é filtrável por aqui — é atributo da coleta (rotina), não do lead.
async function cidadesDaEmpresa(pool, empresaId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT BTRIM(cidade) AS cidade
       FROM prospectador.prospects
      WHERE empresa_id = $1 AND cidade IS NOT NULL AND BTRIM(cidade) <> ''
      ORDER BY 1
      LIMIT 500`,
    [empresaId]
  )
  return rows.map((r) => r.cidade)
}

module.exports = { coletar, porEstagio, cidadesDaEmpresa, botAtribuivel }
