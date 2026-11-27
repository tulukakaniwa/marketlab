<script setup>
import { computed } from 'vue'
import { buildFormulaAvailabilityMap } from '../domain/formula-research/formulaAvailability.js'
import { formulaCapabilities, formulaStages } from '../domain/formulas/registry.js'

const props = defineProps({
  activeId: { type: String, required: true },
  graph: { type: Object, default: () => ({}) },
  market: { type: Object, default: null },
  rows: { type: Array, default: () => [] },
  costPath: { type: Array, default: () => [] },
  formulaPath: { type: Array, default: () => [] },
})

const emit = defineEmits(['select'])

const availability = computed(() =>
  buildFormulaAvailabilityMap({
    graph: props.graph,
    market: props.market,
    rows: props.rows,
    costPath: props.costPath,
    formulaPath: props.formulaPath,
  }),
)
const grouped = computed(() =>
  formulaCapabilities.map((cap) => ({
    ...cap,
    stages: cap.stages
      .map((sid) => formulaStages.find((stage) => stage.id === sid))
      .filter(Boolean)
      .map((stage) => ({ ...stage, availability: availability.value[stage.id] })),
  })),
)
</script>

<template>
  <nav class="fn-nav">
    <div v-for="cap in grouped" :key="cap.id" class="fn-group">
      <span class="fn-cap-label">{{ cap.label }}</span>
      <button
        v-for="stage in cap.stages"
        :key="stage.id"
        type="button"
        class="fn-item"
        :class="{ active: stage.id === activeId }"
        :title="`${stage.availability.label}：${stage.availability.missingInputs.length ? `缺少 ${stage.availability.missingText}` : stage.availability.boundary}`"
        @click="emit('select', stage.id)"
      >
        <span class="fn-dot" :class="`state-${stage.availability.tone}`" />
        <span class="fn-copy">
          <span class="fn-name">{{ stage.label }}</span>
          <span class="fn-out">{{ stage.outputs[0] }}</span>
        </span>
        <span class="fn-state" :class="`state-${stage.availability.tone}`">{{ stage.availability.label }}</span>
      </button>
    </div>
  </nav>
</template>

<style>
.fn-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.fn-group {
  display: grid;
  gap: 2px;
  margin-bottom: 4px;
}
.fn-cap-label {
  display: block;
  padding: 4px 6px 2px;
  color: var(--muted);
  font-size: 0.64rem;
  font-weight: 600;
}
.fn-item {
  display: grid;
  grid-template-columns: 7px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  min-height: 32px;
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  padding: 4px 8px;
  background: transparent;
  color: var(--ink);
  font-size: 0.75rem;
  text-align: left;
  width: 100%;
}
.fn-item:hover {
  background: var(--surface-hover);
}
.fn-item.active {
  background: var(--surface-active);
  border-color: color-mix(in srgb, var(--green) 45%, transparent);
}
.fn-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--muted);
}
.fn-dot.state-viewable {
  background: var(--green);
}
.fn-dot.state-missing,
.fn-dot.state-gate-failed {
  background: var(--red);
}
.fn-dot.state-research {
  background: var(--blue);
}
.fn-dot.state-proxy {
  background: var(--amber);
}
.fn-copy {
  min-width: 0;
  display: grid;
  gap: 1px;
}
.fn-name {
  font-weight: 600;
}
.fn-out {
  min-width: 0;
  font-family: var(--mono);
  font-size: 0.62rem;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fn-state {
  border-radius: var(--r-xs);
  padding: 1px 5px;
  font-size: 0.62rem;
  font-weight: 600;
  white-space: nowrap;
  background: var(--surface-alt);
  color: var(--muted);
}
.fn-state.state-viewable {
  color: var(--green);
  background: var(--green-dim);
}
.fn-state.state-missing,
.fn-state.state-gate-failed {
  color: var(--red);
  background: var(--red-dim);
}
.fn-state.state-research {
  color: var(--blue);
  background: var(--blue-dim);
}
.fn-state.state-proxy {
  color: var(--amber);
  background: var(--amber-dim);
}
</style>
