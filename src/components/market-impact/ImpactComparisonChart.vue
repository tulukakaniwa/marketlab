<script setup>
import { computed } from 'vue'
import { signed } from './format.js'
const props = defineProps({ action: { type: Object, default: null } })
const marks = computed(() => [
  {
    id: 'buy-before',
    label: '买入 · 前',
    value: props.action?.buyBase?.before?.executionImpactBps,
    status: props.action?.buyBase?.before?.status,
    y: 80,
    after: false,
  },
  {
    id: 'buy-after',
    label: '买入 · 后',
    value: props.action?.buyBase?.after?.executionImpactBps,
    status: props.action?.buyBase?.after?.status,
    y: 116,
    after: true,
  },
  {
    id: 'sell-before',
    label: '卖出 · 前',
    value: props.action?.sellBase?.before?.executionImpactBps,
    status: props.action?.sellBase?.before?.status,
    y: 196,
    after: false,
  },
  {
    id: 'sell-after',
    label: '卖出 · 后',
    value: props.action?.sellBase?.after?.executionImpactBps,
    status: props.action?.sellBase?.after?.status,
    y: 232,
    after: true,
  },
])
const extent = computed(
  () => Math.max(0.01, ...marks.value.map((mark) => (Number.isFinite(mark.value) ? Math.abs(mark.value) : 0))) * 1.18,
)
const x = (value) => 408 + (value / extent.value) * 270
const ticks = computed(() =>
  [-1, -0.5, 0, 0.5, 1].map((ratio) => ({ value: ratio * extent.value, x: 408 + ratio * 270 })),
)
</script>

<template>
  <figure class="impact-figure">
    <figcaption><span>同单平均成交冲击</span><span class="muted">相对事件时池价 · bps · 含池费</span></figcaption>
    <svg
      viewBox="0 0 800 292"
      role="img"
      aria-label="同一买卖测试单在 LP 动作前后的成交冲击，单位基点；灰色为动作前，蓝色为动作后"
    >
      <g v-for="item in ticks" :key="item.x">
        <line :x1="item.x" y1="38" :x2="item.x" y2="252" :class="item.value === 0 ? 'chart-zero' : 'chart-grid'" />
        <text :x="item.x" y="278" text-anchor="middle" class="chart-tick">{{ signed(item.value, 1) }}</text>
      </g>
      <line x1="118" y1="158" x2="722" y2="158" class="chart-divider" />
      <g v-for="mark in marks" :key="mark.id">
        <text x="16" :y="mark.y + 5" class="chart-label">{{ mark.label }}</text>
        <template v-if="Number.isFinite(mark.value)">
          <rect
            :x="Math.min(x(0), x(mark.value))"
            :y="mark.y - 10"
            :width="Math.max(1, Math.abs(x(mark.value) - x(0)))"
            height="20"
            rx="2"
            :class="mark.after ? 'bar-after' : 'bar-before'"
            :opacity="mark.status === 'partial' ? 0.45 : 1"
          />
          <text x="790" :y="mark.y + 5" text-anchor="end" class="chart-value">{{ signed(mark.value) }}</text>
        </template>
        <text v-else x="408" :y="mark.y + 5" text-anchor="middle" class="chart-tick">等待可用报价</text>
      </g>
    </svg>
    <div class="chart-note">
      <span><i class="swatch before" />动作前</span><span><i class="swatch after" />动作后</span
      ><span class="muted">浅色：仅覆盖内部分成交</span>
    </div>
  </figure>
</template>
