<template>
  <section class="page" data-module="heatbilling">
    <header class="page-head">
      <div>
        <h2>热费结算管理</h2>
        <p class="page-desc">维护热费结算单，围绕结算编号、用户名称、所属小区、用热面积、热价标准做核算、减免与缴费流转；应缴金额 = 用热面积 × 热价标准 − 减免金额。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记热费结算单</button>
        <button class="btn" type="button" @click="exportRows">导出热费结算清单</button>
        <button class="btn" type="button" @click="exportArrearsRows">导出欠费名单（按小区）</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ cellText(row, column) }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in availableActions(row)"
              :key="action"
              class="link"
              type="button"
              @click="onAction(action, row)"
            >
              {{ action }}
            </button>
            <button class="link" type="button" @click="openDetail(row)">查看详情</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无热费结算数据，可先登记热费结算单</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条热费结算记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="detailRow" class="modal-mask" @click.self="closeDetail">
      <div class="modal">
        <header class="modal-head">
          <h3>结算单详情 · {{ detailRow['结算编号'] }}</h3>
          <button class="link" type="button" @click="closeDetail">关闭</button>
        </header>
        <dl class="detail-list">
          <div v-for="column in columns" :key="column" class="detail-item">
            <dt>{{ column }}</dt>
            <dd>{{ cellText(detailRow, column) }}</dd>
          </div>
          <div class="detail-item detail-formula">
            <dt>结算口径</dt>
            <dd>{{ detailFormula(detailRow) }}</dd>
          </div>
        </dl>
      </div>
    </div>

    <div v-if="reliefRow" class="modal-mask" @click.self="closeRelief">
      <div class="modal">
        <header class="modal-head">
          <h3>办理减免 · {{ reliefRow['结算编号'] }}</h3>
          <button class="link" type="button" @click="closeRelief">取消</button>
        </header>
        <p class="modal-tip">
          用户：{{ reliefRow['用户名称'] }}（{{ reliefRow['所属小区'] }}），
          用热面积 {{ reliefRow['用热面积'] }} ㎡，热价 {{ reliefRow['热价标准'] }} 元/㎡，
          减免前应缴 {{ formatMoney(baseAmount(reliefRow)) }} 元。
        </p>
        <form @submit.prevent="confirmRelief">
          <label class="filter-item">
            <span>减免金额（元）</span>
            <input v-model="reliefInput" placeholder="输入不大于减免前应缴金额的数值" />
          </label>
          <p class="modal-preview" v-if="previewRelief !== null">
            减免后应缴：{{ formatMoney(previewRelief) }} 元<span v-if="previewRelief < 0" class="error-text">（为负，将不予受理）</span>
          </p>
          <div class="modal-actions">
            <button class="btn primary" type="submit">确认减免并重算</button>
            <button class="btn ghost" type="button" @click="closeRelief">取消</button>
          </div>
        </form>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  arrearsGroups,
  baseAmount,
  billingStats,
  exportArrears,
  formatMoney,
  payableAmount,
  reliefAmount,
} from '@/api/heatbilling'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('heatbilling')
const session = useSessionStore()
const columns = meta.fields
const statuses = meta.statuses

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const detailRow = ref<EntryRow | null>(null)
const reliefRow = ref<EntryRow | null>(null)
const reliefInput = ref('')

const stats = computed(() => {
  const summary = billingStats()
  return [
    { label: '待核算用户', value: summary.pendingCount },
    { label: '已缴费用户', value: summary.paidCount },
    { label: '本月应收金额（元）', value: formatMoney(summary.receivable) },
  ]
})

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const previewRelief = computed(() => {
  if (!reliefRow.value) {
    return null
  }
  const relief = Number(reliefInput.value)
  if (!reliefInput.value.trim() || !Number.isFinite(relief)) {
    return null
  }
  const base = baseAmount(reliefRow.value)
  return Number.isFinite(base) ? Math.round((base - relief + Number.EPSILON) * 100) / 100 : null
})

// 列表与详情共用这一处取数：金额列一律按结算口径实时重算，保证两处一致。
function cellText(row: EntryRow, column: string): string | number {
  if (column === '应缴金额') {
    return formatMoney(payableAmount(row))
  }
  if (column === '减免金额') {
    return formatMoney(reliefAmount(row))
  }
  const value = row[column]
  if (value === undefined || value === '') {
    return '—'
  }
  return typeof value === 'boolean' ? String(value) : value
}

function detailFormula(row: EntryRow): string {
  return `应缴金额 = 用热面积 × 热价标准 − 减免金额 = ${formatMoney(baseAmount(row))} − ${formatMoney(
    reliefAmount(row),
  )} = ${formatMoney(payableAmount(row))} 元`
}

function availableActions(row: EntryRow): string[] {
  switch (String(row.status)) {
    case '待核算':
      return ['提交核算', '办理减免']
    case '已核算':
      return ['登记缴费', '办理减免']
    default:
      return []
  }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

// 欠费按小区归拢后导出，交给收费员逐户核对（文件内含各小区小计与欠费合计）。
function exportArrearsRows() {
  const { content, filename } = exportArrears()
  const groups = arrearsGroups()
  if (!groups.length) {
    errorMessage.value = '当前没有已核算未缴费的欠费记录'
    return
  }
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

function openCreate() {
  errorMessage.value = '热费结算单登记入口尚未接入审批流'
}

function openDetail(row: EntryRow) {
  detailRow.value = row
}

function closeDetail() {
  detailRow.value = null
}

function onAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  if (action === '办理减免') {
    reliefRow.value = row
    reliefInput.value = String(reliefAmount(row) || '')
    return
  }
  const result = applyAction(meta.key, Number(row.id), action, { operator: session.operator })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function closeRelief() {
  reliefRow.value = null
  reliefInput.value = ''
}

function confirmRelief() {
  if (!reliefRow.value) {
    return
  }
  const relief = Number(reliefInput.value)
  if (!reliefInput.value.trim() || !Number.isFinite(relief)) {
    errorMessage.value = '请输入有效的减免金额'
    return
  }
  const result = applyAction(meta.key, Number(reliefRow.value.id), '办理减免', {
    operator: session.operator,
    relief,
  })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  closeRelief()
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '热费结算列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.modal {
  width: 640px;
  max-width: calc(100vw - 32px);
  max-height: 80vh;
  overflow: auto;
  background: #fff;
  border-radius: 10px;
  padding: 16px 20px;
}
.modal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.modal-head h3 { margin: 0; font-size: 16px; }
.modal-tip, .modal-preview { font-size: 13px; color: var(--muted); margin: 10px 0; }
.modal-actions { margin-top: 12px; display: flex; gap: 8px; }
.detail-list { margin: 12px 0 0; }
.detail-item { display: flex; gap: 12px; padding: 6px 0; border-bottom: 1px dashed var(--border); font-size: 13px; }
.detail-item dt { width: 96px; color: var(--muted); flex: none; }
.detail-item dd { margin: 0; }
.detail-formula dd { color: var(--brand); }
.page-actions { display: flex; gap: 8px; }
</style>
