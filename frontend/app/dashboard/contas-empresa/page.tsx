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
} from '@/lib/capacidades'
import type { MembroEmpresa, PapelEmpresa, Capacidade } from '@/lib/capacidades'

type Opcoes = {
  papeis: { papel: PapelEmpresa; concedeveis: Capacidade[] }[]
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
    return <p className="text-sm text-lo">Carregando…</p>
  }
  if (!podeGerenciar) {
    return <p className="text-sm text-lo">Você não tem permissão para gerenciar as contas desta empresa.</p>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="neon-text font-display text-2xl font-bold">Contas da empresa</h1>
        <p className="text-sm text-lo">
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

        <p className="text-xs text-lo">{descricaoPapel(papel)}</p>
        <p className="text-xs text-lo">
          Se o e-mail já tiver conta no sistema, ela é reaproveitada e só o acesso a esta empresa é
          criado — a senha existente não muda, e o campo de senha pode ficar vazio.
        </p>

        {listaConcessoes.length > 0 && (
          <fieldset className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-4">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-lo">
              Liberar além do papel (opcional)
            </legend>
            <p className="text-xs text-lo">
              Só se acrescenta permissão. Para restringir alguém, troque o papel.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {listaConcessoes.map((c) => (
                <label key={c.capacidade} className="flex items-start gap-2 text-sm text-mid">
                  <input type="checkbox" checked={c.marcada}
                    onChange={() => alternarConcessao(c.capacidade)}
                    className="mt-1 accent-neon-cyan" />
                  <span>
                    {c.rotulo}
                    {c.aviso && <span className="block text-xs text-neon-amber">{c.aviso}</span>}
                  </span>
                </label>
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
          <thead className="bg-panel text-left text-xs uppercase tracking-wide text-lo">
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
              <tr><td colSpan={6} className="px-4 py-6 text-center text-lo">Carregando…</td></tr>
            ) : membros.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-lo">Ninguém além de você ainda.</td></tr>
            ) : (
              membros.map((m) => {
                const situacao = situacaoMembro(m)
                const acoes = acoesDoMembro(m, usuario?.id)
                const extras = Object.keys(m.permissoes || {}).filter((k) => m.permissoes?.[k] === true)
                return (
                  <tr key={m.id}>
                    <td className="px-4 py-3">
                      <span className="font-medium text-hi">{m.nome || '—'}</span>
                      <span className="block text-xs text-lo">{m.email}</span>
                    </td>
                    <td className="px-4 py-3 text-mid">{rotuloPapel(m.role)}</td>
                    <td className="px-4 py-3 text-lo">
                      {extras.length === 0 ? '—' : `${extras.length} liberação(ões)`}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        situacao.ativo
                          ? 'border border-neon-lime/40 bg-neon-lime/10 text-neon-lime'
                          : 'border border-white/10 bg-white/5 text-lo'
                      }`} title={situacao.detalhe}>
                        {situacao.rotulo}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-lo">{ultimoAcesso(m.ultimo_acesso_em)}</td>
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
                        // Motivo escrito, nunca controle escondido sem explicação.
                        <span className="text-xs text-lo">{acoes.motivo}</span>
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

  const concedeveis = opcoes.papeis.find((p) => p.papel === papel)?.concedeveis || []
  const lista = concessoesDoFormulario(concedeveis, corpoPermissoes(concessoes))

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

        <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-lo">Papel</label>
        <select value={papel} onChange={(e) => trocarPapel(e.target.value as PapelEmpresa)}
          className={inputCls + ' mt-1 w-full'}>
          {opcoes.papeis.map(({ papel: p }) => (
            <option key={p} value={p}>{rotuloPapel(p)}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-lo">{descricaoPapel(papel)}</p>

        {lista.length > 0 && (
          <fieldset className="mt-4 space-y-2 rounded-xl border border-white/10 bg-white/5 p-4">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-lo">
              Liberar além do papel
            </legend>
            <p className="text-xs text-lo">Só se acrescenta permissão. Para restringir, troque o papel.</p>
            {lista.map((c) => (
              <label key={c.capacidade} className="flex items-start gap-2 text-sm text-mid">
                <input type="checkbox" checked={c.marcada}
                  onChange={() => setConcessoes((prev) => (prev.includes(c.capacidade)
                    ? prev.filter((x) => x !== c.capacidade)
                    : [...prev, c.capacidade]))}
                  className="mt-1 accent-neon-cyan" />
                <span>
                  {c.rotulo}
                  {c.aviso && <span className="block text-xs text-neon-amber">{c.aviso}</span>}
                </span>
              </label>
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
