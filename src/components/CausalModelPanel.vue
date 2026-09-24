<script setup>
import { computed } from 'vue'

const props = defineProps({
  snapshot: { type: Object, default: null },
  queryState: { type: Object, default: null },
})

const stateLabels = { reversion: '回归', 'mean-reversion': '回归', trend: '趋势', shock: '冲击' }
const emptyLabel = computed(() => {
  if (props.queryState?.status === 'computing') return '正在估计当前观察日'
  if (props.queryState?.status === 'error') return '估计失败，切换观察日可重试'
  if (props.queryState?.reason === 'missing-tdpy') return '待识别年交易会话数'
  if (props.snapshot?.status === 'warming-up') return '历史样本不足'
  if (props.snapshot?.status === 'invalid-data') return '历史数据无效'
  return '等待历史数据'
})
const ready = computed(() => props.snapshot?.status === 'ready')
const passage = computed(() => props.snapshot?.passage)
const passageReady = computed(() => passage.value?.status === 'ready')
const passageLabel = computed(() => {
  if (passage.value?.reason === 'at-equilibrium') return '已处均衡附近，未构造双边触达'
  return '当前状态未形成双边触达估计'
})
function price(value) {
  return Number.isFinite(value) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value) : '—'
}
function percent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—'
}
function sessions(value) {
  return Number.isFinite(value) ? `${value} 会话` : '—'
}
</script>

<template>
  <article class="causal-model-panel" aria-label="因果模型估计">
    <div class="causal-model-source">
      <span>截至 {{ snapshot?.asOfDate || queryState?.asOfDate || '—' }}</span>
      <span>仅历史前缀 · 模型估计</span>
    </div>
    <p v-if="!ready" class="dd-empty-note" role="status">{{ emptyLabel }}</p>
    <template v-else>
      <div class="dd-action-grid">
        <div>
          <span title="经过滤波估计的价格中枢，不是真实持仓成本">动态均衡锚</span
          ><strong>{{ price(snapshot.state?.equilibrium?.price) }}</strong>
        </div>
        <div>
          <span>条件波动 · 年化</span><strong>{{ percent(snapshot.state?.volatility?.annualized) }}</strong>
        </div>
      </div>
      <div class="causal-model-weights" aria-label="状态模型权重">
        <div v-for="component in snapshot.state?.dynamics?.components ?? []" :key="component.id">
          <span>{{ stateLabels[component.id] || component.label || component.id }}</span>
          <strong>{{ percent(component.weight) }}</strong>
        </div>
      </div>
      <template v-if="passageReady">
        <div class="causal-model-source">
          <span>{{ passage.side === 'long' ? '向上修复' : '向下修复' }}</span>
          <span>扩散尺度窗口 {{ sessions(passage.computedHorizonSessions ?? passage.horizonSessions) }}</span>
        </div>
        <div class="dd-action-grid">
          <div>
            <span>模型目标</span><strong>{{ price(passage.targetPrice) }}</strong>
          </div>
          <div>
            <span>模型风险边界</span><strong>{{ price(passage.riskPrice) }}</strong>
          </div>
        </div>
        <div class="causal-model-probabilities" aria-label="期限内首次触达概率">
          <div>
            <span>先到目标</span><strong>{{ percent(passage.targetProbability) }}</strong>
          </div>
          <div>
            <span>先到风险</span><strong>{{ percent(passage.riskProbability) }}</strong>
          </div>
          <div>
            <span>均未触达</span><strong>{{ percent(passage.survivalProbability) }}</strong>
          </div>
        </div>
        <div class="dd-action-grid">
          <div>
            <span>目标触达中位 · 条件于期限内</span
            ><strong>{{ sessions(passage.conditionalMedianSessions?.target) }}</strong>
          </div>
          <div>
            <span>风险触达中位 · 条件于期限内</span
            ><strong>{{ sessions(passage.conditionalMedianSessions?.risk) }}</strong>
          </div>
        </div>
        <p v-if="passage.truncated" class="dd-empty-note">
          仅算前 {{ sessions(passage.computedHorizonSessions) }} · 原窗口 {{ sessions(passage.horizonSessions) }}
        </p>
        <p v-if="passage.numerical?.resolutionStatus === 'coarse-relative-to-transition-scale'" class="dd-empty-note">
          网格分辨率不足 · 概率近似较粗
        </p>
        <p class="dd-empty-note">会话收盘触达 · 目标为当前均衡锚 · 风险线为反向等幅对数偏离</p>
      </template>
      <p v-else class="dd-empty-note">{{ passageLabel }}</p>
      <p class="dd-empty-note">冻结观察日参数 · 模型概率未校准</p>
      <p class="dd-empty-note">观察日收盘后可用 · 不读取未来行情或手填情景参数 · 独立研究结果</p>
    </template>
  </article>
</template>

<style src="../styles/causal-model.css"></style>
