'use strict'
// Apresentação de Contas da empresa (CRM em equipe, Etapa 2). Módulo puro, sem React e sem rede.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const {
  rotuloPapel, descricaoPapel, rotuloCapacidade, avisoCapacidade, temCapacidade,
  concessoesDoFormulario, corpoPermissoes, situacaoMembro, ultimoAcesso, acoesDoMembro,
  CAPACIDADE_ROTULO, GRUPOS, grupoDaCapacidade, agruparConcessoes, resumoDoPapel, extrasDoMembro,
} = require('./capacidades')

test('rotuloPapel traduz os 4 papeis e devolve o slug quando nao conhece', () => {
  assert.equal(rotuloPapel('owner'), 'Dono')
  assert.equal(rotuloPapel('comercial'), 'Comercial')
  assert.equal(rotuloPapel('papel_novo_do_servidor'), 'papel_novo_do_servidor')
  assert.equal(rotuloPapel(null), '—')
})

test('descricaoPapel nao inventa frase para papel desconhecido', () => {
  assert.ok(descricaoPapel('comercial').length > 10)
  assert.equal(descricaoPapel('papel_novo'), '')
})

test('rotuloCapacidade devolve o slug quando o front ainda nao batizou a capacidade', () => {
  // Uma capacidade nova no servidor NAO pode desaparecer da tela de permissoes.
  assert.equal(rotuloCapacidade('lead_triar'), 'Aprovar e descartar leads')
  assert.equal(rotuloCapacidade('capacidade_futura'), 'capacidade_futura')
  assert.equal(rotuloCapacidade(null), '')
})

test('avisoCapacidade existe para o que tem efeito externo e e null para o resto', () => {
  assert.ok(/IA/.test(avisoCapacidade('conversa_gerenciar_ia')))
  assert.ok(/irrevers/i.test(avisoCapacidade('conversa_apagar_historico')))
  assert.equal(avisoCapacidade('roteiro_ler'), null)
  assert.equal(avisoCapacidade('capacidade_futura'), null)
})

test('temCapacidade consulta a lista do servidor e NUNCA assume por padrao', () => {
  assert.equal(temCapacidade(['membros_gerenciar'], 'membros_gerenciar'), true)
  assert.equal(temCapacidade(['ligacao_operar'], 'membros_gerenciar'), false)
  // Sessao ainda carregando: esconder e' o certo; assumir mostraria um botao que da 403.
  assert.equal(temCapacidade(null, 'membros_gerenciar'), false)
  assert.equal(temCapacidade(undefined, 'membros_gerenciar'), false)
  assert.equal(temCapacidade('membros_gerenciar', 'membros_gerenciar'), false)
})

test('concessoesDoFormulario marca o que ja esta concedido e ordena por rotulo', () => {
  const r = concessoesDoFormulario(
    ['relatorios_ver', 'conversa_gerenciar_ia', 'agenda_ver_equipe'],
    { conversa_gerenciar_ia: true }
  )
  // A ordem e' por ROTULO em pt-BR, nao por slug: "Ligar e desligar a IA" < "Ver a agenda da
  // equipe" < "Ver relatorios da empresa". Ordenar pelo slug faria a lista parecer aleatoria
  // para quem le a tela.
  assert.deepEqual(r.map((x) => x.capacidade), ['conversa_gerenciar_ia', 'agenda_ver_equipe', 'relatorios_ver'])
  assert.deepEqual(r.map((x) => x.rotulo), ['Ligar e desligar a IA', 'Ver a agenda da equipe', 'Ver relatórios da empresa'])
  assert.equal(r.find((x) => x.capacidade === 'conversa_gerenciar_ia').marcada, true)
  assert.equal(r.find((x) => x.capacidade === 'relatorios_ver').marcada, false)
  assert.ok(r.find((x) => x.capacidade === 'conversa_gerenciar_ia').aviso)
})

test('concessoesDoFormulario ignora valor que nao e true nas ja concedidas', () => {
  const r = concessoesDoFormulario(['relatorios_ver'], { relatorios_ver: 'true' })
  assert.equal(r[0].marcada, false)
})

test('concessoesDoFormulario aguenta entrada ausente', () => {
  assert.deepEqual(concessoesDoFormulario(null, null), [])
  assert.deepEqual(concessoesDoFormulario(undefined, {}), [])
})

test('corpoPermissoes e SOMENTE ADITIVO: desmarcada e omitida, nunca false', () => {
  // Mandar `false` e' recusado com 400 pela rota — negar nao existe neste modelo.
  assert.deepEqual(corpoPermissoes(['a', 'b']), { a: true, b: true })
  assert.deepEqual(corpoPermissoes([]), {})
  assert.deepEqual(corpoPermissoes(null), {})
  const r = corpoPermissoes(['x'])
  assert.ok(!Object.values(r).includes(false))
})

test('situacaoMembro distingue vinculo revogado de conta desativada', () => {
  assert.equal(situacaoMembro({ ativo: true, usuario_ativo: true }).ativo, true)
  const semAcesso = situacaoMembro({ ativo: false, usuario_ativo: true })
  assert.equal(semAcesso.ativo, false)
  assert.ok(/esta empresa/.test(semAcesso.detalhe))
  // Conta desativada na plataforma tem precedencia: mostrar "ativo" mandaria o admin procurar o
  // problema no lugar errado.
  const contaMorta = situacaoMembro({ ativo: true, usuario_ativo: false })
  assert.equal(contaMorta.ativo, false)
  assert.ok(/plataforma/.test(contaMorta.detalhe))
})

test('ultimoAcesso nunca inventa data', () => {
  const agora = new Date('2026-09-11T12:00:00Z')
  assert.equal(ultimoAcesso(null, agora), 'nunca acessou')
  assert.equal(ultimoAcesso('', agora), 'nunca acessou')
  assert.equal(ultimoAcesso('nao-e-data', agora), 'nunca acessou')
  assert.equal(ultimoAcesso('2026-09-11T08:00:00Z', agora), 'hoje')
  assert.equal(ultimoAcesso('2026-09-10T08:00:00Z', agora), 'ontem')
  assert.equal(ultimoAcesso('2026-09-01T12:00:00Z', agora), 'há 10 dias')
  assert.equal(ultimoAcesso('2026-08-01T12:00:00Z', agora), 'há 1 mês')
  assert.equal(ultimoAcesso('2026-05-01T12:00:00Z', agora), 'há 4 meses')
})

test('acoesDoMembro repete as duas proibicoes do backend COM motivo', () => {
  // Esconder o controle sem dizer por que faz o operador achar que a tela quebrou.
  const proprio = acoesDoMembro({ usuario_id: 'u1', role: 'admin' }, 'u1')
  assert.equal(proprio.podeEditar, false)
  assert.ok(/próprio/.test(proprio.motivo))

  const dono = acoesDoMembro({ usuario_id: 'u2', role: 'owner' }, 'u1')
  assert.equal(dono.podeEditar, false)
  assert.ok(/dono/i.test(dono.motivo))

  const normal = acoesDoMembro({ usuario_id: 'u2', role: 'comercial' }, 'u1')
  assert.equal(normal.podeEditar, true)
  assert.equal(normal.motivo, '')
})

// ─── Guarda de regressao ────────────────────────────────────────────────────────────────────

test('GUARDA: o front NAO tem a matriz papel x capacidade', () => {
  // A regra de acesso vive no backend (services/acesso-capacidades.js). Uma copia aqui faria a
  // tela e o servidor divergirem em silencio, e a divergencia apareceria como "o botao estava la
  // e deu 403". Este modulo pode ter ROTULOS, nunca a decisao.
  // Sem comentario: o proprio cabecalho CITA os nomes proibidos ao declarar que nao os usa.
  // Sem tirar comentario, a guarda acusaria a documentacao dela mesma.
  const src = fs.readFileSync(path.join(__dirname, 'capacidades.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
  for (const proibido of ['MATRIZ', 'podeCapacidade', 'avaliarCapacidade', 'concedeveisPara']) {
    assert.ok(!src.includes(proibido),
      `lib/capacidades.js nao pode conter '${proibido}' — a decisao e do backend`)
  }
  // Os rotulos sao tradução, não regra: nenhum papel pode aparecer associado a uma lista de
  // capacidades neste arquivo.
  assert.ok(!/owner:\s*\[/.test(src) && !/comercial:\s*\[/.test(src),
    'nao declare listas de capacidades por papel no front')
})

test('GUARDA: todo rotulo de capacidade tem texto proprio (nenhum vazio)', () => {
  for (const [slug, rotulo] of Object.entries(CAPACIDADE_ROTULO)) {
    assert.ok(rotulo && rotulo.trim().length > 3, `rotulo vazio/curto para ${slug}`)
    assert.notEqual(rotulo, slug, `${slug} nao foi traduzido`)
  }
})

// ─── Agrupamento por area (a tela deixou de ser 18 caixas iguais) ───────────────────────────

test('capacidade DESCONHECIDA cai em "outras" e nunca some da tela', () => {
  // Mesma disciplina do rotulo: uma capacidade nova no servidor nao pode desaparecer da tela de
  // permissoes so porque este modulo ainda nao sabe onde ela mora.
  assert.equal(grupoDaCapacidade('capacidade_que_o_servidor_acabou_de_criar'), 'outras')
  assert.equal(grupoDaCapacidade(null), 'outras')
  assert.equal(grupoDaCapacidade('conversa_gerenciar_ia'), 'conversas')
})

test('agruparConcessoes preserva TODOS os itens e respeita a ordem dos grupos', () => {
  const itens = concessoesDoFormulario(
    ['conversa_gerenciar_ia', 'lead_triar', 'relatorios_ver', 'slug_novo'], {}
  )
  const grupos = agruparConcessoes(itens)
  const total = grupos.reduce((n, g) => n + g.itens.length, 0)
  assert.equal(total, itens.length, 'nenhum item pode ser descartado no agrupamento')
  // A ordem segue GRUPOS, nao a ordem de chegada.
  assert.deepEqual(grupos.map((g) => g.id), ['leads', 'conversas', 'gestao', 'outras'])
})

test('grupo vazio e omitido — cabecalho sem nada embaixo e ruido', () => {
  const grupos = agruparConcessoes(concessoesDoFormulario(['lead_triar'], {}))
  assert.equal(grupos.length, 1)
  assert.equal(grupos[0].id, 'leads')
})

test('agruparConcessoes aguenta entrada vazia e invalida', () => {
  assert.deepEqual(agruparConcessoes(null), [])
  assert.deepEqual(agruparConcessoes([]), [])
})

// ─── O que o papel JA da ────────────────────────────────────────────────────────────────────

test('resumoDoPapel traduz a lista que o backend mandou, agrupada e ordenada', () => {
  // Sem esta lista o formulario mostra caixas desmarcadas e nenhuma linha de base: o operador
  // nao sabe se falta a permissao ou se o papel ja da.
  const r = resumoDoPapel(['conversa_atender', 'lead_assumir', 'lead_abordar_manual'])
  assert.deepEqual(r.map((g) => g.id), ['leads', 'conversas'])
  // Ordem alfabetica DENTRO do grupo, para a lista nao dancar entre papeis.
  assert.deepEqual(r[0].itens.map((i) => i.rotulo),
    ['Abordar pelo WhatsApp (manual)', 'Assumir lead livre'])
  assert.equal(r[1].itens[0].rotulo, 'Atender conversas')
})

test('resumoDoPapel com lista vazia nao inventa grupo', () => {
  assert.deepEqual(resumoDoPapel([]), [])
  assert.deepEqual(resumoDoPapel(undefined), [])
})

// ─── Liberacoes extras na tabela ────────────────────────────────────────────────────────────

test('extrasDoMembro diz QUAIS sao, nao quantas', () => {
  // Uma contagem obriga o admin a abrir o editor para saber o que foram — e "quais" e justamente
  // a pergunta que a coluna existe para responder.
  const e = extrasDoMembro({ permissoes: { conversa_gerenciar_ia: true, lead_triar: true } })
  assert.deepEqual(e.map((x) => x.rotulo), ['Aprovar e descartar leads', 'Ligar e desligar a IA'])
  // O aviso viaja junto: e o que distingue uma liberacao comum de uma que fala com o cliente.
  assert.match(e[1].aviso, /IA passa a poder responder/)
  assert.equal(e[0].aviso, null)
})

test('extrasDoMembro ignora chave que nao seja TRUE', () => {
  // Somente aditivo: `false` nunca deveria existir na coluna, e se existir nao e uma liberacao.
  const e = extrasDoMembro({ permissoes: { lead_triar: false, relatorios_ver: true } })
  assert.deepEqual(e.map((x) => x.capacidade), ['relatorios_ver'])
  assert.deepEqual(extrasDoMembro({}), [])
  assert.deepEqual(extrasDoMembro(null), [])
})

test('GUARDA: os grupos sao de AREA, nunca de severidade', () => {
  // Severidade ja e dita pelo aviso de cada capacidade, que fala da consequencia. Um grupo
  // "perigosas" viraria um rotulo de prateleira e esvaziaria o aviso.
  const ids = GRUPOS.map((g) => g.id).join(' ')
  for (const proibido of ['perigos', 'critic', 'sensiv', 'risco']) {
    assert.ok(!ids.includes(proibido), `grupo por severidade (${proibido}) nao e o recorte desta tela`)
  }
  // "outras" precisa existir: e o destino de uma capacidade nova ainda sem casa.
  assert.ok(GRUPOS.some((g) => g.id === 'outras'))
})
