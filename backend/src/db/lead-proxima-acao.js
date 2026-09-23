'use strict'

/**
 * Leitura dos compromissos de UM lead para a "Próxima ação" da ficha do Banco de Leads.
 *
 * SOMENTE LEITURA: não cria, move, conclui nem reagenda nada. A regra (ordem, situação do prazo)
 * vive em `services/lead-proxima-acao.js`; aqui só se busca.
 *
 * O vínculo lead ↔ compromisso é `prospect_id` quando existe e, na falta dele, o TELEFONE
 * normalizado — `app.follow_ups.prospect_id` e `app.agenda_eventos.prospect_id` são nullable (a
 * identidade do follow-up é `empresa_id + telefone_digitos`, migration 062), e casar só por id
 * esconderia o retorno combinado pela Central de Ligações ou pela Central de Mensagens.
 * A expressão de telefone é a do dono único (`telefone-br.js`), a mesma da listagem.
 *
 * O recorte (o lead é do escopo de quem pede?) é conferido pela ROTA antes de chamar aqui.
 */

const { sqlTelefoneNormalizado: fone } = require('../telefone-br')
const { montarProximaAcao } = require('../services/lead-proxima-acao')

async function proximaAcaoDoLead(pool, empresaId, lead, { agora = new Date() } = {}) {
  const params = [empresaId, lead.id, lead.telefone || null]

  const { rows: followUps } = await pool.query(
    `SELECT f.id, f.canal, f.proxima_acao, f.agendado_para, f.prioridade, f.origem, f.observacao,
            COALESCE(u.nome, u.email) AS responsavel_nome
       FROM app.follow_ups f
       LEFT JOIN app.usuarios u ON u.id = f.responsavel_id
      WHERE f.empresa_id = $1
        AND f.status = 'aguardando'
        AND (f.prospect_id = $2::uuid
             OR (NULLIF(${fone('$3::text')}, '') IS NOT NULL
                 AND ${fone('f.telefone_digitos')} = ${fone('$3::text')}))
      ORDER BY f.agendado_para ASC NULLS LAST
      LIMIT 10`,
    params
  )

  // Agenda da TELA (reunião, retorno, tarefa) e agenda do BOT (só reunião). Só o que ainda não
  // terminou: reunião de ontem com status pendente não é próxima ação, é registro a fechar na
  // Agenda. Bloqueio não é compromisso com o lead.
  const { rows: reunioes } = await pool.query(
    `SELECT * FROM (
       SELECT ae.id::text AS id, ae.tipo, ae.titulo, ae.descricao, ae.data_inicio, ae.data_fim,
              'agenda' AS origem, COALESCE(u.nome, u.email) AS responsavel_nome
         FROM app.agenda_eventos ae
         LEFT JOIN app.usuarios u ON u.id = ae.responsavel_id
        WHERE ae.empresa_id = $1
          AND ae.excluido_em IS NULL
          AND ae.tipo IN ('reuniao', 'retorno', 'follow_up', 'tarefa')
          AND ae.status IN ('pendente', 'confirmado')
          AND ae.data_fim >= NOW()
          AND (ae.prospect_id = $2::uuid
               OR (NULLIF(${fone('$3::text')}, '') IS NOT NULL
                   AND ${fone('ae.lead_telefone')} = ${fone('$3::text')}))
       UNION ALL
       SELECT ve.id::text AS id, 'reuniao' AS tipo, ve.titulo, ve.descricao, ve.data_inicio, ve.data_fim,
              'bot' AS origem, NULL AS responsavel_nome
         FROM vendas.agenda_eventos ve
        WHERE ve.excluido_em IS NULL
          AND ve.tipo = 'reuniao'
          AND ve.status IN ('pendente', 'confirmado')
          AND ve.data_fim >= NOW()
          AND NULLIF(${fone('$3::text')}, '') IS NOT NULL
          AND (
            EXISTS (SELECT 1 FROM vendas.conversas vc
                     WHERE vc.id = ve.conversa_id AND vc.empresa_id = $1
                       AND ${fone('vc.numero')} = ${fone('$3::text')})
            OR EXISTS (SELECT 1 FROM vendas.lead_profiles vlp
                        WHERE vlp.id = ve.lead_id AND vlp.empresa_id = $1
                          AND ${fone('vlp.numero')} = ${fone('$3::text')})
          )
     ) u
     ORDER BY data_inicio ASC
     LIMIT 10`,
    params
  )

  // Última ligação ENCERRADA (a em andamento é da Central; a descartada não aconteceu).
  const { rows: ligacoes } = await pool.query(
    `SELECT l.id, l.resultado, l.notas, l.iniciada_em, l.encerrada_em,
            COALESCE(u.nome, u.email) AS usuario_nome
       FROM app.ligacoes l
       LEFT JOIN app.usuarios u ON u.id = l.usuario_id
      WHERE l.empresa_id = $1
        AND l.status = 'encerrada'
        AND (l.prospect_id = $2::uuid
             OR (NULLIF(${fone('$3::text')}, '') IS NOT NULL
                 AND ${fone('l.telefone')} = ${fone('$3::text')}))
      ORDER BY COALESCE(l.encerrada_em, l.iniciada_em) DESC
      LIMIT 1`,
    params
  )

  return montarProximaAcao({ followUps, reunioes, ultimaLigacao: ligacoes[0] || null, agora })
}

module.exports = { proximaAcaoDoLead }
