<script setup>
import { computed } from 'vue'
import { clock } from '../../domain/eth-replay/minute.js'

const props = defineProps({ series: { type: Array, required: true } })
const graph = computed(() => {
  const rows = props.series
  const values = rows.flatMap((r) => [r.spot, r.perp]).filter(Number.isFinite)
  if (!values.length) return null
  const low = Math.min(...values),
    high = Math.max(...values)
  const pad = Math.max(0.02, (high - low) / 12)
  const paths = ['spot', 'perp'].map((venue) => {
    let move = true,
      line = ''
    rows.forEach((r, i) => {
      if (r[venue] == null) {
        move = true
        return
      }
      const x = 4 + (632 * i) / Math.max(1, rows.length - 1)
      const y = 6 + (97 * (high + pad - r[venue])) / (high - low + 2 * pad)
      line += (move ? 'M' : 'L') + x.toFixed(2) + ',' + y.toFixed(2) + ' '
      move = false
    })
    return line
  })
  return { paths, high, low, first: clock(rows[0].minute), last: clock(rows.at(-1).minute) }
})
</script>

<template>
  <div v-if="graph" class="eth-plot">
    <aside>
      <span>{{ graph.high.toFixed(2) }}</span
      ><span>{{ graph.low.toFixed(2) }}</span>
    </aside>
    <svg viewBox="0 0 640 112" preserveAspectRatio="none" role="img" aria-label="截至回放时刻的现货与永续分钟价格">
      <path d="M0,8H640 M0,56H640 M0,104H640" class="gridline" />
      <path v-for="(path, i) in graph.paths" :key="i" :d="path" :class="i ? 'perp-line' : 'spot-line'" />
    </svg>
    <footer>
      <span>{{ graph.first }}</span
      ><span>{{ graph.last }} UTC</span>
    </footer>
  </div>
  <p v-else>当前没有已发布的分钟价格。</p>
</template>
