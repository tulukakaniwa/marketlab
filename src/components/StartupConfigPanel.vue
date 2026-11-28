<script setup>
import { computed } from 'vue'

const props = defineProps({
  input: { type: Object, required: true },
  featureFlags: { type: Object, required: true },
  overlays: { type: Object, required: true },
  rows: { type: Array, default: () => [] },
  cursor: { type: Number, default: 0 },
})

const emit = defineEmits(['patch-input', 'set-feature-flag', 'set-overlay'])

const warmupIndex = computed(() =>
  Math.min(80, Math.max(20, Math.floor(props.rows.length * 0.03)), Math.max(props.rows.length - 1, 0)),
)
const firstDate = computed(() => props.rows[warmupIndex.value]?.date ?? props.rows[0]?.date ?? '')
const lastDate = computed(
  () =>
    props.rows[Math.min(Math.max(props.cursor, 0), Math.max(props.rows.length - 1, 0))]?.date ??
    props.rows.at(-1)?.date ??
    '',
)
</script>

<template>
  <section class="startup-config">
    <div class="sc-grid">
      <label class="sc-toggle">
        <input
          :checked="Boolean(featureFlags.replayAccount)"
          type="checkbox"
          @change="emit('set-feature-flag', 'replayAccount', $event.target.checked)"
        />
        <span>现货回放</span>
      </label>
      <label class="sc-toggle">
        <input
          :checked="Boolean(featureFlags.replayAutoProfile)"
          type="checkbox"
          :disabled="!featureFlags.replayAccount"
          @change="emit('set-feature-flag', 'replayAutoProfile', $event.target.checked)"
        />
        <span>自动选档</span>
      </label>
      <label class="sc-toggle">
        <input
          :checked="Boolean(featureFlags.portfolioResearch)"
          type="checkbox"
          @change="emit('set-feature-flag', 'portfolioResearch', $event.target.checked)"
        />
        <span>组合估值</span>
      </label>
      <label class="sc-toggle">
        <input
          :checked="Boolean(overlays.equityPane)"
          type="checkbox"
          :disabled="!featureFlags.replayAccount"
          @change="emit('set-overlay', 'equityPane', $event.target.checked)"
        />
        <span>权益副图</span>
      </label>
    </div>

    <div class="sc-inputs">
      <label>
        <span>回放起始日</span>
        <input
          :value="input.accountStartDate"
          type="date"
          :min="firstDate"
          :max="lastDate"
          @input="emit('patch-input', { accountStartDate: $event.target.value })"
        />
      </label>
      <label>
        <span>默认起点</span>
        <button type="button" class="sc-mini-btn" @click="emit('patch-input', { accountStartDate: '' })">
          预热后 ({{ firstDate || '自动' }})
        </button>
      </label>
    </div>
  </section>
</template>

<style>
.startup-config {
  display: grid;
  gap: 8px;
  padding: 9px 10px;
  border-radius: var(--r-md);
  background: var(--surface-alt);
  border: 1px solid var(--line);
}
.sc-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px;
}
.sc-toggle {
  display: flex;
  gap: 6px;
  align-items: center;
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: var(--r-xs);
  padding: 5px 7px;
  background: var(--bg);
  cursor: pointer;
}
.sc-toggle:has(input:checked) {
  border-color: color-mix(in srgb, var(--green) 50%, transparent);
  background: var(--surface-active);
}
.sc-toggle input {
  margin: 0;
  accent-color: var(--green);
}
.sc-toggle span {
  color: var(--ink);
  font-size: 0.72rem;
  font-weight: 600;
}
.sc-inputs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.sc-inputs label {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.sc-inputs span {
  color: var(--muted);
  font-size: 0.64rem;
  font-weight: 600;
}
.sc-inputs input,
.sc-mini-btn {
  min-width: 0;
  min-height: 28px;
  font-family: var(--mono);
  font-size: 0.72rem;
}
.sc-mini-btn {
  justify-content: flex-start;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
