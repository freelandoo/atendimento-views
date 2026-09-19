'use client'
// Configurações › Equipes Comerciais — a tela de gestão do dono/admin.
//
// ─── O QUE ESTA TELA RESOLVE ────────────────────────────────────────────────────────────
// A camada de Equipes por Nicho já recorta a operação do comercial (Banco de Leads e Minha
// Operação), mas montar uma equipe exigia chamar a API à mão. Aqui o dono cria a equipe, escolhe
// o nicho, coloca as pessoas e vê quem está em qual equipe.
//
// ─── ESTA TELA NÃO É "CONTAS DA EMPRESA" ────────────────────────────────────────────────
// Lá se decide ACESSO (papel e capacidades da pessoa). Aqui se decide CARTEIRA (que nicho ela
// trabalha). Equipe não é papel: um `comercial` e um `admin` podem estar na mesma equipe sem que
// nenhum dos dois mude de permissão. Não fundir as duas.
//
// ─── A REGRA NÃO VIVE AQUI ──────────────────────────────────────────────────────────────
// Quem autoriza é o backend (`requireCapacidade(MEMBROS_GERENCIAR)`); quem garante "uma equipe
// ativa por pessoa" e "uma equipe ativa por nicho" é o BANCO (migration 088). `lib/equipes-
// comerciais.js` apenas TRADUZ — mesmo contrato de `lib/capacidades.js`. Esconder um controle
// aqui deixa a tela honesta, nunca substitui o gate do servidor.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'
import { useFeedback, Spinner } from '@/components/feedback/FeedbackProvider'
import ModalConfirmar from '@/components/ui/ModalConfirmar'
import {
  estadoDaEquipe, resumoDeMembros, estadoDaPessoa, conflitosDaSelecao,
  validarFormulario, textoConfirmarEncerramento, agruparEquipes, nichosOcupados,
  AVISO_ENCERRAR, LIMITE_NOME,
} from '@/lib/equipes-comerciais'
import type { EquipeResumo, PessoaElegivel } from '@/lib/equipes-comerciais'

// Os tipos vem do modulo PURO, nao redefinidos aqui: duas definicoes da mesma entidade
// divergiriam no primeiro campo novo, e o erro apareceria como incompatibilidade de tipo em vez
// de como o que e' — uma segunda fonte de verdade.
type Equipe = EquipeResumo
type Elegivel = PessoaElegivel
type Nicho = { id: string; nome: string; ativo?: boolean }

const card = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'

export default function EquipesComerciaisPage() {
  const fb = useFeedback()
  const empresaId = typeof window !== 'undefined' ? getEmpresaId() : ''
  const base = `/api/empresas/${empresaId}/equipes-comerciais`

  const [equipes, setEquipes] = useState<Equipe[]>([])
  const [elegiveis, setElegiveis] = useState<Elegivel[]>([])
  const [nichos, setNichos] = useState<Nicho[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  // Formulário de criação
  const [criando, setCriando] = useState(false)
  const [nome, setNome] = useState('')
  const [nichoId, setNichoId] = useState('')
  const [selecionados, setSelecionados] = useState<string[]>([])

  // Edição de participantes de uma equipe existente
  const [editando, setEditando] = useState<string | null>(null)
  const [selEdicao, setSelEdicao] = useState<string[]>([])

  const [encerrar, setEncerrar] = useState<Equipe | null>(null)

  const carregar = useCallback(async () => {
    if (!empresaId) return
    setCarregando(true)
    setErro(null)
    try {
      // `/nichos` e `/elegiveis` alimentam os seletores. Os três juntos porque a tela não serve
      // para nada com um deles faltando — e um erro parcial esconderia por que o seletor está vazio.
      const [eq, el, ni] = await Promise.all([
        apiFetch<Equipe[]>(base),
        apiFetch<Elegivel[]>(`${base}/elegiveis`),
        apiFetch<Nicho[]>(`/api/empresas/${empresaId}/nichos`),
      ])
      setEquipes(eq.data || [])
      setElegiveis(el.data || [])
      setNichos((ni.data || []).filter((n) => n.ativo !== false))
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar as equipes.')
    } finally { setCarregando(false) }
  }, [base, empresaId])

  useEffect(() => { carregar() }, [carregar])

  const { ativas, encerradas } = useMemo(() => agruparEquipes(equipes), [equipes])
  const ocupados = useMemo(() => nichosOcupados(equipes, editando), [equipes, editando])

  const validacao = validarFormulario({ nome, nicho_id: nichoId })
  const conflito = conflitosDaSelecao(elegiveis, selecionados, null)

  async function criar(e: FormEvent) {
    e.preventDefault()
    if (!validacao.ok) return
    await fb.runTask(
      () => apiFetch(base, {
        method: 'POST',
        body: JSON.stringify({ nome, nicho_id: nichoId, usuario_ids: selecionados }),
      }),
      { sucesso: 'Equipe criada.' }
    )
    setNome(''); setNichoId(''); setSelecionados([]); setCriando(false)
    await carregar()
  }

  async function salvarParticipantes(equipeId: string) {
    await fb.runTask(
      () => apiFetch(`${base}/${equipeId}/participantes`, {
        method: 'PUT',
        body: JSON.stringify({ usuario_ids: selEdicao }),
      }),
      { sucesso: 'Equipe atualizada.' }
    )
    setEditando(null)
    await carregar()
  }

  async function confirmarEncerramento() {
    if (!encerrar) return
    const alvo = encerrar
    setEncerrar(null)
    await fb.runTask(
      () => apiFetch(`${base}/${alvo.id}/encerrar`, { method: 'POST', body: JSON.stringify({}) }),
      { sucesso: 'Equipe encerrada.' }
    )
    await carregar()
  }

  function abrirEdicao(eq: Equipe) {
    setEditando(eq.id)
    // Quem já está NESTA equipe vem marcado. A lista de membros chega de `/elegiveis`, que sabe
    // a equipe atual de cada pessoa — não é preciso um GET por equipe.
    setSelEdicao(elegiveis.filter((p) => p.equipe_atual && p.equipe_atual.id === eq.id).map((p) => p.usuario_id))
  }

  if (carregando) return <div className="flex items-center gap-2 text-sm text-slate-500"><Spinner /> Carregando equipes…</div>

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Equipes Comerciais</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Cada equipe trabalha <strong>um nicho</strong>. Quem está numa equipe passa a ver apenas
            os leads daquele nicho no Banco de Leads e na Minha Operação. Quem não está em equipe
            nenhuma continua vendo tudo o que já via.
          </p>
        </div>
        {!criando && (
          <button
            onClick={() => setCriando(true)}
            className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Nova equipe
          </button>
        )}
      </div>

      {erro && (
        <div className={`${card} border-rose-200 bg-rose-50`}>
          <p className="text-sm text-rose-800">{erro}</p>
          <button onClick={carregar} className="mt-2 text-xs text-rose-900 underline">Tentar de novo</button>
        </div>
      )}

      {/* ── Criar ─────────────────────────────────────────────────────────────────────── */}
      {criando && (
        <form onSubmit={criar} className={card}>
          <h2 className="text-lg font-semibold text-slate-900">Nova equipe</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Nome</span>
              <input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                maxLength={LIMITE_NOME}
                placeholder="Ex.: Time Energia Solar"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Nicho</span>
              <select
                value={nichoId}
                onChange={(e) => setNichoId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Escolha o nicho…</option>
                {nichos.map((n) => (
                  <option key={n.id} value={n.id} disabled={ocupados.has(String(n.id))}>
                    {n.nome}{ocupados.has(String(n.id)) ? ' — já tem equipe ativa' : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <SeletorPessoas
            pessoas={elegiveis}
            selecionados={selecionados}
            onToggle={(id) => setSelecionados((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
            equipeAtualId={null}
          />

          {conflito && (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {conflito}
            </p>
          )}

          <div className="mt-4 flex items-center gap-2">
            <button
              type="submit"
              disabled={!validacao.ok || !!conflito || fb.ocupado}
              className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Criar equipe
            </button>
            <button type="button" onClick={() => { setCriando(false); setSelecionados([]) }} className="text-sm text-slate-500 hover:underline">
              Cancelar
            </button>
            {/* Botão desabilitado nunca fica mudo — o motivo vem do módulo puro. */}
            {!validacao.ok && <span className="text-xs text-slate-500">{validacao.motivo}</span>}
          </div>
        </form>
      )}

      {/* ── Ativas ────────────────────────────────────────────────────────────────────── */}
      {ativas.length === 0 && !criando ? (
        <section className={card}>
          <p className="text-sm text-slate-600">
            Nenhuma equipe ainda. Enquanto não houver equipe, <strong>ninguém é recortado</strong> —
            todo mundo continua vendo a carteira como antes.
          </p>
          <button onClick={() => setCriando(true)} className="mt-3 text-sm text-brand underline-offset-2 hover:underline">
            Criar a primeira equipe
          </button>
        </section>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {ativas.map((eq) => (
            <section key={eq.id} className={card}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">{eq.nome}</h3>
                  <p className="mt-0.5 text-sm text-cyan-800">
                    Nicho: <strong>{eq.nicho_nome || 'sem nome'}</strong>
                  </p>
                </div>
                <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                  {estadoDaEquipe(eq).rotulo}
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-500">{resumoDeMembros(eq)}</p>

              {editando === eq.id ? (
                <>
                  <SeletorPessoas
                    pessoas={elegiveis}
                    selecionados={selEdicao}
                    onToggle={(id) => setSelEdicao((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
                    equipeAtualId={eq.id}
                  />
                  {conflitosDaSelecao(elegiveis, selEdicao, eq.id) && (
                    <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      {conflitosDaSelecao(elegiveis, selEdicao, eq.id)}
                    </p>
                  )}
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={() => salvarParticipantes(eq.id)}
                      disabled={!!conflitosDaSelecao(elegiveis, selEdicao, eq.id) || fb.ocupado}
                      className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                    >
                      Salvar pessoas
                    </button>
                    <button onClick={() => setEditando(null)} className="text-sm text-slate-500 hover:underline">Cancelar</button>
                  </div>
                  {/* Tirar alguém da equipe NÃO devolve os leads dela. Dizer isso aqui, no momento
                      da ação, é o que impede a expectativa errada. */}
                  <p className="mt-2 text-xs text-slate-500">
                    Tirar alguém daqui devolve a visão completa para essa pessoa, mas <strong>os leads
                    que ela assumiu continuam com ela</strong>.
                  </p>
                </>
              ) : (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button onClick={() => abrirEdicao(eq)} className="text-sm text-brand underline-offset-2 hover:underline">
                    Gerenciar pessoas
                  </button>
                  <button onClick={() => setEncerrar(eq)} className="text-sm text-slate-500 underline-offset-2 hover:underline">
                    Encerrar equipe
                  </button>
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      {/* ── Encerradas: histórico, recolhido ──────────────────────────────────────────── */}
      {encerradas.length > 0 && (
        <details className={card}>
          <summary className="cursor-pointer text-sm font-medium text-slate-700">
            Encerradas ({encerradas.length})
          </summary>
          <ul className="mt-3 space-y-2">
            {encerradas.map((eq) => (
              <li key={eq.id} className="flex flex-wrap items-baseline justify-between gap-2 border-t border-slate-100 pt-2 text-sm">
                <span className="text-slate-700">{eq.nome}</span>
                <span className="text-xs text-slate-400">{eq.nicho_nome || 'sem nicho'} · {estadoDaEquipe(eq).descricao}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {encerrar && (
        <ModalConfirmar
          titulo="Encerrar equipe"
          corpo={textoConfirmarEncerramento(encerrar)}
          aviso={AVISO_ENCERRAR}
          rotuloConfirmar="Encerrar"
          tom="perigo"
          ocupado={fb.ocupado}
          onConfirmar={confirmarEncerramento}
          onCancelar={() => setEncerrar(null)}
        />
      )}
    </div>
  )
}

/**
 * O seletor de pessoas.
 *
 * Quem já está em OUTRA equipe aparece desabilitado COM o nome da equipe — a informação que o 409
 * do backend não dá (ele diz "uma das pessoas", sem dizer qual). O estado nunca é só a cor: cada
 * linha carrega o motivo em texto.
 */
function SeletorPessoas({
  pessoas, selecionados, onToggle, equipeAtualId,
}: {
  pessoas: Elegivel[]
  selecionados: string[]
  onToggle: (id: string) => void
  equipeAtualId: string | null
}) {
  if (!pessoas.length) {
    return (
      <p className="mt-4 text-xs text-slate-500">
        Nenhuma pessoa com acesso ativo nesta empresa. Adicione contas em Configurações › Contas da empresa.
      </p>
    )
  }
  return (
    <fieldset className="mt-4">
      <legend className="text-xs font-medium uppercase tracking-wide text-slate-500">Pessoas</legend>
      <ul className="mt-2 grid gap-1 sm:grid-cols-2">
        {pessoas.map((p) => {
          const st = estadoDaPessoa(p, equipeAtualId)
          const marcado = selecionados.includes(p.usuario_id)
          return (
            <li key={p.usuario_id}>
              <label className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
                st.disponivel ? 'border-slate-200 hover:bg-slate-50' : 'border-slate-100 bg-slate-50 text-slate-400'
              }`}>
                <input
                  type="checkbox"
                  checked={marcado}
                  disabled={!st.disponivel}
                  onChange={() => onToggle(p.usuario_id)}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="block truncate text-slate-800">{p.nome || 'Sem nome'}</span>
                  {st.aviso && <span className="block text-[11px] text-amber-700">{st.aviso}</span>}
                  {st.jaNesta && <span className="block text-[11px] text-emerald-700">Já é desta equipe</span>}
                </span>
              </label>
            </li>
          )
        })}
      </ul>
    </fieldset>
  )
}
