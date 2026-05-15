<script setup>
defineProps({
  overlays: { type: Object, required: true },
})

const TOGGLES = [
  { key: 'costBand', label: '成本锚带' },
  { key: 'entryLine', label: '入场价线' },
  { key: 'volBand', label: '波动带' },
  { key: 'volume', label: '成交量' },
  { key: 'replayMarkers', label: '回测标记' },
  { key: 'replayMarkerLabels', label: '回测文字' },
  { key: 'currentDecision', label: '当前状态点' },
  { key: 'deltaPane', label: 'Δ 子图' },
  { key: 'equityPane', label: '权益子图' },
  { key: 'kdjPane', label: 'KDJ 子图' },
  { key: 'rsiPane', label: 'RSI 子图' },
]
</script>

<template>
  <div class="cot-grid">
    <label v-for="t in TOGGLES" :key="t.key" class="cot-row">
      <input type="checkbox" v-model="overlays[t.key]" />
      <span>{{ t.label }}</span>
    </label>
  </div>
</template>

<style>
.cot-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 10px; }
.cot-row { display: flex; gap: 7px; align-items: center; padding: 5px 8px; border: 1px solid var(--line); border-radius: 5px; background: var(--bg); cursor: pointer; }
.cot-row:has(input:checked) { border-color: var(--green); background: var(--surface-active); }
.cot-row input { margin: 0; }
.cot-row span { color: var(--ink); font-size: 0.78rem; font-weight: 600; }
</style>
