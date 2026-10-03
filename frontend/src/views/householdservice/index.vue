<template>
  <section class="page" data-module="householdservice">
    <header class="page-head">
      <div>
        <h2>入户服务管理</h2>
        <p class="page-desc">客服台账：收费窗口办结（缴费 / 减免）的结算单会先进入下方待确认清单，由客服核对后确认办结，再进入常规服务单流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记入户服务单</button>
        <button class="btn" type="button" @click="exportRows">导出入户服务清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <section class="confirm-panel">
      <h3 class="confirm-title">待确认清单（收费窗口办结结果）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>服务单号</th>
            <th>来源结算单</th>
            <th>报修用户</th>
            <th>所属小区</th>
            <th>办理方式</th>
            <th>处理结果</th>
            <th>窗口收费员</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in pendingConfirmRows" :key="String(row.id)">
            <td>{{ row['服务单号'] }}</td>
            <td>{{ row['来源单号'] ?? '—' }}</td>
            <td>{{ row['报修用户'] }}</td>
            <td>{{ row['所属小区'] ?? '—' }}</td>
            <td>{{ row['办理方式'] ?? '—' }}</td>
            <td>{{ row['处理结果'] }}</td>
            <td>{{ row['受理人'] }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="confirmClose(row)">确认办结</button>
            </td>
          </tr>
          <tr v-if="!pendingConfirmRows.length">
            <td colspan="8" class="empty-state">暂无待客服确认的窗口办结结果</td>
          </tr>
        </tbody>
      </table>
    </section>

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
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无入户服务数据，可先登记入户服务单</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条入户服务记录（不含上方待确认清单）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
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
import { SERVICE_PENDING } from '@/api/heatbilling'
import { listRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('householdservice')
const columns = meta.fields
// 「确认办结」是待确认清单专用动作，常规服务单不展示它。
const actions = meta.actions.filter((action) => action !== '确认办结')
const statuses = meta.statuses

const rows = ref<EntryRow[]>([])
const pendingConfirmRows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const stats = computed(() => [
  { label: '待确认服务单', value: pendingConfirmRows.value.length },
  { label: '待受理服务单', value: rows.value.filter((row) => String(row.status) === '待受理').length },
  { label: '已处理服务单', value: rows.value.filter((row) => String(row.status) === '已处理').length },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: [...pendingConfirmRows.value, ...rows.value].filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '入户服务单登记入口尚未接入审批流'
}

function confirmClose(row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), '确认办结')
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const all = listRows(meta.key)
    pendingConfirmRows.value = all.filter((row) => String(row.status) === SERVICE_PENDING)
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items.filter((row) => String(row.status) !== SERVICE_PENDING)
    total.value = rows.value.length
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '入户服务列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.confirm-panel {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 14px;
}
.confirm-title { margin: 0 0 10px; font-size: 14px; }
</style>
