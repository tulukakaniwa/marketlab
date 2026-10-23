<script setup>
const props = defineProps({ state: { type: Object, required: true }, kind: { type: String, required: true } })
const emit = defineEmits(['import', 'clear'])
const names = {
  lp: ['ETHEREUM / UNISWAP V3', '导入 LP 研究包'],
  options: ['DERIBIT / ETH OPTIONS', '导入期权研究包'],
  market: ['BINANCE / ETHUSDT · UTC', '导入对齐行情包'],
}
const labels = {
  idle: '等待导入',
  verifying: '校验 SHA256',
  computing: '计算中',
  ready: '研究已就绪',
  blocked: '校验阻止',
}
function read(event) {
  const file = event.target.files?.[0]
  if (file) emit('import', props.kind, file)
  event.target.value = ''
}
</script>

<template>
  <section class="source-strip" :aria-busy="['verifying', 'computing'].includes(state.phase)">
    <div class="source-identity">
      <span class="eyebrow">{{ names[kind]?.[0] }}</span>
      <strong class="source-name" :title="state.filename">{{ state.filename || '导入本地研究包' }}</strong>
      <span class="muted small">本地读取 · 不上传 · 上限 100 MiB</span>
    </div>
    <div class="source-actions">
      <span class="state-tag" :data-state="state.phase" role="status">{{ labels[state.phase] }}</span>
      <span v-if="state.hashVerified" class="hash-tag">SHA256 ✓</span>
      <label class="button import-button"
        >{{ state.filename ? '更换文件' : '选择 JSON 文件'
        }}<input type="file" accept=".json,application/json" :aria-label="names[kind]?.[1]" @change="read"
      /></label>
      <button v-if="state.filename" class="text-button" @click="emit('clear', kind)">清除</button>
    </div>
  </section>
  <div v-if="state.phase === 'blocked'" class="blocked-strip" role="alert">
    <strong>文件未进入研究计算</strong><span v-for="issue in state.issues" :key="issue">{{ issue }}</span>
  </div>
</template>
