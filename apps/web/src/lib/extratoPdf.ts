// Geração do PDF de extrato de operações (admin → Operações → usuário).
//
// Módulo isolado: NÃO altera nenhuma regra de saldo, operação ou cálculo.
// Apenas LÊ os mesmos endpoints que o drawer já consome e formata em PDF.
//
// jsPDF + autotable são importados dinamicamente (~350kB) para não entrarem
// no bundle inicial da plataforma — só carregam quando o admin clica no botão.

import { api } from './api'
import { VX_LOGO_PNG_BASE64, VX_LOGO_ASPECT } from './vxLogoBase64'

// ── Tipos (espelham o que a API já devolve) ───────────────────────────────

export interface ExtratoUser {
  id:        string
  name:      string
  email:     string
  lastName?: string | null
  cpf?:      string | null
  phone?:    string | null
  createdAt?: string | null
}

export interface ExtratoAccount {
  type:         'REAL' | 'DEMO'
  balance:      string
  bonusBalance?: string
}

export interface ExtratoKpis {
  totalGanho:      string
  totalPerdido:    string
  totalDepositado: string
}

export interface OpRow {
  id:           string
  assetSymbol:  string
  direction:    'CALL' | 'PUT' | null
  amount:       string
  entryPrice:   string | null
  exitPrice:    string | null
  profit:       string | null
  status:       string
  openedAt:     string
  timeframeSec?: number
  kind?:        string
}

// ── Helpers de formatação ─────────────────────────────────────────────────

const brl = (v: number | string) =>
  (typeof v === 'number' ? v : parseFloat(v) || 0)
    .toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function dataHora(iso: string) {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return {
    data: `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`,
    hora: `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`,
  }
}

function mascaraCpf(cpf?: string | null) {
  if (!cpf) return '—'
  const d = cpf.replace(/\D/g, '')
  if (d.length !== 11) return cpf
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}

function expiracao(sec?: number) {
  if (!sec || sec <= 0) return '—'
  if (sec < 60)   return `${sec}s`
  if (sec < 3600) return `${Math.round(sec / 60)}min`
  return `${Math.round(sec / 3600)}h`
}

/** Rótulos iguais aos exibidos na tela, para o PDF bater com o que o admin vê. */
const STATUS_LABEL: Record<string, string> = {
  OPEN:      'Aguardando',
  WON:       'Ganhou',
  LOST:      'Perdeu',
  CANCELLED: 'Cancelada',
  DRAW:      'Empate',
  PURCHASE:  'Compra',
}

function tipoOperacao(op: OpRow) {
  if (op.kind === 'COPY')          return 'Copy Trading'
  if (op.kind === 'COPY_PURCHASE') return 'Compra de Copy'
  if (op.direction === 'CALL')     return 'CALL (Alta)'
  if (op.direction === 'PUT')      return 'PUT (Baixa)'
  return '—'
}

/** Valor efetivamente creditado/debitado — mesma regra usada na tela. */
function resultadoFinanceiro(op: OpRow): number | null {
  const stake  = parseFloat(op.amount) || 0
  const profit = op.profit != null ? parseFloat(op.profit) : null
  if (op.kind === 'COPY' || op.kind === 'COPY_PURCHASE') return profit
  if (op.status === 'WON')  return profit ?? 0
  if (op.status === 'LOST') return -stake
  return null   // OPEN, CANCELLED, DRAW → sem impacto
}

// ── Busca TODAS as operações (o endpoint limita a 100 por página) ─────────

async function buscarTodasOperacoes(userId: string, onProgresso?: (n: number) => void): Promise<OpRow[]> {
  const PAGE = 100
  const todas: OpRow[] = []
  let page = 1
  let total = Infinity
  // Trava de segurança: 200 páginas = 20.000 operações. Evita laço infinito
  // caso a API mude o contrato de paginação.
  while (todas.length < total && page <= 200) {
    const res = await api.get<{ operations: OpRow[]; total: number }>('/admin/operations', {
      params: { userId, page, pageSize: PAGE, accountType: 'REAL' },
    })
    total = res.data.total ?? 0
    const lote = res.data.operations ?? []
    todas.push(...lote)
    onProgresso?.(todas.length)
    if (lote.length < PAGE) break
    page++
  }
  return todas
}

// ── Geração do PDF ────────────────────────────────────────────────────────

export async function gerarExtratoPdf(opts: {
  user:     ExtratoUser
  accounts: ExtratoAccount[]
  kpis?:    ExtratoKpis
  onProgresso?: (n: number) => void
}): Promise<{ arquivo: string; operacoes: number }> {
  const ops = await buscarTodasOperacoes(opts.user.id, opts.onProgresso)
  return montarPdf({ ...opts, operacoes: ops })
}

/**
 * Monta e baixa o PDF a partir de dados JÁ carregados.
 * Separado de `gerarExtratoPdf` para poder ser exercitado fora do navegador
 * (o jsPDF roda em Node), sem depender do axios/sessão de admin.
 */
export async function montarPdf(opts: {
  user:       ExtratoUser
  accounts:   ExtratoAccount[]
  kpis?:      ExtratoKpis
  operacoes:  OpRow[]
  /** Em Node não há download: devolve o Buffer em vez de salvar. */
  retornarBuffer?: boolean
}): Promise<{ arquivo: string; operacoes: number; paginas: number; buffer?: ArrayBuffer }> {
  const { user, accounts, kpis, operacoes: ops } = opts

  const [{ jsPDF }, autoTableMod] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])
  const autoTable = (autoTableMod as any).default ?? autoTableMod

  // Paisagem: são 11 colunas — em retrato elas ficariam ilegíveis.
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const LARGURA = doc.internal.pageSize.getWidth()
  const geradoEm = new Date()
  const g = dataHora(geradoEm.toISOString())

  const VERDE  = [16, 185, 129] as [number, number, number]
  const ESCURO = [17, 24, 39] as [number, number, number]
  const CINZA  = [107, 114, 128] as [number, number, number]

  // ── Cabeçalho ──────────────────────────────────────────────────────────
  doc.setFillColor(...ESCURO)
  doc.rect(0, 0, LARGURA, 26, 'F')

  // Logo oficial embutida (a arte tem texto branco, feita para fundo escuro).
  // Se por qualquer motivo a imagem falhar, cai no texto — o extrato nunca
  // deixa de ser gerado por causa da marca.
  const LOGO_W = 34
  const LOGO_H = LOGO_W / VX_LOGO_ASPECT
  try {
    doc.addImage(
      `data:image/png;base64,${VX_LOGO_PNG_BASE64}`,
      'PNG', 14, (26 - LOGO_H) / 2 - 3, LOGO_W, LOGO_H,
    )
  } catch {
    doc.setTextColor(...VERDE)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15)
    doc.text('VX GLOBAL', 14, 12)
  }

  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12)
  doc.text('EXTRATO DE OPERAÇÕES', 14, 21)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
  doc.setTextColor(200, 200, 200)
  doc.text(`Gerado em ${g.data} às ${g.hora}`, LARGURA - 14, 12, { align: 'right' })
  doc.text(`${ops.length} ${ops.length === 1 ? 'operação' : 'operações'}`, LARGURA - 14, 18, { align: 'right' })

  // ── Dados cadastrais ───────────────────────────────────────────────────
  const nomeCompleto = [user.name, user.lastName].filter(Boolean).join(' ') || '—'
  const cadastro: Array<[string, string]> = [
    ['Nome completo', nomeCompleto],
    ['CPF',           mascaraCpf(user.cpf)],
    ['E-mail',        user.email],
    ['ID da conta',   user.id],
  ]
  if (user.phone)     cadastro.push(['Telefone', user.phone])
  if (user.createdAt) cadastro.push(['Cliente desde', dataHora(user.createdAt).data])

  autoTable(doc, {
    startY: 32,
    body: cadastro,
    theme: 'plain',
    styles: { fontSize: 8.5, cellPadding: 1.4, textColor: ESCURO },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 32, textColor: CINZA },
      1: { cellWidth: 'auto' },
    },
    margin: { left: 14, right: 14 },
  })

  // ── Tabela de operações ────────────────────────────────────────────────
  const corpo = ops.map((op) => {
    const dt  = dataHora(op.openedAt)
    const res = resultadoFinanceiro(op)
    return [
      dt.data,
      dt.hora,
      op.assetSymbol || '—',
      tipoOperacao(op),
      `R$ ${brl(op.amount)}`,
      expiracao(op.timeframeSec),
      op.entryPrice ?? '—',
      op.exitPrice ?? '—',
      STATUS_LABEL[op.status] ?? op.status,
      res == null ? '—' : `${res >= 0 ? '+' : '-'}R$ ${brl(Math.abs(res))}`,
      op.id.slice(0, 8).toUpperCase(),
    ]
  })

  const afterCadastro = (doc as any).lastAutoTable?.finalY ?? 60

  autoTable(doc, {
    startY: afterCadastro + 4,
    head: [[
      'Data', 'Hora', 'Ativo', 'Tipo', 'Valor', 'Expiração',
      'Entrada', 'Saída', 'Resultado', 'Ganho/Perda', 'ID',
    ]],
    body: corpo.length ? corpo : [[{
      content: 'Nenhuma operação registrada para esta conta.',
      colSpan: 11,
      styles: { halign: 'center', textColor: CINZA },
    } as any]],
    theme: 'striped',
    headStyles: { fillColor: ESCURO, textColor: 255, fontSize: 8, fontStyle: 'bold' },
    styles: { fontSize: 7.5, cellPadding: 1.2, overflow: 'linebreak' },
    alternateRowStyles: { fillColor: [246, 248, 250] },
    // LARGURAS (mm) — somam exatamente 277 = área útil do A4 paisagem
    // (297 − 2×10 de margem). O cellPadding já está INCLUÍDO no cellWidth.
    // Fechar a soma na largura útil evita o aviso "could not fit" do
    // autotable, que dispara tanto quando a tabela transborda quanto quando
    // ela sobra e não consegue esticar (todas as colunas são fixas aqui).
    columnStyles: {
      0:  { cellWidth: 20 },                    // Data
      1:  { cellWidth: 18 },                    // Hora
      2:  { cellWidth: 36 },                    // Ativo
      3:  { cellWidth: 32 },                    // Tipo
      4:  { cellWidth: 24, halign: 'right'  },  // Valor
      5:  { cellWidth: 18, halign: 'center' },  // Expiração
      6:  { cellWidth: 27, halign: 'right'  },  // Entrada
      7:  { cellWidth: 27, halign: 'right'  },  // Saída
      8:  { cellWidth: 24, halign: 'center' },  // Resultado
      9:  { cellWidth: 31, halign: 'right'  },  // Ganho/Perda
      10: { cellWidth: 20 },                    // ID
    },
    margin: { left: 10, right: 10, bottom: 18 },
    // Colore o resultado: verde para ganho, vermelho para perda.
    didParseCell: (d: any) => {
      if (d.section !== 'body' || d.column.index !== 9) return
      const txt = String(d.cell.raw ?? '')
      if (txt.startsWith('+')) d.cell.styles.textColor = [5, 150, 105]
      else if (txt.startsWith('-')) d.cell.styles.textColor = [220, 38, 38]
    },
  })

  // ── Resumo financeiro ──────────────────────────────────────────────────
  const real       = accounts.find((a) => a.type === 'REAL')
  const saldo      = parseFloat(real?.balance ?? '0') || 0
  const bonus      = parseFloat(real?.bonusBalance ?? '0') || 0
  const depositado = parseFloat(kpis?.totalDepositado ?? '0') || 0
  const ganho      = parseFloat(kpis?.totalGanho ?? '0') || 0
  const perdido    = parseFloat(kpis?.totalPerdido ?? '0') || 0
  const liquido    = saldo - depositado

  const vencedoras = ops.filter((o) => o.status === 'WON').length
  const perdedoras = ops.filter((o) => o.status === 'LOST').length
  const empates    = ops.filter((o) => o.status === 'DRAW').length

  let y = ((doc as any).lastAutoTable?.finalY ?? 60) + 8
  // Sem espaço para o resumo? Abre página nova — nunca cortar o bloco.
  if (y > doc.internal.pageSize.getHeight() - 62) { doc.addPage(); y = 20 }

  doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
  doc.setTextColor(...ESCURO)
  doc.text('RESUMO FINANCEIRO', 14, y)

  autoTable(doc, {
    startY: y + 3,
    body: [
      ['Total depositado',      `R$ ${brl(depositado)}`, 'Total de operações',      String(ops.length)],
      ['Saldo atual',           `R$ ${brl(saldo)}`,      'Operações vencedoras',    String(vencedoras)],
      ['Saldo de bônus',        `R$ ${brl(bonus)}`,      'Operações perdedoras',    String(perdedoras)],
      ['Total ganho',           `R$ ${brl(ganho)}`,      'Empates (devolvidas)',    String(empates)],
      ['Total perdido',         `R$ ${brl(perdido)}`,    'Taxa de acerto',
        vencedoras + perdedoras > 0
          ? `${((vencedoras / (vencedoras + perdedoras)) * 100).toFixed(1)}%`
          : '—'],
      ['Lucro/prejuízo líquido', `${liquido >= 0 ? '+' : '-'}R$ ${brl(Math.abs(liquido))}`, '', ''],
    ],
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 2 },
    // 'wrap' = a tabela ocupa só a largura das colunas, sem tentar esticar
    // até a margem. Sem isso o autotable avisa que sobraram ~97mm que não
    // pôde distribuir (todas as colunas têm largura fixa).
    tableWidth: 'wrap',
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 46, textColor: CINZA },
      1: { cellWidth: 40, halign: 'right' },
      2: { fontStyle: 'bold', cellWidth: 46, textColor: CINZA },
      3: { cellWidth: 40, halign: 'right' },
    },
    margin: { left: 14, right: 14 },
    didParseCell: (d: any) => {
      // Destaca o líquido (última linha, coluna do valor).
      if (d.section === 'body' && d.row.index === 5 && d.column.index === 1) {
        d.cell.styles.fontStyle = 'bold'
        d.cell.styles.textColor = liquido >= 0 ? [5, 150, 105] : [220, 38, 38]
      }
    },
  })

  // ── Rodapé com paginação (aplicado a todas as páginas no fim) ──────────
  const totalPaginas = (doc as any).internal.getNumberOfPages()
  for (let i = 1; i <= totalPaginas; i++) {
    doc.setPage(i)
    const alt = doc.internal.pageSize.getHeight()
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5)
    doc.setTextColor(...CINZA)
    doc.text(`VX Global — Extrato de ${nomeCompleto}`, 14, alt - 7)
    doc.text(`${g.data} ${g.hora}`, LARGURA / 2, alt - 7, { align: 'center' })
    doc.text(`Página ${i} de ${totalPaginas}`, LARGURA - 14, alt - 7, { align: 'right' })
  }

  // ── Nome do arquivo: extrato-operacoes-NOME-DD-MM-AAAA.pdf ─────────────
  const slug = (user.name || 'usuario')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // remove acentos
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    .slice(0, 40) || 'usuario'
  const arquivo = `extrato-operacoes-${slug}-${g.data.replace(/\//g, '-')}.pdf`
  const paginas = (doc as any).internal.getNumberOfPages()

  if (opts.retornarBuffer) {
    return { arquivo, operacoes: ops.length, paginas, buffer: doc.output('arraybuffer') }
  }
  doc.save(arquivo)   // dispara o download no navegador
  return { arquivo, operacoes: ops.length, paginas }
}
