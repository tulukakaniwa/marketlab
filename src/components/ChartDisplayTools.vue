<script setup>
const props = defineProps({
  overlays: { type: Object, required: true },
  ready: { type: Boolean, default: true },
  chipAvailable: { type: Boolean, default: true },
  chipSource: { type: String, default: '成交量按价格分布代理' },
})

const emit = defineEmits(['set-overlay'])
const centerTools = [
  {
    key: 'statisticalCenter',
    label: '统计中心',
    title: '统计回归中心；可在 Vela 原生设置调整窗口',
  },
  {
    key: 'vwapCost',
    label: '成交重心',
    title: 'HLC3 成交量重心代理；可在 Vela 原生设置调整窗口',
  },
  { key: 'cohortCost', label: '存续成本', title: '换手存续成本代理' },
  { key: 'supplyDemand', label: '供需场景', title: '供需均衡场景标尺' },
  { key: 'fundamental', label: '估值场景', title: '基本面估值场景标尺' },
]

function toggle(key, available = true) {
  if (!props.ready || !available || !Object.hasOwn(props.overlays, key)) return
  emit('set-overlay', key, !props.overlays[key])
}
</script>

<template>
  <div class="chart-display-tools" role="toolbar" aria-label="图表显示工具">
    <span class="chart-display-tools-label">图层</span>
    <button
      type="button"
      :class="{ active: overlays.volume !== false }"
      :aria-pressed="overlays.volume !== false"
      :disabled="!ready"
      title="成交量副图"
      @click="toggle('volume')"
    >
      成交量
    </button>
    <button
      type="button"
      class="chart-chip-tool"
      :class="{ active: overlays.stockChipProfile !== false }"
      :aria-pressed="overlays.stockChipProfile !== false"
      :disabled="!ready || !chipAvailable"
      :title="chipAvailable ? chipSource : '筹码分布仅在桌面宽度显示'"
      @click="toggle('stockChipProfile', chipAvailable)"
    >
      筹码
    </button>
    <button
      type="button"
      :class="{ active: overlays.causalEquilibrium !== false }"
      :aria-pressed="overlays.causalEquilibrium !== false"
      :disabled="!ready"
      title="局部趋势价格滤波参考线"
      @click="toggle('causalEquilibrium')"
    >
      <span class="cdt-dot-purple" aria-hidden="true" />滤波参考
    </button>
    <button
      type="button"
      :class="{ active: overlays.priceReferenceMap !== false }"
      :aria-pressed="overlays.priceReferenceMap !== false"
      :disabled="!ready"
      title="量价地图：历史成交密度节点与成本带填色（OHLCV 代理）"
      @click="toggle('priceReferenceMap')"
    >
      量价地图
    </button>
    <button
      type="button"
      :class="{ active: overlays.impactReferenceMap !== false }"
      :aria-pressed="overlays.impactReferenceMap !== false"
      :disabled="!ready"
      title="LP 区间与期权 OI 研究价位"
      @click="toggle('impactReferenceMap')"
    >
      研究价位
    </button>

    <i class="cdt-sep" aria-hidden="true" />

    <button
      v-for="tool in centerTools"
      :key="tool.key"
      type="button"
      :class="{ active: Boolean(overlays[tool.key]) }"
      :aria-pressed="Boolean(overlays[tool.key])"
      :disabled="!ready"
      :title="tool.title"
      @click="toggle(tool.key)"
    >
      {{ tool.label }}
    </button>
    <span class="chart-scale-badge" title="主图价格轴使用对数坐标">主图 Log</span>
  </div>
</template>

<style>
.chart-display-tools {
  flex: 1 1 auto;
  display: flex;
  gap: 3px;
  align-items: center;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.chart-display-tools::-webkit-scrollbar {
  display: none;
}
.chart-display-tools-label {
  color: var(--muted);
  font-size: 0.68rem;
  font-weight: 600;
  margin-right: 2px;
  flex-shrink: 0;
}
.cdt-sep {
  width: 1px;
  height: 14px;
  background: var(--line-strong);
  margin: 0 3px;
  flex-shrink: 0;
}
.cdt-dot-purple {
  width: 6px;
  height: 2px;
  border-radius: 2px;
  background: #a855f7;
  display: inline-block;
}
.chart-display-tools button,
.chart-scale-badge {
  min-height: 24px;
  padding: 2px 8px;
  border: 1px solid transparent;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--muted);
  font-size: 0.72rem;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
}
.chart-display-tools button:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--ink);
  border-color: transparent;
}
.chart-display-tools button.active {
  border-color: color-mix(in srgb, var(--green) 42%, transparent);
  background: var(--green-dim);
  color: var(--green);
}
.chart-scale-badge {
  display: inline-flex;
  align-items: center;
  border-color: var(--line);
  font-family: var(--mono);
  font-size: 0.66rem;
  color: var(--muted);
}
</style>
