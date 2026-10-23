<script setup>
import { computed } from 'vue'
import '../styles/price-reference-map.css'

const props = defineProps({
  snapshot: { type: Object, default: null },
  query: { type: Object, default: null },
  date: { type: String, default: '' },
  bandVisible: { type: Boolean, default: true },
})
const currentSnapshot = computed(() => {
  const { snapshot, query } = props
  if (query && query.status !== 'ready') return null
  if (query?.sourceKey && snapshot?.sourceKey && query.sourceKey !== snapshot.sourceKey) return null
  if (query?.asOfDate && snapshot?.asOfDate && query.asOfDate !== snapshot.asOfDate) return null
  return snapshot
})
const point = computed(() => currentSnapshot.value?.path?.find((item) => item.date === props.date))
const nodes = computed(() => (point.value?.status === 'ready' ? (point.value.nodes ?? []) : []))
const status = computed(() => {
  if (props.query?.status === 'computing') return '计算中'
  if (props.query?.status === 'error') return '暂不可用'
  if (nodes.value.length) return `${point.value.sampleSize} 会话`
  return (
    { 'warming-up': '预热中', 'invalid-data': '数据缺口', 'no-volume': '无有效成交量' }[point.value?.status] ??
    '暂无有效节点'
  )
})
const position = (side) => ({ above: '价格上方', below: '价格下方', at: '现价附近' })[side] ?? '参考价位'
const price = (value) =>
  Number.isFinite(value)
    ? value.toLocaleString('zh-CN', value >= 100 ? { maximumFractionDigits: 2 } : { maximumSignificantDigits: 6 })
    : '—'
const share = (value) => (Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—')
</script>

<template>
  <details class="price-reference-legend">
    <summary>
      <strong>量价地图</strong>
      <span class="price-reference-source">OHLCV 代理</span>
      <time>{{ date || '—' }}</time>
      <span>{{ status }}</span>
      <span v-for="node in nodes" :key="node.price" class="price-reference-node" :class="node.side">
        <span aria-hidden="true">{{ node.isPoc ? '◎' : '●' }}</span>
        {{ node.isPoc ? 'POC' : position(node.side) }} <b>{{ price(node.price) }}</b>
      </span>
      <span class="price-reference-help">口径与占比</span>
    </summary>
    <div class="price-reference-details">
      <p>近 {{ snapshot?.lookbackSessions ?? 60 }} 个会话 · 点大小＝当日窗口内相对密度 · ◎ 最大密度价位</p>
      <p>琥珀：价格上方；青蓝：价格下方。{{ bandVisible ? '淡色区：已有成本带。' : '成本带填色已关闭。' }}</p>
      <table v-if="nodes.length">
        <caption>
          {{
            date
          }}
          的成交密度节点
        </caption>
        <thead>
          <tr>
            <th>位置</th>
            <th>价格</th>
            <th>窗口成交量占比</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="node in nodes" :key="node.price">
            <td>{{ node.isPoc ? 'POC · ' : '' }}{{ position(node.side) }}</td>
            <td>{{ price(node.price) }}</td>
            <td>{{ share(node.share) }}</td>
          </tr>
        </tbody>
      </table>
      <p>按每日高低区间分摊成交量，只使用当日及之前已收盘数据；不代表真实持仓、挂单或 Gamma 暴露。</p>
    </div>
  </details>
</template>
