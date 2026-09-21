// Apresentacao do painel do Banco de Leads — modulo PURO (sem React, rede ou DOM).
//
// O QUE ELE FAZ: traduz o que a API ja resolveu (o resumo por aba, as capacidades ja
// avaliadas pelo backend) para o que a tela desenha — os cartoes do funil, os itens do menu
// "Mais acoes" e a validacao do pedido de exportacao.
//
// O QUE ELE NAO FAZ, DE PROPOSITO: nao decide permissao (quem decide e'
// services/acesso-capacidades.js, e a tela recebe o veredito pronto em `capacidades`), nao
// conta lead, nao filtra e nao sabe o que e' um lead. Mesmo contrato de `lib/site-rotulos.js`
// e `lib/capacidades.js`.

/**
 * Os cartoes do funil. Sao o MESMO seletor de aba que existia como pilulas — o cartao mostra
 * o numero e a participacao daquele estagio na carteira, que a pilula nao dizia.
 *
 * A porcentagem e' sobre o TOTAL DAS ABAS, nao sobre a carteira inteira: e' a unica conta que
 * fecha com os numeros que estao na propria tela. Sem total, `percentual` e' `null` — nunca 0,
 * porque "0%" afirmaria que o estagio esta vazio quando ninguem contou ainda.
 */
export function cartoesDeFunil(abas, resumo) {
  const lista = Array.isArray(abas) ? abas : []
  const contagem = (resumo && resumo.abas) || null
  const total = contagem
    ? lista.reduce((s, a) => s + (Number(contagem[a.valor]) || 0), 0)
    : 0
  return lista.map((a) => {
    const valorAba = contagem ? Number(contagem[a.valor]) || 0 : null
    return {
      valor: a.valor,
      label: a.label,
      total: valorAba,
      percentual: contagem && total > 0 ? Math.round((valorAba / total) * 100) : null,
      tom: TOM_POR_ABA[a.valor] || 'neutro',
    }
  })
}

// Tom de cada estagio. Cor e' REFORCO: o rotulo do cartao ("Fecharam", "Descartados") continua
// dizendo o que e', e a selecao tambem e' anunciada por `aria-pressed`, nunca so pela cor.
const TOM_POR_ABA = {
  sem_contato: 'info',
  conversou: 'ok',
  agendados: 'brand',
  fecharam: 'ok',
  descartados: 'danger',
}

/**
 * O menu "Mais acoes" do cabecalho. Guarda a regra do guia visual: **controle que a pessoa nao
 * pode usar e nao tem decisao de produto a explicar simplesmente nao e' renderizado** — botao
 * inerte so convida ao clique. Quem nao tem nenhuma das duas capacidades nao recebe o menu.
 *
 * As duas acoes moraram no cabecalho como botoes soltos. Sao secundarias (uma exporta, a outra
 * apaga) e disputavam espaco com "Adicionar cadastro", que e' a acao primaria da tela.
 */
export function itensMaisAcoes({ podeExportar = false, podeLimpar = false } = {}) {
  const itens = []
  if (podeExportar) itens.push({ chave: 'exportar', rotulo: 'Exportar CSV', tom: 'neutro' })
  if (podeLimpar) itens.push({ chave: 'limpar', rotulo: 'Limpar leads', tom: 'perigo' })
  return itens
}

/**
 * As colunas que o CSV sabe exportar. As CHAVES espelham o catalogo fechado do backend
 * (`services/banco-leads-export.js`), que e' a autoridade: aqui ficam so os rotulos da tela.
 * Chave que o backend nao conhecer e' ignorada la — nunca vira coluna inventada.
 */
export const COLUNAS_CSV = [
  { chave: 'nome', rotulo: 'Nome' },
  { chave: 'telefone', rotulo: 'Telefone' },
  { chave: 'email', rotulo: 'E-mail' },
  { chave: 'cidade', rotulo: 'Cidade' },
  { chave: 'nicho', rotulo: 'Nicho / Categoria' },
  { chave: 'status', rotulo: 'Status' },
  { chave: 'origem', rotulo: 'Origem' },
  { chave: 'instagram', rotulo: 'Instagram' },
  { chave: 'site', rotulo: 'Site' },
  { chave: 'seguidores', rotulo: 'Seguidores' },
  { chave: 'criado_em', rotulo: 'Data de entrada' },
  { chave: 'atualizado_em', rotulo: 'Última atualização' },
]

export const COLUNAS_CSV_PADRAO = COLUNAS_CSV.map((c) => c.chave)

/**
 * Valida o pedido de exportacao e devolve o nome de arquivo ja saneado.
 *
 * Decisoes que sao contrato:
 *   • Selecao VAZIA e' recusada aqui, na tela, com motivo — o backend cairia no catalogo
 *     inteiro (o que e' o certo para um pedido malformado) e a pessoa receberia um arquivo
 *     que nao foi o que ela pediu.
 *   • O nome do arquivo e' saneado, nunca confiado: barra, contrabarra e dois-pontos saem, e
 *     `.csv` e' garantido uma vez so. Nome vazio cai no padrao.
 *   • A ORDEM das colunas nao e' enviada: quem ordena e' o catalogo do servidor. Duas
 *     exportacoes com as mesmas colunas tem de sair iguais.
 */
export function validarExportacao({ colunas, nomeArquivo, padrao = 'banco-leads' } = {}) {
  const escolhidas = (Array.isArray(colunas) ? colunas : [])
    .map((c) => String(c || '').trim())
    .filter(Boolean)
  if (!escolhidas.length) {
    return { ok: false, motivo: 'Escolha pelo menos uma coluna para exportar.', nome: '', colunas: [] }
  }
  const base = String(nomeArquivo || '')
    .replace(/\.csv$/i, '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  return {
    ok: true,
    motivo: '',
    nome: `${base || padrao}.csv`,
    colunas: escolhidas,
  }
}

/**
 * O que a limpeza REALMENTE faz hoje, em texto. Vive aqui porque e' a frase que impede a tela
 * de prometer mais do que o backend executa: `POST /limpar` apaga apenas os leads **sem e-mail
 * e sem telefone**, preservando negocio fechado. Nao existe exclusao em massa por filtro ou
 * por selecao, e a tela nao pode sugerir que exista.
 */
export const LIMPEZA = Object.freeze({
  titulo: 'Limpar leads sem contato',
  corpo: 'Remove os leads que não têm e-mail nem telefone — os que não dá para abordar por '
    + 'nenhum canal. Leads com qualquer forma de contato e negócios fechados são preservados.',
  aviso: 'A ação é irreversível. Ela não usa os filtros nem a seleção da tabela: vale para '
    + 'toda a carteira desta empresa.',
  rotuloConfirmar: 'Limpar leads sem contato',
})
