'use strict'
// ORIGEM do lead — APRESENTAÇÃO PURA.
//
// Quem SABE a origem é o backend: ela está gravada em `prospects.origem` por quem coletou o
// lead, e o vocabulário tem dono em `backend/src/services/lead-origem.js` (travado contra a
// CHECK da migration 091). Aqui só se traduz o veredito — mesma regra de ouro de
// `lib/site-rotulos.js`, `lib/capacidades.js` e `lib/lead-fila-trabalho.js`.
//
// O DEFEITO QUE ESTE MÓDULO EXISTE PARA FECHAR: a tela dividia a carteira em duas tabelas com
// `ORIGENS_PLACES.has(origem)`, e o `else` — **todo o resto** — era renderizado sob um título
// fixo "Instagram". Lead vindo de anúncio (`origem='meta_ads'`, migration 091) aparecia para o
// operador como se tivesse vindo do Instagram. A correção não é escolher outro `else`: é a
// origem passar a ser um DADO da linha, traduzido por lista fechada, com o desconhecido
// aparecendo como ele mesmo em vez de virar a fonte errada.
//
// PROIBIDO deduzir origem aqui (olhar `instagram_handle`, `place_id`, `site`, `link_original`).
// Deduzir procedência a partir de um campo preenchido é o mesmo erro que `site-classificacao.js`
// existe para não cometer com link. Há guarda de regressão em `lead-origem.test.js`.
//
// Sem React, sem rede, sem DOM: testável com `node --test`.

/**
 * O que o seletor de origem oferece. FECHADA de propósito: só entram aqui as fontes que
 * realmente alimentam a carteira hoje. `linkedin` NÃO tem opção — o motor existe, mas nenhuma
 * coleta o usa, e um filtro que devolve zero sempre treina o operador a desconfiar do filtro.
 * Ele continua sendo ROTULADO corretamente quando aparece numa linha (ver `rotuloOrigem`).
 *
 * O primeiro item é o padrão do servidor (sem filtro) e precisa existir na lista: um `<select>`
 * cujo valor inicial não corresponde a opção nenhuma exibe uma coisa enquanto consulta outra, e
 * não dá como voltar ao padrão depois de filtrar.
 */
const OPCOES_FILTRO_ORIGEM = [
  { valor: '', label: 'Todas as origens' },
  { valor: 'places', label: 'Google Places' },
  { valor: 'instagram', label: 'Instagram' },
  { valor: 'meta_ads', label: 'Anúncios Meta' },
]

// Rótulos por origem. `curto` é o que cabe na célula da tabela; `rotulo` é o nome completo, que
// vai para o `title` e para o nome acessível — a sigla sozinha não diz de onde o lead veio.
const ROTULOS = {
  manual: { chave: 'places', rotulo: 'Google Places', curto: 'Places', dica: 'Entrou pela ficha do Google Maps (cadastro manual).' },
  automatico: { chave: 'places', rotulo: 'Google Places', curto: 'Places', dica: 'Encontrado pela busca no Google Maps.' },
  instagram: { chave: 'instagram', rotulo: 'Instagram', curto: 'Instagram', dica: 'Encontrado pela captação de perfis do Instagram.' },
  linkedin: { chave: 'linkedin', rotulo: 'LinkedIn', curto: 'LinkedIn', dica: 'Encontrado pela captação de perfis do LinkedIn.' },
  meta_ads: { chave: 'meta_ads', rotulo: 'Anúncios Meta', curto: 'Meta', dica: 'Estava anunciando na Biblioteca de Anúncios do Meta.' },
}

/**
 * Traduz a origem gravada no lead. Origem desconhecida volta **como ela mesma**, nunca como
 * outra fonte e nunca escondida: uma origem nova no servidor não pode desaparecer da tela
 * (mesma disciplina de `lib/capacidades.js` com capacidade desconhecida).
 */
function rotuloOrigem(origem) {
  const v = String(origem || '').trim().toLowerCase()
  if (!v) return { chave: 'desconhecida', rotulo: 'Origem não informada', curto: '—', dica: 'Este lead não registrou por onde entrou na carteira.' }
  const r = ROTULOS[v]
  if (r) return { ...r }
  return { chave: 'desconhecida', rotulo: `Origem: ${v}`, curto: v, dica: 'Origem ainda sem rótulo nesta tela.' }
}

/**
 * Classes da pílula de origem. Tom NEUTRO de propósito, e as quatro fontes usam o MESMO tom:
 * origem não é qualidade, não é prioridade e não é estado. Pintar cada fonte de uma cor faria a
 * linha sugerir que uma delas é melhor que a outra — e o operador já tem três pontuações
 * disputando significado nessa mesma linha (ICP, cadastro e prioridade).
 */
const CLASSE_PILULA = 'inline-flex items-center gap-1 rounded-md border border-line bg-surface-3 px-1.5 py-0.5 text-[11px] font-medium text-ink-2'

/**
 * O que a coluna Origem mostra na linha. `detalhe` é a evidência mais identificadora daquela
 * fonte — o @ no Instagram —, e vem SEMPRE do campo que o backend já mandou. Ele não é lido
 * para decidir a origem: só é exibido depois que a origem já foi decidida pelo servidor.
 */
function celulaOrigem(lead) {
  const l = lead || {}
  const base = rotuloOrigem(l.origem)
  const handle = String(l.instagram_handle || '').replace(/^@/, '').trim()
  const detalhe = base.chave === 'instagram' && handle ? `@${handle}` : null
  return { ...base, detalhe, classe: CLASSE_PILULA }
}

/** Rótulo do filtro em vigor, para a tela DECLARAR o recorte em vez de recortar em silêncio. */
function rotuloFiltroOrigem(valor) {
  const v = String(valor || '').trim().toLowerCase()
  if (!v) return null
  const opcao = OPCOES_FILTRO_ORIGEM.find((o) => o.valor === v)
  if (opcao) return opcao.label
  // Alias legado (`social`) e origem isolada que não está no seletor continuam chegando por
  // link salvo e por filtro guardado em sessão — e precisam ter nome.
  if (v === 'social') return 'Instagram e LinkedIn'
  return rotuloOrigem(v).rotulo
}

module.exports = { OPCOES_FILTRO_ORIGEM, rotuloOrigem, celulaOrigem, rotuloFiltroOrigem, CLASSE_PILULA }
