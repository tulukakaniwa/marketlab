<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useEthImpactResearchStore } from '../../stores/ethImpactResearchStore.js'
import '../../styles/continuous-research.css'
const emit = defineEmits(['show-on-chart'])
const store = useEthImpactResearchStore()
const clock = ref(Date.now())
let timer
onMounted(() => {
  timer = setInterval(() => {
    clock.value = Date.now()
  }, 15000)
})
onUnmounted(() => clearInterval(timer))
const live = computed(() => store.live)
const busy = computed(() => ['connecting', 'verifying'].includes(live.value.state.phase))
const phase = computed(
  () =>
    ({
      idle: '未接入',
      connecting: '连接中',
      verifying: '核验中',
      ready: '已接入',
      degraded: '部分失败',
      error: '连接失败',
      paused: '已暂停接入',
    })[live.value.state.phase] ?? '未接入',
)
const lanes = computed(() =>
  ['market', 'lp', 'options'].map((kind) => {
    const history = live.value[`${kind}History`]
    const last = history.at(-1)
    return {
      kind,
      name: { market: '行情', lp: 'LP', options: '期权' }[kind],
      count: history.length,
      stale: last && clock.value - Date.parse(last.availableAt) > 900000,
      last: last?.availableAt,
      next: live.value.state.lanes[kind]?.nextRunAt,
      error: live.value.state.lanes[kind]?.error,
    }
  }),
)
const discarded = computed(() =>
  Object.values(live.value.state.retention?.discarded ?? {}).reduce(
    (sum, value) => sum + (Number.isSafeInteger(value) && value > 0 ? value : 0),
    0,
  ),
)
function selectMode(selected) {
  store.liveSelected = selected
  emit('show-on-chart')
}
function time(value) {
  return value ? new Date(value).toISOString().slice(11, 19) : '—'
}
</script>

<template>
  <section class="continuous-research" aria-label="持续研究接入">
    <div class="continuous-research-actions">
      <strong>自动接入 · {{ phase }}</strong>
      <button v-if="!live.running" type="button" :disabled="!live.supported" @click="store.startContinuous">
        开始自动接入
      </button>
      <button v-else type="button" @click="live.stop">暂停接入</button>
      <button type="button" :disabled="!live.supported || busy" @click="live.refresh">立即刷新</button>
      <button v-if="live.marketRows.length" type="button" :aria-pressed="store.liveSelected" @click="selectMode(true)">
        持续行情
      </button>
      <button
        v-if="store.market.phase === 'ready'"
        type="button"
        :aria-pressed="!store.liveSelected"
        @click="selectMode(false)"
      >
        手动样本
      </button>
      <span>最近接入 {{ time(live.state.lastSuccessAt) }} UTC · 每 15 秒检查</span>
    </div>
    <div class="continuous-research-lanes">
      <span v-for="lane in lanes" :key="lane.kind" :class="{ stale: lane.stale || lane.error }">
        {{ lane.name }} {{ lane.count }} 份 · {{ time(lane.last) }}<b v-if="lane.stale"> 已过期</b>
        <small v-if="lane.next"> · 下次 {{ time(lane.next) }}</small>
        <small v-if="lane.error"> · {{ lane.error }}</small>
      </span>
    </div>
    <p>
      每来源保留最近 288 份 · 行情最近 1000 根<span v-if="discarded"> · 已移出窗口 {{ discarded }} 份</span>
    </p>
    <p v-if="!live.supported">仅本机工作台支持自动接入；静态部署使用本地文件导入。</p>
    <p v-else-if="['idle', 'error'].includes(live.state.phase)">本地采集命令 <code>pnpm research:live</code></p>
    <p v-if="live.state.error" role="status">{{ live.state.error }}</p>
    <p v-if="live.state.issues.length" role="status">{{ live.state.issues.at(-1).reason }}</p>
  </section>
</template>
