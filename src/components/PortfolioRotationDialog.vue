<script setup>
import { computed } from 'vue'
import { X, RefreshCw, ArrowUpRight } from 'lucide-vue-next'

const props = defineProps({
  open: { type: Boolean, default: false },
  running: { type: Boolean, default: false },
  error: { type: String, default: '' },
  presets: { type: Array, default: () => [] },
  presetId: { type: String, default: '' },
  maxSlots: { type: Number, default: 5 },
  useMakerLadder: { type: Boolean, default: true },
  result: { type: Object, default: null },
})

const emit = defineEmits(['close', 'select-preset', 'set-slots', 'toggle-ladder', 'jump-symbol'])

const activePreset = computed(() => props.presets.find((p) => p.id === props.presetId) ?? props.presets[0])

const chartSvg = computed(() => {
  const curve = props.result?.equityCurve ?? []
  if (curve.length < 2) return null
  const W = 760
  const H = 190
  const padX = 8
  const padTop = 12
  const eqH = 132
  const utilTop = 152
  const utilH = 30

  const step = Math.max(1, Math.floor(curve.length / 280))
  const sampled = curve.filter((_, idx) => idx % step === 0 || idx === curve.length - 1)

  let minEq = Infinity
  let maxEq = -Infinity
  for (const pt of sampled) {
    minEq = Math.min(minEq, pt.equity, pt.benchmarkEquity)
    maxEq = Math.max(maxEq, pt.equity, pt.benchmarkEquity)
  }
  const span = Math.max(maxEq - minEq, 0.05)

  const sx = (i) => padX + (i / (sampled.length - 1)) * (W - padX * 2)
  const sy = (v) => padTop + (1 - (v - minEq) / span) * eqH
  const su = (u) => utilTop + (1 - Math.max(0, Math.min(1, u))) * utilH

  const eqPath = sampled.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(p.equity).toFixed(1)}`).join(' ')
  const benchPath = sampled
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(p.benchmarkEquity).toFixed(1)}`)
    .join(' ')
  const utilArea = [
    `M${sx(0).toFixed(1)},${(utilTop + utilH).toFixed(1)}`,
    ...sampled.map((p, i) => `L${sx(i).toFixed(1)},${su(p.utilization).toFixed(1)}`),
    `L${sx(sampled.length - 1).toFixed(1)},${(utilTop + utilH).toFixed(1)} Z`,
  ].join(' ')

  return { W, H, eqPath, benchPath, utilArea, baseY: sy(1.0), minEq, maxEq }
})

function signedPct(v, digits = 1) {
  if (!Number.isFinite(v)) return '—'
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(digits)}%`
}
function pct(v, digits = 1) {
  return Number.isFinite(v) ? `${(v * 100).toFixed(digits)}%` : '—'
}
function num(v, digits = 2) {
  if (v === Infinity) return '∞'
  return Number.isFinite(v) ? v.toFixed(digits) : '—'
}
</script>

<template>
  <div
    v-if="open"
    class="pr-backdrop"
    role="dialog"
    aria-modal="true"
    aria-label="跨市场多标的资金轮动引擎"
    @click.self="emit('close')"
  >
    <div class="pr-modal">
      <header class="pr-header">
        <div class="pr-title-group">
          <strong>跨市场多标的资金轮动引擎</strong>
          <span class="pr-badge">无前视前缀因果 · 闲置现金复用 · 仅研究模拟</span>
        </div>
        <button type="button" class="pr-close-btn" aria-label="关闭" @click="emit('close')">
          <X :size="16" />
        </button>
      </header>

      <div class="pr-toolbar">
        <div class="pr-presets">
          <button
            v-for="item in presets"
            :key="item.id"
            type="button"
            class="pr-pill"
            :class="{ active: item.id === presetId }"
            :disabled="running"
            @click="emit('select-preset', item.id)"
          >
            {{ item.shortLabel }}
          </button>
        </div>

        <div class="pr-controls">
          <span class="pr-ctrl-label">最大并发持仓</span>
          <button
            v-for="slots in [3, 5, 8]"
            :key="slots"
            type="button"
            class="pr-slot-btn"
            :class="{ active: maxSlots === slots }"
            :disabled="running"
            @click="emit('set-slots', slots)"
          >
            {{ slots }}仓
          </button>
          <button
            type="button"
            class="pr-ladder-btn"
            :class="{ active: useMakerLadder }"
            :disabled="running"
            @click="emit('toggle-ladder')"
          >
            √P 限价梯队：{{ useMakerLadder ? '开' : '关' }}
          </button>
        </div>
      </div>

      <div v-if="running" class="pr-loading">
        <RefreshCw :size="16" class="pr-spin" />
        <span>正在并行推演 {{ activePreset?.label }} 前缀因果净值路径…</span>
      </div>

      <p v-else-if="error" class="pr-error">{{ error }}</p>

      <div v-else-if="result?.status === 'ready'" class="pr-body">
        <div class="pr-kpi-grid">
          <div class="pr-kpi">
            <span>组合累计净值</span>
            <strong :class="result.summary.totalNetReturn >= 0 ? 'green' : 'red'">
              {{ signedPct(result.summary.totalNetReturn) }}
            </strong>
            <small>等权基准 {{ signedPct(result.summary.benchmarkReturn) }}</small>
          </div>
          <div class="pr-kpi">
            <span>年化复利 CAGR</span>
            <strong :class="result.summary.cagr >= 0 ? 'green' : 'red'">{{ signedPct(result.summary.cagr) }}</strong>
            <small>{{ result.startDate }} ~ {{ result.endDate }}</small>
          </div>
          <div class="pr-kpi">
            <span>夏普比率 Sharpe</span>
            <strong>{{ num(result.summary.sharpe) }}</strong>
            <small>年化波动 {{ pct(result.summary.annualVol) }}</small>
          </div>
          <div class="pr-kpi">
            <span>最大回撤</span>
            <strong class="red">{{ pct(result.summary.maxDrawdown) }}</strong>
            <small>卡玛比率 {{ num(result.summary.calmar) }}</small>
          </div>
          <div class="pr-kpi">
            <span>资金利用率</span>
            <strong class="blue">{{ pct(result.summary.avgUtilization) }}</strong>
            <small>最多 {{ result.maxSlots }} 标的并发轮动</small>
          </div>
          <div class="pr-kpi">
            <span>交割笔数 / 盈亏比</span>
            <strong>{{ result.summary.closedCount }}笔 · PF {{ num(result.summary.profitFactor) }}</strong>
            <small>胜率 {{ pct(result.summary.winRate, 0) }} · 当前持仓 {{ result.summary.activeCount }} 仓</small>
          </div>
        </div>

        <div v-if="chartSvg" class="pr-chart-card">
          <div class="pr-chart-legend">
            <span><i class="dot-eq" /> 轮动组合净值</span>
            <span><i class="dot-bench" /> 等权买入持有</span>
            <span><i class="dot-util" /> 下方色带：每日仓位利用率</span>
          </div>
          <svg :viewBox="`0 0 ${chartSvg.W} ${chartSvg.H}`" class="pr-svg" preserveAspectRatio="none">
            <line :x1="8" :x2="chartSvg.W - 8" :y1="chartSvg.baseY" :y2="chartSvg.baseY" class="pr-zero-line" />
            <path :d="chartSvg.benchPath" class="pr-bench-line" />
            <path :d="chartSvg.eqPath" class="pr-eq-line" />
            <path :d="chartSvg.utilArea" class="pr-util-area" />
          </svg>
        </div>

        <div class="pr-tables">
          <section class="pr-table-card">
            <h4>标的净值贡献榜（点击切换主图）</h4>
            <div class="pr-table-scroll">
              <table class="pr-table">
                <thead>
                  <tr>
                    <th>标的</th>
                    <th>笔数</th>
                    <th>胜率</th>
                    <th>组合净贡献</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="row in result.attribution"
                    :key="row.symbol"
                    class="pr-click-row"
                    @click="emit('jump-symbol', row.symbol)"
                  >
                    <td>
                      <code>{{ row.symbol }}</code>
                      <span v-if="row.active" class="pr-hold-tag">持仓中</span>
                      <ArrowUpRight :size="11" class="pr-jump-ico" />
                    </td>
                    <td>{{ row.trades }}</td>
                    <td>{{ row.trades ? `${Math.round((row.wins / row.trades) * 100)}%` : '—' }}</td>
                    <td :class="row.netContribution >= 0 ? 'green' : 'red'">{{ signedPct(row.netContribution) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section class="pr-table-card">
            <h4>最近轮动交割记录</h4>
            <div class="pr-table-scroll">
              <table class="pr-table">
                <thead>
                  <tr>
                    <th>标的 / 策略</th>
                    <th>进出日期</th>
                    <th>单笔净收益</th>
                    <th>离场原因</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(tr, idx) in result.recentTrades" :key="idx">
                    <td>
                      <code>{{ tr.symbol }}</code>
                      <small class="pr-muted">{{ tr.legLabel }}</small>
                    </td>
                    <td class="pr-mono">{{ tr.entryDate.slice(2) }}→{{ tr.exitDate.slice(2) }}</td>
                    <td :class="tr.rawNetReturn >= 0 ? 'green' : 'red'">{{ signedPct(tr.rawNetReturn) }}</td>
                    <td>{{ tr.reason }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>

<style src="../styles/portfolio-rotation.css"></style>
