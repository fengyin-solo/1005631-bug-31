<template>
  <section class="page" data-module="heatbilling">
    <header class="page-head">
      <div>
        <h2>热费结算管理</h2>
        <p class="page-desc">维护热费结算单，围绕结算编号、用户名称、所属小区、用热面积、热价标准做登记、筛选与状态流转。减免落库后按既有口径重算应缴金额。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记热费结算单</button>
        <button class="btn" type="button" @click="downloadBillingCsv">导出热费结算清单</button>
        <button class="btn" type="button" @click="downloadArrearsCsv">导出欠费名单（按小区）</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in statCards" :key="item.label" class="stat-card">
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
      <label class="filter-item">
        <span>结算编号</span>
        <input v-model="filters.code" placeholder="按结算编号检索" />
      </label>
      <label class="filter-item">
        <span>用户名称</span>
        <input v-model="filters.customer" placeholder="按用户名称检索" />
      </label>
      <label class="filter-item">
        <span>所属小区</span>
        <input v-model="filters.community" placeholder="按所属小区检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>结算编号</th>
          <th>用户名称</th>
          <th>所属小区</th>
          <th>用热面积(㎡)</th>
          <th>热价标准(元/㎡)</th>
          <th>应缴金额(元)</th>
          <th>减免金额(元)</th>
          <th>缴费日期</th>
          <th>收费员</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="detail in filteredDetails" :key="detail.id">
          <td>{{ detail.code }}</td>
          <td>{{ detail.customer }}</td>
          <td>{{ detail.community }}</td>
          <td>{{ detail.area.toFixed(2) }}</td>
          <td>{{ detail.unitPrice.toFixed(2) }}</td>
          <td :class="{ 'amount-negative': detail.payableAmount < 0 }">¥{{ detail.payableAmount.toFixed(2) }}</td>
          <td>{{ detail.reliefAmount.toFixed(2) }}</td>
          <td>{{ detail.paidAt || '—' }}</td>
          <td>{{ detail.cashier || '—' }}</td>
          <td>{{ detail.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(detail.id)">查看详情</button>
            <button
              v-if="detail.status === statuses.pending || detail.status === statuses.settled"
              class="link"
              type="button"
              :disabled="detail.status === statuses.settled"
              :title="detail.status === statuses.settled ? '已核算，无需重复提交' : ''"
              @click="doSubmit(detail.id)"
            >
              提交核算
            </button>
            <button
              v-if="detail.status === statuses.settled"
              class="link"
              type="button"
              @click="doPay(detail.id)"
            >
              登记缴费
            </button>
            <button
              v-if="detail.status === statuses.pending || detail.status === statuses.settled"
              class="link"
              type="button"
              @click="openRelief(detail.id)"
            >
              办理减免
            </button>
          </td>
        </tr>
        <tr v-if="!filteredDetails.length">
          <td colspan="11" class="empty-state">暂无热费结算数据，可先登记热费结算单</td>
        </tr>
      </tbody>
    </table>

    <section class="arrears-panel">
      <header class="arrears-head">
        <h3>欠费名单（按小区归拢，交收费员核对）</h3>
        <span class="page-desc">仅含待核算、已核算且应缴金额大于 0 的用户；已缴费、已减免不计欠费。</span>
      </header>
      <template v-if="arrearsGroups.length">
        <div v-for="group in arrearsGroups" :key="group.community" class="arrears-group">
          <h4 class="arrears-group-title">{{ group.community }}（{{ group.count }} 户，合计 ¥{{ group.total.toFixed(2) }}）</h4>
          <table class="data-table">
            <thead>
              <tr>
                <th>结算编号</th>
                <th>用户名称</th>
                <th>用热面积(㎡)</th>
                <th>热价标准(元/㎡)</th>
                <th>应缴金额(元)</th>
                <th>当前状态</th>
                <th>核对</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in group.items" :key="item.id">
                <td>{{ item.code }}</td>
                <td>{{ item.customer }}</td>
                <td>{{ item.area.toFixed(2) }}</td>
                <td>{{ item.unitPrice.toFixed(2) }}</td>
                <td>¥{{ item.payableAmount.toFixed(2) }}</td>
                <td>{{ item.status }}</td>
                <td><button class="link" type="button" @click="checkedCode = item.code">收费员已核对</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <p v-else class="empty-state">当前没有欠费记录</p>
    </section>

    <footer class="page-foot">
      <span>共 {{ filteredDetails.length }} 条热费结算记录</span>
      <span v-if="checkedCode" class="check-text">结算单 {{ checkedCode }} 已由收费员核对</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 结算单详情：金额与列表走同一个 computeBillingDetail，口径必然一致 -->
    <div v-if="detailView" class="modal-mask" @click.self="closeDetail">
      <div class="modal-card">
        <header class="modal-head">
          <h3>热费结算单详情 · {{ detailView.code }}</h3>
          <button class="link" type="button" @click="closeDetail">关闭</button>
        </header>
        <dl class="detail-grid">
          <div><dt>用户名称</dt><dd>{{ detailView.customer }}</dd></div>
          <div><dt>所属小区</dt><dd>{{ detailView.community }}</dd></div>
          <div><dt>用热面积</dt><dd>{{ detailView.area.toFixed(2) }} ㎡</dd></div>
          <div><dt>热价标准</dt><dd>{{ detailView.unitPrice.toFixed(2) }} 元/㎡</dd></div>
          <div><dt>面积×热价</dt><dd>¥{{ detailView.baseAmount.toFixed(2) }}</dd></div>
          <div><dt>已办减免</dt><dd>¥{{ detailView.reliefAmount.toFixed(2) }}</dd></div>
          <div class="detail-amount">
            <dt>应缴金额</dt>
            <dd :class="{ 'amount-negative': detailView.payableAmount < 0 }">¥{{ detailView.payableAmount.toFixed(2) }}</dd>
          </div>
          <div><dt>当前状态</dt><dd>{{ detailView.status }}</dd></div>
          <div><dt>缴费日期</dt><dd>{{ detailView.paidAt || '—' }}</dd></div>
          <div><dt>收费员</dt><dd>{{ detailView.cashier || '—' }}</dd></div>
          <div v-if="detailView.reliefReason"><dt>减免原因</dt><dd>{{ detailView.reliefReason }}</dd></div>
          <div v-if="detailView.reliefAt"><dt>减免时间</dt><dd>{{ detailView.reliefAt }}</dd></div>
        </dl>
        <footer class="modal-foot">
          <button
            v-if="detailView.status === statuses.pending"
            class="btn primary"
            type="button"
            @click="doSubmit(detailView.id); closeDetail()"
          >提交核算</button>
          <button
            v-if="detailView.status === statuses.settled"
            class="btn primary"
            type="button"
            @click="doPay(detailView.id); closeDetail()"
          >登记缴费</button>
          <button
            v-if="detailView.status === statuses.pending || detailView.status === statuses.settled"
            class="btn"
            type="button"
            @click="closeDetail(); openRelief(detailView.id)"
          >办理减免</button>
        </footer>
      </div>
    </div>

    <!-- 办理减免：落库前按既有口径试算，应缴为负直接不予受理 -->
    <div v-if="reliefTargetId !== null" class="modal-mask" @click.self="closeRelief">
      <div class="modal-card">
        <header class="modal-head">
          <h3>办理减免 · {{ reliefTarget?.code }}</h3>
          <button class="link" type="button" @click="closeRelief">关闭</button>
        </header>
        <div v-if="reliefTarget" class="relief-form">
          <p class="page-desc">
            {{ reliefTarget.customer }}（{{ reliefTarget.community }}），
            {{ reliefTarget.area.toFixed(2) }} ㎡ × {{ reliefTarget.unitPrice.toFixed(2) }} 元/㎡ = ¥{{ reliefTarget.baseAmount.toFixed(2) }}
          </p>
          <label class="filter-item">
            <span>减免金额（元）</span>
            <input v-model.number="reliefAmountInput" type="number" min="0" step="0.01" @input="syncFromAmount" />
          </label>
          <label class="filter-item">
            <span>减免比例（%，可选）</span>
            <input v-model.number="reliefRatioInput" type="number" min="0" max="100" step="0.01" @input="syncFromRatio" />
          </label>
          <label class="filter-item">
            <span>减免原因</span>
            <input v-model="reliefReasonInput" placeholder="如：低保户供暖减免" />
          </label>
          <p class="relief-preview">
            重算应缴金额：
            <strong :class="{ 'amount-negative': reliefPayable < 0 }">¥{{ reliefPayable.toFixed(2) }}</strong>
          </p>
          <p v-if="reliefHint" class="error-text">{{ reliefHint }}</p>
        </div>
        <footer class="modal-foot">
          <button class="btn primary" type="button" @click="submitRelief">确认减免并重算金额</button>
          <button class="btn ghost" type="button" @click="closeRelief">取消</button>
        </footer>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  applyRelief,
  billingStats,
  computeBillingDetail,
  downloadArrearsCsv,
  downloadBillingCsv,
  getBillingDetail,
  listArrearsGroups,
  listBillingRows,
  registerPayment,
  submitForSettlement,
  BILLING_STATUS,
  type ArrearsGroup,
  type BillingDetail,
} from '@/api/billing-service'
import { useSessionStore } from '@/stores/session'

const statuses = BILLING_STATUS
const session = useSessionStore()

const details = ref<BillingDetail[]>([])
const errorMessage = ref('')
const checkedCode = ref('')
const filters = ref({ code: '', customer: '', community: '' })

const detailView = ref<BillingDetail | null>(null)
const reliefTargetId = ref<number | null>(null)
const reliefAmountInput = ref(0)
const reliefRatioInput = ref<number | null>(null)
const reliefReasonInput = ref('')
const reliefHint = ref('')

const filteredDetails = computed(() =>
  details.value.filter((item) => {
    const code = filters.value.code.trim()
    const customer = filters.value.customer.trim()
    const community = filters.value.community.trim()
    return (
      (!code || item.code.includes(code)) &&
      (!customer || item.customer.includes(customer)) &&
      (!community || item.community.includes(community))
    )
  }),
)

const stats = ref(billingStats())
const statCards = computed(() => [
  { label: '待核算用户', value: stats.value.pendingCount },
  { label: '已缴费用户', value: stats.value.paidCount },
  { label: '已减免用户', value: stats.value.relievedCount },
  { label: '欠费户数', value: stats.value.arrearsCount },
  { label: '本月应收金额（元）', value: `¥${stats.value.receivable.toFixed(2)}` },
])

const arrearsGroups = ref<ArrearsGroup[]>([])

const statusSummary = computed(() =>
  [
    statuses.pending,
    statuses.settled,
    statuses.paid,
    statuses.relieved,
  ].map((status) => ({
    status,
    count: details.value.filter((item) => item.status === status).length,
  })),
)

function reload() {
  errorMessage.value = ''
  // 列表金额直接用每行最新字段重算，保证和详情同口径。
  details.value = listBillingRows().map(computeBillingDetail)
  stats.value = billingStats()
  arrearsGroups.value = listArrearsGroups()
  if (detailView.value) {
    detailView.value = getBillingDetail(detailView.value.id)
  }
}

function resetFilters() {
  filters.value = { code: '', customer: '', community: '' }
}

function openCreate() {
  errorMessage.value = '热费结算单登记入口尚未接入审批流'
}

function notify(result: { ok: boolean; message: string }) {
  if (!result.ok) {
    errorMessage.value = result.message
    return false
  }
  errorMessage.value = ''
  reload()
  return true
}

function doSubmit(id: number) {
  notify(submitForSettlement(id))
}

function doPay(id: number) {
  notify(registerPayment(id, session.operator))
}

function openDetail(id: number) {
  detailView.value = getBillingDetail(id)
}

function closeDetail() {
  detailView.value = null
}

const reliefTarget = computed(() =>
  reliefTargetId.value === null ? null : getBillingDetail(reliefTargetId.value),
)

function openRelief(id: number) {
  const target = getBillingDetail(id)
  if (!target) {
    return
  }
  reliefTargetId.value = id
  reliefAmountInput.value = 0
  reliefRatioInput.value = null
  reliefReasonInput.value = ''
  reliefHint.value = ''
}

function closeRelief() {
  reliefTargetId.value = null
  reliefHint.value = ''
}

const reliefPayable = computed(() => {
  const target = reliefTarget.value
  if (!target) {
    return 0
  }
  const amount = Number.isFinite(reliefAmountInput.value) ? Math.max(0, reliefAmountInput.value) : 0
  return Math.round((target.baseAmount - amount + Number.EPSILON) * 100) / 100
})

function syncFromRatio() {
  const target = reliefTarget.value
  if (!target || reliefRatioInput.value === null || Number.isNaN(reliefRatioInput.value)) {
    return
  }
  const ratio = Math.min(100, Math.max(0, reliefRatioInput.value))
  reliefAmountInput.value = Math.round((target.baseAmount * ratio) / 100 * 100) / 100
  reliefHint.value = reliefPayable.value < 0 ? '应缴金额为负，不予受理' : ''
}

function syncFromAmount() {
  // 金额是主输入，比例仅作快捷换算，金额改动后清空比例，避免双向回写打架。
  reliefRatioInput.value = null
  reliefHint.value = reliefPayable.value < 0 ? '应缴金额为负，不予受理' : ''
}

function submitRelief() {
  if (reliefTargetId.value === null) {
    return
  }
  if (!Number.isFinite(reliefAmountInput.value) || reliefAmountInput.value < 0) {
    reliefHint.value = '减免金额不能为负数'
    return
  }
  if (reliefPayable.value < 0) {
    reliefHint.value = '应缴金额为负的减免申请不予受理'
    return
  }
  const result = applyRelief(reliefTargetId.value, {
    reliefAmount: reliefAmountInput.value,
    reason: reliefReasonInput.value,
    cashier: session.operator,
  })
  if (!result.ok) {
    reliefHint.value = result.message
    return
  }
  closeRelief()
  notify(result)
}

onMounted(reload)
</script>

<style scoped>
.arrears-panel {
  margin-top: 18px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
}
.arrears-head {
  margin-bottom: 8px;
}
.arrears-head h3 {
  margin: 0 0 4px;
  font-size: 15px;
}
.arrears-group {
  margin-bottom: 12px;
}
.arrears-group-title {
  margin: 8px 0 4px;
  font-size: 13px;
  color: #334155;
}
.check-text {
  color: #15803d;
}
.amount-negative {
  color: #b42318;
  font-weight: 600;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal-card {
  width: 560px;
  max-width: 92vw;
  max-height: 86vh;
  overflow: auto;
  background: #fff;
  border-radius: 10px;
  padding: 16px 18px;
}
.modal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.modal-head h3 {
  margin: 0;
  font-size: 16px;
}
.modal-foot {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 14px;
}
.detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 18px;
  margin: 0;
}
.detail-grid div {
  display: flex;
  justify-content: space-between;
  border-bottom: 1px dashed var(--border);
  padding: 4px 0;
  font-size: 13px;
}
.detail-grid dt {
  color: var(--muted);
}
.detail-grid dd {
  margin: 0;
}
.detail-amount dd {
  font-size: 15px;
  font-weight: 700;
}
.relief-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.relief-preview {
  margin: 4px 0 0;
  font-size: 14px;
}
.link:disabled {
  color: #94a3b8;
  cursor: not-allowed;
}
</style>
