'use client'
/**
 * FICHA DO LEAD — uma superfície, quatro seções.
 *
 * O QUE ELA RESOLVE. Eram DOIS modais para o MESMO lead, abertos por gatilhos diferentes da
 * mesma linha: `ConversaHistoricoModal` (conversa, status, registro de reunião/ligação) e
 * `LeadDetalhesModal` (ICP, cadastro, evidências). Cada um repetia o resumo do lead no topo, e
 * quem estava na conversa e precisava do ICP fechava um para abrir o outro — perdendo o que
 * estava lendo e, no caminho, a posição na lista.
 *
 * ⚠️ NADA FOI REIMPLEMENTADO. Os dois componentes continuam sendo os donos do que fazem e
 * viraram o conteúdo de duas seções (`variante="embutido"`). Criar aqui um segundo motor de
 * conversa ou uma segunda marcação de ICP é exatamente o que este arquivo existe para evitar —
 * é a mesma proibição que `ConversaPainel` já documenta para a Central de Mensagens.
 *
 * ⚠️ AS SEÇÕES NÃO DESMONTAM AO TROCAR DE ABA. `LeadDetalhesModal` submete o veredito FINAL do
 * ICP na limpeza do seu efeito de saída (é assim que Lead A atravessa a porta da triagem):
 * desmontá-lo a cada clique numa aba mandaria um `finalizar` por clique. As duas seções pesadas
 * ficam montadas enquanto a ficha está aberta e apenas mudam de visibilidade — o mesmo motivo
 * pelo qual `RotinasAquisicao` fica sempre montado ao alternar Busca/Rotinas.
 *
 * No COMPUTADOR ela é um painel lateral: a lista continua visível atrás, que é o contexto que o
 * operador perde a cada modal centrado. No CELULAR continua sendo folha inferior — ali não
 * existe "ao lado". A geometria vem do primitivo (`lib/ui-primitivos.js`), nunca escrita à mão.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { classesFolha, classesFundoFolha } from '@/lib/ui-primitivos'
import { abasDaFicha, classesAba, secaoInicial, type SecaoFicha } from '@/lib/ficha-lead'
import { celulaOrigem } from '@/lib/lead-origem'
import { IconClose } from '@/components/ui/icons'
import Botao from '@/components/ui/Botao'
import LeadDetalhesModal, { type LeadDetalhavel } from '@/components/LeadDetalhesModal'
import ConversaHistoricoModal from '@/components/ConversaHistoricoModal'
import type { AcessoRapido } from '@/lib/lead-acessos'
import type { AcaoPrincipalLead } from '@/lib/banco-leads-acao'

export type { SecaoFicha }

export type ConversaDaFicha = {
  /** JID do contato. Vazio = lead ainda sem telefone (a conversa declara a pendência). */
  numero: string
  titulo: string
  leadId: string
  mensagemGerada: string | null
  rodavel: boolean
  status: string
  acessos: AcessoRapido[]
}

export default function FichaLead({
  lead, conversa, secao, onTrocarSecao, onFechar, empresaId,
  onLeadAtualizado, podeEditarIcp = true, instanciaDesconectada = false,
  acaoPrincipal, onAcaoPrincipal,
  podeTriarLead = true, mensagemGerada, podeEnviar, podeGerar, motivoEnvioIndisponivel,
  cooldownS, enviando, gerando, onEnviar, onGerar, onAlterarStatus, onSalvarTelefone,
  resumoExtra,
}: {
  lead: LeadDetalhavel & { telefone?: string | null; origem?: string | null; instagram_handle?: string | null }
  conversa: ConversaDaFicha
  secao: SecaoFicha
  onTrocarSecao: (s: SecaoFicha) => void
  onFechar: () => void
  empresaId: string
  onLeadAtualizado?: (lead: LeadDetalhavel) => void
  podeEditarIcp?: boolean
  instanciaDesconectada?: boolean
  /** A ação principal do lead, já resolvida por `lib/banco-leads-acao.js`. */
  acaoPrincipal?: AcaoPrincipalLead | null
  onAcaoPrincipal?: () => void
  podeTriarLead?: boolean
  mensagemGerada?: string | null
  podeEnviar?: boolean
  podeGerar?: boolean
  motivoEnvioIndisponivel?: string | null
  cooldownS?: number | null
  enviando?: boolean
  gerando?: boolean
  onEnviar?: () => void
  onGerar?: () => void
  onAlterarStatus?: (status: string, payload?: Record<string, unknown>) => void | Promise<void>
  onSalvarTelefone?: (telefone: string) => Promise<void>
  /** Bloco livre do Resumo (responsável, carteira) — a tela sabe o que pode mostrar, este não. */
  resumoExtra?: React.ReactNode
}) {
  const painelRef = useRef<HTMLDivElement>(null)
  const gatilhoRef = useRef<Element | null>(null)
  const temTelefone = !!String(lead.telefone || '').trim()
  const abas = useMemo(() => abasDaFicha({ temTelefone }), [temTelefone])
  const origem = celulaOrigem(lead)
  // Motivo de a seção pedida não ter sido a aberta (hoje: conversa sem telefone). A ficha DIZ,
  // em vez de trocar de aba em silêncio.
  const [avisoSecao, setAvisoSecao] = useState('')

  useEffect(() => {
    const r = secaoInicial(secao, { temTelefone })
    setAvisoSecao(r.motivo)
    if (r.secao !== secao) onTrocarSecao(r.secao)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secao, temTelefone])

  // Foco devolvido a quem abriu + Escape fecha — a mesma regra que `FolhaModal` documenta e que
  // nenhum dos dois modais originais pode garantir sozinho agora que vivem dentro desta.
  useEffect(() => {
    gatilhoRef.current = document.activeElement
    const alvo = painelRef.current?.querySelector<HTMLElement>('[data-foco-inicial]')
    alvo?.focus()
    return () => { (gatilhoRef.current as HTMLElement | null)?.focus?.() }
  }, [])

  const fechar = useCallback(() => { onFechar() }, [onFechar])

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      // Um diálogo ABERTO DENTRO da ficha ("Ver dados completos", agendar reunião, registrar
      // ligação) tem de fechar sozinho primeiro. Sem esta guarda, um Escape fecharia os dois de
      // uma vez e levaria junto o formulário que a pessoa estava preenchendo.
      const aninhado = painelRef.current?.querySelector('[role="dialog"], [role="alertdialog"]')
      if (aninhado) return
      fechar()
    }
    document.addEventListener('keydown', aoTeclar)
    return () => document.removeEventListener('keydown', aoTeclar)
  }, [fechar])

  function aoTeclarNasAbas(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const disponiveis = abas.filter((a) => a.disponivel)
    const i = disponiveis.findIndex((a) => a.chave === secao)
    const prox = e.key === 'ArrowRight' ? i + 1 : i - 1
    const alvo = disponiveis[(prox + disponiveis.length) % disponiveis.length]
    if (alvo) onTrocarSecao(alvo.chave)
  }

  return (
    // Fecha no `mousedown` do fundo, nunca no `click`: com `click`, arrastar uma seleção de
    // texto de dentro para fora fecharia a ficha e perderia o que estava sendo escrito.
    <div className={classesFundoFolha({ lateral: true })} onMouseDown={fechar}>
      <div
        ref={painelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Ficha de ${lead.nome || 'lead'}`}
        className={classesFolha({ lateral: true })}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Alça: só no celular, onde a ficha sobe de baixo. */}
        <div className="flex shrink-0 justify-center pt-2 sm:hidden" aria-hidden="true">
          <span className="h-1 w-10 rounded-full bg-line-strong" />
        </div>

        {/* CABEÇALHO FIXO — identidade do lead e a ação principal. Um cabeçalho só, para os
            dois conteúdos: era ele que aparecia duplicado quando eram dois modais. */}
        <div className="shrink-0 border-b border-line bg-surface px-4 py-3 sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Ficha do lead</p>
              <h2 className="mt-0.5 truncate text-lg font-semibold leading-tight text-ink">{lead.nome || '—'}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className={origem.classe} title={`${origem.rotulo} — ${origem.dica}`}>{origem.curto}</span>
                {origem.detalhe && <span className="text-[11px] text-ink-3">{origem.detalhe}</span>}
              </div>
            </div>
            <button
              type="button"
              onClick={fechar}
              data-foco-inicial
              aria-label="Fechar ficha do lead"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line text-ink-3 hover:bg-surface-2 hover:text-ink-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <IconClose />
            </button>
          </div>

          {/* A AÇÃO PRINCIPAL fica no cabeçalho, não no fim do corpo: ela não pode depender de
              rolar a ficha até o fim (a mesma regra que o `FolhaModal` documenta). Quando está
              indisponível, aparece desabilitada COM o motivo em texto. */}
          {acaoPrincipal && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Botao
                variante={acaoPrincipal.variante}
                onClick={onAcaoPrincipal}
                disabled={!!acaoPrincipal.motivoDesabilitado || !onAcaoPrincipal}
                title={acaoPrincipal.dica}
              >
                {acaoPrincipal.rotulo}
              </Botao>
              {acaoPrincipal.motivoDesabilitado && (
                <span className="text-xs text-ink-3">{acaoPrincipal.motivoDesabilitado}</span>
              )}
            </div>
          )}
        </div>

        {/* ABAS. `tablist` de verdade: setas do teclado e leitor de tela funcionam. */}
        <div
          role="tablist"
          aria-label="Seções da ficha"
          onKeyDown={aoTeclarNasAbas}
          className="flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-surface-2 px-2 py-1.5"
        >
          {abas.map((a) => (
            <button
              key={a.chave}
              role="tab"
              type="button"
              aria-selected={secao === a.chave}
              aria-disabled={!a.disponivel}
              tabIndex={secao === a.chave ? 0 : -1}
              disabled={!a.disponivel}
              title={a.disponivel ? a.dica : a.motivo}
              onClick={() => a.disponivel && onTrocarSecao(a.chave)}
              className={classesAba(secao === a.chave, a.disponivel)}
            >
              {a.rotulo}
            </button>
          ))}
        </div>

        {avisoSecao && (
          <p className="shrink-0 border-b border-line bg-amber-50 px-4 py-2 text-xs text-amber-800 sm:px-5" role="status">
            {avisoSecao}
          </p>
        )}

        {/* CORPO. As duas seções pesadas ficam MONTADAS e apenas mudam de visibilidade —
            ver o aviso no cabeçalho deste arquivo. */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className={secao === 'conversa' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
            <ConversaHistoricoModal
              variante="embutido"
              empresaId={empresaId}
              leadId={conversa.leadId}
              numero={conversa.numero}
              titulo={conversa.titulo}
              status={conversa.status}
              acessos={conversa.acessos}
              mensagemGerada={mensagemGerada}
              podeEnviar={podeEnviar}
              podeGerar={podeGerar}
              motivoEnvioIndisponivel={motivoEnvioIndisponivel}
              cooldownS={cooldownS}
              enviando={enviando}
              gerando={gerando}
              podeTriarLead={podeTriarLead}
              onEnviar={onEnviar}
              onGerar={onGerar}
              onAlterarStatus={onAlterarStatus}
              onSalvarTelefone={onSalvarTelefone}
              onClose={fechar}
            />
          </div>

          <div className={secao === 'conversa' ? 'hidden' : 'min-h-0 flex-1 overflow-y-auto overscroll-contain bg-surface-2 px-4 py-3 sm:px-5'}>
            {/* O que a tela sabe e este componente não: responsável, carteira, próxima ação. */}
            {secao === 'resumo' && resumoExtra}
            <LeadDetalhesModal
              variante="embutido"
              secao={secao === 'conversa' ? 'resumo' : secao}
              lead={lead}
              empresaId={empresaId}
              onFechar={fechar}
              onLeadAtualizado={onLeadAtualizado}
              podeEditarIcp={podeEditarIcp}
              instanciaDesconectada={instanciaDesconectada}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
