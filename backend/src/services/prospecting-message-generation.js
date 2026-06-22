'use strict'

const aiProviderDefault = require('../ai-provider')
const { nomeEmpresa, NOME_PADRAO } = require('../db/empresas')

const PROMPT_VERSION = 'prospeccao_fila_mensagem_v1_2026_05'
const STATUS_COM_MENSAGEM_GERAVEL = new Set(['simulado', 'agendado'])

function textoOuNull(valor, max = 4000) {
  const texto = String(valor == null ? '' : valor).trim()
  return texto ? texto.slice(0, max) : null
}

function normalizarId(valor) {
  return String(valor == null ? '' : valor).trim()
}

function extrairSinal(row = {}) {
  const rating = Number(row.rating || 0)
  const avaliacoes = Number(row.avaliacoes || 0)
  if (rating >= 4 && avaliacoes >= 20) return `boa reputacao no Google (${rating} com ${avaliacoes} avaliacoes)`
  if (rating >= 4) return `boa nota no Google (${rating})`
  if (avaliacoes >= 20) return `${avaliacoes} avaliacoes no Google`
  if (row.tem_site === false) return 'sem site proprio visivel'
  return 'perfil encontrado no Google Maps'
}

function montarMensagemFallback(row = {}, nomeEmp = NOME_PADRAO) {
  const nome = row.nome_lead || row.prospect_nome || 'sua empresa'
  const categoria = row.categoria || row.prospect_nicho || 'seu segmento'
  const cidade = row.cidade || row.prospect_cidade || 'sua cidade'
  const sinal = extrairSinal(row)
  return (
    `Opa, tudo bem? Sou da ${nomeEmp}. Vi ${nome} no Google Maps em ${cidade} e notei ${sinal}. ` +
    `A gente ajuda negocios de ${categoria} a ter uma presenca digital mais clara e receber contatos pelo WhatsApp. Posso te mandar uma analise rapida?`
  ).slice(0, 600)
}

function limparMensagemGerada(texto) {
  return textoOuNull(String(texto || '')
    .replace(/^```(?:text|txt)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .replace(/^["']|["']$/g, '')
    .replace(/\s+\n/g, '\n')
    .trim(), 600)
}

async function buscarItemFilaParaMensagem(pool, filaId) {
  const safeId = normalizarId(filaId)
  if (!safeId) {
    const err = new Error('fila_id obrigatorio.')
    err.statusCode = 400
    throw err
  }
  const { rows } = await pool.query(
    `
    SELECT
      f.*,
      p.nome AS prospect_nome,
      p.nicho AS prospect_nicho,
      p.cidade AS prospect_cidade,
      p.endereco,
      p.avaliacoes,
      p.rating,
      p.tem_site,
      p.site,
      p.maps_url,
      p.place_id,
      p.score,
      p.raw_json,
      p.empresa_id,
      e.data_execucao,
      e.modo AS modo_execucao
    FROM prospectador.prospeccao_fila_diaria f
    LEFT JOIN prospectador.prospects p ON p.id = f.prospect_id
    LEFT JOIN prospectador.prospeccao_execucoes_diarias e ON e.id = f.execucao_id
    WHERE f.id = $1::uuid
    LIMIT 1
    `,
    [safeId]
  )
  const row = rows[0]
  if (!row) {
    const err = new Error('Item da fila nao encontrado.')
    err.statusCode = 404
    throw err
  }
  return row
}

function validarItemGeravel(row) {
  if (!STATUS_COM_MENSAGEM_GERAVEL.has(row.status)) {
    const err = new Error('Mensagem so pode ser gerada para item simulado ou agendado.')
    err.statusCode = 409
    throw err
  }
  if (!row.slot_envio) {
    const err = new Error('Item precisa ter slot_envio antes de gerar mensagem.')
    err.statusCode = 409
    throw err
  }
}

async function gerarMensagemProspeccaoIA(row, deps = {}) {
  const aiProvider = deps.aiProvider || aiProviderDefault
  const nomeEmp = await nomeEmpresa(row.empresa_id)
  const fallback = montarMensagemFallback(row, nomeEmp)
  const categoria = row.categoria || row.prospect_nicho || 'negocio local'
  const cidade = row.cidade || row.prospect_cidade || 'cidade informada'
  const nome = row.nome_lead || row.prospect_nome || 'empresa'
  const temSite = row.tem_site === true ? 'sim' : row.tem_site === false ? 'nao' : 'nao informado'
  const sinal = extrairSinal(row)

  const systemPrompt =
    `Voce escreve mensagens frias de WhatsApp em nome da ${nomeEmp} para prospeccao local. ` +
    'Tom humano, curto, consultivo e respeitoso. Retorne APENAS o texto da mensagem, sem JSON e sem markdown.'

  const userPrompt =
    `Crie UMA mensagem inicial de WhatsApp para este lead ja selecionado e agendado na fila.\n\n` +
    `DADOS DO LEAD:\n` +
    `- empresa: ${nome}\n` +
    `- categoria/tag: ${categoria}\n` +
    `- cidade: ${cidade}\n` +
    `- tem site: ${temSite}\n` +
    `- sinal real: ${sinal}\n` +
    `- slot planejado de envio: ${row.slot_envio}\n\n` +
    `REGRAS:\n` +
    `1. Diga "Sou da ${nomeEmp}" na abertura.\n` +
    `2. Use os dados reais acima; nao invente numeros, promessas, descontos ou resultados.\n` +
    `3. Nao peca reuniao nesta primeira mensagem.\n` +
    `4. Termine pedindo permissao para mandar uma analise rapida.\n` +
    `5. Maximo 500 caracteres, texto corrido, sem bullets.`

  try {
    const result = await aiProvider.generateAIResponse(
      {
        systemPrompt,
        userPrompt,
        task: 'prospeccao_fila_mensagem',
        temperature: 0.4,
        maxTokens: 220,
        timeoutMs: 20000,
      },
      deps.pool || null,
      deps.logger || null
    )
    const mensagem = limparMensagemGerada(result.text)
    if (!mensagem || mensagem.length < 30) {
      if (deps.logger?.warn) {
        deps.logger.warn(
          { operation: 'prospeccao_mensagem_ia', etapa: 'resultado_curto', fila_id: row?.id || null, length: (mensagem || '').length },
          'IA retornou mensagem vazia/curta; usando fallback determinístico'
        )
      }
      return { mensagem: fallback, provider: 'fallback', model: null, prompt_version: PROMPT_VERSION, fallback: true }
    }
    return {
      mensagem,
      provider: result.provider || null,
      model: result.model || null,
      prompt_version: PROMPT_VERSION,
      fallback: result.fallback_used === true,
    }
  } catch (err) {
    // Antes engolia em silencio (`catch (_)`), o operador via fallback chegando
    // ao lead sem saber que a IA havia falhado. Agora loga sempre.
    if (deps.logger?.warn) {
      deps.logger.warn(
        { err: err?.message || String(err), operation: 'prospeccao_mensagem_ia', etapa: 'falha_provider', fila_id: row?.id || null },
        'IA falhou em gerar mensagem de prospecção; usando fallback determinístico'
      )
    }
    return { mensagem: fallback, provider: 'fallback', model: null, prompt_version: PROMPT_VERSION, fallback: true }
  }
}

async function salvarMensagemGerada(pool, row, geracao) {
  const { rows } = await pool.query(
    `
    UPDATE prospectador.prospeccao_fila_diaria
    SET mensagem_gerada = $2,
        mensagem_editada = NULL,
        metadata_json = COALESCE(metadata_json, '{}'::jsonb) || $3::jsonb,
        atualizado_em = NOW()
    WHERE id = $1::uuid
    RETURNING *
    `,
    [
      row.id,
      geracao.mensagem,
      JSON.stringify({
        mensagem_ia: {
          prompt_version: geracao.prompt_version,
          provider: geracao.provider,
          model: geracao.model,
          fallback: geracao.fallback === true,
          gerada_em: new Date().toISOString(),
        },
      }),
    ]
  )
  return rows[0] || null
}

async function registrarDecisaoMensagem(pool, row, geracao) {
  await pool.query(
    `
    INSERT INTO prospectador.prospeccao_decisoes_ia (
      execucao_id, fila_id, tipo, provider, model, prompt_version,
      input_json, output_json, aprovado
    )
    VALUES ($1::uuid, $2::uuid, 'mensagem', $3, $4, $5, $6::jsonb, $7::jsonb, NULL)
    `,
    [
      row.execucao_id,
      row.id,
      geracao.provider || null,
      geracao.model || null,
      geracao.prompt_version || PROMPT_VERSION,
      JSON.stringify({
        prospect_id: row.prospect_id || null,
        slot_envio: row.slot_envio || null,
        nome_lead: row.nome_lead || row.prospect_nome || null,
        categoria: row.categoria || row.prospect_nicho || null,
        cidade: row.cidade || row.prospect_cidade || null,
      }),
      JSON.stringify({
        mensagem_gerada: geracao.mensagem,
        fallback: geracao.fallback === true,
      }),
    ]
  )
}

async function gerarMensagemParaItemFila(pool, filaId, deps = {}) {
  const row = await buscarItemFilaParaMensagem(pool, filaId)
  validarItemGeravel(row)
  const geracao = await gerarMensagemProspeccaoIA(row, { ...deps, pool })
  const item = await salvarMensagemGerada(pool, row, geracao)
  await registrarDecisaoMensagem(pool, row, geracao)
  return {
    ok: true,
    item,
    mensagem_gerada: geracao.mensagem,
    mensagem_final: geracao.mensagem,
    provider: geracao.provider,
    model: geracao.model,
    prompt_version: geracao.prompt_version,
    fallback: geracao.fallback === true,
    envio_real_habilitado: false,
  }
}

async function editarMensagemItemFila(pool, filaId, payload = {}) {
  const safeId = normalizarId(filaId)
  const mensagem = textoOuNull(payload.mensagem_editada || payload.mensagem, 4000)
  if (!safeId || !mensagem) {
    const err = new Error('fila_id e mensagem_editada sao obrigatorios.')
    err.statusCode = 400
    throw err
  }
  const atual = await buscarItemFilaParaMensagem(pool, safeId)
  if (!STATUS_COM_MENSAGEM_GERAVEL.has(atual.status)) {
    const err = new Error('Mensagem so pode ser editada antes do envio.')
    err.statusCode = 409
    throw err
  }

  const { rows } = await pool.query(
    `
    UPDATE prospectador.prospeccao_fila_diaria
    SET mensagem_editada = $2,
        metadata_json = COALESCE(metadata_json, '{}'::jsonb) || $3::jsonb,
        atualizado_em = NOW()
    WHERE id = $1::uuid
    RETURNING *
    `,
    [
      safeId,
      mensagem,
      JSON.stringify({
        mensagem_editada_manual: {
          editada_em: new Date().toISOString(),
          tamanho: mensagem.length,
        },
      }),
    ]
  )
  const item = rows[0] || null
  return {
    ok: true,
    item,
    mensagem_editada: mensagem,
    mensagem_final: mensagem,
    envio_real_habilitado: false,
  }
}

module.exports = {
  PROMPT_VERSION,
  STATUS_COM_MENSAGEM_GERAVEL,
  montarMensagemFallback,
  limparMensagemGerada,
  buscarItemFilaParaMensagem,
  gerarMensagemProspeccaoIA,
  gerarMensagemParaItemFila,
  editarMensagemItemFila,
}
