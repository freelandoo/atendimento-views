'use strict'
// Guard UNICO de escrita de evento TEMPORAL da ligacao (etapa, sinal, objecao, pergunta).
//
// Existia uma copia de `assertLigacaoAtiva` em cada um dos 4 modulos, todas checando apenas
// `status !== 'em_andamento'`. Nenhuma olhava `chamada_encerrada_em` — entao, depois do clique
// em "Encerrar ligacao" (que marca o fim da chamada mas mantem o status em_andamento ate o
// resumo ser salvo), TODAS continuavam aceitando escrita. Resultado: era possivel navegar
// etapas e marcar sinais/objecoes/perguntas DEPOIS que a chamada acabou, gerando ocorrencias
// temporais fora da janela real da conversa e inflando a duracao por etapa.
//
// Consolidar aqui evita que a regra volte a divergir entre as copias — mesmo motivo da fonte
// unica em src/domain-enums.js.
//
// REGRA: evento temporal so e' aceito enquanto a CHAMADA esta aberta, i.e.
//        status = 'em_andamento' E chamada_encerrada_em IS NULL  (estado_sessao 'em_andamento').
// O resumo comercial NAO passa por aqui — continua editavel em aguardando_resumo, e as notas
// livres (atualizarNotas) tambem, por nao serem evento temporal.

const { estadoSessao } = require('./ligacoes-estado')

function erroEntrada(message, statusCode = 400) {
  const err = new Error(message)
  err.statusCode = statusCode
  return err
}

// Le a ligacao (isolada por empresa) e exige CHAMADA ABERTA. Aceita pool OU client (para
// rodar dentro de transacao). Devolve a linha, com os campos que os chamadores usam.
async function assertChamadaAberta(db, empresaId, ligacaoId) {
  if (!ligacaoId) throw erroEntrada('ligacao_id obrigatorio.')
  const { rows } = await db.query(
    `SELECT status, chamada_encerrada_em, roteiro_versao_id
       FROM app.ligacoes WHERE id = $1 AND empresa_id = $2`, [ligacaoId, empresaId])
  if (!rows[0]) throw erroEntrada('Ligacao nao encontrada.', 404)
  const estado = estadoSessao(rows[0])
  if (estado === 'aguardando_resumo') {
    throw erroEntrada('A chamada ja foi encerrada — o registro da conversa esta fechado. Conclua o resumo.', 409)
  }
  if (estado !== 'em_andamento') throw erroEntrada('Ligacao nao esta em andamento.', 409)
  return rows[0]
}

module.exports = { assertChamadaAberta }
