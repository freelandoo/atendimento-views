'use strict'

// Acesso a app.meta_integracoes — a credencial da Meta DA EMPRESA.
//
// Duas regras que este módulo existe para garantir:
//   1. TODA consulta filtra por empresa_id. Não há função aqui que leia ou escreva
//      integração sem receber a empresa — nem por engano, nem "só para o admin".
//   2. O token cifrado NUNCA sai daqui em texto puro, exceto por
//      `obterCredencial`, que é o caminho do worker de envio. A função de leitura
//      da API (`obterParaApi`) devolve `token_hint` e mais nada.
//
// `pool` é sempre injetado (mesmo padrão de db/auditoria.js e db/aquisicao-curadoria.js),
// para o módulo poder ser testado sem abrir conexão.

const { encrypt, decrypt, exigirChaveDedicada, dicaDoToken } = require('../services/meta-crypto')
const { STATUS_INTEGRACAO } = require('../services/meta-conversao')

function erro(code, message, statusCode = 400) {
  const e = new Error(message)
  e.code = code
  e.statusCode = statusCode
  return e
}

function texto(valor, max = 200) {
  const s = String(valor == null ? '' : valor).trim()
  return s ? s.slice(0, max) : null
}

/**
 * Forma segura para a API/tela. Note o que NÃO está aqui: access_token_enc.
 * O token não é devolvido nem cifrado — devolver o ciphertext seria entregar o
 * segredo a quem tiver a chave, e a chave está no mesmo servidor.
 */
function paraApi(row) {
  if (!row) return null
  return {
    id: row.id,
    empresa_id: row.empresa_id,
    dataset_id: row.dataset_id,
    page_id: row.page_id || null,
    waba_id: row.waba_id || null,
    // Só os 4 últimos caracteres, para o dono reconhecer qual token está lá.
    token_hint: row.token_hint || null,
    test_event_code: row.test_event_code || null,
    status: row.status,
    eventos: {
      reuniao_agendada: row.evento_agendada === true,
      reuniao_realizada: row.evento_realizada === true,
      reuniao_realizada_com_venda: row.evento_venda === true,
    },
    ultimo_teste_em: row.ultimo_teste_em || null,
    ultimo_teste_ok: row.ultimo_teste_ok,
    ultimo_erro: row.ultimo_erro || null,
    criado_em: row.criado_em,
    atualizado_em: row.atualizado_em,
  }
}

/** Valida e normaliza o corpo do formulário. Não toca no banco. */
function validarConfiguracao(body = {}, { parcial = false } = {}) {
  const issues = []
  const out = {}

  if (!parcial || body.dataset_id !== undefined) {
    out.dataset_id = texto(body.dataset_id, 40)
    if (!out.dataset_id) issues.push('Informe o ID do conjunto de dados (Dataset/Pixel).')
    else if (!/^[0-9]{5,}$/.test(out.dataset_id)) {
      issues.push('O ID do conjunto de dados deve conter apenas números.')
    }
  }
  if (!parcial || body.page_id !== undefined) out.page_id = texto(body.page_id, 40)
  if (!parcial || body.waba_id !== undefined) out.waba_id = texto(body.waba_id, 40)
  if (!parcial || body.test_event_code !== undefined) out.test_event_code = texto(body.test_event_code, 40)

  if (!parcial || body.access_token !== undefined) {
    out.access_token = texto(body.access_token, 1000)
    if (!parcial && !out.access_token) issues.push('Informe o token de acesso da Meta.')
  }

  const eventos = body.eventos && typeof body.eventos === 'object' ? body.eventos : {}
  const flag = (v, atual) => (v === undefined ? atual : v === true)
  if (!parcial || body.eventos !== undefined) {
    out.evento_agendada = flag(eventos.reuniao_agendada, false)
    out.evento_realizada = flag(eventos.reuniao_realizada, false)
    out.evento_venda = flag(eventos.reuniao_realizada_com_venda, false)
  }

  return { ok: issues.length === 0, value: out, issues }
}

/**
 * Cria ou atualiza a configuração da empresa (upsert por empresa_id).
 *
 * Salvar SEMPRE devolve a integração para 'em_teste': mudou dataset, token ou
 * destino, a conexão anterior não prova mais nada. Ativar exige um teste novo.
 * `page_id`/`waba_id`: a Meta exige um dos dois no CTWA (subcode 2804116); a CHECK
 * do banco também recusa, mas recusar aqui dá mensagem em português ao operador.
 */
async function salvarIntegracao(pool, empresaId, dados = {}, { usuarioId = null } = {}) {
  if (!empresaId) throw erro('SEM_EMPRESA', 'Empresa não informada.', 400)
  const { ok, value, issues } = validarConfiguracao(dados, { parcial: false })
  if (!ok) throw erro('VALIDATION', issues.join(' '), 400)
  if (!value.page_id && !value.waba_id) {
    throw erro('VALIDATION', 'Informe o ID da Página do Facebook ou o ID da conta WhatsApp Business.', 400)
  }
  // Recusa guardar credencial de terceiro em produção sem chave dedicada.
  exigirChaveDedicada()

  const { rows } = await pool.query(
    `INSERT INTO app.meta_integracoes
       (empresa_id, dataset_id, page_id, waba_id, access_token_enc, token_hint,
        test_event_code, status, evento_agendada, evento_realizada, evento_venda, criado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'em_teste',$8,$9,$10,$11)
     ON CONFLICT (empresa_id) DO UPDATE SET
       dataset_id       = EXCLUDED.dataset_id,
       page_id          = EXCLUDED.page_id,
       waba_id          = EXCLUDED.waba_id,
       access_token_enc = EXCLUDED.access_token_enc,
       token_hint       = EXCLUDED.token_hint,
       test_event_code  = EXCLUDED.test_event_code,
       status           = 'em_teste',
       evento_agendada  = EXCLUDED.evento_agendada,
       evento_realizada = EXCLUDED.evento_realizada,
       evento_venda     = EXCLUDED.evento_venda,
       ultimo_teste_em  = NULL,
       ultimo_teste_ok  = NULL,
       ultimo_erro      = NULL,
       atualizado_em    = NOW()
     RETURNING *`,
    [
      empresaId, value.dataset_id, value.page_id, value.waba_id,
      encrypt(value.access_token), dicaDoToken(value.access_token),
      value.test_event_code,
      value.evento_agendada, value.evento_realizada, value.evento_venda,
      usuarioId,
    ]
  )
  return paraApi(rows[0])
}

/**
 * Atualiza SÓ os eventos habilitados (sem exigir reenviar o token).
 * Não mexe no status: ligar um evento não reativa uma integração que precisa de atenção.
 */
async function atualizarEventos(pool, empresaId, eventos = {}) {
  if (!empresaId) throw erro('SEM_EMPRESA', 'Empresa não informada.', 400)
  const { rows } = await pool.query(
    `UPDATE app.meta_integracoes
        SET evento_agendada  = COALESCE($2, evento_agendada),
            evento_realizada = COALESCE($3, evento_realizada),
            evento_venda     = COALESCE($4, evento_venda),
            atualizado_em    = NOW()
      WHERE empresa_id = $1
      RETURNING *`,
    [
      empresaId,
      eventos.reuniao_agendada === undefined ? null : eventos.reuniao_agendada === true,
      eventos.reuniao_realizada === undefined ? null : eventos.reuniao_realizada === true,
      eventos.reuniao_realizada_com_venda === undefined ? null : eventos.reuniao_realizada_com_venda === true,
    ]
  )
  if (!rows[0]) throw erro('NOT_FOUND', 'Integração da Meta não configurada para esta empresa.', 404)
  return paraApi(rows[0])
}

/** Leitura para a API/tela. Nunca inclui o token. Retorna null se não configurada. */
async function obterParaApi(pool, empresaId) {
  if (!empresaId) throw erro('SEM_EMPRESA', 'Empresa não informada.', 400)
  const { rows } = await pool.query(
    `SELECT * FROM app.meta_integracoes WHERE empresa_id = $1 LIMIT 1`,
    [empresaId]
  )
  return paraApi(rows[0] || null)
}

/**
 * Credencial DECIFRADA. Caminho exclusivo do worker de envio e do teste de conexão.
 *
 * Recebe `empresaId` e filtra por ele: é este filtro que garante o critério de aceite
 * "cada evento usa Dataset/Pixel e token da empresa correta". Não existe variante
 * desta função que busque por dataset, por telefone ou "a integração ativa".
 */
async function obterCredencial(pool, empresaId) {
  if (!empresaId) throw erro('SEM_EMPRESA', 'Empresa não informada.', 400)
  const { rows } = await pool.query(
    `SELECT * FROM app.meta_integracoes WHERE empresa_id = $1 LIMIT 1`,
    [empresaId]
  )
  const row = rows[0]
  if (!row) return null
  return {
    empresaId: row.empresa_id,
    datasetId: row.dataset_id,
    pageId: row.page_id || null,
    wabaId: row.waba_id || null,
    token: decrypt(row.access_token_enc),
    testEventCode: row.test_event_code || null,
    status: row.status,
    evento_agendada: row.evento_agendada === true,
    evento_realizada: row.evento_realizada === true,
    evento_venda: row.evento_venda === true,
  }
}

/** Registra o resultado do "Testar conexão" (mensagem já sanitizada pelo chamador). */
async function registrarTeste(pool, empresaId, { ok, mensagemErro = null } = {}) {
  const { rows } = await pool.query(
    `UPDATE app.meta_integracoes
        SET ultimo_teste_em = NOW(),
            ultimo_teste_ok = $2,
            ultimo_erro     = $3,
            -- Teste falho em integração ATIVA a joga para "precisa de atenção":
            -- ela já estava mandando evento e passou a não conseguir.
            status = CASE
                       WHEN $2 = false AND status = 'ativa' THEN 'precisa_atencao'
                       ELSE status
                     END,
            atualizado_em = NOW()
      WHERE empresa_id = $1
      RETURNING *`,
    [empresaId, ok === true, mensagemErro ? String(mensagemErro).slice(0, 500) : null]
  )
  if (!rows[0]) throw erro('NOT_FOUND', 'Integração da Meta não configurada para esta empresa.', 404)
  return paraApi(rows[0])
}

/**
 * Troca o status. Ativar exige teste bem-sucedido — regra de negócio, não de tela:
 * uma integração ativada sem teste manda evento para lugar nenhum e ninguém percebe.
 */
async function definirStatus(pool, empresaId, status) {
  if (!STATUS_INTEGRACAO.includes(status)) {
    throw erro('VALIDATION', 'Status inválido.', 400)
  }
  if (status === 'ativa') {
    const { rows } = await pool.query(
      `SELECT ultimo_teste_ok FROM app.meta_integracoes WHERE empresa_id = $1 LIMIT 1`,
      [empresaId]
    )
    if (!rows[0]) throw erro('NOT_FOUND', 'Integração da Meta não configurada para esta empresa.', 404)
    if (rows[0].ultimo_teste_ok !== true) {
      throw erro('TESTE_PENDENTE', 'Teste a conexão com a Meta antes de ativar a integração.', 409)
    }
  }
  const { rows } = await pool.query(
    `UPDATE app.meta_integracoes
        SET status = $2,
            -- Ativar limpa o erro anterior: ele já não descreve o estado atual.
            ultimo_erro = CASE WHEN $2 = 'ativa' THEN NULL ELSE ultimo_erro END,
            atualizado_em = NOW()
      WHERE empresa_id = $1
      RETURNING *`,
    [empresaId, status]
  )
  if (!rows[0]) throw erro('NOT_FOUND', 'Integração da Meta não configurada para esta empresa.', 404)
  return paraApi(rows[0])
}

/**
 * Marca a integração como "precisa de atenção" a partir de uma falha de ENVIO
 * (não de teste). Chamado pelo worker quando o erro é de credencial/configuração.
 */
async function marcarAtencao(pool, empresaId, mensagemErro) {
  await pool.query(
    `UPDATE app.meta_integracoes
        SET status = CASE WHEN status = 'desativada' THEN status ELSE 'precisa_atencao' END,
            ultimo_erro = $2,
            atualizado_em = NOW()
      WHERE empresa_id = $1`,
    [empresaId, mensagemErro ? String(mensagemErro).slice(0, 500) : null]
  )
}

/** Empresas com integração ATIVA — universo do worker. Só ids e flags, sem segredo. */
async function listarAtivas(pool) {
  const { rows } = await pool.query(
    `SELECT empresa_id, evento_agendada, evento_realizada, evento_venda
       FROM app.meta_integracoes
      WHERE status = 'ativa'
      ORDER BY atualizado_em ASC`
  )
  return rows.map((r) => ({
    empresaId: r.empresa_id,
    evento_agendada: r.evento_agendada === true,
    evento_realizada: r.evento_realizada === true,
    evento_venda: r.evento_venda === true,
  }))
}

/** Remove a configuração. O ledger (histórico de envio) é preservado de propósito. */
async function removerIntegracao(pool, empresaId) {
  const { rowCount } = await pool.query(
    `DELETE FROM app.meta_integracoes WHERE empresa_id = $1`,
    [empresaId]
  )
  if (!rowCount) throw erro('NOT_FOUND', 'Integração da Meta não configurada para esta empresa.', 404)
  return { removido: true }
}

module.exports = {
  paraApi,
  validarConfiguracao,
  salvarIntegracao,
  atualizarEventos,
  obterParaApi,
  obterCredencial,
  registrarTeste,
  definirStatus,
  marcarAtencao,
  listarAtivas,
  removerIntegracao,
}
