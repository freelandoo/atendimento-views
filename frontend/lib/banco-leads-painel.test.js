import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  cartoesDeFunil, leadPermaneceNaAbaBanco, itensMaisAcoes, validarExportacao, escopoDaSelecao, faixaDeEnvio,
  COLUNAS_CSV, COLUNAS_CSV_PADRAO, LIMPEZA,
} from './banco-leads-painel.js'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const FONTE = fs.readFileSync(path.join(AQUI, 'banco-leads-painel.js'), 'utf8')
// As guardas olham o CÓDIGO, não o comentário: o arquivo explica por escrito que não decide
// permissão, e uma varredura ingênua acusaria justamente a frase que promete o contrário.
const CODIGO = FONTE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const ABAS = [
  { valor: 'sem_contato', label: 'Sem contato ainda' },
  { valor: 'conversou', label: 'Já conversou' },
  { valor: 'fecharam', label: 'Fecharam' },
  { valor: 'agendados', label: 'Agendados' },
  { valor: 'descartados', label: 'Descartados' },
]

// ─── Cartões do funil ────────────────────────────────────────────────────────

test('cartão traz total e participação no total das abas', () => {
  const cartoes = cartoesDeFunil(ABAS, { abas: { sem_contato: 60, conversou: 20, fecharam: 10, agendados: 10, descartados: 0 } })
  assert.equal(cartoes.length, 5)
  assert.equal(cartoes[0].total, 60)
  assert.equal(cartoes[0].percentual, 60)
  assert.equal(cartoes[4].total, 0)
  assert.equal(cartoes[4].percentual, 0)
})

test('sem resumo, total e percentual são NULL — "0%" afirmaria estágio vazio sem ninguém ter contado', () => {
  const [primeiro] = cartoesDeFunil(ABAS, null)
  assert.equal(primeiro.total, null)
  assert.equal(primeiro.percentual, null)
})

test('carteira zerada não divide por zero', () => {
  const cartoes = cartoesDeFunil(ABAS, { abas: {} })
  assert.equal(cartoes[0].total, 0)
  assert.equal(cartoes[0].percentual, null)
})

test('todo cartão carrega rótulo em texto — cor nunca é o único sinal', () => {
  for (const c of cartoesDeFunil(ABAS, { abas: { sem_contato: 1 } })) {
    assert.ok(c.label && c.label.trim().length > 2, `cartão sem rótulo: ${c.valor}`)
    assert.ok(c.tom)
  }
})

test('aba desconhecida não quebra e nasce neutra', () => {
  const [c] = cartoesDeFunil([{ valor: 'novissima', label: 'Nova' }], { abas: { novissima: 3 } })
  assert.equal(c.tom, 'neutro')
  assert.equal(c.percentual, 100)
})

// ─── Lead dentro da aba atual ────────────────────────────────────────────────

test('lead descartado sai imediatamente da aba sem contato', () => {
  assert.equal(leadPermaneceNaAbaBanco({ status: 'rejeitado', tem_whatsapp: true }, 'sem_contato'), false)
  assert.equal(leadPermaneceNaAbaBanco({ status: 'aprovado', tem_whatsapp: true }, 'sem_contato'), true)
})

test('aba descartados recebe rejeitados, nao contatar e leads sem WhatsApp', () => {
  assert.equal(leadPermaneceNaAbaBanco({ status: 'rejeitado', tem_whatsapp: true }, 'descartados'), true)
  assert.equal(leadPermaneceNaAbaBanco({ status: 'nao_contatar', tem_whatsapp: true }, 'descartados'), true)
  assert.equal(leadPermaneceNaAbaBanco({ status: 'coletado', tem_whatsapp: false }, 'descartados'), true)
  assert.equal(leadPermaneceNaAbaBanco({ status: 'coletado', tem_whatsapp: true }, 'descartados'), false)
})

test('aba agendados depende de agendamento futuro carregado no lead', () => {
  assert.equal(leadPermaneceNaAbaBanco({ status: 'enviado', proximo_agendamento: '2026-09-23T10:00:00.000Z' }, 'agendados'), true)
  assert.equal(leadPermaneceNaAbaBanco({ status: 'enviado', proximo_agendamento: null }, 'agendados'), false)
})

// ─── Menu "Mais ações" ───────────────────────────────────────────────────────

test('sem capacidade nenhuma, o menu não existe — botão inerte só convida ao clique', () => {
  assert.deepEqual(itensMaisAcoes({}), [])
  assert.deepEqual(itensMaisAcoes(), [])
})

test('cada capacidade traz só o seu item, e limpar é marcado como perigo', () => {
  assert.deepEqual(itensMaisAcoes({ podeExportar: true }).map((i) => i.chave), ['exportar'])
  const limpar = itensMaisAcoes({ podeLimpar: true })
  assert.deepEqual(limpar.map((i) => i.chave), ['limpar'])
  assert.equal(limpar[0].tom, 'perigo')
  assert.deepEqual(itensMaisAcoes({ podeExportar: true, podeLimpar: true }).map((i) => i.chave),
    ['exportar', 'limpar'])
})

// ─── Exportação ──────────────────────────────────────────────────────────────

test('seleção vazia é recusada COM motivo, não com botão apagado', () => {
  const r = validarExportacao({ colunas: [], nomeArquivo: 'x' })
  assert.equal(r.ok, false)
  assert.match(r.motivo, /pelo menos uma coluna/i)
  assert.deepEqual(r.colunas, [])
})

test('nome do arquivo é saneado e termina em .csv uma vez só', () => {
  assert.equal(validarExportacao({ colunas: ['nome'], nomeArquivo: 'meus leads.csv' }).nome, 'meus leads.csv')
  assert.equal(validarExportacao({ colunas: ['nome'], nomeArquivo: 'a/b\\c:d' }).nome, 'a-b-c-d.csv')
  assert.equal(validarExportacao({ colunas: ['nome'], nomeArquivo: '   ' }).nome, 'banco-leads.csv')
  assert.equal(validarExportacao({ colunas: ['nome'] }).nome, 'banco-leads.csv')
})

test('o padrão do arquivo é do chamador (a aba entra no nome)', () => {
  assert.equal(validarExportacao({ colunas: ['nome'], padrao: 'banco-leads-sem_contato' }).nome,
    'banco-leads-sem_contato.csv')
})

test('colunas em branco são descartadas antes da validação', () => {
  assert.equal(validarExportacao({ colunas: ['', '  '], nomeArquivo: 'x' }).ok, false)
  assert.deepEqual(validarExportacao({ colunas: [' nome ', 'telefone'], nomeArquivo: 'x' }).colunas,
    ['nome', 'telefone'])
})

test('o padrão de colunas é o catálogo inteiro', () => {
  assert.equal(COLUNAS_CSV_PADRAO.length, COLUNAS_CSV.length)
})

// ─── Guardas de regressão ────────────────────────────────────────────────────

test('guarda: toda coluna oferecida existe no catálogo FECHADO do backend', () => {
  const backend = fs.readFileSync(
    path.join(AQUI, '..', '..', 'backend', 'src', 'services', 'banco-leads-export.js'), 'utf8')
  for (const c of COLUNAS_CSV) {
    assert.match(backend, new RegExp(`chave: '${c.chave}'`),
      `a tela oferece a coluna "${c.chave}", que o backend não conhece — o arquivo sairia sem ela`)
  }
})

test('guarda: o módulo não decide permissão nem lê capacidade por conta própria', () => {
  assert.doesNotMatch(CODIGO, /temCapacidade|capacidades|papel|owner|'admin'|'comercial'/)
})

test('guarda: o módulo é PURO — sem React, rede ou DOM', () => {
  assert.doesNotMatch(FONTE, /\bfetch\(|useState|useEffect|document\.|window\./)
})

test('guarda: o texto da limpeza não promete exclusão por filtro ou por seleção', () => {
  const texto = `${LIMPEZA.titulo} ${LIMPEZA.corpo} ${LIMPEZA.aviso} ${LIMPEZA.rotuloConfirmar}`
  assert.match(texto, /sem e-mail e sem telefone|não têm e-mail nem telefone/i)
  assert.match(LIMPEZA.aviso, /irreversível/i)
  assert.doesNotMatch(texto, /todos os leads|leads filtrados|leads selecionados/i)
})

// ─── escopoDaSelecao ──────────────────────────────────────────────────────────
// O defeito: "Selecionar todos os filtrados" selecionava o conjunto CARREGADO. Com 300 de
// 1.240, o operador lia "todos os filtrados" e concluia que mandara gerar mensagem para 1.240.
test('escopoDaSelecao DIZ que a selecao alcanca so a janela carregada', () => {
  const e = escopoDaSelecao({ selecionados: 3, naPagina: 25, carregados: 300, totalCarteira: 1240 })
  assert.ok(e.aviso.includes('300'))
  assert.ok(e.aviso.includes('1240'))
})

test('escopoDaSelecao NAO promete a carteira inteira', () => {
  const e = escopoDaSelecao({ selecionados: 300, naPagina: 25, carregados: 300, totalCarteira: 1240 })
  const textos = [e.rotulo, e.rotuloAmpliar, e.rotuloPagina, e.aviso].join(' ').toLowerCase()
  for (const proibido of ['todos os resultados', 'toda a carteira', 'todos os filtrados']) {
    assert.ok(!textos.includes(proibido), `a barra prometeu "${proibido}" para uma selecao limitada a janela`)
  }
})

test('sem janela parcial nao ha aviso (nao se inventa ressalva)', () => {
  assert.equal(escopoDaSelecao({ selecionados: 1, naPagina: 25, carregados: 40, totalCarteira: 40 }).aviso, '')
  assert.equal(escopoDaSelecao({ selecionados: 1, naPagina: 25, carregados: 40, totalCarteira: null }).aviso, '',
    'carteira nao contada nao vira afirmacao sobre o que falta')
})

test('a barra so existe quando ha selecao, e ampliar some quando ja cobre o carregado', () => {
  assert.equal(escopoDaSelecao({ selecionados: 0, carregados: 300 }).ativo, false)
  assert.equal(escopoDaSelecao({ selecionados: 300, carregados: 300 }).podeAmpliar, false)
  assert.equal(escopoDaSelecao({ selecionados: 3, carregados: 300 }).podeAmpliar, true)
})

test('singular e plural do contador', () => {
  assert.equal(escopoDaSelecao({ selecionados: 1 }).rotulo, '1 lead selecionado')
  assert.equal(escopoDaSelecao({ selecionados: 2 }).rotulo, '2 leads selecionados')
})

test('escopoDaSelecao aguenta chamada vazia', () => {
  const e = escopoDaSelecao()
  assert.equal(e.ativo, false)
  assert.equal(e.aviso, '')
})

// ─── faixaDeEnvio ─────────────────────────────────────────────────────────────
// O painel de disparo foi recolhido. A regra que nao se negocia: o MOTIVO de o envio estar
// bloqueado nunca fica dentro do que se recolhe.
test('bloqueio vence cooldown e traz o motivo em texto', () => {
  const f = faixaDeEnvio({ motivoBloqueio: 'WhatsApp desconectado', cooldown: '04:12' })
  assert.equal(f.estado, 'bloqueado')
  assert.equal(f.detalhe, 'WhatsApp desconectado')
  assert.equal(f.tom, 'danger')
})

test('o estado sempre tem rotulo em texto — nunca so cor', () => {
  for (const entrada of [{}, { motivoBloqueio: 'x' }, { cooldown: '01:00' }, { automatico: true }]) {
    const f = faixaDeEnvio(entrada)
    assert.ok(f.rotulo && f.rotulo.trim().length > 0, 'faixa sem rotulo em texto')
    assert.ok(f.detalhe && f.detalhe.trim().length > 0, 'faixa sem explicacao em texto')
  }
})

test('cooldown aparece com o tempo restante', () => {
  const f = faixaDeEnvio({ cooldown: '04:12' })
  assert.equal(f.estado, 'aguardando')
  assert.ok(f.rotulo.includes('04:12'))
})

test('automatico desligado nao e "liberado"', () => {
  assert.equal(faixaDeEnvio({ automatico: true, autoAtivo: false }).estado, 'parado')
  assert.equal(faixaDeEnvio({ automatico: true, autoAtivo: true }).estado, 'liberado')
})

test('automatico informa que a janela usa o horario local do pais', () => {
  const f = faixaDeEnvio({ automatico: true, autoAtivo: true })
  assert.match(f.detalhe, /horário local do país/i)
})

test('o resumo recolhido descarta vazios e preserva a ordem', () => {
  assert.deepEqual(faixaDeEnvio({ modoLabel: 'Manual', instanciaLabel: '', conexao: 'Conectada' }).resumo,
    ['Manual', 'Conectada'])
})
