'use client'
// Controle de ativacao PADRONIZADO: rotulo + icone de informacao + interruptor.
//
// POR QUE ELE EXISTE
// Cada tela desenhava o seu: o Follow-up automatico era um `<button aria-pressed>` com
// borda colorida e o texto "Follow-up automatico: ativo/desativado" repetindo, por extenso,
// o que o proprio controle ja mostra. O estado cabe no interruptor; a CONSEQUENCIA de
// ligar/desligar cabe no balao — que so' ocupa espaco quando alguem pergunta.
//
// O ESTADO NUNCA E' SO' COR: a posicao do botao dentro do trilho e' o sinal principal (forma,
// nao cor), `role="switch"` + `aria-checked` levam o estado ao leitor de tela e o `ariaLabel`
// diz o que o controle faz. Por isso nao ha — e nao deve voltar — nenhum "Ativo"/"Desativo"
// escrito ao lado.
//
// Este componente NAO decide nada: recebe `ligado` e devolve o clique. Regra de negocio,
// permissao e persistencia continuam de quem o usa.
import BalaoAjuda from '@/components/ui/BalaoAjuda'

export default function InterruptorAtivacao({
  rotulo,
  ligado,
  onMudar,
  ajuda,
  ariaLabel,
  desabilitado = false,
}: {
  /** O NOME do que se liga (ex.: "Follow-up automático"). Nunca o estado. */
  rotulo: string
  ligado: boolean
  onMudar: (novo: boolean) => void
  /** Frase curta no balao: o efeito de ligar e o de desligar. */
  ajuda: string
  /** Frase completa (acao + estado atual) para o leitor de tela. */
  ariaLabel: string
  /** Enquanto o valor real ainda nao chegou ou a acao esta bloqueada. */
  desabilitado?: boolean
}) {
  return (
    <div className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 shadow-sm">
      <span className="text-sm font-medium text-slate-700">{rotulo}</span>
      <BalaoAjuda texto={ajuda} rotuloAcessivelBotao={`O que faz ${rotulo}`} />
      <button
        type="button"
        role="switch"
        aria-checked={ligado}
        aria-label={ariaLabel}
        disabled={desabilitado}
        onClick={() => onMudar(!ligado)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${
          ligado ? 'bg-emerald-600' : 'bg-slate-300'
        }`}
      >
        <span
          aria-hidden="true"
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
            ligado ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  )
}
