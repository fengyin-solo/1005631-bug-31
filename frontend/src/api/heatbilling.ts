import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 热费结算领域逻辑：状态流转只能经这里落库，列表/详情/导出/统计共用同一套结算口径，
// 避免窗口列表与详情各算各的（页面组件不做业务判断）。

export const BILLING_KEY = 'heatbilling'
export const SERVICE_KEY = 'householdservice'

export const BILLING_STATUS = {
  pending: '待核算',
  checked: '已核算',
  paid: '已缴费',
  relieved: '已减免',
} as const

export const SERVICE_PENDING = '待确认'

// 既有结算口径：应缴金额 = 用热面积 × 热价标准 − 减免金额。
export function toNumber(value: string | number | boolean | undefined): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : Number.NaN
  }
  const n = Number(String(value ?? '').trim())
  return Number.isFinite(n) ? n : Number.NaN
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function baseAmount(row: EntryRow): number {
  const area = toNumber(row['用热面积'])
  const price = toNumber(row['热价标准'])
  if (!Number.isFinite(area) || !Number.isFinite(price)) {
    return Number.NaN
  }
  return round2(area * price)
}

export function reliefAmount(row: EntryRow): number {
  const relief = toNumber(row['减免金额'])
  return Number.isFinite(relief) ? round2(relief) : 0
}

// 应缴金额：减免落库后这里会实时重算，导出、列表、详情拿到的永远是最新值。
export function payableAmount(row: EntryRow): number {
  const base = baseAmount(row)
  if (!Number.isFinite(base)) {
    return Number.NaN
  }
  return round2(base - reliefAmount(row))
}

export function formatMoney(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '—'
}

export function billingDetail(row: EntryRow): {
  base: number
  relief: number
  payable: number
  formula: string
} {
  const base = baseAmount(row)
  const relief = reliefAmount(row)
  const payable = payableAmount(row)
  return {
    base,
    relief,
    payable,
    formula: `应缴金额 = 用热面积 × 热价标准 − 减免金额 = ${formatMoney(base)} − ${formatMoney(relief)} = ${formatMoney(payable)} 元`,
  }
}

function fail(message: string): ActionResult {
  return { ok: false, message }
}

function findRow(id: number): { rows: EntryRow[]; index: number; row: EntryRow } | ActionResult {
  const rows = listRows(BILLING_KEY)
  const index = rows.findIndex((item) => Number(item.id) === id)
  if (index < 0) {
    return fail(`没有找到编号为 ${id} 的热费结算单`)
  }
  return { rows, index, row: rows[index] }
}

function persist(rows: EntryRow[], index: number, patch: Record<string, string | number | boolean>): EntryRow {
  const updated: EntryRow = { ...rows[index], ...patch }
  const next = [...rows]
  next[index] = updated
  saveRows(BILLING_KEY, next)
  return updated
}

// 提交核算：只允许从「待核算」发起；重复提交不会新增任何记录；应缴金额为负的不予受理。
export function submitAccounting(id: number): ActionResult {
  const found = findRow(id)
  if ('ok' in found) {
    return found
  }
  const { rows, index, row } = found
  const current = String(row.status)
  if (current === BILLING_STATUS.checked || current === BILLING_STATUS.paid) {
    return fail(`结算单 ${row['结算编号']} 已核算，重复提交不生效，也不会新增记录`)
  }
  if (current === BILLING_STATUS.relieved) {
    return fail(`结算单 ${row['结算编号']} 已办结减免，不能再提交核算`)
  }
  const base = baseAmount(row)
  if (!Number.isFinite(base)) {
    return fail('用热面积或热价标准不是有效数值，无法核算')
  }
  const payable = payableAmount(row)
  if (payable < 0) {
    return fail(`应缴金额为负（${formatMoney(payable)} 元），不予受理`)
  }
  persist(rows, index, {
    status: BILLING_STATUS.checked,
    pending: true,
    abnormal: false,
    应缴金额: payable,
    结算状态: BILLING_STATUS.checked,
  })
  return { ok: true, message: `结算单 ${row['结算编号']} 已提交核算，应缴金额 ${formatMoney(payable)} 元` }
}

// 登记缴费：必须先核算；办结结果进客服台账待确认清单。
export function registerPayment(id: number, operator: string): ActionResult {
  const found = findRow(id)
  if ('ok' in found) {
    return found
  }
  const { rows, index, row } = found
  const billNo = String(row['结算编号'])
  const current = String(row.status)
  if (current === BILLING_STATUS.paid) {
    return fail(`结算单 ${billNo} 已缴费，无需重复登记`)
  }
  if (current === BILLING_STATUS.relieved) {
    return fail(`结算单 ${billNo} 已办结减免，不能再登记缴费`)
  }
  if (current === BILLING_STATUS.pending) {
    return fail(`结算单 ${billNo} 尚未核算，请先提交核算`)
  }
  const payable = payableAmount(row)
  if (payable < 0) {
    return fail(`应缴金额为负（${formatMoney(payable)} 元），不予受理`)
  }
  const today = new Date().toISOString().slice(0, 10)
  persist(rows, index, {
    status: BILLING_STATUS.paid,
    pending: false,
    abnormal: false,
    应缴金额: payable,
    缴费日期: today,
    收费员: operator,
    结算状态: BILLING_STATUS.paid,
  })
  pushServiceEntry({ ...row, status: BILLING_STATUS.paid, 应缴金额: payable }, '登记缴费', operator,
    `已缴费 ${formatMoney(payable)} 元，待客服复核`)
  return { ok: true, message: `结算单 ${billNo} 缴费登记完成，应缴 ${formatMoney(payable)} 元，已转客服待确认` }
}

// 办理减免：落库后立即重算应缴金额；重复提交只生效一次；减成负数的不予受理。
export function applyRelief(id: number, reliefInput: number, operator: string): ActionResult {
  const found = findRow(id)
  if ('ok' in found) {
    return found
  }
  const { rows, index, row } = found
  const billNo = String(row['结算编号'])
  const current = String(row.status)
  if (current === BILLING_STATUS.relieved) {
    return fail(`结算单 ${billNo} 已办理减免，重复提交只生效一次`)
  }
  if (current === BILLING_STATUS.paid) {
    return fail(`结算单 ${billNo} 已缴费，不能再办理减免`)
  }
  const relief = toNumber(reliefInput)
  if (!Number.isFinite(relief) || relief < 0) {
    return fail('减免金额必须是不小于 0 的有效数值')
  }
  const base = baseAmount(row)
  if (!Number.isFinite(base)) {
    return fail('用热面积或热价标准不是有效数值，无法办理减免')
  }
  const payable = round2(base - relief)
  if (payable < 0) {
    return fail(`减免后应缴金额为负（${formatMoney(payable)} 元），减免额不能超过 ${formatMoney(base)} 元，不予受理`)
  }
  persist(rows, index, {
    status: BILLING_STATUS.relieved,
    pending: false,
    abnormal: false,
    减免金额: round2(relief),
    应缴金额: payable,
    结算状态: BILLING_STATUS.relieved,
  })
  pushServiceEntry({ ...row, status: BILLING_STATUS.relieved, 减免金额: relief, 应缴金额: payable },
    '办理减免', operator, `已办理减免 ${formatMoney(relief)} 元，减免后应缴 ${formatMoney(payable)} 元，待客服复核`)
  return {
    ok: true,
    message: `结算单 ${billNo} 减免已落库并重算，应缴金额 ${formatMoney(payable)} 元，已转客服待确认`,
  }
}

// 窗口办结（缴费/减免）后，在客服台账生成一条「待确认」清单；同一单同方式只挂一条，防重复。
function pushServiceEntry(bill: EntryRow, method: string, operator: string, resultText: string): void {
  const services = listRows(SERVICE_KEY)
  const billNo = String(bill['结算编号'])
  const community = String(bill['所属小区'] ?? '')
  const duplicated = services.some(
    (item) =>
      String(item['来源单号'] ?? '') === billNo &&
      String(item['办理方式'] ?? '') === method &&
      String(item.status) === SERVICE_PENDING,
  )
  if (duplicated) {
    return
  }
  const nextId = services.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1
  const today = new Date().toISOString().slice(0, 10)
  const entry: EntryRow = {
    id: nextId,
    status: SERVICE_PENDING,
    pending: true,
    abnormal: false,
    服务单号: `HOUS-${String(nextId).padStart(4, '0')}`,
    报修用户: String(bill['用户名称'] ?? ''),
    服务内容: `热费结算 ${billNo} 窗口办结确认`,
    受理人: operator,
    上门时间: today,
    处理结果: `${resultText}（${community}）`,
    回访日期: '',
    服务状态: SERVICE_PENDING,
    来源单号: billNo,
    办理方式: method,
    所属小区: community,
  }
  saveRows(SERVICE_KEY, [...services, entry])
}

export type BillingStats = {
  pendingCount: number
  paidCount: number
  receivable: number
}

// 统计严格按当前状态取数：已缴费不会再落进「待核算」；应收只汇总未办结（待核算/已核算）的单子。
export function billingStats(): BillingStats {
  const rows = listRows(BILLING_KEY)
  let receivable = 0
  const result: BillingStats = { pendingCount: 0, paidCount: 0, receivable: 0 }
  for (const row of rows) {
    const status = String(row.status)
    if (status === BILLING_STATUS.pending) {
      result.pendingCount += 1
    } else if (status === BILLING_STATUS.paid) {
      result.paidCount += 1
    }
    if (status === BILLING_STATUS.pending || status === BILLING_STATUS.checked) {
      const payable = payableAmount(row)
      if (Number.isFinite(payable) && payable > 0) {
        receivable += payable
      }
    }
  }
  result.receivable = round2(receivable)
  return result
}

// 欠费：已核算但尚未缴费/减免的结算单，按小区归拢，交收费员上门或电话核对。
export type ArrearsGroup = {
  community: string
  items: EntryRow[]
  subtotal: number
}

export function arrearsGroups(): ArrearsGroup[] {
  const map = new Map<string, EntryRow[]>()
  for (const row of listRows(BILLING_KEY)) {
    if (String(row.status) !== BILLING_STATUS.checked) {
      continue
    }
    const community = String(row['所属小区'] ?? '未登记小区')
    const bucket = map.get(community)
    if (bucket) {
      bucket.push(row)
    } else {
      map.set(community, [row])
    }
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'zh-Hans-CN'))
    .map(([community, items]) => {
      const sorted = [...items].sort((a, b) =>
        String(a['结算编号']).localeCompare(String(b['结算编号']), 'zh-Hans-CN'),
      )
      return {
        community,
        items: sorted,
        subtotal: round2(
          sorted.reduce((sum, item) => sum + Math.max(payableAmount(item), 0), 0),
        ),
      }
    })
}

function csvCell(value: unknown): string {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function exportArrears(): { filename: string; content: string } {
  const groups = arrearsGroups()
  const header = ['所属小区', '结算编号', '用户名称', '用热面积', '热价标准', '减免金额', '应缴金额', '收费员核对签名']
  const lines = [header.join(',')]
  let total = 0
  for (const group of groups) {
    for (const item of group.items) {
      lines.push(
        [
          group.community,
          item['结算编号'],
          item['用户名称'],
          item['用热面积'],
          item['热价标准'],
          formatMoney(reliefAmount(item)),
          formatMoney(payableAmount(item)),
          '',
        ]
          .map(csvCell)
          .join(','),
      )
    }
    lines.push(['', `${group.community}小计`, '', '', '', '', formatMoney(group.subtotal), ''].map(csvCell).join(','))
    total += group.subtotal
  }
  lines.push(['', '欠费合计', '', '', '', '', formatMoney(round2(total)), ''].map(csvCell).join(','))
  return {
    filename: '热费欠费名单-按小区.csv',
    content: `﻿${lines.join('\n')}`,
  }
}

// 热费清单导出：字段顺序与页面列表严格对齐（修面积/单价错位），应缴金额实时重算，
// 减免办完后导出的就是重算后的金额。
export function exportBilling(): { filename: string; content: string } {
  const fields = [
    '结算编号', '用户名称', '所属小区', '用热面积', '热价标准', '减免金额',
    '应缴金额', '缴费日期', '收费员', '结算状态',
  ]
  const lines = [['编号', ...fields, '当前状态'].join(',')]
  for (const row of listRows(BILLING_KEY)) {
    const values = fields.map((field) => {
      if (field === '应缴金额') {
        return formatMoney(payableAmount(row))
      }
      if (field === '减免金额') {
        return formatMoney(reliefAmount(row))
      }
      return row[field] ?? ''
    })
    lines.push([row.id, ...values, row.status].map(csvCell).join(','))
  }
  return { filename: '热费结算-清单.csv', content: `﻿${lines.join('\n')}` }
}
