'use client'
/**
 * AQUISIÇÃO — uma área, três trabalhos: **Resultados · Buscas · Rotinas**.
 *
 * ⚠️ O QUE MUDOU E POR QUÊ. Esta página tinha três "sessões" por FONTE (Google Places ·
 * Instagram · Meta), e cada uma renderizava uma tela inteira e diferente: três listas de
 * resultados, três acompanhamentos, três jeitos de olhar a mesma carteira. Um lead do Instagram
 * era invisível para quem estava na sessão do Places, e não havia como ver tudo junto.
 *
 * A fonte não some — ela vira **filtro** e **coluna** na lista (`lib/lead-origem.js`), e o
 * formulário de cada fonte continua existindo, dentro de **Buscas**. É a mesma correção que o
 * Banco de Leads recebeu: origem é DADO da linha, não o título de uma tela.
 *
 * ⚠️ A LISTA UNIFICADA SÓ É HONESTA PORQUE A PAGINAÇÃO É DO SERVIDOR. Todas as origens vivem em
 * `prospectador.prospects` e `GET /prospeccao/prospects` pagina e ordena lá — juntar no
 * navegador uma página de cada endpoint não produziria uma lista global, produziria um recorte
 * que ninguém consegue explicar.
 *
 * ⚠️ **META NÃO TEM ROTINA, e a tela diz isso.** Places tem rotina de coleta e Instagram tem
 * campanhas agendadas; a Biblioteca de Anúncios é **sob demanda** (todo gasto tem um clique
 * humano atrás). Inventar aqui uma "rotina Meta" por analogia visual prometeria uma automação
 * que o backend não executa.
 */
import { useState } from 'react'
import ProspeccaoPainel from '@/components/ProspeccaoPainel'
import CaptacaoPage from '../captacao/page'

type Fonte = 'places' | 'instagram' | 'meta_ads'

/** As fontes de COLETA. Cada uma tem o seu formulário — juntá-los num só seria inventar campos. */
const FONTES: { valor: Fonte; label: string; desc: string }[] = [
  { valor: 'places', label: 'Google Places', desc: 'Empresas por nicho e cidade no mapa' },
  { valor: 'instagram', label: 'Instagram', desc: 'Perfis por hashtag, nicho ou @semente' },
  { valor: 'meta_ads', label: 'Anúncios Meta', desc: 'Anunciantes ativos por termo de anúncio' },
]

/** Fontes com coleta contínua. A Meta fica de fora — e a ausência é DITA, não escondida. */
const FONTES_COM_ROTINA = new Set<Fonte>(['places', 'instagram'])

function SeletorFonte({ fonte, onFonte, apenasComRotina }: {
  fonte: Fonte
  onFonte: (f: Fonte) => void
  apenasComRotina?: boolean
}) {
  const opcoes = apenasComRotina ? FONTES.filter((f) => FONTES_COM_ROTINA.has(f.valor)) : FONTES
  return (
    <div className="rounded-xl border border-line bg-surface p-3 shadow-card">
      <p id="fonte-rotulo" className="mb-1.5 text-xs text-ink-3">
        {apenasComRotina ? 'Fonte da coleta contínua' : 'Onde procurar'}
      </p>
      <div role="radiogroup" aria-labelledby="fonte-rotulo" className="flex flex-wrap gap-1.5">
        {opcoes.map((f) => (
          <button
            key={f.valor}
            type="button"
            role="radio"
            aria-checked={fonte === f.valor}
            title={f.desc}
            onClick={() => onFonte(f.valor)}
            className={`inline-flex h-9 items-center rounded-lg border px-3 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
              fonte === f.valor
                ? 'border-brand bg-brand/5 font-semibold text-brand'
                : 'border-line bg-surface text-ink-2 hover:bg-surface-2'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      {apenasComRotina && (
        // A ausência da rotina da Meta é informação, não lacuna: sem esta frase o operador
        // procuraria um botão que não existe.
        <p className="mt-2 text-[11px] leading-snug text-ink-3">
          A busca por <b>Anúncios Meta</b> é sob demanda — ela não tem coleta contínua, e cada
          execução parte de um clique. Ela fica em <b>Buscas</b>.
        </p>
      )}
    </div>
  )
}

export default function AquisicaoPage() {
  // A fonte do FORMULÁRIO. Ela não recorta a lista de Resultados — quem faz isso é o filtro de
  // origem, dentro do painel. São dois eixos, e confundi-los foi o que criou as três telas.
  const [fonte, setFonte] = useState<Fonte>('places')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Aquisição</h1>
        <p className="mt-1 text-sm text-ink-3">
          Encontrar leads novos e acompanhar o que as coletas trouxeram. Tudo cai no Banco de
          Leads, onde o trabalho de abordagem acontece.
        </p>
      </div>

      <ProspeccaoPainel
        fonteBusca={fonte}
        embutida
        conteudoBuscas={
          <div className="space-y-4">
            <SeletorFonte fonte={fonte} onFonte={setFonte} />
            {/* A coleta de Instagram tem tela própria (campanhas, cotas, sementes). Ela é
                injetada aqui em vez de reimplementada: duplicar aquele fluxo criaria duas
                regras de cota sobre a MESMA conta paga. */}
            {fonte === 'instagram' && <CaptacaoPage />}
          </div>
        }
        conteudoRotinas={
          <div className="space-y-4">
            <SeletorFonte
              fonte={FONTES_COM_ROTINA.has(fonte) ? fonte : 'places'}
              onFonte={setFonte}
              apenasComRotina
            />
            {fonte === 'instagram' && <CaptacaoPage />}
          </div>
        }
      />
    </div>
  )
}
