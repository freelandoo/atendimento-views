'use strict'
// Contexto do roteiro PUBLICADO para analise por IA EXTERNA (copiar -> colar na mao).
//
// Modulo PURO: recebe o que a tela de Roteiros ja carregou e devolve o objeto/JSON.
// NAO faz fetch, NAO chama provedor de IA, NAO grava nada e NAO conhece clipboard —
// a copia (DOM) fica na tela (frontend/app/dashboard/roteiros/page.tsx).
//
// Regras de conteudo:
//  - so entram campos REAIS de app.roteiros / roteiro_versoes / roteiro_etapas
//    (migration 033). Campo sem dado vira null / [] — nada e' inventado;
//  - NAO exporta identificadores internos (empresa_id, roteiro_id, versao_id) nem
//    qualquer dado de lead/credencial: o roteiro e' texto autoral da empresa;
//  - so a versao 'publicada' pode ser exportada (fonte de verdade unica).

/** @typedef {{ objecao: string, resposta: string }} Objecao */
/** @typedef {{ ordem?: number, tipo: string, titulo?: string, objetivo?: string, frase_sugerida?: string, perguntas?: string[], sinais_interesse?: string[], sinais_resistencia?: string[], objecoes?: Objecao[] }} Etapa */

// Instrucao que acompanha o JSON (o pedido feito a IA externa).
const INSTRUCAO_ANALISE =
  'Analise este roteiro e sugira melhorias práticas. Preserve o objetivo, o público-alvo, ' +
  'as restrições e a estrutura essencial. Não invente preços, promessas quantitativas ou ' +
  'integrações inexistentes.'

// Disposicoes possiveis de uma ligacao. ESPELHA LIGACAO_RESULTADO de
// backend/src/domain-enums.js (CHECK ligacoes_resultado_chk, migration 040) — a mesma
// lista ja aparece na Central de Ligacoes. Mudou la? Mude aqui (o teste trava a lista).
const RESULTADOS_POSSIVEIS_LIGACAO = Object.freeze([
  'atendeu', 'nao_atendeu', 'caixa_postal', 'ocupado', 'numero_invalido', 'reagendou',
])

// Regras de conducao que NAO vem do texto do roteiro: sao fatos do proprio produto
// (como o roteiro e' executado na ligacao). Ficam fixas para nao virar suposicao da IA.
const PRINCIPIOS_DE_CONDUCAO = Object.freeze([
  'As etapas são conduzidas na ordem apresentada em "etapas_na_ordem".',
  'As perguntas de diagnóstico são marcadas como feitas durante a ligação, por etapa.',
  'Sinais de interesse/resistência e objeções são registrados na etapa em que aparecem.',
  'A versão publicada é imutável: qualquer melhoria vira uma NOVA versão do roteiro.',
])

function texto(v) {
  const s = v == null ? '' : String(v).trim()
  return s ? s : null
}

function lista(v) {
  if (!Array.isArray(v)) return []
  return v.map((x) => texto(x)).filter((x) => x !== null)
}

function objecoes(v) {
  if (!Array.isArray(v)) return []
  return v
    .map((o) => ({ objecao: texto(o && o.objecao), resposta: texto(o && o.resposta) }))
    .filter((o) => o.objecao !== null || o.resposta !== null)
}

/** So a versao PUBLICADA pode virar contexto de analise. */
function podeExportarContextoIA(versao) {
  return !!versao && versao.status === 'publicada'
}

/**
 * Monta o objeto de contexto a partir do que a tela exibe.
 * `etapas` deve chegar na ORDEM EXIBIDA — a posicao no JSON e' o indice do array,
 * nao o campo `ordem` do banco (assim o JSON nunca discorda da tela).
 *
 * @param {{ roteiro: { nome?: string, descricao?: string|null, nicho?: string|null },
 *           versao: { versao: number, status: string, publicada_em?: string|null },
 *           etapas?: Etapa[], tiposDeEtapaPermitidos?: string[] }} entrada
 */
function montarContextoIA({ roteiro, versao, etapas, tiposDeEtapaPermitidos } = {}) {
  if (!roteiro || !versao) throw new Error('Roteiro e versao sao obrigatorios.')
  if (!podeExportarContextoIA(versao)) {
    throw new Error('So a versao publicada pode ser exportada para analise.')
  }

  const passos = (Array.isArray(etapas) ? etapas : []).map((e, i) => ({
    etapa: e || {},
    posicao: i + 1,
  }))

  const tipos = lista(tiposDeEtapaPermitidos)
  const restricoes = [
    'Não invente preços, promessas quantitativas ou integrações inexistentes.',
    'Preserve o objetivo, o público-alvo e a estrutura essencial do roteiro.',
    'A versão publicada é imutável: melhorias precisam virar uma nova versão.',
  ]
  if (tipos.length > 0) {
    restricoes.push(`Use apenas os tipos de etapa existentes no produto: ${tipos.join(', ')}.`)
  }

  return {
    instrucao_de_analise: INSTRUCAO_ANALISE,
    nome_do_roteiro: texto(roteiro.nome),
    versao: versao.versao,
    status_publicada: true,
    publicada_em: texto(versao.publicada_em),
    objetivo: texto(roteiro.descricao),
    publico_alvo: texto(roteiro.nicho),
    restricoes,
    resultados_possiveis_da_ligacao: [...RESULTADOS_POSSIVEIS_LIGACAO],
    etapas_na_ordem: passos.map(({ etapa, posicao }) => ({
      posicao,
      tipo: texto(etapa.tipo),
      titulo: texto(etapa.titulo),
    })),
    falas_e_instrucoes_por_etapa: passos.map(({ etapa, posicao }) => ({
      posicao,
      tipo: texto(etapa.tipo),
      objetivo_da_etapa: texto(etapa.objetivo),
      frase_sugerida: texto(etapa.frase_sugerida),
    })),
    perguntas_de_diagnostico: passos.map(({ etapa, posicao }) => ({
      posicao,
      tipo: texto(etapa.tipo),
      perguntas: lista(etapa.perguntas),
    })),
    regras_de_conducao: {
      principios: [...PRINCIPIOS_DE_CONDUCAO],
      por_etapa: passos.map(({ etapa, posicao }) => ({
        posicao,
        tipo: texto(etapa.tipo),
        sinais_de_interesse: lista(etapa.sinais_interesse),
        sinais_de_resistencia: lista(etapa.sinais_resistencia),
        objecoes_e_respostas: objecoes(etapa.objecoes),
      })),
    },
  }
}

/** JSON legivel (indentado) pronto para colar numa IA externa. */
function serializarContextoIA(entrada) {
  return JSON.stringify(montarContextoIA(entrada), null, 2)
}

module.exports = {
  INSTRUCAO_ANALISE,
  RESULTADOS_POSSIVEIS_LIGACAO,
  PRINCIPIOS_DE_CONDUCAO,
  podeExportarContextoIA,
  montarContextoIA,
  serializarContextoIA,
}
