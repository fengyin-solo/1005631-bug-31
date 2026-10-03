import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 热费结算的领域服务：结算口径（用热面积 × 热价标准 − 减免金额）统一在这里算，
// 收费窗口的列表、详情、导出都走同一份结果，避免两处口径不一致。

export const BILLING_KEY = 'heatbilling'
export const SERVICE_KEY = 'householdservice'

export const BILLING_STATUS = {
  pending: '待核算',
  settled: '已核算',
  paid: '已缴费',
  relieved: '已减免',
} as const

const FIELD_CODE = '结算编号'
const FIELD_CUSTOMER = '用户名称'
const FIELD_COMMUNITY = '所属小区'
const FIELD_AREA = '用热面积'
const FIELD_PRICE = '热价标准'
const FIELD_PAYABLE = '应缴金额'
const FIELD_RELIEF = '减免金额'
const FIELD_PAID_AT = '缴费日期'
const FIELD_CASHIER = '收费员'
const FIELD_RELIEF_REASON = '减免原因'
const FIELD_RELIEF_AT = '减免时间'

// 未结清、需要收费窗口继续跟进的状态：已缴费、已减免不算欠费。
const OPEN_STATUSES = [BILLING_STATUS.pending, BILLING_STATUS.settled]
const TERMINAL_STATUSES = [BILLING_STATUS.paid, BILLING_STATUS.relieved]

export type BillingDetail = {
  id: number
  code: string
  customer: string
  community: string
  area: number
  unitPrice: number
  baseAmount: number
  reliefAmount: number
  payableAmount: number
  status: string
  paidAt: string
  cashier: string
  reliefReason: string
  reliefAt: string
}

export type ArrearsGroup = {
  community: string
  items: BillingDetail[]
  count: number
  total: number
}

export type BillingStats = {
  pendingCount: number
  paidCount: number
  relievedCount: number
  arrearsCount: number
  receivable: number
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }
  const parsed = Number.parseFloat(String(value ?? '').replace(/[,，\s]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function today(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/** 既有结算口径：应缴金额 = 用热面积 × 热价标准 − 减免金额。 */
export function settlePayable(area: number, unitPrice: number, reliefAmount: number): number {
  return round2(area * unitPrice - reliefAmount)
}

/** 列表、详情共用的金额计算入口，任何页面展示金额前都过这里。 */
export function computeBillingDetail(row: EntryRow): BillingDetail {
  const area = round2(toNumber(row[FIELD_AREA]))
  const unitPrice = round2(toNumber(row[FIELD_PRICE]))
  const reliefAmount = round2(Math.max(0, toNumber(row[FIELD_RELIEF])))
  return {
    id: Number(row.id),
    code: String(row[FIELD_CODE] ?? ''),
    customer: String(row[FIELD_CUSTOMER] ?? ''),
    community: String(row[FIELD_COMMUNITY] ?? '未登记小区'),
    area,
    unitPrice,
    baseAmount: round2(area * unitPrice),
    reliefAmount,
    payableAmount: settlePayable(area, unitPrice, reliefAmount),
    status: String(row.status ?? ''),
    paidAt: String(row[FIELD_PAID_AT] ?? ''),
    cashier: String(row[FIELD_CASHIER] ?? ''),
    reliefReason: String(row[FIELD_RELIEF_REASON] ?? ''),
    reliefAt: String(row[FIELD_RELIEF_AT] ?? ''),
  }
}

export function listBillingRows(): EntryRow[] {
  return listRows(BILLING_KEY)
}

export function listBillingDetails(): BillingDetail[] {
  return listBillingRows().map(computeBillingDetail)
}

export function getBillingDetail(id: number): BillingDetail | null {
  const row = listBillingRows().find((item) => Number(item.id) === id)
  return row ? computeBillingDetail(row) : null
}

function persistBillingRows(rows: EntryRow[]): void {
  saveRows(BILLING_KEY, rows)
}

function findRow(rows: EntryRow[], id: number): number {
  return rows.findIndex((row) => Number(row.id) === id)
}

function fail(message: string): ActionResult {
  return { ok: false, message }
}

function ok(message: string): ActionResult {
  return { ok: true, message }
}

/** 提交核算：同一单重复提交只认一次，且不产生重复记录。 */
export function submitForSettlement(id: number): ActionResult {
  const rows = listBillingRows()
  const index = findRow(rows, id)
  if (index < 0) {
    return fail(`没有找到编号为 ${id} 的热费结算单`)
  }
  const current = String(rows[index].status)
  if (current === BILLING_STATUS.settled) {
    return fail(`结算单 ${rows[index][FIELD_CODE]} 已核算，无需重复提交`)
  }
  if (TERMINAL_STATUSES.includes(current as (typeof TERMINAL_STATUSES)[number])) {
    return fail(`结算单 ${rows[index][FIELD_CODE]} 已${current}，不能重复提交核算`)
  }
  const detail = computeBillingDetail(rows[index])
  const next = [...rows]
  next[index] = {
    ...rows[index],
    status: BILLING_STATUS.settled,
    pending: true,
    [FIELD_PAYABLE]: detail.payableAmount,
  }
  persistBillingRows(next)
  return ok(`结算单 ${detail.code} 已核算，应缴金额 ¥${detail.payableAmount}`)
}

/** 登记缴费：只有已核算的单子能缴费，重复缴费直接拒绝。 */
export function registerPayment(id: number, cashier: string): ActionResult {
  const rows = listBillingRows()
  const index = findRow(rows, id)
  if (index < 0) {
    return fail(`没有找到编号为 ${id} 的热费结算单`)
  }
  const current = String(rows[index].status)
  if (current === BILLING_STATUS.paid) {
    return fail(`结算单 ${rows[index][FIELD_CODE]} 已缴费，不能重复登记`)
  }
  if (current === BILLING_STATUS.relieved) {
    return fail(`结算单 ${rows[index][FIELD_CODE]} 已办结减免，无需再缴费`)
  }
  if (current === BILLING_STATUS.pending) {
    return fail(`结算单 ${rows[index][FIELD_CODE]} 尚未核算，请先提交核算`)
  }
  const detail = computeBillingDetail(rows[index])
  const next = [...rows]
  next[index] = {
    ...rows[index],
    status: BILLING_STATUS.paid,
    pending: false,
    [FIELD_PAYABLE]: detail.payableAmount,
    [FIELD_PAID_AT]: today(),
    [FIELD_CASHIER]: cashier || '收费窗口',
  }
  persistBillingRows(next)
  return ok(`结算单 ${detail.code} 已登记缴费 ¥${detail.payableAmount}`)
}

export type ReliefInput = {
  reliefAmount: number
  reason?: string
  cashier?: string
}

/**
 * 办理减免：减免落库后立即按既有口径重算应缴金额；
 * 应缴金额为负的不予受理；同一单重复申请只生效一次。
 */
export function applyRelief(id: number, input: ReliefInput): ActionResult {
  const reliefAmount = round2(toNumber(input.reliefAmount))
  if (!Number.isFinite(reliefAmount) || reliefAmount < 0) {
    return fail('减免金额不能为负数，请重新填写')
  }
  const rows = listBillingRows()
  const index = findRow(rows, id)
  if (index < 0) {
    return fail(`没有找到编号为 ${id} 的热费结算单`)
  }
  const current = String(rows[index].status)
  if (current === BILLING_STATUS.relieved) {
    return fail(`结算单 ${rows[index][FIELD_CODE]} 的减免已办结，重复申请只生效一次`)
  }
  if (current === BILLING_STATUS.paid) {
    return fail(`结算单 ${rows[index][FIELD_CODE]} 已缴费，不能再办理减免`)
  }
  const before = computeBillingDetail(rows[index])
  const payableAmount = settlePayable(before.area, before.unitPrice, reliefAmount)
  if (payableAmount < 0) {
    return fail(
      `减免 ¥${reliefAmount} 后应缴金额为 ¥${payableAmount}，应缴金额为负的不予受理`,
    )
  }
  const reliefAt = today()
  const next = [...rows]
  next[index] = {
    ...rows[index],
    status: BILLING_STATUS.relieved,
    pending: false,
    [FIELD_RELIEF]: reliefAmount,
    [FIELD_PAYABLE]: payableAmount,
    [FIELD_RELIEF_REASON]: input.reason?.trim() || '窗口办理减免',
    [FIELD_RELIEF_AT]: reliefAt,
    [FIELD_CASHIER]: input.cashier || rows[index][FIELD_CASHIER] || '收费窗口',
  }
  persistBillingRows(next)
  pushReliefLedger(computeBillingDetail(next[index]))
  return ok(`结算单 ${before.code} 减免 ¥${reliefAmount} 已落库，重算应缴金额 ¥${payableAmount}`)
}

// ---- 客服台账（入户服务）联动 -------------------------------------------------

const LEDGER_SOURCE_FIELD = '来源单号'
const LEDGER_PENDING_STATUS = '待确认'

/** 减免办结后把结果推进客服台账的待确认清单；同一结算单只推一条。 */
function pushReliefLedger(detail: BillingDetail): void {
  const rows = listRows(SERVICE_KEY)
  const duplicated = rows.some(
    (row) =>
      String(row.status) === LEDGER_PENDING_STATUS &&
      String(row[LEDGER_SOURCE_FIELD] ?? '') === detail.code,
  )
  if (duplicated) {
    return
  }
  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const entry: EntryRow = {
    id: nextId,
    status: LEDGER_PENDING_STATUS,
    pending: true,
    abnormal: false,
    服务单号: `KF-${String(nextId).padStart(4, '0')}`,
    报修用户: detail.customer,
    所属小区: detail.community,
    服务内容: `热费减免确认（结算单 ${detail.code}）`,
    受理人: detail.cashier || '收费窗口',
    上门时间: detail.reliefAt,
    处理结果: `减免 ¥${detail.reliefAmount}，应缴金额核减为 ¥${detail.payableAmount}`,
    回访日期: '',
    服务状态: '',
    [LEDGER_SOURCE_FIELD]: detail.code,
  }
  saveRows(SERVICE_KEY, [...rows, entry])
}

/** 客服台账的待确认清单：收费窗口办结、客服核对前的减免记录。 */
export function listPendingConfirm(): EntryRow[] {
  return listRows(SERVICE_KEY).filter((row) => String(row.status) === LEDGER_PENDING_STATUS)
}

/** 客服核对确认：待确认 → 已处理。 */
export function confirmLedgerEntry(id: number): ActionResult {
  const rows = listRows(SERVICE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return fail(`没有找到编号为 ${id} 的入户服务单`)
  }
  if (String(rows[index].status) !== LEDGER_PENDING_STATUS) {
    return fail('该服务单不在待确认清单里，无需重复确认')
  }
  const next = [...rows]
  next[index] = { ...rows[index], status: '已处理', pending: true }
  saveRows(SERVICE_KEY, next)
  return ok(`服务单 ${next[index]['服务单号']} 已确认办结`)
}

// ---- 欠费名单 -----------------------------------------------------------------

/** 欠费名单按小区归拢，交收费员逐户核对。 */
export function listArrearsGroups(): ArrearsGroup[] {
  const groups = new Map<string, BillingDetail[]>()
  for (const detail of listBillingDetails()) {
    if (!OPEN_STATUSES.includes(detail.status as (typeof OPEN_STATUSES)[number])) {
      continue
    }
    if (detail.payableAmount <= 0) {
      continue
    }
    const list = groups.get(detail.community) ?? []
    list.push(detail)
    groups.set(detail.community, list)
  }
  return [...groups.entries()]
    .map(([community, items]) => ({
      community,
      items: items.sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN')),
      count: items.length,
      total: round2(items.reduce((sum, item) => sum + item.payableAmount, 0)),
    }))
    .sort((a, b) => a.community.localeCompare(b.community, 'zh-Hans-CN'))
}

export function billingStats(): BillingStats {
  const details = listBillingDetails()
  const arrears = details.filter(
    (item) =>
      OPEN_STATUSES.includes(item.status as (typeof OPEN_STATUSES)[number]) &&
      item.payableAmount > 0,
  )
  return {
    pendingCount: details.filter((item) => item.status === BILLING_STATUS.pending).length,
    paidCount: details.filter((item) => item.status === BILLING_STATUS.paid).length,
    relievedCount: details.filter((item) => item.status === BILLING_STATUS.relieved).length,
    arrearsCount: arrears.length,
    receivable: round2(arrears.reduce((sum, item) => sum + item.payableAmount, 0)),
  }
}

// ---- 导出 ---------------------------------------------------------------------

function csvCell(value: unknown): string {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([`﻿${content}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

/** 结算清单：表头与各列严格对位，金额取重算后的应缴金额；按编号去重防止同一单多行。 */
export function buildBillingCsv(): string {
  const seen = new Set<number>()
  const header = [
    '编号',
    FIELD_CODE,
    FIELD_CUSTOMER,
    FIELD_COMMUNITY,
    FIELD_AREA,
    FIELD_PRICE,
    FIELD_PAYABLE,
    FIELD_RELIEF,
    FIELD_PAID_AT,
    FIELD_CASHIER,
    '当前状态',
  ]
  const lines = [header.join(',')]
  for (const detail of listBillingDetails()) {
    if (seen.has(detail.id)) {
      continue
    }
    seen.add(detail.id)
    lines.push(
      [
        detail.id,
        detail.code,
        detail.customer,
        detail.community,
        detail.area,
        detail.unitPrice,
        detail.payableAmount,
        detail.reliefAmount,
        detail.paidAt,
        detail.cashier,
        detail.status,
      ]
        .map(csvCell)
        .join(','),
    )
  }
  return lines.join('\n')
}

export function downloadBillingCsv(): void {
  downloadCsv('热费结算-清单.csv', buildBillingCsv())
}

/** 欠费名单：按小区归拢，每组带小计，末尾带合计，供收费员核对。 */
export function buildArrearsCsv(): string {
  const groups = listArrearsGroups()
  const lines = ['所属小区,结算编号,用户名称,用热面积,热价标准,应缴金额,当前状态']
  let grandTotal = 0
  for (const group of groups) {
    for (const item of group.items) {
      lines.push(
        [
          group.community,
          item.code,
          item.customer,
          item.area,
          item.unitPrice,
          item.payableAmount,
          item.status,
        ]
          .map(csvCell)
          .join(','),
      )
    }
    lines.push([`${group.community} 小计`, '', '', '', '', group.count, group.total].map(csvCell).join(','))
    grandTotal = round2(grandTotal + group.total)
  }
  lines.push(['合计', '', '', '', '', groups.reduce((sum, g) => sum + g.count, 0), grandTotal].join(','))
  return lines.join('\n')
}

export function downloadArrearsCsv(): void {
  downloadCsv('热费结算-欠费名单（按小区）.csv', buildArrearsCsv())
}

// 测试辅助：直接拿清单内容，不触发浏览器下载。
export function exportBillingRowsForTest(): string {
  return buildBillingCsv()
}
