// Conversão de uma sugestão do assistente no rascunho de rotina que o admin revisa
// antes de aprovar. Lógica pura, testada em aquisicao-sugestao.test.js.
//
// A regra que importa: uma sugestão de AJUSTE só carrega o campo que ela propõe mudar
// (o intervalo, por exemplo). Todo o resto tem de vir da rotina ATUAL — senão aprovar um
// ajuste de intervalo silenciosamente devolveria dias, janela e volume para o padrão.

const PADRAO = {
  dias_semana: [1, 2, 3, 4, 5],
  janela_inicio: '08:00',
  janela_fim: '18:00',
  intervalo_horas: 6,
  quantidade: 200,
}

function primeiroDefinido(...valores) {
  for (const v of valores) if (v !== undefined && v !== null && v !== '') return v
  return undefined
}

/**
 * @param {object} sugestao  sugestão vinda da API (tipo, nicho/cidade/uf, parametros)
 * @param {object|null} rotina  rotina atual, quando a sugestão age sobre uma existente
 * @returns {object} rascunho no formato do formulário de rotina (sempre `ativo: false`)
 */
function sugestaoParaRascunho(sugestao, rotina = null) {
  const p = (sugestao && sugestao.parametros) || {}
  const r = rotina || {}
  return {
    id: sugestao && sugestao.tipo === 'criar_rotina' ? undefined : (r.id || undefined),
    nicho: primeiroDefinido(sugestao && sugestao.nicho, r.nicho) || '',
    cidade: primeiroDefinido(sugestao && sugestao.cidade, r.cidade) || '',
    uf: primeiroDefinido(sugestao && sugestao.uf, r.uf) || '',
    dias_semana: primeiroDefinido(p.dias_semana, r.dias_semana) || PADRAO.dias_semana,
    janela_inicio: primeiroDefinido(p.janela_inicio, r.janela_inicio) || PADRAO.janela_inicio,
    janela_fim: primeiroDefinido(p.janela_fim, r.janela_fim) || PADRAO.janela_fim,
    intervalo_horas: Number(primeiroDefinido(p.intervalo_horas, r.intervalo_horas) || PADRAO.intervalo_horas),
    quantidade: Number(primeiroDefinido(p.quantidade, r.quantidade) || PADRAO.quantidade),
    // A rotina aprovada nasce PAUSADA: ativar é um segundo ato do administrador.
    ativo: false,
  }
}

// Só os campos que o admin pode ter mexido viajam como `ajustes` na aprovação.
function rascunhoParaAjustes(rascunho) {
  return {
    nicho: rascunho.nicho.trim(),
    cidade: rascunho.cidade.trim(),
    uf: rascunho.uf.trim().toUpperCase() || null,
    dias_semana: rascunho.dias_semana,
    janela_inicio: rascunho.janela_inicio,
    janela_fim: rascunho.janela_fim,
    intervalo_horas: rascunho.intervalo_horas,
    quantidade: rascunho.quantidade,
  }
}

function rotuloConfianca(valor) {
  const n = Number(valor) || 0
  if (n >= 70) return 'Confiança alta'
  if (n >= 45) return 'Confiança média'
  return 'Confiança baixa'
}

module.exports = { sugestaoParaRascunho, rascunhoParaAjustes, rotuloConfianca }
