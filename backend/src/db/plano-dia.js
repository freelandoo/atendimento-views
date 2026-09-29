'use strict'
/**
 * QUADRO DO DIA — acesso a dados (migration 095).
 *
 * ⚠️ ESTA CAMADA NÃO TOCA O CICLO COMERCIAL. Nenhuma instrução aqui escreve em
 * `prospectador.prospects` (status, qualificacao, responsavel_id, icp_*), em `vendas.conversas`
 * ou em `app.follow_ups`: o Quadro é PLANEJAMENTO, e mover um card não pode alterar o funil,
 * assumir lead de ninguém nem disparar abordagem. Há guarda de regressão que lê este fonte.
 *
 * Todo SELECT e todo UPDATE são escopados por `empresa_id` **e** `usuario_id`: o plano é
 * pessoal, e nenhuma rota devolve o quadro de outra pessoa.
 */
const { pool } = require('../db')
const PD = require('../services/plano-dia')
// Dono único de "o que conta como AÇÃO no lead" (services/lead-parado.js). Reusar é o que
// impede "o sistema viu que você trabalhou o lead" de significar uma coisa aqui e outra no
// painel da equipe.
const LP = require('../services/lead-parado')
const { sqlTelefoneNormalizado } = require('../telefone-br')

// O que o card mostra. Lista FECHADA — o quadro não é uma segunda listagem do Banco de Leads.
const COLS_CARD = `
  i.id, i.dia, i.etapa, i.ordem, i.objetivo, i.origem_entrada,
  i.conclusao_tipo, i.conclusao_nota, i.concluido_em, i.criado_em,
  p.id AS prospect_id, p.nome, p.telefone, p.origem, p.instagram_handle,
  p.cidade, p.nicho, p.status, p.icp_faixa, p.icp_score, p.bloqueado_ate`

/**
 * O quadro de UMA pessoa num dia. Devolve os cards já na ordem das colunas.
 *
 * `proximo_agendamento` vem por LATERAL sobre as poucas linhas do dia — é o "horário quando
 * existir" do card. O casamento por telefone usa a MESMA expressão indexada do resto do
 * repositório (`sqlTelefoneNormalizado`); escrevê-la de novo aqui criaria a segunda cópia que
 * aquele módulo existe para impedir.
 */
async function quadroDoDia(empresaId, usuarioId, dia) {
  const { rows } = await pool.query(
     `SELECT ${COLS_CARD},
            COALESCE(i.follow_up_id, followup.follow_up_id) AS follow_up_id,
            followup.follow_up_agendado_para,
            acao.conclusao_acao,
            agenda.proximo_agendamento
       FROM app.plano_dia_itens i
       JOIN prospectador.prospects p ON p.id = i.prospect_id AND p.empresa_id = i.empresa_id
       LEFT JOIN LATERAL (
         SELECT fu.id AS follow_up_id, fu.agendado_para AS follow_up_agendado_para
           FROM app.follow_ups fu
          WHERE fu.empresa_id = i.empresa_id
            AND fu.prospect_id = i.prospect_id
            AND fu.status = 'aguardando'
          ORDER BY fu.agendado_para ASC NULLS LAST, fu.criado_em DESC
          LIMIT 1
       ) followup ON TRUE
       LEFT JOIN LATERAL (
         SELECT ae.acao AS conclusao_acao
           FROM app.auditoria_eventos ae
          WHERE ae.empresa_id = i.empresa_id
            AND ae.entidade_tipo = 'prospect'
            AND ae.entidade_id = i.prospect_id
            AND ae.criado_em::date = i.dia
            AND ae.acao IN (
              'lead_reuniao_agendada',
              'lead_ligacao_realizada',
              'lead_follow_up_criado',
              'lead_proposta_enviada',
              'abordagem_manual_declarada',
              'lead_status_alterado'
            )
          ORDER BY CASE ae.acao
                     WHEN 'lead_reuniao_agendada' THEN 0
                     WHEN 'lead_ligacao_realizada' THEN 1
                     WHEN 'lead_follow_up_criado' THEN 2
                     WHEN 'lead_proposta_enviada' THEN 3
                     WHEN 'abordagem_manual_declarada' THEN 4
                     ELSE 5
                   END,
                   ae.criado_em DESC
          LIMIT 1
       ) acao ON TRUE
       LEFT JOIN LATERAL (
         SELECT MIN(ae.data_inicio) AS proximo_agendamento
           FROM app.agenda_eventos ae
          WHERE ae.empresa_id = i.empresa_id
            AND ae.excluido_em IS NULL
            AND ae.status IN ('pendente', 'confirmado')
            AND ae.data_inicio >= NOW()
            AND NULLIF(${sqlTelefoneNormalizado('p.telefone')}, '') IS NOT NULL
            AND ${sqlTelefoneNormalizado('ae.lead_telefone')} = ${sqlTelefoneNormalizado('p.telefone')}
       ) agenda ON TRUE
      WHERE i.empresa_id = $1 AND i.usuario_id = $2 AND i.dia = $3::date
      ORDER BY i.etapa, i.ordem, i.criado_em`,
    [empresaId, usuarioId, dia]
  )
  return rows
}

/**
 * Resumo read-only de um intervalo curto para navegação visual do Quadro.
 *
 * Continua PESSOAL: empresa + usuario. Não lista cards de outro dia e não move nada; a tela usa
 * isto só para dizer "este dia tem 4 itens, 2 feitos" antes de trocar o foco diário.
 */
async function resumoPeriodo({ empresaId, usuarioId, inicio, fim }) {
  const { rows } = await pool.query(
    `SELECT to_char(i.dia, 'YYYY-MM-DD') AS dia,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE i.etapa = 'feito')::int AS feitos,
            COUNT(*) FILTER (WHERE i.etapa <> 'feito')::int AS abertos,
            COUNT(*) FILTER (WHERE i.etapa = 'para_hoje')::int AS para_hoje,
            COUNT(*) FILTER (WHERE i.etapa = 'em_trabalho')::int AS em_trabalho,
            COUNT(*) FILTER (WHERE i.etapa = 'aguardando_retorno')::int AS aguardando_retorno
       FROM app.plano_dia_itens i
      WHERE i.empresa_id = $1
        AND i.usuario_id = $2
        AND i.dia BETWEEN $3::date AND $4::date
      GROUP BY i.dia
      ORDER BY i.dia`,
    [empresaId, usuarioId, inicio, fim]
  )
  return rows
}

/**
 * Acrescenta leads ao dia. **`ON CONFLICT DO NOTHING`**: o índice único
 * (`empresa, usuario, dia, prospect`) é quem garante que arrastar duas vezes, um retry ou duas
 * abas abertas não produzam dois cards do mesmo lead. Devolve só o que REALMENTE entrou — a
 * tela precisa poder dizer "3 de 5; 2 já estavam no dia".
 *
 * A checagem de recorte (o lead está na carteira desta pessoa?) acontece na ROTA, com o mesmo
 * `sqlEscopo` da listagem. Aqui ela é reforçada pelo `WHERE` do SELECT de origem: um id que não
 * passe pelo filtro simplesmente não vira linha.
 */
async function adicionarItens({ empresaId, usuarioId, dia, prospectIds, origem }) {
  const ids = [...new Set((prospectIds || []).map((x) => String(x || '').trim()).filter(Boolean))]
  if (!ids.length) return { adicionados: [], ignorados: 0 }
  const params = [empresaId, usuarioId, dia, ids, origem]
  const extra = ''
  const { rows } = await pool.query(
    `INSERT INTO app.plano_dia_itens (empresa_id, usuario_id, dia, prospect_id, origem_entrada, ordem)
     SELECT $1, $2, $3::date, p.id, $5,
            COALESCE((SELECT MAX(x.ordem) FROM app.plano_dia_itens x
                       WHERE x.empresa_id = $1 AND x.usuario_id = $2 AND x.dia = $3::date
                         AND x.etapa = 'para_hoje'), 0)
            + (ROW_NUMBER() OVER (ORDER BY p.nome)) * 10
       FROM prospectador.prospects p
      WHERE p.empresa_id = $1 AND p.id = ANY($4::uuid[])${extra}
     ON CONFLICT (empresa_id, usuario_id, dia, prospect_id) DO NOTHING
     RETURNING id, prospect_id`,
    params
  )
  return { adicionados: rows, ignorados: ids.length - rows.length }
}

/**
 * Move / reordena / anota um card. O `UPDATE` é condicionado a empresa + usuário + id: um id
 * trocado na URL não alcança o quadro de outra pessoa (404, nunca 403 — dizer "existe, mas não
 * é seu" já entrega que aquele lead está no plano de alguém).
 *
 * `conclusao` vem resolvida por `services/plano-dia.js`. Quando a etapa sai de `feito`, os três
 * campos de conclusão são ZERADOS na mesma instrução — a CHECK do banco recusaria uma conclusão
 * pendurada num card que voltou para outra coluna, e é isso que mantém "Feito hoje" contável.
 */
async function moverItem({ empresaId, usuarioId, itemId, etapa, ordem, objetivo, conclusao, followUpId }) {
  const sets = ['etapa = $4', 'atualizado_em = NOW()']
  const params = [empresaId, usuarioId, itemId, etapa]
  if (ordem !== undefined && ordem !== null) { params.push(ordem); sets.push(`ordem = $${params.length}`) }
  if (objetivo !== undefined) { params.push(objetivo || null); sets.push(`objetivo = $${params.length}`) }
  if (followUpId !== undefined) { params.push(followUpId || null); sets.push(`follow_up_id = $${params.length}`) }
  if (etapa === 'feito' && conclusao) {
    params.push(conclusao.tipo); sets.push(`conclusao_tipo = $${params.length}`)
    params.push(conclusao.nota || null); sets.push(`conclusao_nota = $${params.length}`)
    sets.push('concluido_em = NOW()')
  } else {
    sets.push('conclusao_tipo = NULL', 'conclusao_nota = NULL', 'concluido_em = NULL')
  }
  const { rows } = await pool.query(
    `UPDATE app.plano_dia_itens SET ${sets.join(', ')}
      WHERE empresa_id = $1 AND usuario_id = $2 AND id = $3
      RETURNING id, dia, etapa, ordem, objetivo, conclusao_tipo, conclusao_nota, concluido_em, prospect_id`,
    params
  )
  return rows[0] || null
}

/**
 * Um card do quadro DESTA pessoa. Devolve `null` fora do escopo — a rota responde 404, nunca
 * 403: dizer "existe, mas não é seu" já entrega que aquele lead está no plano de alguém.
 */
async function itemDoUsuario({ empresaId, usuarioId, itemId }) {
  const { rows } = await pool.query(
    `SELECT id, dia, etapa, ordem, objetivo, prospect_id, conclusao_tipo, concluido_em
       FROM app.plano_dia_itens
      WHERE empresa_id = $1 AND usuario_id = $2 AND id = $3`,
    [empresaId, usuarioId, itemId]
  )
  return rows[0] || null
}

/** Tira o lead do dia. **Não** mexe no cadastro, na carteira nem no responsável. */
async function removerItem({ empresaId, usuarioId, itemId }) {
  const { rows } = await pool.query(
    `DELETE FROM app.plano_dia_itens
      WHERE empresa_id = $1 AND usuario_id = $2 AND id = $3
      RETURNING id, prospect_id`,
    [empresaId, usuarioId, itemId]
  )
  return rows[0] || null
}

/**
 * Houve AÇÃO registrada neste lead no dia? É o que decide entre `atividade_registrada` e
 * `autodeclarada` ao concluir um card.
 *
 * A definição de "ação" é EMPRESTADA de `services/lead-parado.js` (disparo — que cobre o envio
 * automático e o wa.me manual —, ligação e follow-up). Escrever uma segunda lista aqui faria
 * "você trabalhou este lead" significar uma coisa no quadro e outra no painel da equipe.
 *
 * A comparação de data usa o fuso da SESSÃO do Postgres, que `src/db.js` fixa em APP_TIMEZONE —
 * é o mesmo fuso em que `dia` foi resolvido.
 */
async function temAtividadeNoDia({ empresaId, prospectId, dia }) {
  const { rows } = await pool.query(
    `SELECT (${LP.sqlUltimaAcao('p')})::date = $3::date AS tem
       FROM prospectador.prospects p
      WHERE p.empresa_id = $1 AND p.id = $2`,
    [empresaId, prospectId, dia]
  )
  return rows[0] ? rows[0].tem === true : false
}

/**
 * O que ficou EM ABERTO em dias anteriores. É a lista da prévia de "Replanejar pendências":
 * nada é movido sozinho à meia-noite — o operador vê o que vai acontecer e manda.
 * Card `feito` não entra: ele é o registro do dia em que aconteceu.
 */
async function pendentesAnteriores({ empresaId, usuarioId, dia }) {
  const { rows } = await pool.query(
    `SELECT ${COLS_CARD}
       FROM app.plano_dia_itens i
       JOIN prospectador.prospects p ON p.id = i.prospect_id AND p.empresa_id = i.empresa_id
      WHERE i.empresa_id = $1 AND i.usuario_id = $2 AND i.dia < $3::date AND i.etapa <> 'feito'
      ORDER BY i.dia, i.ordem
      LIMIT 200`,
    [empresaId, usuarioId, dia]
  )
  return rows
}

/**
 * Move as pendências anteriores para o dia pedido. Ação EXPLÍCITA, nunca um worker.
 *
 * `ON CONFLICT DO NOTHING` + `DELETE` do que sobrou: quando o lead JÁ está no dia de destino, o
 * item antigo some e o de destino é preservado — reescrever o de destino apagaria o objetivo que
 * a pessoa escreveu hoje. Tudo numa transação: pendência não pode sumir do dia velho sem
 * aparecer no novo.
 */
async function replanejarPendentes({ empresaId, usuarioId, de, para, modo = 'trazer_tudo' }) {
  const continuarHoje = modo === 'continuar_hoje'
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: movidos } = await client.query(
      `WITH pendentes AS (
         SELECT id, dia, prospect_id, objetivo, origem_entrada, etapa, ordem, follow_up_id
           FROM app.plano_dia_itens
          WHERE empresa_id = $1 AND usuario_id = $2 AND dia < $3::date AND etapa <> 'feito'
          ORDER BY dia, ordem
          LIMIT 200
       ), inseridos AS (
         INSERT INTO app.plano_dia_itens (empresa_id, usuario_id, dia, prospect_id, origem_entrada, objetivo, follow_up_id, etapa, ordem)
         SELECT $1, $2, $3::date, prospect_id, origem_entrada, objetivo,
                follow_up_id,
                CASE WHEN $4::boolean THEN etapa ELSE 'para_hoje' END,
                ordem
           FROM pendentes
         ON CONFLICT (empresa_id, usuario_id, dia, prospect_id) DO NOTHING
         RETURNING id AS novo_id, prospect_id
       ), apagados AS (
         DELETE FROM app.plano_dia_itens d
          USING pendentes
          WHERE d.id = pendentes.id
          RETURNING d.id, d.dia, d.prospect_id, d.origem_entrada, d.objetivo, d.follow_up_id, d.etapa, d.ordem
       )
       SELECT a.*, i.novo_id
         FROM apagados a
         LEFT JOIN inseridos i ON i.prospect_id = a.prospect_id`,
      [empresaId, usuarioId, para, continuarHoje]
    )
    await client.query('COMMIT')
    return { movidos: movidos.length, modo, desfazer: movidos }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function desfazerReplanejamento({ empresaId, usuarioId, itens }) {
  const lista = (Array.isArray(itens) ? itens : []).map((item) => ({
    id: String(item?.id || '').trim(),
    novo_id: item?.novo_id ? String(item.novo_id).trim() : null,
    dia: String(item?.dia || '').slice(0, 10),
    prospect_id: String(item?.prospect_id || '').trim(),
    origem_entrada: PD.origemValida(item?.origem_entrada) || 'escolha_manual',
    objetivo: item?.objetivo == null ? null : String(item.objetivo),
    follow_up_id: item?.follow_up_id ? String(item.follow_up_id).trim() : null,
    etapa: PD.etapaValida(item?.etapa) || 'para_hoje',
    ordem: Number.isFinite(Number(item?.ordem)) ? Math.trunc(Number(item.ordem)) : 10,
  })).filter((item) => item.id && item.prospect_id && PD.diaValido(item.dia))
  if (!lista.length) return { restaurados: 0 }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `WITH entrada AS (
         SELECT *
           FROM jsonb_to_recordset($3::jsonb) AS x(
             id uuid,
             novo_id uuid,
             dia date,
             prospect_id uuid,
             origem_entrada text,
             objetivo text,
             follow_up_id uuid,
             etapa text,
             ordem int
           )
       ), removidos AS (
         DELETE FROM app.plano_dia_itens d
          USING entrada e
         WHERE e.novo_id IS NOT NULL
            AND d.empresa_id = $1
            AND d.usuario_id = $2
            AND d.id = e.novo_id
         RETURNING d.id
       )
       INSERT INTO app.plano_dia_itens (
         id, empresa_id, usuario_id, dia, prospect_id, origem_entrada, objetivo, follow_up_id, etapa, ordem
       )
       SELECT e.id, $1, $2, e.dia, e.prospect_id, e.origem_entrada, e.objetivo,
              e.follow_up_id, e.etapa, e.ordem
         FROM entrada e
         JOIN prospectador.prospects p ON p.id = e.prospect_id AND p.empresa_id = $1
        WHERE e.etapa <> 'feito'
       ON CONFLICT (empresa_id, usuario_id, dia, prospect_id) DO NOTHING
       RETURNING id`,
      [empresaId, usuarioId, JSON.stringify(lista)]
    )
    await client.query('COMMIT')
    return { restaurados: rows.length }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/**
 * SUGESTÕES para o "Planejar meu dia". Duas fontes, ambas com informação confiável no banco:
 *   • `sugestao_vencidos`  — follow-up MEU, aguardando, com prazo já vencido;
 *   • `sugestao_agenda`    — compromisso MEU na agenda de hoje, casado pelo telefone do lead.
 *
 * ⚠️ NÃO despeja a carteira. Sem follow-up vencido e sem compromisso, a lista volta vazia — e
 * vazio aqui é resposta, não falha: significa que a escolha do dia é inteiramente do operador.
 *
 * O RECORTE (o lead está na carteira desta pessoa?) é aplicado pela ROTA, que passa os ids por
 * `filtrarIdsNoRecorte` — o mesmo `sqlEscopo` + nicho da listagem. Colar aquele fragmento aqui
 * exigiria renumerar os placeholders dele, e um erro de renumeração silenciosa é exatamente o
 * tipo de defeito que abriria o quadro de um vendedor para a carteira de outro.
 */
async function sugestoesDoDia({ empresaId, usuarioId, dia }) {
  const params = [empresaId, usuarioId, dia]
  const extra = ''
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (p.id) p.id AS prospect_id, p.nome, p.telefone, p.origem, p.cidade,
            p.icp_faixa, p.icp_score,
            s.origem_entrada, s.quando
       FROM prospectador.prospects p
       JOIN LATERAL (
         SELECT 'sugestao_vencidos'::text AS origem_entrada, fu.agendado_para AS quando
           FROM app.follow_ups fu
          WHERE fu.prospect_id = p.id AND fu.empresa_id = p.empresa_id
            AND fu.status = 'aguardando' AND fu.responsavel_id = $2
            AND fu.agendado_para < NOW()
          UNION ALL
         SELECT 'sugestao_agenda'::text, ae.data_inicio
           FROM app.agenda_eventos ae
          WHERE ae.empresa_id = p.empresa_id AND ae.excluido_em IS NULL
            AND ae.status IN ('pendente', 'confirmado')
            AND ae.responsavel_id = $2
            AND ae.data_inicio::date = $3::date
            AND NULLIF(${sqlTelefoneNormalizado('p.telefone')}, '') IS NOT NULL
            AND ${sqlTelefoneNormalizado('ae.lead_telefone')} = ${sqlTelefoneNormalizado('p.telefone')}
       ) s ON TRUE
      WHERE p.empresa_id = $1${extra}
        AND NOT EXISTS (
          SELECT 1 FROM app.plano_dia_itens i
           WHERE i.empresa_id = $1 AND i.usuario_id = $2 AND i.dia = $3::date AND i.prospect_id = p.id
        )
      ORDER BY p.id, s.quando
      LIMIT 30`,
    params
  )
  return rows
}

module.exports = {
  PD,
  quadroDoDia,
  resumoPeriodo,
  itemDoUsuario,
  adicionarItens,
  moverItem,
  removerItem,
  temAtividadeNoDia,
  pendentesAnteriores,
  replanejarPendentes,
  desfazerReplanejamento,
  sugestoesDoDia,
}
