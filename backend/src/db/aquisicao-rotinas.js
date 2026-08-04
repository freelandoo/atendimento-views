'use strict'
// Acesso a dados das ROTINAS de Aquisição (prospectador.aquisicao_rotinas).
// Só SQL + isolamento por empresa. A decisão de QUANDO rodar é do scheduler puro
// (services/aquisicao-rotinas-scheduler.js) e o disparo é do motor (prospecting.js).

const {
  normalizarRotina,
  validarRotina,
  MAX_FALHAS_CONSECUTIVAS,
} = require('../services/aquisicao-rotinas-scheduler')

const COLUNAS = `
  id, empresa_id, nicho, cidade, uf, dias_semana,
  to_char(janela_inicio, 'HH24:MI') AS janela_inicio,
  to_char(janela_fim, 'HH24:MI')    AS janela_fim,
  intervalo_horas, quantidade, ativo, estado, mensagem,
  ultima_execucao_em, ultima_conclusao_em, total_execucoes,
  ultimo_coletados, ultimo_novos, ultimo_duplicados,
  falhas_consecutivas, ultimo_erro, criado_em, atualizado_em
`

function erro(mensagem, statusCode = 400) {
  const e = new Error(mensagem)
  e.statusCode = statusCode
  return e
}

// Erro de unicidade do Postgres (índice aquisicao_rotinas_mercado_uk).
function ehConflitoDeMercado(err) {
  return err && err.code === '23505' && String(err.constraint || '').includes('aquisicao_rotinas_mercado')
}

async function listarRotinas(pool, empresaId) {
  const { rows } = await pool.query(
    `SELECT ${COLUNAS}
       FROM prospectador.aquisicao_rotinas
      WHERE empresa_id = $1
      ORDER BY ativo DESC, criado_em ASC`,
    [empresaId]
  )
  return rows
}

async function obterRotina(pool, empresaId, id) {
  const { rows } = await pool.query(
    `SELECT ${COLUNAS} FROM prospectador.aquisicao_rotinas WHERE empresa_id = $1 AND id = $2::uuid`,
    [empresaId, id]
  )
  return rows[0] || null
}

// Todas as rotinas ativas do sistema, agrupáveis por empresa — usado pelo worker.
async function listarRotinasAtivas(pool) {
  const { rows } = await pool.query(
    `SELECT ${COLUNAS}
       FROM prospectador.aquisicao_rotinas
      WHERE ativo = true AND estado NOT IN ('precisa_atencao', 'coletando', 'importando')
      ORDER BY empresa_id, ultima_execucao_em ASC NULLS FIRST, criado_em ASC`
  )
  return rows
}

async function criarRotina(pool, empresaId, payload = {}) {
  const rotina = normalizarRotina(payload)
  const problemas = validarRotina(rotina)
  if (problemas.length) throw erro(problemas.join(' '), 400)

  try {
    const { rows } = await pool.query(
      `INSERT INTO prospectador.aquisicao_rotinas (
         empresa_id, nicho, cidade, uf, dias_semana,
         janela_inicio, janela_fim, intervalo_horas, quantidade, ativo, estado
       ) VALUES ($1, $2, $3, $4, $5::smallint[], $6::time, $7::time, $8, $9, $10, $11)
       RETURNING ${COLUNAS}`,
      [
        empresaId, rotina.nicho, rotina.cidade, rotina.uf, rotina.dias_semana,
        rotina.janela_inicio, rotina.janela_fim, rotina.intervalo_horas,
        rotina.quantidade, rotina.ativo, rotina.ativo ? 'aguardando' : 'pausada',
      ]
    )
    return rows[0]
  } catch (err) {
    if (ehConflitoDeMercado(err)) throw erro('Já existe uma rotina para este nicho, cidade e UF.', 409)
    throw err
  }
}

async function atualizarRotina(pool, empresaId, id, payload = {}) {
  const atual = await obterRotina(pool, empresaId, id)
  if (!atual) throw erro('Rotina não encontrada.', 404)

  const rotina = normalizarRotina(payload, atual)
  const problemas = validarRotina(rotina)
  if (problemas.length) throw erro(problemas.join(' '), 400)

  // Editar/retomar uma rotina que estava em "precisa de atenção" a reabilita e zera o
  // contador de falhas — é a ação explícita do admin dizendo "corrigi, pode tentar".
  const saiuDeAtencao = atual.estado === 'precisa_atencao'
  const estadoNovo = !rotina.ativo
    ? 'pausada'
    : (saiuDeAtencao || atual.estado === 'pausada') ? 'aguardando' : atual.estado

  try {
    const { rows } = await pool.query(
      `UPDATE prospectador.aquisicao_rotinas
          SET nicho = $3, cidade = $4, uf = $5, dias_semana = $6::smallint[],
              janela_inicio = $7::time, janela_fim = $8::time,
              intervalo_horas = $9, quantidade = $10, ativo = $11,
              estado = $12,
              falhas_consecutivas = CASE WHEN $13 THEN 0 ELSE falhas_consecutivas END,
              ultimo_erro = CASE WHEN $13 THEN NULL ELSE ultimo_erro END,
              mensagem = CASE WHEN $13 THEN NULL ELSE mensagem END,
              atualizado_em = NOW()
        WHERE empresa_id = $1 AND id = $2::uuid
        RETURNING ${COLUNAS}`,
      [
        empresaId, id, rotina.nicho, rotina.cidade, rotina.uf, rotina.dias_semana,
        rotina.janela_inicio, rotina.janela_fim, rotina.intervalo_horas,
        rotina.quantidade, rotina.ativo, estadoNovo, saiuDeAtencao,
      ]
    )
    return rows[0]
  } catch (err) {
    if (ehConflitoDeMercado(err)) throw erro('Já existe uma rotina para este nicho, cidade e UF.', 409)
    throw err
  }
}

// Pausar/retomar sem mexer no resto do cadastro — o histórico é preservado.
async function alternarRotina(pool, empresaId, id, ativo) {
  const atual = await obterRotina(pool, empresaId, id)
  if (!atual) throw erro('Rotina não encontrada.', 404)
  const ligar = ativo === true || ativo === 'true'
  const { rows } = await pool.query(
    `UPDATE prospectador.aquisicao_rotinas
        SET ativo = $3,
            estado = CASE WHEN $3 THEN 'aguardando' ELSE 'pausada' END,
            falhas_consecutivas = CASE WHEN $3 THEN 0 ELSE falhas_consecutivas END,
            ultimo_erro = CASE WHEN $3 THEN NULL ELSE ultimo_erro END,
            mensagem = CASE WHEN $3 THEN NULL ELSE mensagem END,
            atualizado_em = NOW()
      WHERE empresa_id = $1 AND id = $2::uuid
      RETURNING ${COLUNAS}`,
    [empresaId, id, ligar]
  )
  return rows[0]
}

async function removerRotina(pool, empresaId, id) {
  const { rowCount } = await pool.query(
    `DELETE FROM prospectador.aquisicao_rotinas WHERE empresa_id = $1 AND id = $2::uuid`,
    [empresaId, id]
  )
  if (!rowCount) throw erro('Rotina não encontrada.', 404)
  return { ok: true, id }
}

// Marca o DISPARO. `ultima_execucao_em` é gravado aqui (não na conclusão) para que uma
// coleta travada não reabra o intervalo.
//
// O WHERE é a trava de concorrência do disparo e checa DUAS coisas no mesmo comando
// atômico, porque entre a seleção da rotina pelo worker e este UPDATE existe uma janela
// real de tempo:
//   - `ativo = true`   → o admin pode ter PAUSADO a rotina nessa janela; pausar tem de
//                        impedir a coleta paga, não só escondê-la da próxima seleção;
//   - estado não em voo → dois ticks concorrentes não disparam a mesma rotina duas vezes.
// Zero linhas atualizadas = o motor NÃO pode chamar a Bright Data.
async function marcarDisparo(pool, id, quandoIso = null) {
  const { rows } = await pool.query(
    `UPDATE prospectador.aquisicao_rotinas
        SET ultima_execucao_em = COALESCE($2::timestamptz, NOW()),
            total_execucoes = total_execucoes + 1,
            estado = 'coletando',
            mensagem = NULL,
            atualizado_em = NOW()
      WHERE id = $1::uuid
        AND ativo = true
        AND estado NOT IN ('coletando', 'importando')
      RETURNING ${COLUNAS}`,
    [id, quandoIso]
  )
  return rows[0] || null
}

// Desfaz o marcarDisparo quando o disparo NÃO chegou a virar coleta paga (ex.: outra
// coleta da empresa ganhou a corrida). Sem isso a rotina perderia sua vez e contaria uma
// execução que nunca existiu.
async function reverterDisparo(pool, id, ultimaExecucaoAnterior = null) {
  await pool.query(
    `UPDATE prospectador.aquisicao_rotinas
        SET ultima_execucao_em = $2::timestamptz,
            total_execucoes = GREATEST(total_execucoes - 1, 0),
            estado = 'aguardando',
            atualizado_em = NOW()
      WHERE id = $1::uuid AND estado = 'coletando'`,
    [id, ultimaExecucaoAnterior]
  )
}

async function marcarImportando(pool, id) {
  await pool.query(
    `UPDATE prospectador.aquisicao_rotinas
        SET estado = 'importando', atualizado_em = NOW()
      WHERE id = $1::uuid AND estado = 'coletando'`,
    [id]
  )
}

async function marcarConclusao(pool, id, { coletados = 0, novos = 0, duplicados = 0 } = {}) {
  const { rows } = await pool.query(
    `UPDATE prospectador.aquisicao_rotinas
        SET estado = 'concluida',
            ultima_conclusao_em = NOW(),
            ultimo_coletados = $2, ultimo_novos = $3, ultimo_duplicados = $4,
            falhas_consecutivas = 0, ultimo_erro = NULL,
            mensagem = $5,
            atualizado_em = NOW()
      WHERE id = $1::uuid
      RETURNING ${COLUNAS}`,
    [id, coletados, novos, duplicados,
      `Última coleta: ${coletados} encontrados · ${novos} novos · ${duplicados} já existiam.`]
  )
  return rows[0] || null
}

// Falha do disparo ou da importação. Depois de MAX_FALHAS_CONSECUTIVAS a rotina para
// sozinha e passa a exigir uma ação do admin — não tenta coleta paga para sempre.
async function marcarFalha(pool, id, mensagemErro) {
  const { rows } = await pool.query(
    `UPDATE prospectador.aquisicao_rotinas
        SET falhas_consecutivas = falhas_consecutivas + 1,
            ultimo_erro = $2,
            estado = CASE WHEN falhas_consecutivas + 1 >= $3 THEN 'precisa_atencao' ELSE 'aguardando' END,
            mensagem = CASE WHEN falhas_consecutivas + 1 >= $3
                            THEN 'A rotina foi pausada depois de falhas seguidas. Revise os dados e retome.'
                            ELSE 'A última coleta falhou. A rotina tentará de novo na próxima janela.' END,
            atualizado_em = NOW()
      WHERE id = $1::uuid
      RETURNING ${COLUNAS}`,
    [id, String(mensagemErro || 'erro').slice(0, 400), MAX_FALHAS_CONSECUTIVAS]
  )
  return rows[0] || null
}

// A empresa já tem uma coleta paga em voo? Usado só para exibir "na fila" no painel —
// a garantia de verdade é o índice único parcial em busca_snapshots.
async function existeColetaEmVoo(pool, empresaId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM prospectador.busca_snapshots
      WHERE empresa_id = $1 AND status IN ('pendente', 'processando') LIMIT 1`,
    [empresaId]
  )
  return !!rows[0]
}

// Atividade recente das coletas desta empresa (rotinas + manual), para o painel.
async function listarAtividadeRecente(pool, empresaId, limite = 15) {
  const { rows } = await pool.query(
    `SELECT s.id, s.rotina_id, s.nicho, s.cidade, s.origem, s.status,
            s.total_prospects, s.novos_prospects, s.custo_registros,
            s.quantidade_solicitada, s.erro, s.created_at, s.updated_at,
            r.uf
       FROM prospectador.busca_snapshots s
       LEFT JOIN prospectador.aquisicao_rotinas r ON r.id = s.rotina_id
      WHERE s.empresa_id = $1
      ORDER BY s.created_at DESC
      LIMIT $2`,
    [empresaId, Math.max(1, Math.min(50, Number.parseInt(limite, 10) || 15))]
  )
  return rows
}

module.exports = {
  listarRotinas,
  obterRotina,
  listarRotinasAtivas,
  criarRotina,
  atualizarRotina,
  alternarRotina,
  removerRotina,
  marcarDisparo,
  reverterDisparo,
  marcarImportando,
  marcarConclusao,
  marcarFalha,
  existeColetaEmVoo,
  listarAtividadeRecente,
}
