'use client'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'

/**
 * Mensagens ENVIADAS por período, separando IA × pessoa × autoria desconhecida.
 *
 * Alimentado pelo ledger de saída (migration 117) via `GET .../relatorios/mensagens`. A tela não
 * calcula nada: cada número e cada definição vêm do servidor.
 *
 * As três honestidades que este bloco é obrigado a manter, porque sem elas o número engana:
 *  1. "mensagem" não é entrega nem leitura — é envio aceito pelo provedor;
 *  2. "lead contatado" é contato DISTINTO, não contagem de mensagens;
 *  3. o histórico anterior ao ledger não tem autoria e NÃO é retroagido — aparece como
 *     "autoria não registrada", nunca distribuído entre IA e pessoas para o total fechar.
 */
type PorPessoa = { usuario_id: string; nome: string; mensagens: number }
type PorInstancia = { evolution_instance: string; nome: string; mensagens: number; leads_contatados: number }
type Dados = {
  periodo: { de: string; ate: string }
  mensagens: number
  ia: number
  pessoa: number
  desconhecida: number
  alerta_operador: number
  leads_contatados: number
  por_pessoa: PorPessoa[]
  por_instancia: PorInstancia[]
  definicoes: Record<string, string>
}

const PERIODOS = [
  { dias: 7, rotulo: '7 dias' },
  { dias: 30, rotulo: '30 dias' },
  { dias: 90, rotulo: '90 dias' },
]

export default function IndicadoresMensagens() {
  const [dias, setDias] = useState(30)
  const [dados, setDados] = useState<Dados | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)

  const carregar = useCallback(async () => {
    const empresaId = getEmpresaId()
    if (!empresaId) return
    setCarregando(true)
    setErro(null)
    try {
      const de = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString()
      const r = await apiFetch<Dados>(`/api/empresas/${empresaId}/relatorios/mensagens?de=${encodeURIComponent(de)}`)
      setDados(r.data)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível ler os indicadores de mensagens.')
    } finally {
      setCarregando(false)
    }
  }, [dias])

  useEffect(() => { carregar() }, [carregar])

  return (
    <section className="space-y-4 rounded-lg border border-line bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-2">Mensagens enviadas</h2>
        <div className="flex items-center gap-1" role="group" aria-label="Período">
          {PERIODOS.map((p) => (
            <button key={p.dias} type="button" onClick={() => setDias(p.dias)}
              aria-pressed={dias === p.dias}
              className={`rounded-md border px-2 py-1 text-xs transition ${
                dias === p.dias
                  ? 'border-brand bg-brand/10 font-semibold text-brand'
                  : 'border-line text-ink-2 hover:bg-surface-2'
              }`}>
              {p.rotulo}
            </button>
          ))}
        </div>
      </div>

      {erro && (
        <div className="rounded-md border border-line bg-surface-2 px-3 py-2 text-xs text-ink-2">
          <p>{erro}</p>
          <button type="button" onClick={carregar} className="mt-1 font-semibold text-brand underline">
            Tentar de novo
          </button>
        </div>
      )}
      {carregando && !dados && <p className="text-sm text-ink-3">Carregando…</p>}

      {dados && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Numero titulo="Mensagens" valor={dados.mensagens} ajuda={dados.definicoes?.mensagens} />
            <Numero titulo="Pela IA" valor={dados.ia} ajuda={dados.definicoes?.ia} />
            <Numero titulo="Por pessoas" valor={dados.pessoa} ajuda={dados.definicoes?.pessoa} />
            <Numero titulo="Leads contatados" valor={dados.leads_contatados} ajuda={dados.definicoes?.leads_contatados} />
          </div>

          {/* Autoria não registrada NUNCA é distribuída entre IA e pessoas. */}
          {dados.desconhecida > 0 && (
            <p className="rounded-md border border-line bg-surface-2 px-3 py-2 text-xs leading-relaxed text-ink-2">
              <strong>{dados.desconhecida}</strong> mensagem{dados.desconhecida === 1 ? '' : 's'} sem autoria
              registrada. {dados.definicoes?.desconhecida}
            </p>
          )}

          {dados.por_pessoa.length > 0 && (
            <div>
              <h3 className="mb-1 text-xs font-semibold text-ink-2">Por pessoa</h3>
              <ul className="divide-y divide-line rounded-md border border-line">
                {dados.por_pessoa.map((p) => (
                  <li key={p.usuario_id} className="flex items-center justify-between px-3 py-1.5 text-sm">
                    <span className="text-ink">{p.nome}</span>
                    <span className="font-semibold text-ink">{p.mensagens}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {dados.por_instancia.length > 0 && (
            <div>
              <h3 className="mb-1 text-xs font-semibold text-ink-2">Por instância</h3>
              <ul className="divide-y divide-line rounded-md border border-line">
                {dados.por_instancia.map((i) => (
                  <li key={i.evolution_instance} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-sm">
                    <span className="text-ink">{i.nome}</span>
                    <span className="text-xs text-ink-3">
                      {i.leads_contatados} lead{i.leads_contatados === 1 ? '' : 's'} contatado{i.leads_contatados === 1 ? '' : 's'}
                    </span>
                    <span className="font-semibold text-ink">{i.mensagens}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {dados.alerta_operador > 0 && (
            <p className="text-[11px] leading-relaxed text-ink-3">
              {dados.alerta_operador} aviso{dados.alerta_operador === 1 ? '' : 's'} ao operador saíram pelos mesmos
              números e ficam fora dos totais acima. {dados.definicoes?.alerta_operador}
            </p>
          )}

          <p className="text-[11px] leading-relaxed text-ink-3">
            {dados.definicoes?.mensagens} Mensagens enviadas antes deste registro entrar no ar não têm autoria
            e não são recontadas.
          </p>

          {dados.mensagens === 0 && (
            <p className="text-sm text-ink-3">
              Nenhuma mensagem registrada no período. Se o sistema começou a registrar agora, os números
              aparecem a partir dos próximos envios.
            </p>
          )}
        </>
      )}
    </section>
  )
}

/** Número com a definição do que ele conta — exigência deste bloco, não enfeite. */
function Numero({ titulo, valor, ajuda }: { titulo: string; valor: number; ajuda?: string }) {
  return (
    <div className="rounded-md border border-line bg-surface-2 p-3" title={ajuda || undefined}>
      <p className="text-xs text-ink-3">{titulo}</p>
      <p className="mt-0.5 text-xl font-bold text-ink">{valor}</p>
      {ajuda && <p className="mt-1 text-[10px] leading-snug text-ink-3">{ajuda}</p>}
    </div>
  )
}
