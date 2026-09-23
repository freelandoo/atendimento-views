'use client'
// Link de cadastro — a seção de Contas da empresa que gera, lista e cancela convites.
//
// O convite carrega PAPEL e, para o comercial, EQUIPE. Quem abre o link cria a própria conta e
// entra já no papel e na equipe. O link vale 24 horas, é de uso único e NÃO é preso a um e-mail
// (decisão do operador, 2026-09-23) — por isso a tela deixa claro que ele deve ir para UMA pessoa
// e oferece "Cancelar" enquanto ninguém o usou.
//
// ⚠️ O LINK SÓ PODE SER COPIADO AGORA. O servidor guarda apenas o hash do token; depois de fechar
// o aviso, o convite continua na lista, mas o link não volta. A tela diz isso em texto.
//
// NENHUMA REGRA AQUI: quais papéis podem ser convidados, qual exige equipe e em que pé está cada
// convite vêm prontos da API. `lib/convite-membro.js` só traduz.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useFeedback } from '@/components/feedback/FeedbackProvider'
import Card from '@/components/ui/Card'
import Campo from '@/components/ui/Campo'
import Botao from '@/components/ui/Botao'
import ModalConfirmar from '@/components/ui/ModalConfirmar'
import { rotuloPapel } from '@/lib/capacidades'
import type { PapelEmpresa } from '@/lib/capacidades'
import {
  contarPendentes,
  equipesQueRecebem,
  linkDoConvite,
  papeisDoConvite,
  papelExigeEquipe,
  rotuloSituacao,
  tempoRestante,
} from '@/lib/convite-membro'
import type { ConviteMembro, EquipeParaConvite, OpcaoPapelEntrada } from '@/lib/convite-membro'

const TOM: Record<string, string> = {
  ok: 'border-estado-ok/30 bg-estado-ok/10 text-estado-ok',
  info: 'border-estado-info/30 bg-estado-info/10 text-estado-info',
  neutro: 'border-line bg-surface-3 text-ink-3',
}

function dataHora(v: string | null | undefined) {
  if (!v) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function ConvitesMembro({
  base,
  opcoes,
  equipes,
  validadeHoras = 24,
}: {
  /** `/api/empresas/:id/membros` */
  base: string
  opcoes: { papeis?: OpcaoPapelEntrada[] } | null
  equipes: EquipeParaConvite[]
  validadeHoras?: number
}) {
  const fb = useFeedback()
  const papeis = useMemo(() => papeisDoConvite(opcoes), [opcoes])
  const equipesAtivas = useMemo(() => equipesQueRecebem(equipes), [equipes])

  const [papel, setPapel] = useState('comercial')
  const [equipeId, setEquipeId] = useState('')
  const [rotulo, setRotulo] = useState('')
  const [gerando, setGerando] = useState(false)
  const [linkGerado, setLinkGerado] = useState('')
  const [copiado, setCopiado] = useState(false)

  const [convites, setConvites] = useState<ConviteMembro[]>([])
  const [cancelando, setCancelando] = useState<ConviteMembro | null>(null)

  // Papel inicial: o primeiro que a API oferece, caso "comercial" não esteja na lista.
  useEffect(() => {
    if (papeis.length && !papeis.includes(papel)) setPapel(papeis[0])
  }, [papeis, papel])

  const exigeEquipe = papelExigeEquipe(opcoes, papel)

  const carregar = useCallback(async () => {
    try {
      const r = await apiFetch<ConviteMembro[]>(`${base}/convites`)
      setConvites(r.data || [])
    } catch {
      /* a lista é secundária: falhar aqui não derruba a tela de contas */
    }
  }, [base])

  useEffect(() => { carregar() }, [carregar])

  async function gerar() {
    setGerando(true)
    setCopiado(false)
    try {
      const r = await fb.runTask(
        () => apiFetch<{ convite: ConviteMembro; token: string }>(`${base}/convites`, {
          method: 'POST',
          body: JSON.stringify({ role: papel, equipe_id: equipeId || null, rotulo }),
        }),
        { sucesso: 'Link de cadastro gerado.' },
      )
      setLinkGerado(linkDoConvite(window.location.origin, r.data.token))
      setRotulo('')
      carregar()
    } catch {
      /* erro já exibido pelo feedback */
    } finally {
      setGerando(false)
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(linkGerado)
      setCopiado(true)
    } catch {
      // Sem permissão de área de transferência: o link continua visível e selecionável.
      setCopiado(false)
    }
  }

  async function cancelar() {
    if (!cancelando) return
    const alvo = cancelando
    setCancelando(null)
    try {
      await fb.runTask(
        () => apiFetch(`${base}/convites/${alvo.id}/revogar`, { method: 'POST' }),
        { sucesso: 'Convite cancelado. O link não funciona mais.' },
      )
      carregar()
    } catch {
      /* erro já exibido pelo feedback */
    }
  }

  const motivoBloqueio = !papeis.length
    ? 'Carregando os papéis…'
    : exigeEquipe && !equipesAtivas.length
      ? 'Não há equipe ativa. Crie uma equipe em Equipe › Equipes antes de convidar um comercial.'
      : exigeEquipe && !equipeId
        ? 'Escolha a equipe: quem entra como comercial precisa começar numa equipe.'
        : ''

  const pendentes = contarPendentes(convites)

  return (
    <>
      <Card
        titulo="Convidar por link"
        descricao={`A pessoa abre o link, preenche os próprios dados e já entra no papel e na equipe escolhidos. O link vale ${validadeHoras} horas e só pode ser usado uma vez.`}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Campo etiqueta="Papel" obrigatorio>
            <select value={papel} onChange={(e) => { setPapel(e.target.value); setLinkGerado('') }}>
              {papeis.map((p) => (
                <option key={p} value={p}>{rotuloPapel(p as PapelEmpresa)}</option>
              ))}
            </select>
          </Campo>
          <Campo
            etiqueta={exigeEquipe ? 'Equipe' : 'Equipe (opcional)'}
            obrigatorio={exigeEquipe}
            ajuda={exigeEquipe ? 'Obrigatória para o comercial.' : ''}
          >
            <select value={equipeId} onChange={(e) => setEquipeId(e.target.value)}>
              <option value="">{exigeEquipe ? 'Escolha a equipe…' : 'Sem equipe'}</option>
              {equipesAtivas.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nome}{e.nicho_nome ? ` — ${e.nicho_nome}` : ''}
                </option>
              ))}
            </select>
          </Campo>
          <Campo etiqueta="Para quem é (opcional)" ajuda="Só para você reconhecer o convite na lista.">
            <input value={rotulo} onChange={(e) => setRotulo(e.target.value)} maxLength={120} placeholder="Ex.: Ana, vaga de SDR" />
          </Campo>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Botao
            variante="primaria"
            onClick={gerar}
            carregando={gerando}
            disabled={!!motivoBloqueio}
            motivoDesabilitado={motivoBloqueio}
          >
            Gerar link
          </Botao>
          {motivoBloqueio && papeis.length > 0 && (
            <span className="text-xs text-ink-3">{motivoBloqueio}</span>
          )}
        </div>

        {linkGerado && (
          <div className="mt-4 rounded-lg border border-estado-info/30 bg-estado-info/10 p-4">
            <p className="text-sm font-medium text-ink">Link pronto. Copie agora.</p>
            <p className="mt-1 text-xs text-ink-2">
              Por segurança o sistema não guarda o link: depois de sair desta tela ele não pode ser
              mostrado de novo. Mande para UMA pessoa — qualquer um que abrir primeiro se cadastra com ele.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                readOnly
                value={linkGerado}
                onFocus={(e) => e.currentTarget.select()}
                aria-label="Link de cadastro"
                className="min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-3 py-2 font-mono text-xs text-ink"
              />
              <Botao variante="secundaria" onClick={copiar}>{copiado ? 'Copiado' : 'Copiar link'}</Botao>
            </div>
          </div>
        )}
      </Card>

      <Card
        titulo={`Convites recentes${pendentes ? ` · ${pendentes} aguardando cadastro` : ''}`}
        descricao="Os 50 mais recentes. Um convite pendente pode ser cancelado enquanto ninguém o usou."
        semPadding
      >
        {convites.length === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-3">Nenhum convite gerado ainda.</p>
        ) : (
          <ul className="divide-y divide-line">
            {convites.map((c) => {
              const st = rotuloSituacao(c.situacao)
              const detalhe = c.situacao === 'usado'
                ? `Usado por ${c.usado_por_nome || 'alguém'} em ${dataHora(c.usado_em)}`
                : c.situacao === 'pendente'
                  ? `Gerado em ${dataHora(c.criado_em)} · ${tempoRestante(c.expira_em)}`
                  : `Gerado em ${dataHora(c.criado_em)}`
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">
                      {c.rotulo || 'Sem identificação'}
                    </p>
                    <p className="truncate text-xs text-ink-3">
                      {rotuloPapel(c.role as PapelEmpresa)}
                      {c.equipe_nome ? ` · ${c.equipe_nome}` : ''}
                      {' · '}{detalhe}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${TOM[st.tom] || TOM.neutro}`}>
                    {st.rotulo}
                  </span>
                  {c.situacao === 'pendente' && (
                    <Botao tamanho="sm" variante="neutra" onClick={() => setCancelando(c)}>Cancelar</Botao>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {cancelando && (
        <ModalConfirmar
          titulo="Cancelar convite"
          corpo={`O link ${cancelando.rotulo ? `"${cancelando.rotulo}" ` : ''}deixa de funcionar agora. Quem já tiver o link não conseguirá se cadastrar com ele.`}
          rotuloConfirmar="Cancelar convite"
          tom="perigo"
          onConfirmar={cancelar}
          onCancelar={() => setCancelando(null)}
        />
      )}
    </>
  )
}
