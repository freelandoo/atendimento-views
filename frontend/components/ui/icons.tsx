// Ícones de linha do painel — mesmo estilo da Sidebar (stroke currentColor, 2px,
// cantos arredondados). Herdam a cor do texto/botão. Uso: <IconTrash className="h-4 w-4" />.
// Centraliza os ícones para NÃO duplicar SVG por tela.
import type { SVGProps } from 'react'

const base = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}
type P = { className?: string } & SVGProps<SVGSVGElement>
const Svg = ({ className = 'h-4 w-4', children, ...r }: P & { children: React.ReactNode }) => (
  <svg {...base} className={className} {...r}>{children}</svg>
)

export const IconCalendar = (p: P) => (
  <Svg {...p}><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M4 9h16M8 3v4M16 3v4" /></Svg>
)
export const IconTrash = (p: P) => (
  <Svg {...p}><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" /><path d="M9 7V4h6v3" /></Svg>
)
export const IconStar = (p: P) => (
  <Svg {...p}><path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8-4.2-4.1 5.9-.9z" /></Svg>
)
export const IconUndo = (p: P) => (
  <Svg {...p}><path d="M4 8h11a5 5 0 0 1 0 10H9" /><path d="M7 4L3 8l4 4" /></Svg>
)
export const IconPlay = (p: P) => (
  <Svg {...p}><path d="M7 5l11 7-11 7z" /></Svg>
)
export const IconPause = (p: P) => (
  <Svg {...p}><path d="M8 5v14M16 5v14" /></Svg>
)
export const IconDownload = (p: P) => (
  <Svg {...p}><path d="M12 3v12" /><path d="M7 11l5 5 5-5" /><path d="M5 21h14" /></Svg>
)
export const IconGear = (p: P) => (
  <Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></Svg>
)
export const IconFlask = (p: P) => (
  <Svg {...p}><path d="M9 3h6" /><path d="M10 3v6l-5 8a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-8V3" /><path d="M7.5 14h9" /></Svg>
)
export const IconBroom = (p: P) => (
  <Svg {...p}><path d="M8 20l-4-4 9-9 4 4-9 9z" /><path d="M4 20h6" /><path d="M13 7l4 4" /></Svg>
)
export const IconLock = (p: P) => (
  <Svg {...p}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Svg>
)
export const IconEnvelope = (p: P) => (
  <Svg {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M4 7l8 6 8-6" /></Svg>
)
export const IconSend = (p: P) => (
  <Svg {...p}><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></Svg>
)
export const IconClose = (p: P) => (
  <Svg {...p}><path d="M6 6l12 12M18 6L6 18" /></Svg>
)
export const IconCheck = (p: P) => (
  <Svg {...p}><path d="M5 12l5 5L20 6" /></Svg>
)
export const IconThumbUp = (p: P) => (
  <Svg {...p}><path d="M7 10v11" /><path d="M15 5l-1 5h5a2 2 0 0 1 2 2.3l-1 6A3 3 0 0 1 17 21H7" /><path d="M7 10H4a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3" /></Svg>
)
export const IconThumbDown = (p: P) => (
  <Svg {...p}><path d="M7 14V3" /><path d="M15 19l-1-5h5a2 2 0 0 0 2-2.3l-1-6A3 3 0 0 0 17 3H7" /><path d="M7 14H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h3" /></Svg>
)
export const IconPlus = (p: P) => (
  <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>
)
// Brilho/estrela de IA — usado no gatilho do Assistente de Oportunidades.
export const IconSparkle = (p: P) => (
  <Svg {...p}><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" /></Svg>
)
// Copiar + brilho de IA. O traço do "copiar" herda a cor do botão; o brilho é laranja
// (mesma família visual do gatilho de IA do produto — ver RotinasAquisicao).
export const IconCopySparkle = (p: P) => (
  <Svg {...p}>
    <rect x="8" y="9" width="11" height="11" rx="2" />
    <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    <path className="text-orange-500" stroke="currentColor" d="M19 1.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
  </Svg>
)
export const IconAlert = (p: P) => (
  <Svg {...p}><path d="M12 3l9 16H3l9-16z" /><path d="M12 10v4M12 17h.01" /></Svg>
)
// Caixa de arquivo — guardar sem apagar. Usado no arquivamento de roteiro, que e' reversivel;
// nao confundir com IconTrash, que sinaliza remocao.
export const IconArchive = (p: P) => (
  <Svg {...p}><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" /><path d="M10 12h4" /></Svg>
)
// Seta de expandir/recolher. Aponta para baixo por padrao; a tela gira com `rotate-*`.
export const IconChevron = (p: P) => (
  <Svg {...p}><path d="M6 9l6 6 6-6" /></Svg>
)
