<script setup>
import { onMounted, ref, watch } from 'vue'
import EthImpactLab from './EthImpactLab.vue'

const props = defineProps({ open: { type: Boolean, default: false } })
const emit = defineEmits(['close'])
const dialog = ref(null)
function syncOpen() {
  if (!dialog.value) return
  if (props.open && !dialog.value.open) dialog.value.showModal()
  else if (!props.open && dialog.value.open) dialog.value.close()
}
onMounted(syncOpen)
watch(() => props.open, syncOpen)
</script>

<template>
  <dialog
    ref="dialog"
    class="market-impact-dialog"
    aria-labelledby="market-impact-title"
    @cancel.prevent="emit('close')"
    @close="emit('close')"
  >
    <header class="market-impact-dialog-header">
      <div>
        <h2 id="market-impact-title">市场冲击研究</h2>
        <span>ETH · 本地数据</span>
      </div>
      <button type="button" autofocus @click="emit('close')">返回行情图</button>
    </header>
    <EthImpactLab />
  </dialog>
</template>

<style scoped>
.market-impact-dialog {
  width: min(1240px, calc(100vw - 32px));
  max-width: none;
  max-height: calc(100dvh - 32px);
  padding: 0;
  margin: auto;
  color: var(--ink);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  overscroll-behavior: contain;
}
.market-impact-dialog::backdrop {
  background: rgb(0 0 0 / 50%);
}
.market-impact-dialog-header {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  background: var(--panel);
  border-bottom: 1px solid var(--line);
}
.market-impact-dialog-header > div {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 12px;
}
.market-impact-dialog-header h2 {
  margin: 0;
  font-size: 15px;
}
.market-impact-dialog-header span {
  font-size: 11px;
  color: var(--muted);
}
.market-impact-dialog-header button {
  flex-shrink: 0;
  padding: 7px 10px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: var(--panel);
  color: var(--ink);
  cursor: pointer;
}
@media (max-width: 640px) {
  .market-impact-dialog {
    width: calc(100vw - 12px);
    max-height: calc(100dvh - 12px);
  }
}
</style>
