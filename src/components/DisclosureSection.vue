<script setup>
import { ref, watch } from 'vue'
import { persistedRef } from '../composables/usePersisted.js'

const props = defineProps({
  title: { type: String, required: true },
  meta: { type: String, default: '' },
  defaultOpen: { type: Boolean, default: true },
  storageKey: { type: String, default: '' },
  tone: { type: String, default: 'default' },
})

const localOpen = ref(props.defaultOpen)
const persistedOpen = props.storageKey
  ? persistedRef(`lab.disclosure.${props.storageKey}.v1`, props.defaultOpen)
  : null
const open = persistedOpen ?? localOpen

watch(() => props.defaultOpen, (value) => {
  if (!props.storageKey) open.value = value
})

function onToggle(event) {
  open.value = event.target.open
}
</script>

<template>
  <details class="ds" :class="`tone-${tone}`" :open="open" @toggle="onToggle">
    <summary>
      <span>{{ title }}</span>
      <strong v-if="meta">{{ meta }}</strong>
      <i aria-hidden="true">⌄</i>
    </summary>
    <div class="ds-body">
      <slot />
    </div>
  </details>
</template>

<style>
.ds { display: grid; border-bottom: 1px solid var(--line); min-width: 0; }
.ds:last-child { border-bottom: none; }
.ds summary {
  min-height: 34px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 8px;
  align-items: center;
  list-style: none;
  cursor: pointer;
  color: var(--green);
  font-size: 0.66rem;
  font-weight: 900;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.ds summary::-webkit-details-marker { display: none; }
.ds summary strong {
  min-width: 0;
  color: var(--ink);
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0;
  text-transform: none;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ds summary i {
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  color: var(--muted);
  font-style: normal;
  font-size: 0.74rem;
  transition: transform 120ms ease;
}
.ds[open] summary i { transform: rotate(180deg); }
.ds-body { display: grid; gap: 8px; padding: 2px 0 12px; min-width: 0; }
.ds.tone-muted summary { color: var(--muted); }
.ds.tone-research summary { color: var(--blue); }
</style>
