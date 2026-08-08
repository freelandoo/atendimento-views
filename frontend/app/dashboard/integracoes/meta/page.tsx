'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { apiFetch, getEmpresaId } from '@/lib/api'
import { useSession, podePapel } from '@/lib/useSession'
import {
  EVENTOS, AJUDA_CAMPO,
  estadoDaIntegracao, rotuloEstado, descricaoEstado, tomEstado,
  validarFormulario, acoesDisponiveis,
  rotuloStatusEvento, tomStatusEvento, rotuloTipoEvento, formatarValor, explicacaoDoEvento,
} from '@/lib/meta-integracao'
import type {
  Integracao, EventoHistorico, ResumoStatus, ChaveEvento, StatusEvento,
} from '@/lib/meta-integracao'

// Configurações › Integrações › Meta Conversions.
//
// Configura a integração DESTA empresa: conjunto de dados, token, quais resultados de
// reunião viram conversão, e o histórico do que foi (ou não) enviado.
//
// O token é tratado como segredo: é digitado, enviado no corpo do PUT e NUNCA volta
// da API — a tela mostra só os 4 últimos caracteres. Ele também não vai para o
// localStorage nem para a URL.
//
// A proteção real é do backend (requireAuth + requireRole('admin') +
// requireEmpresaAccess). O guard abaixo só evita mostrar a tela a quem não opera.

type Resposta = { integracao: Integracao; resumo: ResumoStatus; mapeamento: Record<string, string> }
type ResultadoTeste = { ok: boolean; mensagem?: string; eventos: { tipo: string; event_name: string; ok: boolean; mensagem: string | null }[] }

const FILTROS: { chave: StatusEvento | 'todos'; label: string }[] = [
  { chave: 'todos', label: 'Todos' },
  { chave: 'enviado', label: 'Enviados' },
  { chave: 'pendente', label: 'Aguardando' },
  { chave: 'falhou', label: 'Falharam' },
  { chave: 'ignorado', label: 'Não enviados' },
]

export default function MetaConversionsPage() {
  const router = useRouter()
  const { role, loading: carregandoSessao } = useSession()
  const empresaId = useMemo(() => (typeof window !== 'undefined' ? getEmpresaId() : ''), [])

  const [dados, setDados] = useState<Resposta | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<{ tom: 'ok' | 'erro'; texto: string } | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)

  const [form, setForm] = useState({ dataset_id: '', page_id: '', waba_id: '', access_token: '', test_event_code: '' })
  const [errosForm, setErrosForm] = useState<Record<string, string>>({})
  const [eventos, setEventos] = useState<Record<ChaveEvento, boolean>>({
    reuniao_agendada: false, reuniao_realizada: false, reuniao_realizada_com_venda: false,
  })
  const [teste, setTeste] = useState<ResultadoTeste | null>(null)

  const [historico, setHistorico] = useState<EventoHistorico[]>([])
  const [filtro, setFiltro] = useState<StatusEvento | 'todos'>('todos')

  const base = `/api/empresas/${empresaId}/integracoes/meta`
  const integracao = dados?.integracao ?? null
  const estado = estadoDaIntegracao(integracao)
  const acoes = acoesDisponiveis(integracao)
  const jaConfigurada = estado !== 'nao_configurada'

  useEffect(() => {
    if (!carregandoSessao && !podePapel(role, 'admin')) router.replace('/dashboard')
  }, [carregandoSessao, role, router])

  const carregar = useCallback(async () => {
    if (!empresaId) { setErro('Nenhuma empresa selecionada.'); setCarregando(false); return }
    setCarregando(true)
    try {
      const r = await apiFetch<Resposta>(base)
      setDados(r.data)
      const it = r.data.integracao
      if (it) {
        setForm({
          dataset_id: it.dataset_id || '',
          page_id: it.page_id || '',
          waba_id: it.waba_id || '',
          // O token não volta da API — o campo nasce vazio, sempre.
          access_token: '',
          test_event_code: it.test_event_code || '',
        })
        setEventos(it.eventos)
      }
      setErro(null)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar a integração.')
    } finally {
      setCarregando(false)
    }
  }, [base, empresaId])

  const carregarHistorico = useCallback(async () => {
    if (!empresaId) return
    try {
      const q = filtro === 'todos' ? '' : `?status=${filtro}`
      const r = await apiFetch<{ eventos: EventoHistorico[] }>(`${base}/eventos${q}`)
      setHistorico(r.data.eventos || [])
    } catch {
      setHistorico([])
    }
  }, [base, empresaId, filtro])

  useEffect(() => { void carregar() }, [carregar])
  useEffect(() => { void carregarHistorico() }, [carregarHistorico])

  async function acao<T>(nome: string, fn: () => Promise<T>, sucesso?: string) {
    setOcupado(nome)
    setAviso(null)
    try {
      const r = await fn()
      await carregar()
      await carregarHistorico()
      if (sucesso) setAviso({ tom: 'ok', texto: sucesso })
      return r
    } catch (e) {
      setAviso({ tom: 'erro', texto: e instanceof Error ? e.message : 'Não foi possível concluir.' })
      return null
    } finally {
      setOcupado(null)
    }
  }

  async function salvar() {
    const v = validarFormulario(form, { jaConfigurada })
    setErrosForm(v.erros as Record<string, string>)
    if (!v.ok) return
    setTeste(null)
    await acao('salvar', () => apiFetch(base, {
      method: 'PUT',
      body: JSON.stringify({ ...form, eventos }),
    }), 'Configuração salva. Agora teste a conexão para poder ativar.')
    // O token é apagado do estado assim que sai daqui: não fica na memória da página.
    setForm((f) => ({ ...f, access_token: '' }))
  }

  async function salvarEventos(proximos: Record<ChaveEvento, boolean>) {
    setEventos(proximos)
    if (!jaConfigurada) return
    await acao('eventos', () => apiFetch(`${base}/eventos`, {
      method: 'PATCH',
      body: JSON.stringify({ eventos: proximos }),
    }))
  }

  async function testar() {
    const r = await acao('testar', () => apiFetch<{ ok: boolean; mensagem?: string; eventos: ResultadoTeste['eventos'] }>(
      `${base}/testar`, { method: 'POST' }
    ))
    if (r) setTeste(r.data as ResultadoTeste)
  }

  async function trocarStatus(status: 'ativa' | 'desativada') {
    await acao(status, () => apiFetch(`${base}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
      status === 'ativa' ? 'Integração ativada.' : 'Integração desativada.')
  }

  async function remover() {
    if (!window.confirm('Remover a configuração da Meta? O histórico de envios é preservado.')) return
    await acao('remover', () => apiFetch(base, { method: 'DELETE' }), 'Configuração removida.')
    setForm({ dataset_id: '', page_id: '', waba_id: '', access_token: '', test_event_code: '' })
    setEventos({ reuniao_agendada: false, reuniao_realizada: false, reuniao_realizada_com_venda: false })
    setDados((d) => (d ? { ...d, integracao: null } : d))
  }

  if (carregandoSessao || !podePapel(role, 'admin')) {
    return <p className="text-sm text-slate-500">Carregando…</p>
  }

  return (
    <div className="space-y-6">
      <div>
        <nav className="text-xs text-slate-500">
          <Link href="/dashboard/integracoes" className="hover:underline">Integrações</Link>
          <span className="mx-1.5">/</span>
          <span className="text-slate-700">Meta Conversions</span>
        </nav>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">Meta Conversions</h1>
          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${tomEstado(estado)}`}>
            {rotuloEstado(estado)}
          </span>
        </div>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">{descricaoEstado(estado)}</p>
      </div>

      {erro && <Caixa tom="erro">{erro}</Caixa>}
      {aviso && <Caixa tom={aviso.tom}>{aviso.texto}</Caixa>}
      {estado === 'precisa_atencao' && integracao?.ultimo_erro && (
        <Caixa tom="erro">
          <strong className="font-semibold">A Meta recusou o último envio.</strong> {integracao.ultimo_erro}
        </Caixa>
      )}

      {carregando ? (
        <p className="text-sm text-slate-500">Carregando…</p>
      ) : (
        <>
          <section className="rounded-xl border bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-slate-900">Conexão com a sua conta Meta</h2>
            <p className="mt-1 text-sm text-slate-500">
              Estes dados valem só para esta empresa. As conversões são enviadas para o
              conjunto de dados informado aqui, com o token informado aqui.
            </p>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Campo
                id="dataset_id"
                label="Conjunto de dados (Dataset/Pixel)"
                ajuda={AJUDA_CAMPO.dataset_id}
                valor={form.dataset_id}
                erro={errosForm.dataset_id}
                onChange={(v) => setForm((f) => ({ ...f, dataset_id: v }))}
                placeholder="1572278814315441"
                inputMode="numeric"
              />
              <Campo
                id="waba_id"
                label="ID da conta WhatsApp Business"
                ajuda={AJUDA_CAMPO.waba_id}
                valor={form.waba_id}
                onChange={(v) => setForm((f) => ({ ...f, waba_id: v }))}
                placeholder="Recomendado para Click-to-WhatsApp"
              />
              <Campo
                id="page_id"
                label="ID da Página do Facebook"
                ajuda={AJUDA_CAMPO.page_id}
                valor={form.page_id}
                onChange={(v) => setForm((f) => ({ ...f, page_id: v }))}
                placeholder="Alternativa ao ID da conta WhatsApp"
              />
              <Campo
                id="test_event_code"
                label="Código de teste (opcional)"
                ajuda={AJUDA_CAMPO.test_event_code}
                valor={form.test_event_code}
                onChange={(v) => setForm((f) => ({ ...f, test_event_code: v }))}
                placeholder="TEST12345"
              />
              <div className="sm:col-span-2">
                <Campo
                  id="access_token"
                  label="Token de acesso"
                  ajuda={AJUDA_CAMPO.access_token}
                  valor={form.access_token}
                  erro={errosForm.access_token}
                  onChange={(v) => setForm((f) => ({ ...f, access_token: v }))}
                  placeholder={integracao?.token_hint ? `Token salvo •••• ${integracao.token_hint} — cole de novo para trocar` : 'EAAG…'}
                  tipo="password"
                />
                {integracao?.token_hint && (
                  <p className="mt-1.5 text-xs text-slate-500">
                    Há um token salvo, criptografado, terminado em <strong>{integracao.token_hint}</strong>.
                    Por segurança ele nunca é exibido de volta.
                  </p>
                )}
              </div>
            </div>
            {errosForm.destino && <p className="mt-3 text-sm text-rose-600">{errosForm.destino}</p>}

            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={salvar}
                disabled={ocupado !== null}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {ocupado === 'salvar' ? 'Salvando…' : jaConfigurada ? 'Salvar alterações' : 'Salvar configuração'}
              </button>
              <BotaoComMotivo
                onClick={testar}
                disponivel={acoes.podeTestar}
                motivo="Salve a configuração e ligue pelo menos um evento para testar."
                ocupado={ocupado === 'testar'}
                rotulo="Testar conexão"
                rotuloOcupado="Testando…"
              />
              {acoes.podeDesativar ? (
                <button
                  type="button"
                  onClick={() => trocarStatus('desativada')}
                  disabled={ocupado !== null}
                  className="rounded-lg border px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
                >
                  {ocupado === 'desativada' ? 'Desativando…' : 'Desativar'}
                </button>
              ) : (
                <BotaoComMotivo
                  onClick={() => trocarStatus('ativa')}
                  disponivel={acoes.podeAtivar}
                  motivo={acoes.motivoAtivarBloqueado || ''}
                  ocupado={ocupado === 'ativa'}
                  rotulo="Ativar integração"
                  rotuloOcupado="Ativando…"
                  primario
                />
              )}
              {acoes.podeRemover && (
                <button
                  type="button"
                  onClick={remover}
                  disabled={ocupado !== null}
                  className="ml-auto rounded-lg px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                >
                  Remover
                </button>
              )}
            </div>

            {teste && (
              <div className="mt-4 rounded-lg border bg-slate-50 p-4">
                <p className={`text-sm font-medium ${teste.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {teste.mensagem}
                </p>
                <ul className="mt-2 space-y-1 text-sm text-slate-600">
                  {teste.eventos.map((e) => (
                    <li key={e.tipo} className="flex flex-wrap items-baseline gap-2">
                      <span aria-hidden="true">{e.ok ? '✓' : '✕'}</span>
                      <span className="font-medium">{rotuloTipoEvento(e.tipo)}</span>
                      <span className="text-xs text-slate-400">({e.event_name})</span>
                      {e.mensagem && <span className="text-rose-600">{e.mensagem}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className="rounded-xl border bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-slate-900">O que enviar para a Meta</h2>
            <p className="mt-1 text-sm text-slate-500">
              Cada resultado liga de forma independente. Reunião cancelada e contato que
              não compareceu ficam registrados aqui e <strong>nunca</strong> são enviados.
            </p>
            <ul className="mt-4 space-y-3">
              {EVENTOS.map((ev) => (
                <li key={ev.chave} className="flex items-start gap-3 rounded-lg border p-3.5">
                  <input
                    id={`ev-${ev.chave}`}
                    type="checkbox"
                    checked={eventos[ev.chave] === true}
                    onChange={(e) => void salvarEventos({ ...eventos, [ev.chave]: e.target.checked })}
                    disabled={ocupado !== null}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300"
                  />
                  <div className="min-w-0">
                    <label htmlFor={`ev-${ev.chave}`} className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-slate-900">
                      {ev.nome}
                      <Dica texto={ev.ajuda} />
                      {dados?.mapeamento?.[ev.chave] && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-normal text-slate-500">
                          {dados.mapeamento[ev.chave]}
                        </span>
                      )}
                    </label>
                    <p className="mt-0.5 text-sm text-slate-500">{ev.resumo}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-slate-900">Histórico de envios</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {dados?.resumo
                    ? `${dados.resumo.enviado} enviados · ${dados.resumo.pendente} aguardando · ${dados.resumo.falhou} com falha · ${dados.resumo.ignorado} não enviados`
                    : 'Nada registrado ainda.'}
                </p>
              </div>
              {(dados?.resumo?.falhou ?? 0) > 0 && (
                <button
                  type="button"
                  onClick={() => acao('reenviar-todos', () => apiFetch(`${base}/eventos/reenviar-falhas`, { method: 'POST' }), 'Falhas devolvidas para a fila.')}
                  disabled={ocupado !== null}
                  className="rounded-lg border px-3 py-1.5 text-sm font-medium text-slate-700 disabled:opacity-50"
                >
                  Reenviar todas as falhas
                </button>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-1.5">
              {FILTROS.map((f) => (
                <button
                  key={f.chave}
                  type="button"
                  onClick={() => setFiltro(f.chave)}
                  aria-pressed={filtro === f.chave}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    filtro === f.chave ? 'bg-slate-900 text-white' : 'border text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {historico.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">
                Nenhum resultado de reunião nesta lista ainda. Assim que uma reunião de um
                contato vindo de anúncio for agendada ou concluída, ela aparece aqui.
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="py-2 pr-3 font-medium">Resultado</th>
                      <th className="py-2 pr-3 font-medium">Origem</th>
                      <th className="py-2 pr-3 font-medium">Contato</th>
                      <th className="py-2 pr-3 font-medium">Quando</th>
                      <th className="py-2 pr-3 font-medium">Valor</th>
                      <th className="py-2 pr-3 font-medium">Situação</th>
                      <th className="py-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {historico.map((ev) => {
                      const explicacao = explicacaoDoEvento(ev)
                      return (
                        <tr key={ev.id} className="border-b last:border-0 align-top">
                          <td className="py-2.5 pr-3 font-medium text-slate-800">{rotuloTipoEvento(ev.tipo)}</td>
                          <td className="py-2.5 pr-3 text-slate-600">{ev.origem}</td>
                          <td className="py-2.5 pr-3 font-mono text-xs text-slate-500">{ev.telefone || '—'}</td>
                          <td className="py-2.5 pr-3 text-slate-600">{formatarData(ev.ocorrido_em)}</td>
                          <td className="py-2.5 pr-3 text-slate-600">
                            {formatarValor(ev.valor, ev.moeda)}
                            {ev.valor_corrigido != null && (
                              <span className="block text-xs text-amber-700">
                                corrigido para {formatarValor(ev.valor_corrigido, ev.moeda)}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 pr-3">
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tomStatusEvento(ev.status)}`}>
                              {rotuloStatusEvento(ev.status)}
                            </span>
                            {explicacao && <p className="mt-1 max-w-xs text-xs text-slate-500">{explicacao}</p>}
                          </td>
                          <td className="py-2.5">
                            {ev.pode_reenviar && (
                              <button
                                type="button"
                                onClick={() => acao(`reenviar-${ev.id}`, () => apiFetch(`${base}/eventos/${ev.id}/reenviar`, { method: 'POST' }), 'Evento devolvido para a fila.')}
                                disabled={ocupado !== null}
                                className="rounded-lg border px-2.5 py-1 text-xs font-medium text-slate-700 disabled:opacity-50"
                              >
                                Reenviar
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function formatarData(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function Caixa({ tom, children }: { tom: 'ok' | 'erro'; children: React.ReactNode }) {
  const cor = tom === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'
  return <div role="status" className={`rounded-lg border p-3.5 text-sm ${cor}`}>{children}</div>
}

function Campo({
  id, label, ajuda, valor, onChange, placeholder, erro, tipo = 'text', inputMode,
}: {
  id: string
  label: string
  ajuda: string
  valor: string
  onChange: (v: string) => void
  placeholder?: string
  erro?: string
  tipo?: 'text' | 'password'
  inputMode?: 'numeric'
}) {
  return (
    <div>
      <label htmlFor={id} className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
        {label}
        <Dica texto={ajuda} />
      </label>
      <input
        id={id}
        type={tipo}
        value={valor}
        inputMode={inputMode}
        // Token é segredo: nada de preenchimento automático nem de correção do teclado.
        autoComplete={tipo === 'password' ? 'new-password' : 'off'}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro ? `${id}-erro` : undefined}
        className={`mt-1.5 w-full rounded-lg border px-3 py-2 text-sm ${erro ? 'border-rose-300' : 'border-slate-300'}`}
      />
      {erro && <p id={`${id}-erro`} className="mt-1 text-xs text-rose-600">{erro}</p>}
    </div>
  )
}

/** Ajuda contextual. Usa `title` + texto acessível — sem dependência de tooltip novo. */
function Dica({ texto }: { texto: string }) {
  return (
    <span
      title={texto}
      tabIndex={0}
      role="note"
      aria-label={texto}
      className="grid h-4 w-4 cursor-help place-items-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-600"
    >
      ?
    </span>
  )
}

/**
 * Botão que, quando indisponível, DIZ o porquê em vez de só ficar cinza.
 * Bloquear sem explicar é o que transforma uma tela de configuração em chamado.
 */
function BotaoComMotivo({
  onClick, disponivel, motivo, ocupado, rotulo, rotuloOcupado, primario = false,
}: {
  onClick: () => void
  disponivel: boolean
  motivo: string
  ocupado: boolean
  rotulo: string
  rotuloOcupado: string
  primario?: boolean
}) {
  const classe = primario
    ? 'rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:bg-slate-100 disabled:text-slate-400'
    : 'rounded-lg border px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50'
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={onClick} disabled={!disponivel || ocupado} title={!disponivel ? motivo : undefined} className={classe}>
        {ocupado ? rotuloOcupado : rotulo}
      </button>
      {!disponivel && motivo && <span className="text-xs text-slate-500">{motivo}</span>}
    </span>
  )
}
