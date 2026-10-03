<template>
  <section class="page" data-module="householdservice">
    <header class="page-head">
      <div>
        <h2>入户服务管理</h2>
        <p class="page-desc">维护入户服务单，围绕服务单号、报修用户、服务内容、受理人做登记、筛选与状态流转；收费窗口办结的减免结果会进入下方待确认清单。</p>
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
      <header class="confirm-head">
        <h3>客服台账 · 待确认清单</h3>
        <span class="page-desc">收费窗口办结（热费减免）后推送，客服核对无误后点「确认办结」。</span>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th>服务单号</th>
            <th>来源结算单</th>
            <th>报修用户</th>
            <th>所属小区</th>
            <th>服务内容</th>
            <th>处理结果</th>
            <th>来源窗口</th>
            <th>办理日期</th>
            <th>核对</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in pendingRows" :key="String(row.id)">
            <td>{{ row['服务单号'] }}</td>
            <td>{{ row['来源单号'] || '—' }}</td>
            <td>{{ row['报修用户'] }}</td>
            <td>{{ row['所属小区'] || '—' }}</td>
            <td>{{ row['服务内容'] }}</td>
            <td>{{ row['处理结果'] }}</td>
            <td>{{ row['受理人'] }}</td>
            <td>{{ row['上门时间'] }}</td>
            <td><button class="link" type="button" @click="confirmEntry(Number(row.id))">确认办结</button></td>
          </tr>
          <tr v-if="!pendingRows.length">
            <td colspan="9" class="empty-state">待确认清单为空，新的减免办结会自动推送到这里</td>
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
      <span>共 {{ total }} 条入户服务记录</span>
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
import { confirmLedgerEntry, listPendingConfirm } from '@/api/billing-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('householdservice')
const columns = ["服务单号", "报修用户", "所属小区", "服务内容", "受理人", "上门时间", "处理结果", "回访日期", "服务状态"]
const actions = ["受理报修", "登记处理", "完成回访"]
const statuses = ["待受理", "已安排", "待确认", "已处理", "已回访"]

const rows = ref<EntryRow[]>([])
const pendingRows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const stats = computed(() => [
  { label: '待受理服务单', value: rows.value.filter((row) => row.status === '待受理').length },
  { label: '待确认服务单', value: pendingRows.value.length },
  { label: '待回访服务单', value: rows.value.filter((row) => row.status === '已处理').length },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
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

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function confirmEntry(id: number) {
  errorMessage.value = ''
  const result = confirmLedgerEntry(id)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    // 待确认清单已在页面顶部专区展示，主表只保留常规台账记录。
    rows.value = payload.items.filter((row) => String(row.status) !== '待确认')
    total.value = payload.total
    pendingRows.value = listPendingConfirm()
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
  padding: 12px 14px;
  margin-bottom: 12px;
}
.confirm-head {
  margin-bottom: 8px;
}
.confirm-head h3 {
  margin: 0 0 4px;
  font-size: 15px;
}
</style>
