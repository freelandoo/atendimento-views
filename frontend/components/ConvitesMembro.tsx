'use client'
// Convites — a ÚNICA porta de cadastro de pessoas em Contas da empresa (operador, 2026-09-23).
//
// A página mostra só a lista de convites recentes e o botão "Gerar link". O botão abre um PAINEL
// LATERAL (drawer) com tudo o que o convite decide: papel, equipe, nome da pessoa e as
// liberações além do papel. Depois de gerar, o mesmo painel mostra o link para copiar.
//
// O convite vale 24 horas, é de uso único e NÃO é preso a um e-mail — por isso ele deve ir para
// UMA pessoa, e pode ser cancelado enquanto pendente.
//
// ⚠️ O LINK SÓ PODE SER COPIADO NA HORA. O servidor guarda apenas o hash do token; fechado o
// painel, o convite continua na lista, mas o link não volta. A tela diz isso em texto.
//
// NENHUMA REGRA AQUI: quais papéis podem ser convidados, qual exige equipe, o que cada papel já
// dá e o que ainda pode ser liberado vêm prontos da API (`/membros/opcoes`). `lib/convite-membro.js`
// e `lib/capacidades.js` só traduzem.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useFeedback } from '@/components/feedback/FeedbackProvider'
import Card from '@/components/ui/Card'
import Campo from '@/components/ui/Campo'
import Botao from '@/components/ui/Botao'
import FolhaModal from '@/components/ui/FolhaModal'
import ModalConfirmar from '@/components/ui/ModalConfirmar'
import {
  agruparConcessoes,
  concessoesDoFormulario,
  corpoPermissoes,
  descricaoPapel,
  resumoDoPapel,
  rotuloPapel,
} from '@/lib/capacidades'
import type { Capacidade, PapelEmpresa } from '@/lib/capacidades'
import {
  contarPendentes,
  equipesQueRecebem,
  linkDoConvite,
  papeisDoConvite,
  papelExigeEquipe,
  rotuloSituacao,
  tempoRestante,
} from '@/lib/convite-membro'
import type { ConviteMembro, EquipeParaConvite } from '@/lib/convite-membro'

export type OpcoesConvite = {
  papeis: {
    papel: PapelEmpresa
    incluidas?: Capacidade[]
    concedeveis: Capacidade[]
    convidavel?: boolean
    exige_equipe?: boolean
  }[]
  convite_validade_horas?: number
}

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
}: {
  /** `/api/empresas/:id/membros` */
  base: string
  opcoes: OpcoesConvite | null
  equipes: EquipeParaConvite[]
}) {
  const fb = useFeedback()
  const validadeHoras = opcoes?.convite_validade_horas ?? 24
  const papeis = useMemo(() => papeisDoConvite(opcoes), [opcoes])
  const equipesAtivas = useMemo(() => equipesQueRecebem(equipes), [equipes])

  const [convites, setConvites] = useState<ConviteMembro[]>([])
  const [cancelando, setCancelando] = useState<ConviteMembro | null>(null)

  // ── Estado do painel ──
  const [aberto, setAberto] = useState(false)
  const [papel, setPapel] = useState<string>('comercial')
  const [equipeId, setEquipeId] = useState('')
  const [nome, setNome] = useState('')
  const [concessoes, setConcessoes] = useState<Capacidade[]>([])
  const [gerando, setGerando] = useState(false)
  const [linkGerado, setLinkGerado] = useState('')
  const [nomeGerado, setNomeGerado] = useState('')
  const [copiado, setCopiado] = useState(false)

  useEffect(() => {
    if (papeis.length && !papeis.includes(papel)) setPapel(papeis[0])
  }, [papeis, papel])

  const opcaoDoPapel = opcoes?.papeis.find((p) => p.papel === papel)
  const exigeEquipe = papelExigeEquipe(opcoes, papel)
  // O que o papel JÁ dá e o que ainda pode ser liberado — os dois vêm do backend.
  const jaIncluso = useMemo(() => resumoDoPapel(opcaoDoPapel?.incluidas || []), [opcaoDoPapel])
  const totalIncluso = jaIncluso.reduce((n, g) => n + g.itens.length, 0)
  const gruposConcessoes = useMemo(
    () => agruparConcessoes(concessoesDoFormulario(opcaoDoPapel?.concedeveis || [], corpoPermissoes(concessoes))),
    [opcaoDoPapel, concessoes],
  )

  const carregar = useCallback(async () => {
    try {
      const r = await apiFetch<ConviteMembro[]>(`${base}/convites`)
      setConvites(r.data || [])
    } catch {
      /* a lista é secundária: falhar aqui não derruba a tela de contas */
    }
  }, [base])

  useEffect(() => { carregar() }, [carregar])

  function abrir() {
    setEquipeId('')
    setNome('')
    setConcessoes([])
    setLinkGerado('')
    setNomeGerado('')
    setCopiado(false)
    setAberto(true)
  }

  // Trocar de papel descarta liberações que o papel novo já inclui — senão o servidor recusaria
  // com "já está incluída no papel".
  function trocarPapel(novo: string) {
    setPapel(novo)
    const permitidas = new Set(opcoes?.papeis.find((p) => p.papel === novo)?.concedeveis || [])
    setConcessoes((prev) => prev.filter((c) => permitidas.has(c)))
  }

  function alternarConcessao(c: Capacidade) {
    setConcessoes((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
  }

  async function gerar() {
    setGerando(true)
    setCopiado(false)
    try {
      const r = await fb.runTask(
        () => apiFetch<{ convite: ConviteMembro; token: string }>(`${base}/convites`, {
          method: 'POST',
          body: JSON.stringify({
            role: papel,
            equipe_id: equipeId || null,
            rotulo: nome,
            permissoes: corpoPermissoes(concessoes),
          }),
        }),
        { sucesso: 'Link de cadastro gerado.' },
      )
      setLinkGerado(linkDoConvite(window.location.origin, r.data.token))
      setNomeGerado(nome.trim())
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
    : nome.trim().length < 2
      ? 'Digite o nome da pessoa.'
      : exigeEquipe && !equipesAtivas.length
        ? 'Não há equipe ativa. Crie uma equipe em Equipe › Equipes antes de convidar um comercial.'
        : exigeEquipe && !equipeId
          ? 'Escolha a equipe: quem entra como comercial precisa começar numa equipe.'
          : ''

  const pendentes = contarPendentes(convites)

  return (
    <>
      <Card
        titulo={`Convites${pendentes ? ` · ${pendentes} aguardando cadastro` : ''}`}
        descricao={`Pessoas entram na empresa só por convite. O link vale ${validadeHoras} horas e só pode ser usado uma vez.`}
        acoes={<Botao variante="primaria" onClick={abrir} disabled={!papeis.length}>Gerar link</Botao>}
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
                    <p className="truncate text-sm font-medium text-ink">{c.rotulo || 'Sem nome'}</p>
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

      <FolhaModal
        aberto={aberto}
        lateral
        titulo={linkGerado ? 'Link pronto' : 'Gerar link de cadastro'}
        descricao={linkGerado
          ? 'Copie agora e mande para a pessoa.'
          : 'A pessoa abre o link, preenche os próprios dados e já entra com o que você escolher aqui.'}
        onFechar={() => setAberto(false)}
        rodape={linkGerado ? (
          <>
            <Botao variante="secundaria" onClick={abrir}>Gerar outro</Botao>
            <Botao variante="primaria" onClick={() => setAberto(false)}>Concluir</Botao>
          </>
        ) : (
          <>
            {motivoBloqueio && papeis.length > 0 && (
              <span className="mr-auto text-xs text-ink-3">{motivoBloqueio}</span>
            )}
            <Botao variante="secundaria" onClick={() => setAberto(false)}>Cancelar</Botao>
            <Botao
              variante="primaria"
              onClick={gerar}
              carregando={gerando}
              disabled={!!motivoBloqueio}
              motivoDesabilitado={motivoBloqueio}
            >
              Gerar link
            </Botao>
          </>
        )}
      >
        {linkGerado ? (
          <div className="space-y-4">
            <p className="text-sm text-ink-2">
              Convite{nomeGerado ? <> para <span className="font-medium text-ink">{nomeGerado}</span></> : null}{' '}
              como <span className="font-medium text-ink">{rotuloPapel(papel as PapelEmpresa)}</span>.
            </p>
            <div className="flex flex-col gap-2">
              <input
                readOnly
                value={linkGerado}
                onFocus={(e) => e.currentTarget.select()}
                aria-label="Link de cadastro"
                className="w-full rounded-md border border-line-strong bg-surface-2 px-3 py-2 font-mono text-xs text-ink"
              />
              <Botao variante="primaria" onClick={copiar}>{copiado ? 'Copiado' : 'Copiar link'}</Botao>
            </div>
            <p className="rounded-lg border border-estado-warn/30 bg-estado-warn/10 px-3 py-2 text-xs text-ink-2">
              Por segurança o sistema não guarda o link: depois de fechar este painel ele não pode
              ser mostrado de novo. Mande para uma pessoa só — quem abrir primeiro se cadastra com ele.
              Ele vence em {validadeHoras} horas.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <Campo etiqueta="Nome da pessoa" obrigatorio ajuda="Já vem preenchido no cadastro dela; ela pode corrigir.">
              <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} placeholder="Ex.: Ana Lima" />
            </Campo>

            <Campo etiqueta="Papel" obrigatorio>
              <select value={papel} onChange={(e) => trocarPapel(e.target.value)}>
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

            {/* O papel por extenso, com a LINHA DE BASE dele: é o que transforma as caixas abaixo
                em decisão em vez de chute. */}
            <div className="rounded-lg border border-line bg-surface-2 p-3">
              <p className="text-sm font-medium text-ink">{rotuloPapel(papel as PapelEmpresa)}</p>
              {descricaoPapel(papel as PapelEmpresa) && (
                <p className="mt-0.5 text-xs text-ink-3">{descricaoPapel(papel as PapelEmpresa)}</p>
              )}
              {totalIncluso > 0 && (
                <div className="mt-3 space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                    Este papel já dá {totalIncluso} permiss{totalIncluso === 1 ? 'ão' : 'ões'}
                  </p>
                  {jaIncluso.map((g) => (
                    <div key={g.id}>
                      <p className="text-[10px] uppercase tracking-wide text-ink-3">{g.rotulo}</p>
                      <ul className="mt-1 flex flex-wrap gap-1">
                        {g.itens.map((i) => (
                          <li key={i.capacidade} className="rounded-md border border-estado-ok/30 bg-estado-ok/10 px-1.5 py-0.5 text-[11px] font-medium text-estado-ok">
                            {i.rotulo}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {gruposConcessoes.length > 0 && (
              <fieldset className="space-y-3">
                <legend className="text-sm font-medium text-ink">Liberar além do papel (opcional)</legend>
                <p className="text-xs text-ink-3">
                  Só se acrescenta permissão. Para restringir alguém, troque o papel.
                  {concessoes.length > 0 && (
                    <span className="ml-1 font-medium text-brand">
                      {concessoes.length} marcada{concessoes.length === 1 ? '' : 's'}.
                    </span>
                  )}
                </p>
                {gruposConcessoes.map((g) => (
                  <div key={g.id} className="space-y-1.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{g.rotulo}</p>
                    {g.itens.map((c) => (
                      <label
                        key={c.capacidade}
                        className={`flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-sm transition ${
                          c.marcada
                            ? 'border-brand/40 bg-brand/5 text-ink'
                            : 'border-line bg-surface text-ink-2 hover:bg-surface-2'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={c.marcada}
                          onChange={() => alternarConcessao(c.capacidade)}
                          className="mt-0.5 accent-brand"
                        />
                        <span>
                          {c.rotulo}
                          {/* A consequência (fala com o cliente, gasta dinheiro) fica sempre visível. */}
                          {c.aviso && <span className="mt-0.5 block text-xs text-estado-warn">{c.aviso}</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                ))}
              </fieldset>
            )}
          </div>
        )}
      </FolhaModal>

      {cancelando && (
        <ModalConfirmar
          titulo="Cancelar convite"
          corpo={`O link ${cancelando.rotulo ? `de "${cancelando.rotulo}" ` : ''}deixa de funcionar agora. Quem já tiver o link não conseguirá se cadastrar com ele.`}
          rotuloConfirmar="Cancelar convite"
          tom="perigo"
          onConfirmar={cancelar}
          onCancelar={() => setCancelando(null)}
        />
      )}
    </>
  )
}
