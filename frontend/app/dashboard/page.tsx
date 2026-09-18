'use client'
// A PORTA DE ENTRADA do painel — e ela mostra telas DIFERENTES para papéis diferentes.
//
// ─── O DEFEITO QUE ISTO CORRIGE ─────────────────────────────────────────────────────────
// Esta rota chamava `/relatorios/resumo` para todo mundo. Aquela rota exige `RELATORIOS_VER`, que
// nem `comercial` nem `member` têm — então a PRIMEIRA tela depois do login (e, desde o termo, logo
// depois do aceite) era uma mensagem de erro 403. Não era só "administrativa demais": estava
// quebrada para quem mais usa o produto.
//
// ─── COMO A ESCOLHA É FEITA ─────────────────────────────────────────────────────────────
// Por CAPACIDADE, nunca por papel literal (`visaoDoPainel`, em `lib/minha-operacao.js`). E a
// capacidade não é arbitrária: é exatamente a que a tela administrativa precisa para carregar.
// Enquanto a sessão carrega não se escolhe nada — decidir no escuro faria a pessoa ver a visão
// errada por um instante a cada carregamento.
//
// A visão administrativa abaixo NÃO foi alterada: é a mesma de antes, agora num componente
// próprio e alcançada por quem de fato pode vê-la.
import { useEffect, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'
import { useSession } from '@/lib/useSession'
import { visaoDoPainel } from '@/lib/minha-operacao'
import MinhaOperacao from '@/components/MinhaOperacao'

type Resumo = {
  conversas: { ativas: string; fechadas: string; arquivadas: string; total: string }
  por_estagio: { estagio: string; total: string }[]
  followups: { enviados: string; respondidos: string }
  llm_30d: { chamadas: string; input_tokens: string; output_tokens: string; latencia_media_ms: string }
  temperatura: { quente: string; morno: string; frio: string; prontos_handoff: string }
}

const ESTAGIO_LABEL: Record<string, string> = {
  primeiro_contato: 'Primeiro contato',
  diagnostico: 'Diagnóstico',
  proposta: 'Proposta',
  objecao: 'Objeção',
  fechamento: 'Fechamento',
}

export default function DashboardPage() {
  // `redirectOnFail = false`: quem cuida de sessão inválida é o AuthGuard do layout. Um segundo
  // redirecionador aqui competiria com ele.
  const { capacidades, usuario, loading } = useSession(false)
  const visao = visaoDoPainel(capacidades)

  if (loading || visao === null) {
    return <p className="text-sm text-slate-500">Carregando…</p>
  }
  if (visao === 'minha_operacao') {
    return <MinhaOperacao nome={usuario?.nome} />
  }
  return <VisaoGeralAdministrativa />
}

// A Visão Geral de sempre — conteúdo inalterado. Ela vive aqui porque continua sendo o painel de
// quem administra a empresa; só deixou de ser servida a quem não pode carregá-la.
function VisaoGeralAdministrativa() {
  const [dados, setDados] = useState<Resumo | null>(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    const id = getEmpresaId()
    if (!id) { setErro('Nenhuma empresa selecionada.'); return }
    apiFetch<Resumo>(`/api/empresas/${id}/relatorios/resumo`)
      .then((r) => setDados(r.data))
      .catch((e) => setErro(e.message))
  }, [])

  if (erro) return <p className="text-red-600 text-sm">{erro}</p>
  if (!dados) return <p className="text-slate-500 text-sm">Carregando…</p>

  const t = dados.temperatura || { quente: '0', morno: '0', frio: '0', prontos_handoff: '0' }
  const nQuente = Number(t.quente || 0)
  const nMorno = Number(t.morno || 0)
  const nFrio = Number(t.frio || 0)
  const totalTemp = nQuente + nMorno + nFrio
  const pct = (n: number) => (totalTemp > 0 ? Math.round((n / totalTemp) * 100) : 0)

  const tokens = Number(dados.llm_30d?.input_tokens || 0) + Number(dados.llm_30d?.output_tokens || 0)

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Visão Geral</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card title="Conversas ativas" value={dados.conversas?.ativas ?? '—'} />
        <Card title="Leads quentes" value={t.quente ?? '0'} accent="text-orange-600" />
        <Card title="Prontos p/ handoff" value={t.prontos_handoff ?? '0'} accent="text-emerald-600" />
        <Card title="Vendas fechadas" value={dados.conversas?.fechadas ?? '0'} />
      </div>

      <section className="grid md:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl shadow-sm border p-5">
          <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wide mb-4">Temperatura dos leads</h2>
          {totalTemp === 0 ? (
            <p className="text-slate-400 text-sm">Sem leads classificados ainda.</p>
          ) : (
            <div className="space-y-3">
              <TempBar label="🔥 Quente" n={nQuente} pct={pct(nQuente)} color="bg-orange-500" />
              <TempBar label="🌤️ Morno" n={nMorno} pct={pct(nMorno)} color="bg-amber-400" />
              <TempBar label="❄️ Frio" n={nFrio} pct={pct(nFrio)} color="bg-sky-400" />
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border p-5">
          <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wide mb-4">Funil comercial</h2>
          {dados.por_estagio.length === 0 ? (
            <p className="text-slate-400 text-sm">Sem conversas ativas.</p>
          ) : (
            <ul className="space-y-2">
              {dados.por_estagio.map((row) => (
                <li key={row.estagio} className="flex items-center justify-between text-sm">
                  <span className="text-slate-700">{ESTAGIO_LABEL[row.estagio] || row.estagio}</span>
                  <span className="font-semibold">{row.total}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card title="Follow-ups enviados" value={dados.followups?.enviados ?? '0'} small />
        <Card title="Follow-ups respondidos" value={dados.followups?.respondidos ?? '0'} small />
        <Card title="Chamadas IA (30d)" value={dados.llm_30d?.chamadas ?? '0'} small />
        <Card title="Tokens IA (30d)" value={tokens.toLocaleString('pt-BR')} small />
      </section>
    </div>
  )
}

function Card({ title, value, accent, small }: { title: string; value: string | number; accent?: string; small?: boolean }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border p-5">
      <p className="text-xs text-slate-500 uppercase tracking-wide">{title}</p>
      <p className={`${small ? 'text-2xl' : 'text-3xl'} font-bold mt-1 ${accent || 'text-slate-900'}`}>{value}</p>
    </div>
  )
}

function TempBar({ label, n, pct, color }: { label: string; n: number; pct: number; color: string }) {
  return (
    <div>
      <div className="flex justify-between text-xs text-slate-600 mb-1">
        <span>{label}</span>
        <span>{n} ({pct}%)</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
