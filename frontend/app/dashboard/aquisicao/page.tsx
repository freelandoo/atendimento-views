'use client'
import { useState } from 'react'
import ProspeccaoPage from '../prospeccao/page'
import CaptacaoPage from '../captacao/page'

// Aquisição — reúne as duas frentes de geração de leads em sessões.
// Cada sessão reaproveita INTEGRALMENTE a tela existente (pesquisar / programar /
// deixar o worker rodando), sem duplicar lógica. O Banco de Leads (página própria)
// consolida o que as duas sessões coletam.
const SESSOES: { valor: string; label: string; desc: string }[] = [
  { valor: 'places', label: 'Google Places', desc: 'Empresas por nicho e cidade no mapa' },
  { valor: 'instagram', label: 'Instagram', desc: 'Perfis por hashtag, nicho ou @semente' },
]

export default function AquisicaoPage() {
  const [sessao, setSessao] = useState('places')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Aquisição</h1>
        <p className="text-sm text-slate-500 mt-1">
          Pesquise, programe e deixe o robô trabalhando. Duas fontes, o mesmo funil —
          tudo cai no Banco de Leads.
        </p>
      </div>

      <div className="inline-flex rounded-xl border bg-white p-1 shadow-sm">
        {SESSOES.map((s) => (
          <button key={s.valor} onClick={() => setSessao(s.valor)}
            title={s.desc}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              sessao === s.valor ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-50'
            }`}>
            {s.label}
          </button>
        ))}
      </div>

      <div>
        {sessao === 'places' ? <ProspeccaoPage /> : <CaptacaoPage />}
      </div>
    </div>
  )
}
