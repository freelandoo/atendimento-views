// Tradução do veredito da prévia de abordagem — SÓ TRADUZ.
//
// A regra de precedência (oferta específica do nicho > oferta geral > nenhuma) vive no BACKEND,
// em `services/abordagem-inicial-contrato.js#selecionarOfertaAbordagem`, e é a MESMA que escolhe
// a oferta no disparo real. Este módulo não decide nada: recebe `{motivo, oferta}` de
// `GET /banco-leads/abordagem/previa` e devolve o texto. Uma segunda régua aqui divergiria da que
// vale de verdade, e a tela passaria a prometer uma oferta que o disparo não usa.

// Espelha `MOTIVO_OFERTA` do backend. Motivo desconhecido aparece COMO ELE MESMO (nunca
// escondido): um motivo novo no servidor não pode sumir da tela.
export const MOTIVO = Object.freeze({
  ESPECIFICA: 'oferta_especifica_do_nicho',
  GERAL: 'oferta_geral',
  SEM_CONFIG: 'sem_configuracao_de_abordagem',
  SEM_ATIVA: 'nenhuma_oferta_ativa',
  SEM_CORRESPONDENCIA: 'sem_oferta_para_o_nicho',
})

/**
 * @param {{motivo?: string, oferta?: {nome?: string, nicho?: string, geral?: boolean, site_pronto?: boolean}|null, nicho?: string, gerar_ia?: boolean}|null} previa
 * @returns {{titulo: string, detalhe: string, tom: 'ok'|'atencao'|'neutro', oferta: string}}
 */
export function leituraPrevia(previa) {
  const p = previa && typeof previa === 'object' ? previa : null
  if (!p) return { titulo: 'Prévia indisponível', detalhe: 'Não foi possível consultar qual oferta seria usada.', tom: 'neutro', oferta: '' }

  const nicho = String(p.nicho || '').trim()
  const alvo = nicho ? `"${nicho}"` : 'um lead sem nicho informado'
  const nome = String(p.oferta?.nome || '').trim()

  if (p.gerar_ia === false) {
    return {
      titulo: 'A IA não escreve a primeira mensagem',
      detalhe: 'Com "Gerar primeira abordagem por IA" desligado, sai o template da instância e nenhuma oferta é selecionada.',
      tom: 'neutro',
      oferta: '',
    }
  }

  switch (p.motivo) {
    case MOTIVO.ESPECIFICA:
      return {
        titulo: `Oferta do nicho ${alvo}`,
        detalhe: `A seção cadastrada para ${p.oferta?.nicho ? `"${p.oferta.nicho}"` : 'este nicho'} vence a oferta padrão nesta abordagem.`
          + (p.oferta?.site_pronto ? ' A IA pode dizer que já existe algo pronto.' : ' A IA aborda como diagnóstico, sem prometer material pronto.'),
        tom: 'ok',
        oferta: nome,
      }
    case MOTIVO.GERAL:
      return {
        titulo: 'Oferta padrão (geral)',
        detalhe: `Nenhuma seção por nicho corresponde a ${alvo}, então vale a oferta padrão.`
          + (p.oferta?.site_pronto ? ' A IA pode dizer que já existe algo pronto.' : ' A IA aborda como diagnóstico, sem prometer material pronto.'),
        tom: 'ok',
        oferta: nome,
      }
    case MOTIVO.SEM_CORRESPONDENCIA:
      return {
        titulo: 'Nenhuma oferta para este nicho',
        detalhe: `Não há seção para ${alvo} e a oferta padrão está vazia ou desativada. `
          + 'A IA aborda de forma consultiva — ela nunca usa a oferta de outro nicho.',
        tom: 'atencao',
        oferta: '',
      }
    case MOTIVO.SEM_ATIVA:
      return {
        titulo: 'Nenhuma oferta ativa',
        detalhe: 'Todas as ofertas estão desativadas. A IA aborda de forma consultiva, sem carro-chefe.',
        tom: 'atencao',
        oferta: '',
      }
    case MOTIVO.SEM_CONFIG:
      return {
        titulo: 'Abordagem ainda não configurada',
        detalhe: 'Sem oferta cadastrada, a IA aborda de forma consultiva pelos sinais reais do lead.',
        tom: 'atencao',
        oferta: '',
      }
    default:
      return {
        titulo: String(p.motivo || 'Veredito desconhecido'),
        detalhe: nome ? `Oferta indicada: ${nome}.` : 'O servidor devolveu um motivo que esta tela ainda não traduz.',
        tom: 'neutro',
        oferta: nome,
      }
  }
}

/** Classe de cor do selo. Cor é REFORÇO: o título e o detalhe já dizem tudo em texto. */
export function classeTom(tom) {
  if (tom === 'ok') return 'border-estado-ok/40 bg-estado-ok/10 text-estado-ok'
  if (tom === 'atencao') return 'border-estado-warn/40 bg-estado-warn/10 text-estado-warn'
  return 'border-line bg-surface-2 text-ink-3'
}
