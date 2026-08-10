'use client'
// Detalhes do lead — destino declarado dos campos que saíram das tabelas operacionais.
//
// Por que existe: Aquisição e Banco de Leads carregavam 14 colunas cada, e duas delas eram
// dado TÉCNICO numa tela de trabalho (o botão `{ }` de JSON cru). A regra desta mudança é que
// nada sai da tabela sem destino: avaliação, nota, horário e endereço passaram a viver aqui e
// no tooltip da bolinha, e o JSON deixou de ser uma coluna para virar um botão DENTRO dos
// detalhes — o `JsonLeadModal` continua existindo porque carrega o prompt unificado, que é
// ferramenta de trabalho real.
//
// Um único componente serve as duas telas de propósito: eram elas que já duplicavam colunas,
// pontuação e JSON. Os campos ausentes simplesmente não aparecem — perfil de Instagram não
// tem endereço nem nota, e uma linha "—" para cada um só encheria a tela.
import { useState } from 'react'
import JsonLeadModal, { type JsonApresentacao, type CriterioApresentacao } from '@/components/ui/JsonLeadModal'
import BolinhaPontuacao from '@/components/ui/BolinhaPontuacao'
import { rotuloLink, tituloLinkNaoSite } from '@/lib/site-rotulos'
import {
  VARIANTES, O_QUE_MEDE, NOTA_COMPLETUDE, fatoresDeCadastro, leituraCadastro,
} from '@/lib/pontuacao-indicador'

type JsonApresLead = JsonApresentacao & {
  empresa?: { horario_funcionamento?: boolean; fotos?: number }
}

/** O mínimo que as duas telas têm em comum. Tudo é opcional: origens diferentes, campos diferentes. */
export type LeadDetalhavel = {
  id: string
  nome: string
  origem?: string
  telefone?: string | null
  email?: string | null
  nicho?: string | null
  cidade?: string | null
  endereco?: string | null
  rating?: number | null
  avaliacoes?: number | null
  seguidores?: number | null
  instagram_handle?: string | null
  bio?: string | null
  tem_site?: boolean | null
  site?: string | null
  link_original?: string | null
  link_bio?: string | null
  classificacao_url?: string | null
  /** Veredito de 3 estados do backend. É ele que a bolinha de cadastro passou a dizer. */
  situacao_site?: 'tem_site' | 'sem_site' | 'nao_identificado' | null
  maps_url?: string | null
  score_cadastro?: number | null
  score_cadastro_max?: number | null
  score_cadastro_criterios?: CriterioApresentacao[] | null
  json_apresentacao?: JsonApresLead | null
}

/**
 * Critérios da completude. A Aquisição recebe `score_cadastro_criterios` direto na listagem; o
 * Banco de Leads recebe os mesmos critérios dentro de `json_apresentacao.pontuacao`. Mesma
 * função do backend nos dois casos — aqui só se escolhe por qual porta eles chegaram.
 */
export function criteriosDoLead(l: LeadDetalhavel): CriterioApresentacao[] {
  if (Array.isArray(l.score_cadastro_criterios) && l.score_cadastro_criterios.length) return l.score_cadastro_criterios
  const doJson = l.json_apresentacao?.pontuacao?.criterios
  return Array.isArray(doJson) ? doJson : []
}

/** Teto da escala: Places 100, Instagram 60. Nunca assumido — vem do backend. */
export function maximoDoLead(l: LeadDetalhavel): number {
  const m = l.score_cadastro_max ?? l.json_apresentacao?.pontuacao?.maximo
  return typeof m === 'number' && Number.isFinite(m) && m > 0 ? m : 100
}

/**
 * Bolinha de COMPLETUDE pronta para as tabelas — o mesmo veredito nas duas telas.
 *
 * A coluna "Site" saiu da Aquisição e do Banco de Leads (decisão do operador em 2026-08-10):
 * a situação do site passou a ser lida DENTRO desta pontuação, onde ela já valia 20 dos 100
 * pontos. Por isso o contexto de site é passado ao tradutor de fatores — sem ele, o balão
 * diria só "Tem site próprio ✗", que não distingue "não tem" (a oportunidade) de "ninguém
 * verificou". O LINK continua clicável em "Detalhes": balão de hover é `pointer-events-none`,
 * e link dentro dele seria inalcançável.
 */
export function BolinhaCadastro({ l }: { l: LeadDetalhavel }) {
  const maximo = maximoDoLead(l)
  const criterios = criteriosDoLead(l)
  const leitura = leituraCadastro(l.score_cadastro, maximo, criterios)
  const instagram = l.origem === 'instagram' || l.origem === 'linkedin' || maximo === 60
  return (
    <BolinhaPontuacao
      valor={l.score_cadastro}
      maximo={maximo}
      faixa={leitura.faixa}
      titulo={leitura.titulo}
      oQueMede={instagram ? O_QUE_MEDE.cadastro_instagram : O_QUE_MEDE.cadastro_places}
      fatores={fatoresDeCadastro(criterios, {
        situacaoSite: l.situacao_site,
        rotuloLink: rotuloLink(l.classificacao_url),
      })}
      nota={NOTA_COMPLETUDE}
      variante={VARIANTES.COMPLETUDE}
      rotuloSemValor="Cadastro não avaliado"
    />
  )
}

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 py-1 text-sm">
      <dt className="w-32 shrink-0 text-xs text-slate-500">{rotulo}</dt>
      <dd className="min-w-0 flex-1 break-words text-slate-800">{children}</dd>
    </div>
  )
}

export default function LeadDetalhesModal({ lead, onFechar }: { lead: LeadDetalhavel; onFechar: () => void }) {
  const [jsonAberto, setJsonAberto] = useState(false)
  const emp = lead.json_apresentacao?.empresa
  const horario = emp?.horario_funcionamento
  const fotos = emp?.fotos
  const criterios = criteriosDoLead(lead)
  const maximo = maximoDoLead(lead)
  const handle = (lead.instagram_handle || '').replace(/^@/, '')

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onFechar}>
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Detalhes de ${lead.nome}`}
          className="max-h-[85vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold">{lead.nome || '—'}</h3>
              <p className="text-xs text-slate-500">{[lead.nicho, lead.cidade].filter(Boolean).join(' · ') || 'Sem mercado informado'}</p>
            </div>
            <button onClick={onFechar} aria-label="Fechar detalhes" className="text-lg leading-none text-slate-400 hover:text-slate-600">×</button>
          </div>

          {/* Pontuação: a MESMA bolinha da tabela, com os critérios abertos em lista — no
              tooltip eles são um resumo; aqui dá para conferir item a item. */}
          <div className="rounded-xl border bg-slate-50 px-3 py-3">
            <div className="flex items-center gap-3">
              <BolinhaCadastro l={lead} />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-800">{leituraCadastro(lead.score_cadastro, maximo, criterios).titulo}</div>
                <div className="text-xs text-slate-500">{NOTA_COMPLETUDE}</div>
              </div>
            </div>
            {criterios.length > 0 && (
              <ul className="mt-3 grid grid-cols-1 gap-1 sm:grid-cols-2">
                {criterios.map((c, i) => (
                  <li key={c.chave || i} className={`flex items-center gap-1.5 text-xs ${c.ok ? 'text-slate-700' : 'text-slate-400'}`}>
                    <span aria-hidden="true">{c.ok ? '✓' : '✗'}</span>
                    <span>{c.label}</span>
                    {!c.ok && <span className="text-[10px] text-slate-400">(+{c.pontos_possiveis ?? 0})</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Dados complementares: é para cá que vieram Endereço, Nota, Avaliações e Horário
              quando saíram das colunas da tabela. */}
          <dl className="divide-y">
            {lead.telefone && <Linha rotulo="Telefone"><span className="font-mono text-xs">{lead.telefone}</span></Linha>}
            {lead.email && <Linha rotulo="E-mail"><span className="text-xs">{lead.email}</span></Linha>}
            {lead.endereco && <Linha rotulo="Endereço"><span className="text-xs">{lead.endereco}</span></Linha>}
            {(lead.rating != null || lead.avaliacoes != null) && (
              <Linha rotulo="Reputação">
                <span className="text-xs">
                  {lead.rating != null ? `Nota ${Number(lead.rating).toFixed(1)}` : 'Sem nota'}
                  {' · '}
                  {lead.avaliacoes != null ? `${lead.avaliacoes} avaliações` : 'sem avaliações'}
                </span>
              </Linha>
            )}
            {horario != null && (
              <Linha rotulo="Horário"><span className="text-xs">{horario ? 'Cadastrado no Google' : 'Não cadastrado'}</span></Linha>
            )}
            {fotos != null && <Linha rotulo="Fotos"><span className="text-xs">{fotos}</span></Linha>}
            {lead.seguidores != null && (
              <Linha rotulo="Seguidores"><span className="text-xs">{lead.seguidores.toLocaleString('pt-BR')}</span></Linha>
            )}
            {handle && (
              <Linha rotulo="@username">
                <a href={`https://instagram.com/${handle}`} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline">@{handle}</a>
              </Linha>
            )}
            {/* O link não-site continua acessível, dito pelo que ele é — nunca como "site". */}
            <Linha rotulo="Presença digital">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                {lead.tem_site && lead.site && (
                  <a href={lead.site} target="_blank" rel="noreferrer" className="text-brand hover:underline">site próprio ↗</a>
                )}
                {!lead.tem_site && lead.link_original && (
                  <a href={lead.link_original} target="_blank" rel="noreferrer" className="text-slate-500 hover:underline"
                    title={tituloLinkNaoSite(lead.classificacao_url, lead.link_original)}>
                    {rotuloLink(lead.classificacao_url) || 'link'} ↗
                  </a>
                )}
                {lead.link_bio && (
                  <a href={lead.link_bio} target="_blank" rel="noreferrer" className="text-slate-500 hover:underline">link da bio ↗</a>
                )}
                {lead.maps_url && (
                  <a href={lead.maps_url} target="_blank" rel="noreferrer" className="text-slate-500 hover:underline">ficha no Maps ↗</a>
                )}
                {!lead.site && !lead.link_original && !lead.link_bio && !lead.maps_url && <span className="text-slate-400">Nenhum link</span>}
              </div>
            </Linha>
            {lead.bio && <Linha rotulo="Bio"><span className="text-xs text-slate-600">{lead.bio}</span></Linha>}
          </dl>

          {/* O JSON saiu da tabela e vive aqui: continua a um clique de quem precisa dele,
              sem ocupar uma coluna da tela de trabalho. */}
          {lead.json_apresentacao && (
            <div className="flex justify-end border-t pt-3">
              <button
                onClick={() => setJsonAberto(true)}
                className="rounded-lg border px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                title="Dados unificados + prompt único pro bot gerar a saudação de análise"
              >
                Ver dados completos
              </button>
            </div>
          )}
        </div>
      </div>
      {jsonAberto && lead.json_apresentacao && (
        <JsonLeadModal titulo={lead.nome} json={lead.json_apresentacao} onFechar={() => setJsonAberto(false)} />
      )}
    </>
  )
}
