'use strict'
// Fluxo guiado de entrada do Assistente de Oportunidades — LÓGICA PURA.
//
// O botão premium "Analisar oportunidades" abre um menu curto ("O que você quer fazer
// agora?"). Daí saem dois caminhos:
//   revisar  → a sessão de análise de sempre (aprovar/descartar, uma por vez);
//   buscar   → uma nova coleta guiada, perguntando só o que a pessoa quer mudar.
//
// Este módulo decide os passos, os campos e a validação. Ele NÃO conhece rede, React nem
// banco — por isso é testável com `node --test` (mesmo padrão de ligacao-estado.js).
//
// Regra que o módulo protege: a busca guiada só monta o mercado a ser buscado. Ela nunca
// abre, encerra ou retargeta uma sessão — quem faz isso é o passo "revisar".

/** @typedef {'escolha'|'o_que_mudar'|'campos'|'iniciada'} PassoEntrada */
/** @typedef {'nicho'|'localidade'|'ambos'} AjusteBusca */

const PASSOS = ['escolha', 'o_que_mudar', 'campos', 'iniciada']

// As três opções de mudança, na ordem em que aparecem. `campos` é o que cada uma abre.
const OPCOES_AJUSTE = [
  { id: 'nicho', label: 'Alterar nicho', descricao: 'Mesma cidade, outro tipo de negócio.', campos: ['nicho'] },
  { id: 'localidade', label: 'Alterar localidade', descricao: 'Mesmo nicho, outra cidade.', campos: ['cidade', 'uf'] },
  { id: 'ambos', label: 'Alterar nicho e localidade', descricao: 'Um mercado totalmente novo.', campos: ['nicho', 'cidade', 'uf'] },
]

function texto(valor) {
  return String(valor == null ? '' : valor).trim()
}

/** UF sempre em duas letras maiúsculas; qualquer outra coisa vira vazio. */
function normalizarUf(valor) {
  const t = texto(valor).toUpperCase()
  return /^[A-Z]{2}$/.test(t) ? t : ''
}

/** Mercado no formato que a Busca avulsa usa, já limpo. */
function normalizarMercado(mercado = {}) {
  return {
    nicho: texto(mercado.nicho),
    cidade: texto(mercado.cidade),
    uf: normalizarUf(mercado.uf),
  }
}

/**
 * Quais campos o passo "campos" mostra.
 *
 * São os campos escolhidos MAIS os que já estão vazios no contexto atual: pedir "só o
 * nicho" quando a cidade nunca foi preenchida levaria a pessoa a um beco sem saída na
 * validação. UF continua opcional e só entra quando a localidade está em jogo.
 */
function camposVisiveis(ajuste, base = {}) {
  const opcao = OPCOES_AJUSTE.find((o) => o.id === ajuste)
  if (!opcao) return []
  const atual = normalizarMercado(base)
  const campos = new Set(opcao.campos)
  if (!atual.nicho) campos.add('nicho')
  if (!atual.cidade) { campos.add('cidade'); campos.add('uf') }
  return ['nicho', 'cidade', 'uf'].filter((c) => campos.has(c))
}

/**
 * Mercado que será buscado: o contexto atual com as alterações por cima. Campo não
 * editado neste ajuste é PRESERVADO — é assim que "manter o contexto" vira garantia.
 */
function mercadoResultante(base = {}, alteracoes = {}, ajuste = 'ambos') {
  const atual = normalizarMercado(base)
  const novo = normalizarMercado(alteracoes)
  const visiveis = camposVisiveis(ajuste, base)
  return {
    nicho: visiveis.includes('nicho') ? novo.nicho : atual.nicho,
    cidade: visiveis.includes('cidade') ? novo.cidade : atual.cidade,
    uf: visiveis.includes('uf') ? novo.uf : atual.uf,
  }
}

/**
 * Valida o mercado montado. Devolve `null` quando pode buscar, ou a frase a mostrar.
 * Espelha a exigência do backend (`POST /prospeccao/buscar` exige nicho e cidade).
 */
function validarMercado(mercado = {}) {
  const m = normalizarMercado(mercado)
  if (!m.nicho) return 'Informe o nicho que você quer buscar.'
  if (!m.cidade) return 'Informe a cidade da busca.'
  return null
}

/** O mercado mudou de fato? Repetir a mesma busca só gastaria coleta à toa. */
function mercadoMudou(base = {}, destino = {}) {
  const a = normalizarMercado(base)
  const b = normalizarMercado(destino)
  return a.nicho.toLowerCase() !== b.nicho.toLowerCase()
    || a.cidade.toLowerCase() !== b.cidade.toLowerCase()
    || a.uf !== b.uf
}

/** Rótulo humano de um mercado ("Dentista · Campinas - SP"). */
function rotuloMercado(mercado = {}, vazio = 'toda a sua carteira') {
  const m = normalizarMercado(mercado)
  if (!m.nicho && !m.cidade) return vazio
  const local = m.cidade ? `${m.cidade}${m.uf ? ` - ${m.uf}` : ''}` : ''
  return [m.nicho, local].filter(Boolean).join(' · ')
}

/**
 * O que cada opção do menu pode fazer AGORA, e por quê não, quando não pode.
 *
 * - "revisar" existe sempre: sem sessão ela abre uma; com sessão ela retoma a que está
 *   aberta (o backend devolve a existente — o rótulo avisa para não parecer perdida).
 * - "buscar" respeita a trava de uma coleta paga por empresa por vez, que é garantida no
 *   banco. Aqui a trava só é ESPELHADA, para o clique não virar um 409.
 */
function opcoesDoMenu({ sessao = null, coletaEmAndamento = false, mercadoAtual = {} } = {}) {
  const ativa = !!sessao && sessao.status === 'ativa'
  const mercadoSessao = ativa ? rotuloMercado(sessao.escopo_ampliado ? {} : sessao) : ''
  return {
    revisar: {
      disponivel: true,
      label: ativa ? 'Retomar a revisão em andamento' : 'Revisar oportunidades encontradas',
      descricao: ativa
        ? `${mercadoSessao} · ${sessao.aprovados} de ${sessao.meta} aprovados.`
        : `Um lead por vez, com o motivo de valer (ou não) a abordagem em ${rotuloMercado(mercadoAtual)}.`,
      // Verdade que a tela precisa dizer: pedir outro mercado não troca a sessão aberta.
      retomando: ativa,
    },
    buscar: {
      disponivel: !coletaEmAndamento,
      label: 'Encontrar novas oportunidades',
      descricao: coletaEmAndamento
        ? 'Já existe uma coleta em andamento. Assim que ela terminar, dá para buscar de novo.'
        : 'Uma nova busca guiada: mudo o nicho, a cidade ou os dois.',
    },
  }
}

/** Próximo passo do fluxo. Passo desconhecido volta para o começo, nunca trava. */
function proximoPasso(passo, acao) {
  if (passo === 'escolha') {
    if (acao === 'buscar') return 'o_que_mudar'
    if (acao === 'revisar') return 'revisar'
  }
  if (passo === 'o_que_mudar') {
    if (acao === 'voltar') return 'escolha'
    if (OPCOES_AJUSTE.some((o) => o.id === acao)) return 'campos'
  }
  if (passo === 'campos') {
    if (acao === 'voltar') return 'o_que_mudar'
    if (acao === 'buscou') return 'iniciada'
  }
  if (passo === 'iniciada' && acao === 'voltar') return 'escolha'
  return PASSOS.includes(passo) ? passo : 'escolha'
}

module.exports = {
  PASSOS,
  OPCOES_AJUSTE,
  normalizarUf,
  normalizarMercado,
  camposVisiveis,
  mercadoResultante,
  validarMercado,
  mercadoMudou,
  rotuloMercado,
  opcoesDoMenu,
  proximoPasso,
}
