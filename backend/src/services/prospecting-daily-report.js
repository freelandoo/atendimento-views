'use strict'

const { normalizarData } = require('./prospecting-daily-queue')

// Empresa padrão (PJ Codeworks) — usada quando o chamador não informa empresaId, mantendo
// o comportamento single-tenant das rotas legadas do dashboard (/dashboard/prospeccao/*).
const PJ_EMPRESA_ID = '00000000-0000-0000-0000-000000000001'

function numeroEnvioWhatsapp(numero) {
  const raw = String(numero || '').trim()
  if (!raw) return ''
  if (/@g\.us$/i.test(raw) || /@broadcast$/i.test(raw)) return ''
  if (/@/.test(raw) && !/@s\.whatsapp\.net$/i.test(raw)) return ''
  return raw.replace(/@s\.whatsapp\.net$/i, '').replace(/\D/g, '')
}

function operadoresDoPayloadOuEnv(payload = {}) {
  const lista = Array.isArray(payload.operadores) ? payload.operadores : []
  const normalizados = lista
    .map((op) => {
      if (typeof op === 'string') return { numero: numeroEnvioWhatsapp(op), nome: null }
      return { numero: numeroEnvioWhatsapp(op?.numero || op?.phone || op?.jid), nome: op?.nome || op?.name || null }
    })
    .filter((op) => op.numero)
  if (normalizados.length) return normalizados

  const raw = String(process.env.OPERATOR_WHATSAPP || process.env.VICTOR_WHATSAPP || '').trim()
  if (!raw) return []
  const seen = new Set()
  return raw
    .split(',')
    .map((parte) => {
      const [numero, ...nomePartes] = parte.split(':')
      return { numero: numeroEnvioWhatsapp(numero), nome: nomePartes.join(':').trim() || null }
    })
    .filter((op) => {
      if (!op.numero || seen.has(op.numero)) return false
      seen.add(op.numero)
      return true
    })
}

function taxaResposta(respostas, enviados) {
  const e = Number(enviados || 0)
  if (!e) return 0
  return Number((Number(respostas || 0) / e).toFixed(4))
}

function primeiroRanking(rows = [], campo = 'total_respostas') {
  const ordenados = rows
    .filter((r) => r && (r.categoria || r.cidade || r.estado || r.chave))
    .sort((a, b) => Number(b[campo] || 0) - Number(a[campo] || 0) || Number(b.total_enviados || 0) - Number(a.total_enviados || 0))
  return ordenados[0] || null
}

function montarAprendizados({ resumo, categorias, cidades }) {
  const enviados = Number(resumo.total_enviados || 0)
  const falhas = Number(resumo.total_falhas || 0)
  const respostas = Number(resumo.total_respostas || 0)
  const aprendizados = []
  const melhorCategoria = primeiroRanking(categorias)
  const melhorCidade = primeiroRanking(cidades)

  if (!enviados) {
    aprendizados.push('Ainda nao houve envio concluido no dia; validar fila, slots e mensagens antes de avaliar performance.')
  } else if (respostas > 0) {
    aprendizados.push(`Taxa de resposta de ${Math.round(taxaResposta(respostas, enviados) * 100)}% sobre mensagens enviadas.`)
  } else {
    aprendizados.push('Houve envios, mas nenhuma resposta registrada ainda; acompanhar janela de retorno antes de trocar a estrategia.')
  }

  if (melhorCategoria?.categoria) aprendizados.push(`Categoria com melhor sinal: ${melhorCategoria.categoria}.`)
  if (melhorCidade?.cidade) aprendizados.push(`Cidade com melhor sinal: ${melhorCidade.cidade}${melhorCidade.estado ? `/${melhorCidade.estado}` : ''}.`)
  if (falhas > 0) aprendizados.push(`${falhas} falha(s) de envio exigem revisao de telefone, instancia ou payload.`)

  return aprendizados
}

function sugerirProximoDia({ resumo, categorias, cidades }) {
  const enviados = Number(resumo.total_enviados || 0)
  const respostas = Number(resumo.total_respostas || 0)
  const melhorCategoria = primeiroRanking(categorias)
  const melhorCidade = primeiroRanking(cidades)

  if (!enviados) return 'Priorizar validacao da fila e gerar mensagens para os itens com slot antes de ativar novos envios.'
  if (respostas > 0 && melhorCategoria?.categoria) {
    const local = melhorCidade?.cidade ? ` em ${melhorCidade.cidade}${melhorCidade.estado ? `/${melhorCidade.estado}` : ''}` : ''
    return `Repetir ou ampliar ${melhorCategoria.categoria}${local}, mantendo a mesma janela de envio e comparando taxa de resposta.`
  }
  return 'Testar nova variacao de categoria/cidade e revisar a primeira mensagem antes de aumentar volume.'
}

function formatarRelatorioDiarioWhatsapp(relatorio = {}) {
  const r = relatorio.resumo || {}
  const funil = relatorio.funil || {}
  const local = [relatorio.cidade, relatorio.estado, relatorio.regiao].filter(Boolean).join(' / ') || '-'
  const linhas = [
    `Relatorio diario de prospeccao - ${relatorio.data_referencia || '-'}`,
    '',
    `Modo: ${relatorio.modo || '-'}`,
    `Categoria: ${relatorio.categoria || '-'}`,
    `Local: ${local}`,
    '',
    `Enviadas: ${r.total_enviados || 0}`,
    `Falhas: ${r.total_falhas || 0}`,
    `Respostas: ${r.total_respostas || 0}`,
    `Taxa de resposta: ${Math.round(Number(r.taxa_resposta || 0) * 100)}%`,
    '',
    `Diagnostico: ${funil.diagnostico || 0}`,
    `Proposta: ${funil.proposta || 0}`,
    `Reunioes: ${funil.reunioes || 0}`,
    `Fechados: ${funil.fechados || 0}`,
    '',
    'Aprendizados:',
    ...(relatorio.aprendizados || []).map((a) => `- ${a}`),
    '',
    `Sugestao para o proximo dia: ${relatorio.sugestao_proximo_dia || '-'}`,
  ]
  return linhas.join('\n').trim()
}

async function buscarExecucaoDoDia(pool, dataReferencia, empresaId) {
  const { rows } = await pool.query(
    `
    SELECT *
    FROM prospectador.prospeccao_execucoes_diarias
    WHERE data_execucao = $1::date AND empresa_id = $2::uuid
    ORDER BY criado_em DESC
    LIMIT 1
    `,
    [dataReferencia, empresaId]
  )
  return rows[0] || null
}

async function coletarResumoFila(pool, dataReferencia, execucao, empresaId) {
  const params = execucao ? [execucao.id] : [dataReferencia, empresaId]
  const where = execucao
    ? `f.execucao_id = $1::uuid`
    : `COALESCE(f.slot_envio::date, f.criado_em::date) = $1::date AND f.empresa_id = $2::uuid`

  const [resumo, categorias, cidades, funil] = await Promise.all([
    pool.query(
      `
      SELECT
        COUNT(*)::int AS total_fila,
        COUNT(*) FILTER (WHERE f.status IN ('enviado', 'respondido'))::int AS total_enviados,
        COUNT(*) FILTER (WHERE f.status = 'falhou')::int AS total_falhas,
        COUNT(*) FILTER (WHERE f.status = 'respondido')::int AS total_respostas,
        COUNT(*) FILTER (WHERE f.status IN ('simulado', 'agendado'))::int AS total_agendados
      FROM prospectador.prospeccao_fila_diaria f
      WHERE ${where}
      `,
      params
    ),
    pool.query(
      `
      SELECT COALESCE(f.categoria, p.nicho, 'sem_categoria') AS categoria,
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE f.status IN ('enviado', 'respondido'))::int AS total_enviados,
             COUNT(*) FILTER (WHERE f.status = 'respondido')::int AS total_respostas
      FROM prospectador.prospeccao_fila_diaria f
      LEFT JOIN prospectador.prospects p ON p.id = f.prospect_id
      WHERE ${where}
      GROUP BY COALESCE(f.categoria, p.nicho, 'sem_categoria')
      ORDER BY total_respostas DESC, total_enviados DESC, total DESC
      LIMIT 8
      `,
      params
    ),
    pool.query(
      `
      SELECT COALESCE(f.cidade, p.cidade, 'sem_cidade') AS cidade,
             COALESCE(f.estado, '') AS estado,
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE f.status IN ('enviado', 'respondido'))::int AS total_enviados,
             COUNT(*) FILTER (WHERE f.status = 'respondido')::int AS total_respostas
      FROM prospectador.prospeccao_fila_diaria f
      LEFT JOIN prospectador.prospects p ON p.id = f.prospect_id
      WHERE ${where}
      GROUP BY COALESCE(f.cidade, p.cidade, 'sem_cidade'), COALESCE(f.estado, '')
      ORDER BY total_respostas DESC, total_enviados DESC, total DESC
      LIMIT 8
      `,
      params
    ),
    pool.query(
      `
      WITH telefones AS (
        SELECT DISTINCT f.telefone_normalizado
        FROM prospectador.prospeccao_fila_diaria f
        WHERE ${where}
          AND f.telefone_normalizado IS NOT NULL
      )
      SELECT
        COUNT(*) FILTER (WHERE c.estagio IN ('diagnostico', 'qualificacao'))::int AS diagnostico,
        COUNT(*) FILTER (WHERE c.estagio IN ('proposta', 'proposta_enviada', 'negociacao'))::int AS proposta,
        COUNT(*) FILTER (WHERE c.estagio IN ('handoff', 'reuniao_agendada', 'proposta_enviada', 'negociacao'))::int AS reunioes,
        COUNT(*) FILTER (WHERE c.venda_fechada = true)::int AS fechados
      FROM vendas.conversas c
      JOIN telefones t
        ON regexp_replace(c.numero, '\\D', '', 'g') = t.telefone_normalizado
        OR regexp_replace(c.numero, '\\D', '', 'g') LIKE '%' || RIGHT(t.telefone_normalizado, 11)
      `,
      params
    ),
  ])

  const row = resumo.rows[0] || {}
  const totalEnviados = Number(row.total_enviados || 0)
  const totalRespostas = Number(row.total_respostas || 0)
  return {
    resumo: {
      total_fila: Number(row.total_fila || 0),
      total_enviados: totalEnviados,
      total_falhas: Number(row.total_falhas || 0),
      total_respostas: totalRespostas,
      total_agendados: Number(row.total_agendados || 0),
      taxa_resposta: taxaResposta(totalRespostas, totalEnviados),
    },
    categorias: categorias.rows,
    cidades: cidades.rows,
    funil: funil.rows[0] || { diagnostico: 0, proposta: 0, reunioes: 0, fechados: 0 },
  }
}

async function salvarRelatorio(pool, relatorio) {
  const { rows } = await pool.query(
    `
    INSERT INTO prospectador.prospeccao_relatorios_diarios (
      data_referencia, empresa_id, execucao_id, status, relatorio_json, texto_relatorio, metadata_json
    )
    VALUES ($1::date, $2::uuid, $3::uuid, 'gerado', $4::jsonb, $5, $6::jsonb)
    ON CONFLICT (data_referencia, empresa_id) DO UPDATE
    SET execucao_id = EXCLUDED.execucao_id,
        status = 'gerado',
        relatorio_json = EXCLUDED.relatorio_json,
        texto_relatorio = EXCLUDED.texto_relatorio,
        metadata_json = EXCLUDED.metadata_json,
        atualizado_em = NOW()
    RETURNING *
    `,
    [
      relatorio.data_referencia,
      relatorio.empresa_id,
      relatorio.execucao_id || null,
      JSON.stringify(relatorio),
      relatorio.texto_relatorio,
      JSON.stringify({ gerado_por: 'prospecting_daily_report' }),
    ]
  )
  return rows[0] || null
}

async function obterRelatorioDiarioProspeccao(pool, input = {}) {
  const dataReferencia = normalizarData(input.data || input.data_referencia || new Date())
  const empresaId = input.empresaId || input.empresa_id || PJ_EMPRESA_ID
  const { rows } = await pool.query(
    `
    SELECT *
    FROM prospectador.prospeccao_relatorios_diarios
    WHERE data_referencia = $1::date AND empresa_id = $2::uuid
    LIMIT 1
    `,
    [dataReferencia, empresaId]
  )
  if (!rows[0]) return { ok: true, data_referencia: dataReferencia, relatorio: null }
  return { ok: true, data_referencia: dataReferencia, relatorio: rows[0] }
}

async function gerarRelatorioDiarioProspeccao(pool, input = {}) {
  const dataReferencia = normalizarData(input.data || input.data_referencia || new Date())
  const empresaId = input.empresaId || input.empresa_id || PJ_EMPRESA_ID
  const execucao = await buscarExecucaoDoDia(pool, dataReferencia, empresaId)
  const dados = await coletarResumoFila(pool, dataReferencia, execucao, empresaId)
  const snapshot = execucao?.config_snapshot || {}
  const categoriaTop = primeiroRanking(dados.categorias, 'total')?.categoria
  const cidadeTop = primeiroRanking(dados.cidades, 'total') || {}
  const relatorio = {
    data_referencia: dataReferencia,
    empresa_id: empresaId,
    execucao_id: execucao?.id || null,
    modo: execucao?.modo || snapshot.modo || null,
    categoria: snapshot.categoria_padrao || snapshot.categoria || categoriaTop || null,
    cidade: snapshot.cidade_padrao || cidadeTop.cidade || null,
    estado: snapshot.estado_padrao || cidadeTop.estado || null,
    regiao: snapshot.regiao_padrao || null,
    resumo: dados.resumo,
    funil: {
      diagnostico: Number(dados.funil.diagnostico || 0),
      proposta: Number(dados.funil.proposta || 0),
      reunioes: Number(dados.funil.reunioes || 0),
      fechados: Number(dados.funil.fechados || 0),
    },
    ranking_categorias: dados.categorias,
    ranking_cidades: dados.cidades,
  }
  relatorio.aprendizados = montarAprendizados({ resumo: relatorio.resumo, categorias: dados.categorias, cidades: dados.cidades })
  relatorio.sugestao_proximo_dia = sugerirProximoDia({ resumo: relatorio.resumo, categorias: dados.categorias, cidades: dados.cidades })
  relatorio.texto_relatorio = formatarRelatorioDiarioWhatsapp(relatorio)

  const row = await salvarRelatorio(pool, relatorio)
  return { ok: true, data_referencia: dataReferencia, relatorio: row, relatorio_json: relatorio, texto_relatorio: relatorio.texto_relatorio }
}

async function enviarRelatorioDiarioOperadores(pool, input = {}, deps = {}) {
  const enviarMensagemFn = deps.enviarMensagemFn
  if (typeof enviarMensagemFn !== 'function') throw new Error('enviarMensagemFn e obrigatorio.')

  const empresaId = input.empresaId || input.empresa_id || PJ_EMPRESA_ID
  const gerado = input.relatorio_json && input.texto_relatorio
    ? { relatorio_json: input.relatorio_json, texto_relatorio: input.texto_relatorio, data_referencia: input.relatorio_json.data_referencia }
    : await gerarRelatorioDiarioProspeccao(pool, input)
  const texto = gerado.texto_relatorio || gerado.relatorio_json?.texto_relatorio
  const dataReferencia = normalizarData(input.data || input.data_referencia || gerado.data_referencia || new Date())
  const operadores = operadoresDoPayloadOuEnv(input)

  if (!operadores.length) {
    return { ok: true, enviado: false, motivo: 'sem_operadores_configurados', operadores: [], texto_relatorio: texto }
  }

  const resultados = []
  for (const op of operadores) {
    try {
      await enviarMensagemFn(op.numero, texto)
      resultados.push({ numero: op.numero, ok: true })
    } catch (err) {
      resultados.push({ numero: op.numero, ok: false, erro: String(err.message || err).slice(0, 240) })
    }
  }

  const enviados = resultados.filter((r) => r.ok).length
  await pool.query(
    `
    UPDATE prospectador.prospeccao_relatorios_diarios
    SET status = $3,
        enviado_operadores_em = CASE WHEN $3 = 'enviado' THEN NOW() ELSE enviado_operadores_em END,
        metadata_json = COALESCE(metadata_json, '{}'::jsonb) || jsonb_build_object('envio_operadores', $4::jsonb),
        atualizado_em = NOW()
    WHERE data_referencia = $1::date AND empresa_id = $2::uuid
    `,
    [dataReferencia, empresaId, enviados > 0 ? 'enviado' : 'falhou_envio', JSON.stringify(resultados)]
  )

  return { ok: true, enviado: enviados > 0, total_operadores: operadores.length, enviados, resultados, texto_relatorio: texto }
}

module.exports = {
  operadoresDoPayloadOuEnv,
  formatarRelatorioDiarioWhatsapp,
  gerarRelatorioDiarioProspeccao,
  obterRelatorioDiarioProspeccao,
  enviarRelatorioDiarioOperadores,
}
