<script setup>
import { computed } from 'vue'

const props = defineProps({
  rows: { type: Array, required: true },
  cursor: { type: Number, required: true },
  observationDate: { type: String, default: '' },
})

const emit = defineEmits(['set-date', 'latest'])

const current = computed(() => props.rows[props.cursor] ?? null)
const firstDate = computed(() => props.rows[0]?.date ?? '')
const lastDate = computed(() => props.rows.at(-1)?.date ?? '')
const progress = computed(() => (props.rows.length > 1 ? props.cursor / (props.rows.length - 1) : 1))
</script>

<template>
  <section class="odc">
    <div class="odc-row">
      <input
        type="date"
        :value="observationDate || current?.date || ''"
        :min="firstDate"
        :max="lastDate"
        :disabled="!rows.length"
        @input="emit('set-date', $event.target.value)"
      />
      <button type="button" :disabled="!rows.length || cursor === rows.length - 1" @click="emit('latest')">
        回到最新
      </button>
    </div>
    <input
      type="range"
      min="0"
      max="1"
      step="0.001"
      :value="progress"
      :disabled="!rows.length"
      aria-label="观察日进度条"
      @input="emit('set-date', rows[Math.round(Number($event.target.value) * (rows.length - 1))]?.date)"
    />
    <footer>
      <small>{{ firstDate || '—' }}</small>
      <small>{{ lastDate || '—' }}</small>
    </footer>
  </section>
</template>

<style>
.odc {
  display: grid;
  gap: 6px;
  padding: 9px 10px;
  border-radius: var(--r-md);
  background: var(--surface-alt);
  border: 1px solid var(--line);
}
.odc-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px;
}
.odc input[type='date'] {
  min-height: 28px;
  font-family: var(--mono);
  font-size: 0.75rem;
}
.odc input[type='range'] {
  width: 100%;
  accent-color: var(--green);
  cursor: pointer;
}
.odc footer {
  display: flex;
  justify-content: space-between;
  font-family: var(--mono);
  font-size: 0.64rem;
  color: var(--muted);
}
</style>
