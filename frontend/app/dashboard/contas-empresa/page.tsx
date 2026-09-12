'use client'
// Configurações › Contas da empresa — CRM em equipe, Etapa 2.
// Ver docs/plano-execucao-crm-equipe.md §4.
//
// O QUE ESTA TELA RESOLVE
// Não existia como adicionar uma segunda pessoa a uma empresa pelo produto: `/api/admin/usuarios`
// cria a conta e **não cria vínculo**, então a pessoa nascia sem acesso a empresa alguma. Montar
// uma equipe exigia `INSERT` manual no banco.
//
// ESTA TELA NÃO É `/dashboard/contas`. Aquela é a lista de PLATAFORMA (superadmin, todas as
// contas do sistema) e continua existindo. Esta é da EMPRESA em contexto. Não fundir: são escopos
// diferentes, com autorizações diferentes.
//
// A REGRA DE ACESSO NÃO VIVE AQUI. Papéis, capacidades e o que é concedível vêm do backend
// (`GET .../membros/opcoes` e `/api/auth/me`); `lib/capacidades.js` apenas TRADUZ. Mesmo contrato
// de `lib/site-rotulos.js`. Esconder um controle aqui deixa a tela honesta — nunca substitui o
// gate do servidor, que é `requireCapacidade(MEMBROS_GERENCIAR)`.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch, getEmpresaId } from '@/lib/api'
import { useFeedback, Spinner } from '@/components/feedback/FeedbackProvider'
import { useSession } from '@/lib/useSession'
import DataTableFrame from '@/components/ui/DataTableFrame'
import ModalConfirmar from '@/components/ui/ModalConfirmar'
import {
  rotuloPapel, descricaoPapel, temCapacidade, concessoesDoFormulario, corpoPermissoes,
  situacaoMembro, ultimoAcesso, acoesDoMembro,
  agruparConcessoes, resumoDoPapel, extrasDoMembro,
} from '@/lib/capacidades'
import type { MembroEmpresa, PapelEmpresa, Capacidade } from '@/lib/capacidades'

type Opcoes = {
  // `incluidas` = o que o papel JA da; `concedeveis` = o que ainda pode ser acrescentado.
  // As duas vem do MESMO modulo que autoriza (services/acesso-capacidades.js) — a tela nao
  // recalcula nem deduz uma a partir da outra.
  papeis: { papel: PapelEmpresa; incluidas?: Capacidade[]; concedeveis: Capacidade[] }[]
  senha_minima: number
}

const inputCls = 'rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-hi outline-none transition focus:border-neon-cyan'
const botaoCls = 'inline-flex items-center gap-2 rounded-lg border border-neon-cyan/40 bg-neon-cyan/15 px-3 py-2 text-sm font-semibold text-neon-cyan transition hover:bg-neon-cyan/25 hover:shadow-glow-cyan disabled:opacity-50'

export default function ContasEmpresaPage() {
  const router = useRouter()
  const { usuario, loading: loadingSessao } = useSession()
  const fb = useFeedback()

  const empresaId = getEmpresaId()
  const base = `/api/empresas/${empresaId}/membros`

  const [capacidades, setCapacidades] = useState<Capacidade[] | null>(null)
  const [membros, setMembros] = useState<MembroEmpresa[]>([])
  const [opcoes, setOpcoes] = useState<Opcoes | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  // Formulário de convite
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [papel, setPapel] = useState<PapelEmpresa>('comercial')
  const [concessoes, setConcessoes] = useState<Capacidade[]>([])
  const [criando, setCriando] = useState(false)

  const [editando, setEditando] = useState<MembroEmpresa | null>(null)
  const [confirmando, setConfirmando] = useState<MembroEmpresa | null>(null)

  const podeGerenciar = temCapacidade(capacidades, 'membros_gerenciar')

  // As capacidades vêm de /api/auth/me, por EMPRESA. A tela não as calcula — se calculasse,
  // divergiria do servidor e o operador veria um botão que responde 403.
  useEffect(() => {
    if (loadingSessao || !empresaId) return
    let vivo = true
    apiFetch<{ empresas: { id: string; capacidades: Capacidade[] }[] }>('/api/auth/me')
      .then((r) => {
        if (!vivo) return
        const atual = (r.data.empresas || []).find((e) => e.id === empresaId)
        setCapacidades(atual?.capacidades || [])
      })
      .catch(() => { if (vivo) setCapacidades([]) })
    return () => { vivo = false }
  }, [loadingSessao, empresaId])

  // Sem a capacidade, sai da tela. O redirect é cortesia: quem chegar aqui por URL direta já
  // recebe 403 do backend em toda chamada.
  useEffect(() => {
    if (capacidades !== null && !podeGerenciar) router.replace('/dashboard')
  }, [capacidades, podeGerenciar, router])

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro('')
    try {
      const [m, o] = await Promise.all([
        apiFetch<MembroEmpresa[]>(base),
        apiFetch<Opcoes>(`${base}/opcoes`),
      ])
      setMembros(m.data || [])
      setOpcoes(o.data)
    } catch (err: unknown) {
      setErro(err instanceof Error ? err.message : 'Falha ao carregar as contas da empresa.')
    } finally {
      setCarregando(false)
    }
  }, [base])

  useEffect(() => {
    if (podeGerenciar) carregar()
  }, [podeGerenciar, carregar])

  // Concedíveis dependem do PAPEL escolhido: trocar de papel muda o que sobrou para conceder.
  // Quem decide isso é o backend (`concedeveisPara`), que já mandou a lista por papel.
  const concedeveisDoPapel = useMemo(
    () => opcoes?.papeis.find((p) => p.papel === papel)?.concedeveis || [],
    [opcoes, papel]
  )
  const listaConcessoes = useMemo(
    () => concessoesDoFormulario(concedeveisDoPapel, corpoPermissoes(concessoes)),
    [concedeveisDoPapel, concessoes]
  )
  // Agrupado por AREA: 18 caixas iguais em lista plana obrigam a varrer tudo para achar uma.
  const gruposConcessoes = useMemo(() => agruparConcessoes(listaConcessoes), [listaConcessoes])
  // O que o papel JA inclui. Sem isso, o formulario mostra caixas vazias e nenhuma linha de base:
  // o operador nao tem como saber se falta a permissao ou se o papel ja da.
  const jaIncluso = useMemo(
    () => resumoDoPapel(opcoes?.papeis.find((p) => p.papel === papel)?.incluidas || []),
    [opcoes, papel]
  )
  const totalIncluso = useMemo(
    () => jaIncluso.reduce((n, g) => n + g.itens.length, 0),
    [jaIncluso]
  )

  // Trocar de papel descarta concessões que o papel novo já inclui — senão o formulário enviaria
  // algo que a rota recusa com "já está incluída no papel".
  function trocarPapel(novo: PapelEmpresa) {
    setPapel(novo)
    const permitidas = new Set(opcoes?.papeis.find((p) => p.papel === novo)?.concedeveis || [])
    setConcessoes((prev) => prev.filter((c) => permitidas.has(c)))
  }

  function alternarConcessao(capacidade: Capacidade) {
    setConcessoes((prev) => (prev.includes(capacidade)
      ? prev.filter((c) => c !== capacidade)
      : [...prev, capacidade]))
  }

  async function criar(e: FormEvent) {
    e.preventDefault()
    setCriando(true)
    try {
      await fb.runTask(
        () => apiFetch(base, {
          method: 'POST',
          body: JSON.stringify({ nome, email, senha, role: papel, permissoes: corpoPermissoes(concessoes) }),
        }),
        { sucesso: 'Pessoa adicionada à empresa.' }
      )
      setNome(''); setEmail(''); setSenha(''); setConcessoes([])
      carregar()
    } catch { /* erro já exibido pelo feedback */ }
    finally { setCriando(false) }
  }

  async function salvarEdicao(membro: MembroEmpresa, patch: Record<string, unknown>, sucesso: string) {
    try {
      await fb.runTask(
        () => apiFetch(`${base}/${membro.id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
        { sucesso }
      )
      setEditando(null)
      carregar()
    } catch { /* erro já exibido pelo feedback */ }
  }

  if (loadingSessao || capacidades === null) {
    return <p className="text-sm text-mid">Carregando…</p>
  }
  if (!podeGerenciar) {
    return <p className="text-sm text-mid">Você não tem permissão para gerenciar as contas desta empresa.</p>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="neon-text font-display text-2xl font-bold">Contas da empresa</h1>
        {/* `text-mid` e nao `text-lo`: sobre o painel escuro, `lo` (#6b7a9e) da 4,4:1 — abaixo do
            minimo AA — e em 12px o texto praticamente some. `lo` fica so no que e cromo. */}
        <p className="text-sm text-mid">
          Quem trabalha nesta operação e o que cada pessoa pode fazer. Não é a lista de contas da
          plataforma — é só desta empresa.
        </p>
      </div>

      {erro && <p className="rounded-lg border border-neon-red/30 bg-neon-red/10 px-3 py-2 text-sm text-neon-red">{erro}</p>}

      {/* ── Convite ─────────────────────────────────────────────────────────────── */}
      <form onSubmit={criar} className="glass space-y-4 rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-hi">Adicionar pessoa</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <input value={nome} onChange={(e) => setNome(e.target.value)} required minLength={2}
            placeholder="Nome" className={inputCls} />
          <input value={email} onChange={(e) => setEmail(e.target.value)} required type="email"
            placeholder="E-mail" className={inputCls} />
          <input value={senha} onChange={(e) => setSenha(e.target.value)} type="password"
            minLength={opcoes?.senha_minima ?? 12}
            placeholder={`Senha inicial (≥${opcoes?.senha_minima ?? 12})`} className={inputCls} />
          <select value={papel} onChange={(e) => trocarPapel(e.target.value as PapelEmpresa)} className={inputCls}>
            {(opcoes?.papeis || []).map(({ papel: p }) => (
              <option key={p} value={p}>{rotuloPapel(p)}</option>
            ))}
          </select>
        </div>

        {/* O papel escolhido, dito por extenso e com a LINHA DE BASE dele. Trocar o papel troca
            esta lista inteira — e e' ela que transforma as caixas abaixo em decisao em vez de
            chute. */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-semibold text-hi">{rotuloPapel(papel)}</span>
            <span className="text-xs text-mid">{descricaoPapel(papel)}</span>
          </div>

          {totalIncluso > 0 && (
            <div className="mt-3 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-mid">
                Este papel já dá {totalIncluso} permiss{totalIncluso === 1 ? 'ão' : 'ões'}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {jaIncluso.map((g) => (
                  <div key={g.id} className="min-w-[180px] flex-1">
                    <div className="text-[10px] uppercase tracking-wide text-mid">{g.rotulo}</div>
                    <ul className="mt-1 flex flex-wrap gap-1">
                      {g.itens.map((i) => (
                        <li key={i.capacidade}
                          className="rounded-md border border-neon-lime/25 bg-neon-lime/10 px-1.5 py-0.5 text-[11px] text-neon-lime">
                          {i.rotulo}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          {listaConcessoes.length === 0 && totalIncluso > 0 && (
            <p className="mt-3 text-xs text-mid">
              Não há o que liberar além disso — este papel já alcança tudo.
            </p>
          )}
        </div>

        <p className="text-xs text-mid">
          Se o e-mail já tiver conta no sistema, ela é reaproveitada e só o acesso a esta empresa é
          criado — a senha existente não muda, e o campo de senha pode ficar vazio.
        </p>

        {listaConcessoes.length > 0 && (
          <fieldset className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-4">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-mid">
              Liberar além do papel (opcional)
            </legend>
            <p className="text-xs text-mid">
              Só se acrescenta permissão. Para restringir alguém, <b>troque o papel</b> — negar não
              existe neste modelo.
              {concessoes.length > 0 && (
                <span className="ml-1 text-neon-cyan">
                  {concessoes.length} marcada{concessoes.length === 1 ? '' : 's'}.
                </span>
              )}
            </p>
            {/* Por AREA, na ordem do menu lateral. A marcada ganha contorno proprio: com 19 caixas,
                cor de acento sozinha no quadradinho nao se acha varrendo a lista. */}
            <div className="grid gap-4 sm:grid-cols-2">
              {gruposConcessoes.map((g) => (
                <div key={g.id} className="space-y-1.5">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-mid">{g.rotulo}</div>
                  {g.itens.map((c) => (
                    <label key={c.capacidade}
                      className={`flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-sm transition ${
                        c.marcada
                          ? 'border-neon-cyan/40 bg-neon-cyan/10 text-hi'
                          : 'border-transparent text-mid hover:border-white/10 hover:bg-white/5'
                      }`}>
                      <input type="checkbox" checked={c.marcada}
                        onChange={() => alternarConcessao(c.capacidade)}
                        className="mt-0.5 accent-neon-cyan" />
                      <span>
                        {c.rotulo}
                        {/* O aviso e' sobre a CONSEQUENCIA (fala com o cliente, gasta dinheiro, e
                            irreversivel) — por isso fica sempre visivel, nunca em tooltip. */}
                        {c.aviso && <span className="mt-0.5 block text-xs text-neon-amber">{c.aviso}</span>}
                      </span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </fieldset>
        )}

        <button type="submit" disabled={criando} className={botaoCls}>
          {criando && <Spinner />}
          {criando ? 'Adicionando…' : 'Adicionar à empresa'}
        </button>
      </form>

      {/* ── Lista ───────────────────────────────────────────────────────────────── */}
      <DataTableFrame
        className="glass overflow-hidden rounded-2xl"
        scrollbarClassName="border-b border-white/10 bg-panel"
        ariaLabel="Rolagem horizontal da tabela de contas da empresa"
      >
        <table className="w-full min-w-max text-sm">
          <thead className="bg-panel text-left text-xs uppercase tracking-wide text-mid">
            <tr className="border-b border-white/10">
              <th className="px-4 py-3">Pessoa</th>
              <th className="px-4 py-3">Papel</th>
              <th className="px-4 py-3">Liberações extras</th>
              <th className="px-4 py-3">Situação</th>
              <th className="px-4 py-3">Último acesso</th>
              <th className="px-4 py-3">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {carregando ? (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-mid">Carregando…</td></tr>
            ) : membros.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-mid">
                Ninguém além de você ainda. Use o formulário acima para dar acesso a alguém.
              </td></tr>
            ) : (
              membros.map((m) => {
                const situacao = situacaoMembro(m)
                const acoes = acoesDoMembro(m, usuario?.id)
                const extras = extrasDoMembro(m)
                const ehVoce = String(m.usuario_id) === String(usuario?.id)
                return (
                  <tr key={m.id} className={`transition hover:bg-white/5 ${m.ativo === false ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-3">
                      <span className="font-medium text-hi">{m.nome || '—'}</span>
                      {/* Marcar a propria linha evita o "por que nao consigo me editar?": a resposta
                          esta na coluna de acoes, mas so faz sentido depois de saber que e voce. */}
                      {ehVoce && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-neon-cyan">você</span>}
                      {/* O e-mail e o identificador real da pessoa: em `text-lo` (4,4:1) ele some. */}
                      <span className="block text-xs text-mid">{m.email}</span>
                    </td>
                    <td className="px-4 py-3 text-mid">{rotuloPapel(m.role)}</td>
                    <td className="px-4 py-3">
                      {/* QUAIS, nao quantas: uma contagem obriga a abrir o editor justamente para
                          responder a pergunta que esta coluna existe para responder. */}
                      {extras.length === 0 ? (
                        <span className="text-mid">nenhuma</span>
                      ) : (
                        <ul className="flex flex-wrap gap-1">
                          {extras.map((e) => (
                            <li key={e.capacidade} title={e.aviso || undefined}
                              className={`rounded-md px-1.5 py-0.5 text-[11px] ${
                                e.aviso
                                  ? 'border border-neon-amber/30 bg-neon-amber/10 text-neon-amber'
                                  : 'border border-white/10 bg-white/5 text-mid'
                              }`}>
                              {e.rotulo}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        situacao.ativo
                          ? 'border border-neon-lime/40 bg-neon-lime/10 text-neon-lime'
                          : 'border border-white/10 bg-white/5 text-mid'
                      }`} title={situacao.detalhe}>
                        {situacao.rotulo}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-mid">{ultimoAcesso(m.ultimo_acesso_em)}</td>
                    <td className="px-4 py-3">
                      {acoes.podeEditar ? (
                        <div className="flex flex-wrap gap-2">
                          <button onClick={() => setEditando(m)}
                            className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-mid transition hover:bg-white/10">
                            Editar
                          </button>
                          <button onClick={() => setConfirmando(m)}
                            className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-mid transition hover:bg-white/10">
                            {m.ativo ? 'Revogar acesso' : 'Devolver acesso'}
                          </button>
                        </div>
                      ) : (
                        // Motivo escrito, nunca controle escondido sem explicação — e legível:
                        // um motivo que ninguém enxerga não explica nada.
                        <span className="text-xs text-mid">{acoes.motivo}</span>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </DataTableFrame>

      {editando && opcoes && (
        <ModalEditar
          membro={editando}
          opcoes={opcoes}
          onFechar={() => setEditando(null)}
          onSalvar={(patch) => salvarEdicao(editando, patch, 'Acesso atualizado.')}
        />
      )}

      {confirmando && (
        <ModalConfirmar
          titulo={confirmando.ativo ? 'Revogar o acesso desta pessoa?' : 'Devolver o acesso?'}
          corpo={confirmando.ativo
            ? 'Ela deixa de entrar nesta empresa. Nada é apagado: leads, conversas, ligações, follow-ups e reuniões continuam registrados no nome dela, e você decide se redistribui.'
            : 'Ela volta a entrar nesta empresa com o mesmo papel e as mesmas liberações.'}
          rotuloConfirmar={confirmando.ativo ? 'Revogar acesso' : 'Devolver acesso'}
          tom={confirmando.ativo ? 'perigo' : 'neutro'}
          onConfirmar={() => {
            const alvo = confirmando
            setConfirmando(null)
            salvarEdicao(alvo, { ativo: !alvo.ativo },
              alvo.ativo ? 'Acesso revogado.' : 'Acesso devolvido.')
          }}
          onCancelar={() => setConfirmando(null)}
        />
      )}
    </div>
  )
}

// ── Edição de papel e liberações ──────────────────────────────────────────────────────────
function ModalEditar({ membro, opcoes, onFechar, onSalvar }: {
  membro: MembroEmpresa
  opcoes: Opcoes
  onFechar: () => void
  onSalvar: (patch: Record<string, unknown>) => void
}) {
  const [papel, setPapel] = useState<PapelEmpresa>(membro.role)
  const [concessoes, setConcessoes] = useState<Capacidade[]>(
    Object.keys(membro.permissoes || {}).filter((k) => membro.permissoes?.[k] === true)
  )

  const escolhido = opcoes.papeis.find((p) => p.papel === papel)
  const lista = concessoesDoFormulario(escolhido?.concedeveis || [], corpoPermissoes(concessoes))
  const grupos = agruparConcessoes(lista)
  const incluso = resumoDoPapel(escolhido?.incluidas || [])
  const totalIncluso = incluso.reduce((n, g) => n + g.itens.length, 0)

  function trocarPapel(novo: PapelEmpresa) {
    setPapel(novo)
    const permitidas = new Set(opcoes.papeis.find((p) => p.papel === novo)?.concedeveis || [])
    setConcessoes((prev) => prev.filter((c) => permitidas.has(c)))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div role="dialog" aria-modal="true" aria-label={`Editar acesso de ${membro.nome || membro.email}`}
        className="glass max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-hi">Acesso de {membro.nome || membro.email}</h2>

        <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-mid">Papel</label>
        <select value={papel} onChange={(e) => trocarPapel(e.target.value as PapelEmpresa)}
          className={inputCls + ' mt-1 w-full'}>
          {opcoes.papeis.map(({ papel: p }) => (
            <option key={p} value={p}>{rotuloPapel(p)}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-mid">{descricaoPapel(papel)}</p>

        {/* A mesma linha de base do formulario de convite: trocar o papel aqui muda o que a pessoa
            alcanca, e a lista abaixo so faz sentido contra o que o papel ja da. */}
        {totalIncluso > 0 && (
          <div className="mt-3 rounded-lg border border-white/10 bg-white/5 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-mid">
              O papel já dá {totalIncluso} permiss{totalIncluso === 1 ? 'ão' : 'ões'}
            </p>
            <ul className="mt-1.5 flex flex-wrap gap-1">
              {incluso.flatMap((g) => g.itens).map((i) => (
                <li key={i.capacidade}
                  className="rounded-md border border-neon-lime/25 bg-neon-lime/10 px-1.5 py-0.5 text-[11px] text-neon-lime">
                  {i.rotulo}
                </li>
              ))}
            </ul>
          </div>
        )}

        {lista.length > 0 && (
          <fieldset className="mt-4 space-y-2 rounded-xl border border-white/10 bg-white/5 p-4">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-mid">
              Liberar além do papel
            </legend>
            <p className="text-xs text-mid">Só se acrescenta permissão. Para restringir, troque o papel.</p>
            {grupos.map((g) => (
              <div key={g.id} className="space-y-1">
                <div className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-mid">{g.rotulo}</div>
                {g.itens.map((c) => (
                  <label key={c.capacidade}
                    className={`flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-sm transition ${
                      c.marcada
                        ? 'border-neon-cyan/40 bg-neon-cyan/10 text-hi'
                        : 'border-transparent text-mid hover:border-white/10 hover:bg-white/5'
                    }`}>
                    <input type="checkbox" checked={c.marcada}
                      onChange={() => setConcessoes((prev) => (prev.includes(c.capacidade)
                        ? prev.filter((x) => x !== c.capacidade)
                        : [...prev, c.capacidade]))}
                      className="mt-0.5 accent-neon-cyan" />
                    <span>
                      {c.rotulo}
                      {c.aviso && <span className="mt-0.5 block text-xs text-neon-amber">{c.aviso}</span>}
                    </span>
                  </label>
                ))}
              </div>
            ))}
          </fieldset>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onFechar}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-mid transition hover:bg-white/10">
            Cancelar
          </button>
          <button onClick={() => onSalvar({ role: papel, permissoes: corpoPermissoes(concessoes) })}
            className={botaoCls}>
            Salvar
          </button>
        </div>
      </div>
    </div>
  )
}
