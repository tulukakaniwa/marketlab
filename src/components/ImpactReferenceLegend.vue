<script setup>
import { computed } from 'vue'
import '../styles/impact-reference-map.css'

const props = defineProps({
  snapshot: { type: Object, default: null },
  date: { type: String, default: '' },
})
const emit = defineEmits(['open-research'])
const point = computed(() => props.snapshot?.path?.find((item) => item.date === props.date))
const observationTime = computed(() => point.value?.completedAt ?? props.date)
const nodes = computed(() => (point.value?.status === 'ready' ? point.value.nodes : []))
const sources = computed(() => Object.values(point.value?.sourceStatus ?? props.snapshot?.sourceStatus ?? {}))
const hasSample = computed(() => sources.value.some((source) => source.reason !== 'no-sample'))
const reasons = {
  'no-sample': '未导入',
  'research-not-ready': '核验中或不可用',
  'snapshot-after-observation': '晚于观察时间',
  'asset-mismatch': '仅适用 ETH',
  'unsupported-asset': '仅适用 ETH',
  'unknown-asset': '标的未知',
  'quote-mismatch': '报价不匹配',
  'unknown-quote': '报价未知',
  'missing-availability-time': '缺可用时间',
  'no-observations': '无有效价位',
  'no-unexpired-observations': '合约已到期',
  'unknown-completion-time': '缺收盘时间',
  'snapshot-expired': '快照已过期',
  'invalid-history': '时间线不可用',
}
const reason = (source) => (source.status === 'ready' ? '已知快照' : (reasons[source.reason] ?? '暂不可叠加'))
const price = (value) => (Number.isFinite(value) ? value.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : '—')
const quantity = (node) => (node.kind === 'lp' ? String(node.rawValue) : `${price(node.rawValue)} ETH`)
const origin = (value) =>
  ({ observed: '观测', 'captured-rpc': 'RPC 观测', 'synthetic-fixture': '合成样本' })[value] ?? '来源未确认'
</script>

<template>
  <details v-if="hasSample" class="impact-reference-legend">
    <summary>
      <strong>研究价位</strong>
      <span>美元近似 · 未换汇</span>
      <time>收盘 {{ observationTime }}</time>
      <span v-for="source in sources" :key="source.kind">
        {{ source.kind === 'lp' ? '● LP' : '◆ 期权' }} · {{ reason(source) }}
      </span>
      <b v-if="nodes.length">{{ nodes.length }} 个价位</b>
    </summary>
    <div class="impact-reference-details">
      <p>● LP 区间中点 / |ΔL| · ◆ 行权价 / 样本 OI · 点面积＝各来源内相对强度</p>
      <p>每根 K 线只读取当时已知快照；不回贴新数据，不代表实时深度、支撑阻力或净 Gamma。</p>
      <div
        v-for="source in sources.filter((item) => item.availableAt)"
        :key="source.kind"
        class="impact-reference-source"
      >
        <span
          >{{ source.kind === 'lp' ? 'LP' : '期权' }} · {{ origin(source.dataOrigin) }} ·
          {{ source.quoteCurrency }}</span
        >
        <time>可用时间 {{ source.availableAt }}</time>
        <time v-if="source.effectiveAvailableAt && source.effectiveAvailableAt !== source.availableAt">
          首次接入 {{ source.effectiveAvailableAt }}
        </time>
      </div>
      <table v-if="nodes.length">
        <caption>
          {{
            observationTime
          }}
          收盘时已知的研究价位
        </caption>
        <thead>
          <tr>
            <th>来源</th>
            <th>价位 / 区间</th>
            <th>原始强度</th>
            <th>相对强度</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="node in nodes" :key="node.id">
            <td>{{ node.kind === 'lp' ? '● LP' : '◆ 样本 OI' }} {{ node.action ?? '' }}</td>
            <td>
              {{ price(node.price)
              }}<small v-if="node.kind === 'lp'">{{ price(node.lowerPrice) }}–{{ price(node.upperPrice) }}</small>
            </td>
            <td>{{ quantity(node) }}<small v-if="node.kind === 'lp'">协议流动性单位</small></td>
            <td>{{ (node.intensity * 100).toFixed(1) }}%</td>
          </tr>
        </tbody>
      </table>
      <button type="button" @click="emit('open-research')">查看 / 更换研究样本</button>
    </div>
  </details>
</template>
