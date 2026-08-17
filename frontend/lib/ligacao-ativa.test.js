const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  ACAO, indexarAtivasPorLead, rotuloOperador, rotuloAparelho, acaoDoLead, seloLigacaoAtiva,
  proximoLigavel, contarOcupadosPorOutros,
  sessaoTerminou, descreverDesfechoRemoto, saidasDaFila,
} = require('./ligacao-ativa')

const minha = {
  id: 'lig-1', campanha_lead_id: 'cl-1', prospect_id: 'p-1', estado_sessao: 'em_andamento',
  iniciada_em: '2026-08-14T12:00:00.000Z', chamada_encerrada_em: null,
  usuario_id: 'u-1', usuario_nome: 'Victor', sou_eu: true,
}
const alheia = { ...minha, id: 'lig-2', campanha_lead_id: 'cl-2', usuario_id: 'u-2', usuario_nome: 'Maria', sou_eu: false }

test('indexarAtivasPorLead: chaveia por lead e ignora item sem lead', () => {
  const mapa = indexarAtivasPorLead([minha, alheia, { ...alheia, campanha_lead_id: null }, null])
  assert.deepEqual(Object.keys(mapa).sort(), ['cl-1', 'cl-2'])
  assert.equal(mapa['cl-2'].usuario_nome, 'Maria')
})

test('indexarAtivasPorLead: entrada invalida vira mapa vazio (a fila nao quebra)', () => {
  assert.deepEqual(indexarAtivasPorLead(undefined), {})
  assert.deepEqual(indexarAtivasPorLead(null), {})
})

test('rotuloOperador: "você" para a propria; nome quando ha; fallback sem inventar identidade', () => {
  assert.equal(rotuloOperador(minha), 'você')
  assert.equal(rotuloOperador(alheia), 'Maria')
  assert.equal(rotuloOperador({ ...alheia, usuario_nome: '  ' }), 'outro operador')
  assert.equal(rotuloOperador({ ...alheia, usuario_nome: null }), 'outro operador')
})

test('acaoDoLead: sem ligacao ativa continua "Ligar" e nunca e somente leitura', () => {
  const a = acaoDoLead(null)
  assert.equal(a.acao, ACAO.LIGAR)
  assert.equal(a.rotulo, 'Ligar')
  assert.equal(a.somenteLeitura, false)
})

test('acaoDoLead: ligacao PROPRIA vira "Retomar" e mantem o comportamento normal', () => {
  const a = acaoDoLead(minha)
  assert.equal(a.acao, ACAO.RETOMAR)
  assert.equal(a.rotulo, 'Retomar')
  assert.equal(a.somenteLeitura, false) // idempotencia do POST /iniciar devolve a minha sessao
})

test('acaoDoLead: ligacao de OUTRA pessoa vira "Acompanhar" em somente leitura', () => {
  const a = acaoDoLead(alheia)
  assert.equal(a.acao, ACAO.ACOMPANHAR)
  assert.equal(a.rotulo, 'Acompanhar')
  assert.equal(a.somenteLeitura, true)
  assert.match(a.titulo, /Maria/)
  assert.match(a.titulo, /somente leitura/i)
})

test('acaoDoLead: resumo pendente de OUTRA pessoa continua somente leitura', () => {
  // O lead segue ocupado: no banco 'aguardando_resumo' e o mesmo status 'em_andamento'.
  const a = acaoDoLead({ ...alheia, estado_sessao: 'aguardando_resumo', chamada_encerrada_em: '2026-08-14T12:05:00.000Z' })
  assert.equal(a.acao, ACAO.ACOMPANHAR)
  assert.equal(a.somenteLeitura, true)
})

test('acaoDoLead: resumo pendente PROPRIO abre para concluir, nao para observar', () => {
  const a = acaoDoLead({ ...minha, estado_sessao: 'aguardando_resumo' })
  assert.equal(a.acao, ACAO.RETOMAR)
  assert.equal(a.somenteLeitura, false)
  assert.match(a.titulo, /resumo pendente/i)
})

test('seloLigacaoAtiva: diz o estado E quem, sempre em texto', () => {
  assert.equal(seloLigacaoAtiva(null), null)
  const s = seloLigacaoAtiva(alheia)
  assert.equal(s.texto, 'Em ligação agora · Maria')
  assert.equal(s.proprio, false)
  const meu = seloLigacaoAtiva(minha)
  assert.equal(meu.texto, 'Em ligação agora · você')
  assert.equal(meu.proprio, true)
  const pend = seloLigacaoAtiva({ ...alheia, estado_sessao: 'aguardando_resumo' })
  assert.equal(pend.texto, 'Resumo pendente · Maria')
})

// --- "Ligar agora" (botao global do topo) -------------------------------------------
const fila = [
  { campanha_lead_id: 'cl-2', nome: 'B' }, // ocupado por Maria
  { campanha_lead_id: 'cl-1', nome: 'A' }, // minha ligacao
  { campanha_lead_id: 'cl-3', nome: 'C' }, // livre
]

test('proximoLigavel: pula o lead ocupado por OUTRA pessoa', () => {
  const mapa = indexarAtivasPorLead([alheia])
  assert.equal(proximoLigavel(fila, mapa).campanha_lead_id, 'cl-1')
})

test('proximoLigavel: NAO pula a minha propria ligacao (retomar e o esperado)', () => {
  const mapa = indexarAtivasPorLead([minha, alheia])
  assert.equal(proximoLigavel(fila, mapa).campanha_lead_id, 'cl-1')
})

test('proximoLigavel: com todos ocupados por outros, nao ha proximo (botao desabilita)', () => {
  const mapa = indexarAtivasPorLead(fila.map((f, i) => ({ ...alheia, id: `x${i}`, campanha_lead_id: f.campanha_lead_id })))
  assert.equal(proximoLigavel(fila, mapa), null)
})

test('proximoLigavel: sem mapa de ativas, comporta-se como antes (primeiro da fila)', () => {
  assert.equal(proximoLigavel(fila, null).campanha_lead_id, 'cl-2')
  assert.equal(proximoLigavel([], {}), null)
})

test('contarOcupadosPorOutros: conta so o que e de outra pessoa', () => {
  const mapa = indexarAtivasPorLead([minha, alheia])
  assert.equal(contarOcupadosPorOutros(fila, mapa), 1)
  assert.equal(contarOcupadosPorOutros(fila, {}), 0)
})

// --- origem da sessao (mesma conta em dois aparelhos) --------------------------------
test('rotuloAparelho: so fala do aparelho quando NAO foi nesta mesma sessao', () => {
  // Dizer "no computador" para quem esta olhando o computador e ruido puro.
  assert.equal(rotuloAparelho({ mesma_sessao: true, sessao_dispositivo: 'computador' }), '')
  // Na DUVIDA (origem nao registrada de um dos lados) tambem nao se afirma aparelho.
  assert.equal(rotuloAparelho({ mesma_sessao: null, sessao_dispositivo: 'celular' }), '')
  assert.equal(rotuloAparelho(null), '')
  // O caso que importa: veio de OUTRA sessao.
  assert.equal(rotuloAparelho({ mesma_sessao: false, sessao_dispositivo: 'celular' }), 'no celular')
  assert.equal(rotuloAparelho({ mesma_sessao: false, sessao_dispositivo: 'computador' }), 'no computador')
  // Aparelho desconhecido nao vira chute: continua sabendo que foi "em outro aparelho".
  assert.equal(rotuloAparelho({ mesma_sessao: false, sessao_dispositivo: null }), 'em outro aparelho')
})

test('acaoDoLead: ligacao PROPRIA feita no outro aparelho nomeia o aparelho', () => {
  const a = acaoDoLead({ ...minha, mesma_sessao: false, sessao_dispositivo: 'celular' })
  assert.equal(a.acao, ACAO.RETOMAR)
  assert.match(a.titulo, /no celular/)
  // Sem prova de origem, mantem exatamente a frase antiga (nenhuma regressao de texto).
  assert.match(acaoDoLead(minha).titulo, /em outra aba ou aparelho/)
})

test('seloLigacaoAtiva: o titulo diz o aparelho quando a origem e outra', () => {
  const s = seloLigacaoAtiva({ ...alheia, mesma_sessao: false, sessao_dispositivo: 'celular' })
  assert.match(s.titulo, /Maria/)
  assert.match(s.titulo, /no celular/)
})

// --- estado TERMINAL vindo de outra sessao -------------------------------------------
const sessaoViva = {
  id: 'lig-1', status: 'em_andamento', estado_sessao: 'em_andamento', viva: true, desfecho: null,
  sou_eu: false, mesma_sessao: false, usuario_nome: 'Maria', sessao_dispositivo: 'celular',
}
const encerradaRemota = { ...sessaoViva, status: 'encerrada', estado_sessao: 'encerrada', viva: false, desfecho: 'encerrada' }
const descartadaRemota = { ...encerradaRemota, status: 'descartada', estado_sessao: 'descartada', desfecho: 'descartada' }

test('sessaoTerminou: le o `viva` do servidor, nao re-deriva o fim', () => {
  assert.equal(sessaoTerminou(sessaoViva), false)
  assert.equal(sessaoTerminou({ ...sessaoViva, estado_sessao: 'aguardando_resumo' }), false)
  assert.equal(sessaoTerminou(encerradaRemota), true)
  assert.equal(sessaoTerminou(null), false)
})

test('NAO existe um "terminouEmOutraSessao" puro — e a ausencia e deliberada', () => {
  // `mesma_sessao` identifica o APARELHO, entao duas abas do mesmo computador tem a MESMA
  // origem. Uma funcao pura respondendo "foi esta tela?" a partir do payload deixaria a
  // segunda aba sem aviso nenhum. Quem responde isso e a propria tela, pelo que ela fez.
  const lib = require('./ligacao-ativa')
  assert.equal('terminouEmOutraSessao' in lib, false)
  const fonteTela = fs.readFileSync(
    path.join(__dirname, '..', 'app', 'dashboard', 'central-ligacoes', 'page.tsx'), 'utf8')
  assert.match(fonteTela, /fechandoLocalRef/,
    'a tela decide pelo que ela mesma esta fazendo, nao por comparacao de origem')
})

test('descreverDesfechoRemoto: encerrada e descartada NAO recebem o mesmo texto', () => {
  const enc = descreverDesfechoRemoto(encerradaRemota)
  const desc = descreverDesfechoRemoto(descartadaRemota)
  assert.equal(enc.desfecho, 'encerrada')
  assert.equal(desc.desfecho, 'descartada')
  assert.notEqual(enc.titulo, desc.titulo)
  // A consequencia e' oposta: uma virou registro, a outra nao ficou em lugar nenhum.
  assert.match(enc.detalhe, /histórico do lead/)
  assert.match(desc.detalhe, /auditoria/)
  assert.match(desc.detalhe, /não entra/)
  // Quem fez e de onde entram na frase.
  assert.match(enc.detalhe, /Maria/)
  assert.match(enc.detalhe, /no celular/)
  assert.equal(descreverDesfechoRemoto(sessaoViva), null)
})

test('descreverDesfechoRemoto: so quem estava OPERANDO ouve sobre o resumo perdido', () => {
  assert.equal(descreverDesfechoRemoto(encerradaRemota).aviso, '')
  assert.match(descreverDesfechoRemoto(encerradaRemota, { operando: true }).aviso, /não pode mais ser salvo/)
})

test('descreverDesfechoRemoto: sem nome, nao inventa identidade', () => {
  const d = descreverDesfechoRemoto({ ...encerradaRemota, usuario_nome: null })
  assert.match(d.detalhe, /outro operador/)
})

// --- reconciliacao da fila -----------------------------------------------------------
test('saidasDaFila: aponta o que terminou entre dois tiques', () => {
  const antes = indexarAtivasPorLead([minha, alheia])
  const depois = indexarAtivasPorLead([minha])
  const r = saidasDaFila(antes, depois)
  assert.deepEqual(r.saidas, ['cl-2'])
  assert.equal(r.avisar, true)
})

test('saidasDaFila: a ligacao encerrada NESTA tela reconcilia, mas nao avisa', () => {
  // Sem isto, todo encerramento proprio dispararia um aviso de "aconteceu em outra sessao"
  // logo depois do clique — ruido garantido, exatamente para quem acabou de agir.
  const antes = indexarAtivasPorLead([{ ...minha, mesma_sessao: true }])
  const r = saidasDaFila(antes, {})
  assert.deepEqual(r.saidas, ['cl-1'])
  assert.equal(r.avisar, false)
})

test('saidasDaFila: ligacao NOVA nao e saida; nada muda => nada a fazer', () => {
  const antes = indexarAtivasPorLead([minha])
  const depois = indexarAtivasPorLead([minha, alheia])
  assert.deepEqual(saidasDaFila(antes, depois), { saidas: [], avisar: false })
  assert.deepEqual(saidasDaFila(antes, antes), { saidas: [], avisar: false })
  assert.deepEqual(saidasDaFila(null, null), { saidas: [], avisar: false })
})

// --- guarda de regressao ------------------------------------------------------------
test('guarda: a regra de dono vem do backend (`sou_eu`), nunca de comparacao de id no front', () => {
  const fonte = fs.readFileSync(path.join(__dirname, 'ligacao-ativa.js'), 'utf8')
  assert.equal(/usuario_id\s*===|===\s*usuario_id|localStorage|apiFetch/.test(fonte), false,
    'este modulo so traduz o veredito da API')
})

test('guarda: a tela nao pode decidir a acao por conta propria', () => {
  const tela = fs.readFileSync(
    path.join(__dirname, '..', 'app', 'dashboard', 'central-ligacoes', 'page.tsx'), 'utf8')
  assert.match(tela, /acaoDoLead/, 'a Central de Ligacoes deve consumir a regra pura')
  // Ternario sobre `sou_eu` na tela = rotulo/acao decidido fora da lib pura. Comparar o
  // veredito (`r.data.sou_eu === false`, na corrida do /iniciar) continua permitido — ali nao
  // se escolhe texto, se decide trocar de MODO.
  assert.equal(/\.sou_eu\s*\?/.test(tela), false,
    'rotulo/acao a partir de sou_eu pertence a lib pura, nao a tela')
  assert.equal(/usuario_id\s*===/.test(tela), false,
    'a tela nao compara id de usuario: quem sabe quem esta logado e o servidor')
})
