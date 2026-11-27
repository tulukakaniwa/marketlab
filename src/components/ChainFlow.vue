<script setup>
import { computed } from 'vue'

const props = defineProps({
  graph: { type: Object, required: true },
  market: { type: Object, default: null },
  activeId: { type: String, default: 'delta-band' },
})

const emit = defineEmits(['select'])

const pipeline = computed(() => [
  { id: 'path', label: '样本', val: props.market?.rows ? `${props.market.rows}` : '—', sub: 'K线' },
  {
    id: 'cost',
    label: '成本锚',
    val: fmt(props.market?.costAnchor),
    sub: pctFmt(props.market?.costDistance),
    tone: (props.market?.costDistance ?? 0) < 0 ? 'lo' : 'hi',
  },
  {
    id: 'volatility',
    label: '波动',
    val: pctFmt(props.market?.annualVol),
    sub: `ATR ${pctFmt(props.market?.atrPercent)}`,
  },
  {
    id: 'delta-band',
    label: 'Δ带',
    val: fmt(props.graph.deltaBands?.long?.low),
    sub: fmt(props.graph.deltaBands?.long?.high),
    tone: 'band',
  },
  {
    id: 'order-plan',
    label: '门禁',
    val: props.graph.plan?.primaryOrders?.length
      ? `${props.graph.plan.primaryOrders.length}档`
      : `${props.graph.decision?.candidateStatus ?? '等待'}`,
    sub: executionLabel(props.graph.decision?.executionStatus),
  },
])

function executionLabel(status) {
  return status === 'simulation-only' ? '模拟' : '拦截'
}

function fmt(v) {
  return Number.isFinite(v) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(v) : '—'
}
function pctFmt(v) {
  return Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—'
}

function nClass(n) {
  if (!n.tone) return ''
  return `cf-${n.tone}`
}
</script>

<template>
  <div class="cf-strip">
    <ol class="cf-layer">
      <li v-for="n in pipeline" :key="n.id" class="cf-step">
        <button
          type="button"
          :class="['cf-node', nClass(n), { active: n.id === activeId }]"
          :aria-current="n.id === activeId ? 'step' : undefined"
          @click="emit('select', n.id)"
        >
          <span class="cf-label">{{ n.label }}</span>
          <span class="cf-val">{{ n.val }}</span>
          <span v-if="n.sub" class="cf-sub">{{ n.sub }}</span>
        </button>
      </li>
    </ol>
  </div>
</template>

<style>
.cf-strip {
  container-type: inline-size;
  min-width: 0;
  padding: 4px;
  border-radius: var(--r-md);
  background: var(--surface-alt);
  border: 1px solid var(--line);
}
.cf-layer {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 3px;
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}
.cf-step {
  min-width: 0;
}
.cf-node {
  display: grid;
  gap: 1px;
  justify-items: start;
  width: 100%;
  min-width: 0;
  min-height: 44px;
  border: 1px solid transparent;
  border-radius: var(--r-xs);
  padding: 4px 5px;
  background: transparent;
  color: var(--ink);
  text-align: left;
}
.cf-node:hover {
  background: var(--surface-hover);
}
.cf-node.active {
  border-color: color-mix(in srgb, var(--green) 48%, transparent);
  background: var(--surface-active);
}
.cf-label {
  color: var(--muted);
  font-size: 0.62rem;
  font-weight: 600;
}
.cf-node.active .cf-label {
  color: var(--green);
}
.cf-val {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--mono);
  font-size: 0.72rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.cf-sub {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--mono);
  color: var(--muted);
  font-size: 0.6rem;
}
.cf-lo .cf-val,
.cf-band .cf-val {
  color: var(--blue);
}
.cf-hi .cf-val {
  color: var(--amber);
}
@container (max-width: 280px) {
  .cf-layer {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
