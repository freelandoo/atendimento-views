// Apresentacao da lista de Roteiros: agrupamento, ciclo de vida visivel e quais acoes
// cabem em cada estado. Modulo PURO (sem React, sem fetch, sem DOM) — a tela so' desenha
// o que este arquivo decide, no mesmo padrao de lib/followups-fila.js e
// lib/prospeccao-listagem.js.
//
// TRES fatos do backend que este modulo TRADUZ e nao reinventa:
//
// 1. STATUS DA VERSAO != STATUS DO ROTEIRO. `app.roteiro_versoes.status`
//    (rascunho|publicada|arquivada) descreve UMA versao. O que a lista lateral precisa e' o
//    estado do ROTEIRO, e ele NAO e' derivavel do status das versoes: `publicarVersao`
//    arquiva a versao publicada anterior sozinha, entao quase todo roteiro saudavel tem
//    versao arquivada sem estar arquivado. O estado do roteiro vem de `ativo`
//    (app.roteiros.ativo, migration 033) combinado com "ja publicou alguma vez".
//
// 2. ARQUIVADO E' REVERSIVEL E NAO APAGA NADA. Nao existe — e nao deve existir — exclusao de
//    roteiro: as FKs de historico sao ON DELETE SET NULL, entao apagar desligaria em silencio
//    as ligacoes ja realizadas do roteiro que as gerou. Por isso `acoesDoRoteiro` nunca
//    devolve uma acao destrutiva.
//
// 3. "ATENDIMENTO X" E' O NICHO. Nao ha vinculo roteiro<->instancia no schema; `nicho`
//    (texto livre em app.roteiros) e' o agrupamento que os dados realmente tem.

'use strict'

const SEM_NICHO = '__sem_nicho__'

/** Status do ROTEIRO (o cabecalho), nao da versao. */
function statusDoRoteiro(roteiro) {
  if (!roteiro) return 'rascunho'
  if (roteiro.ativo === false) return 'arquivado'
  return roteiro.versao_publicada != null ? 'publicado' : 'rascunho'
}

// Rotulo + frase de CONSEQUENCIA. A frase existe porque cor sozinha nao informa (e nao e'
// acessivel): o operador precisa ler o que aquele estado faz com o atendimento.
const STATUS_ROTEIRO = Object.freeze({
  rascunho: {
    rotulo: 'Rascunho',
    frase: 'Em edicao. Ainda nao e usado em nenhum atendimento.',
  },
  publicado: {
    rotulo: 'Publicado',
    frase: 'Versao ativa: e esta que as campanhas novas passam a usar.',
  },
  arquivado: {
    rotulo: 'Arquivado',
    frase: 'Guardado como historico. Nao entra em campanha nova, e o que ja usava continua funcionando.',
  },
})

const STATUS_VERSAO = Object.freeze({
  rascunho: {
    rotulo: 'Rascunho',
    frase: 'Esta versao ainda pode ser editada e nao esta em uso.',
  },
  publicada: {
    rotulo: 'Publicada',
    frase: 'Versao imutavel. Para mudar o conteudo, crie uma nova versao.',
  },
  arquivada: {
    rotulo: 'Arquivada',
    frase: 'Versao antiga, mantida como historico das ligacoes que a usaram.',
  },
})

function rotuloStatusRoteiro(status) {
  return (STATUS_ROTEIRO[status] || STATUS_ROTEIRO.rascunho).rotulo
}
function fraseStatusRoteiro(status) {
  return (STATUS_ROTEIRO[status] || STATUS_ROTEIRO.rascunho).frase
}
function rotuloStatusVersao(status) {
  return (STATUS_VERSAO[status] || STATUS_VERSAO.rascunho).rotulo
}
function fraseStatusVersao(status) {
  return (STATUS_VERSAO[status] || STATUS_VERSAO.rascunho).frase
}

function rotuloNicho(nicho) {
  const n = String(nicho == null ? '' : nicho).trim()
  return n || 'Sem nicho'
}

// Chave de agrupamento: nichos que so' diferem por caixa/espaco sao o MESMO atendimento.
// "Academias" e "academias " nao podem virar dois grupos na lateral.
function chaveNicho(nicho) {
  const n = String(nicho == null ? '' : nicho).trim()
  return n ? n.toLocaleLowerCase('pt-BR') : SEM_NICHO
}

function ordenarPorNome(a, b) {
  return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR', { sensitivity: 'base' })
}

/**
 * Monta a lista lateral inteira a partir do que `GET /roteiros` devolveu.
 *
 * Devolve os ATIVOS agrupados por nicho (o "Atendimento X" da tela) e os ARQUIVADOS numa
 * lista separada e plana — arquivado e' consulta de historico, agrupar por nicho ali so'
 * acrescentaria cliques a um conteudo que fica recolhido por padrao.
 */
function montarListaRoteiros(roteiros) {
  const lista = Array.isArray(roteiros) ? roteiros.filter(Boolean) : []
  const arquivados = []
  const porNicho = new Map()

  for (const r of lista) {
    const item = { ...r, status: statusDoRoteiro(r) }
    if (item.status === 'arquivado') { arquivados.push(item); continue }
    const chave = chaveNicho(r.nicho)
    if (!porNicho.has(chave)) {
      porNicho.set(chave, { chave, rotulo: rotuloNicho(r.nicho), itens: [] })
    }
    porNicho.get(chave).itens.push(item)
  }

  // "Sem nicho" sempre por ultimo: e' o balde do que ainda nao foi organizado, nao um
  // atendimento de verdade. Os demais em ordem alfabetica.
  const grupos = [...porNicho.values()].sort((a, b) => {
    if (a.chave === SEM_NICHO) return 1
    if (b.chave === SEM_NICHO) return -1
    return a.rotulo.localeCompare(b.rotulo, 'pt-BR', { sensitivity: 'base' })
  })
  for (const g of grupos) g.itens.sort(ordenarPorNome)
  arquivados.sort(ordenarPorNome)

  return {
    grupos,
    arquivados,
    totalAtivos: lista.length - arquivados.length,
    totalArquivados: arquivados.length,
  }
}

/**
 * Qual versao abrir quando o operador seleciona um roteiro.
 *
 * A publicada vem primeiro porque e' a que esta valendo; sem ela, a versao mais recente.
 * `obterRoteiro` ja devolve as versoes por numero DESC, mas depender da ordem de chegada
 * deixaria a escolha implicita — aqui ela e' explicita e testavel.
 */
function versaoInicial(versoes) {
  const vs = Array.isArray(versoes) ? versoes.filter(Boolean) : []
  if (!vs.length) return null
  return vs.find((v) => v.status === 'publicada') || vs.slice().sort((a, b) => (b.versao || 0) - (a.versao || 0))[0]
}

/**
 * Acoes permitidas para o par (roteiro, versao exibida).
 *
 * `carregando` zera TODAS as acoes: enquanto o painel busca o conteudo, publicar ou arquivar
 * agiria sobre o que ainda esta na tela — que e' justamente o roteiro anterior.
 *
 * Roteiro arquivado fica somente-leitura: para voltar a editar, desarquive. Isso mantem uma
 * unica leitura possivel do estado, em vez de "arquivado, mas com rascunho editavel dentro".
 * Nenhuma acao destrutiva e' emitida aqui — exclusao de roteiro nao existe no produto.
 */
function acoesDoRoteiro({ statusRoteiro, statusVersao, carregando = false, temVersao = true } = {}) {
  const bloqueado = !!carregando || !temVersao
  const arquivado = statusRoteiro === 'arquivado'
  const rascunho = statusVersao === 'rascunho'
  return {
    podeEditar: !bloqueado && !arquivado && rascunho,
    podePublicar: !bloqueado && !arquivado && rascunho,
    podeCriarVersao: !bloqueado && !arquivado && !rascunho,
    podeExportar: !carregando && !arquivado && statusVersao === 'publicada',
    podeArquivar: !carregando && !arquivado,
    podeDesarquivar: !carregando && arquivado,
  }
}

/**
 * Texto do modal de confirmacao. Nomeia o roteiro e diz a consequencia REAL — inclusive
 * quando ha campanha usando, caso em que o operador precisa saber que nada para de funcionar.
 */
function textoConfirmacao(acao, roteiro) {
  const nome = String((roteiro && roteiro.nome) || 'este roteiro')
  const usando = Number((roteiro && roteiro.campanhas_usando) || 0)
  if (acao === 'desarquivar') {
    return {
      titulo: 'Desarquivar roteiro',
      confirmar: 'Desarquivar',
      corpo: `"${nome}" volta para a lista principal e pode ser usado em campanhas novas de novo.`,
      aviso: null,
    }
  }
  return {
    titulo: 'Arquivar roteiro',
    confirmar: 'Arquivar',
    corpo: `"${nome}" sai da lista principal e passa a viver na secao Arquivados. Nada e apagado: versoes, etapas e o historico de ligacoes continuam intactos, e voce pode desarquivar quando quiser.`,
    aviso: usando > 0
      ? `${usando} campanha(s) ja usam este roteiro. Elas continuam funcionando normalmente — o arquivamento so impede que ele seja escolhido em campanha NOVA.`
      : 'Enquanto estiver arquivado, ele nao pode ser escolhido em campanha nova.',
  }
}

module.exports = {
  statusDoRoteiro,
  rotuloStatusRoteiro,
  fraseStatusRoteiro,
  rotuloStatusVersao,
  fraseStatusVersao,
  rotuloNicho,
  montarListaRoteiros,
  versaoInicial,
  acoesDoRoteiro,
  textoConfirmacao,
}
