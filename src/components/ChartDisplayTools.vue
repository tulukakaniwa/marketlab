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
    title: '统计回归中心；仅在窗口可识别时显示，可在 Vela 原生设置调整窗口',
  },
  {
    key: 'vwapCost',
    label: '成交重心',
    title: 'HLC3 成交量重心代理；不代表持仓者的真实成本，可在 Vela 原生设置调整窗口',
  },
  { key: 'cohortCost', label: '存续成本', title: '随机换手存续成本代理；不含未知初始持仓，缺已知流通数据时不生成数值' },
  { key: 'supplyDemand', label: '供需场景', title: '供需均衡参数场景；仅标当前观察点，需填写独立场景参数' },
  { key: 'fundamental', label: '估值场景', title: '基本面估值参数场景；仅标当前观察点，需填写独立场景参数' },
]

function toggle(key, available = true) {
  if (!props.ready || !available || !Object.hasOwn(props.overlays, key)) return
  emit('set-overlay', key, !props.overlays[key])
}
</script>

<template>
  <div class="chart-display-tools" role="toolbar" aria-label="图表显示工具">
    <span class="chart-display-tools-label">显示</span>
    <button
      type="button"
      :class="{ active: overlays.volume !== false }"
      :aria-pressed="overlays.volume !== false"
      :disabled="!ready"
      title="显示或隐藏 OHLCV 成交量副图"
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
      :title="chipAvailable ? `显示或隐藏${chipSource}` : '筹码图在桌面宽度显示'"
      @click="toggle('stockChipProfile', chipAvailable)"
    >
      筹码
    </button>
    <button
      type="button"
      :class="{ active: overlays.causalEquilibrium !== false }"
      :aria-pressed="overlays.causalEquilibrium !== false"
      :disabled="!ready"
      title="价格滤波参考；历史局部趋势滤波值，不代表因果均衡或回归目标"
      @click="toggle('causalEquilibrium')"
    >
      <span style="color: #a855f7" aria-hidden="true">━</span> 滤波参考
    </button>
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
    <span class="chart-scale-badge" title="主图价格轴默认使用对数坐标">主图 Log</span>
  </div>
</template>

<style>
.chart-display-tools {
  flex: 1 1 auto;
  display: flex;
  gap: 3px;
  align-items: center;
  min-width: 0;
  flex-wrap: wrap;
}
.chart-display-tools-label {
  color: var(--muted);
  font-size: 11px;
  font-weight: 800;
}
.chart-display-tools button,
.chart-scale-badge {
  min-height: 30px;
  padding: 3px 7px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: var(--surface);
  color: var(--muted);
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
}
.chart-display-tools button {
  cursor: pointer;
}
.chart-display-tools button.active {
  border-color: var(--green);
  background: var(--green-dim);
  color: var(--green);
}
.chart-display-tools button:disabled {
  opacity: 0.48;
  cursor: not-allowed;
}
.chart-scale-badge {
  display: grid;
  place-items: center;
  border-style: dashed;
  background: transparent;
  color: var(--green);
}
.chart-display-tools :focus-visible {
  outline: 3px solid color-mix(in srgb, var(--green) 58%, white);
  outline-offset: 2px;
}
</style>
