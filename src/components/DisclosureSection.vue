<script setup>
import { ref, watch } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import { persistedRef } from '../composables/usePersisted.js'

const props = defineProps({
  title: { type: String, required: true },
  meta: { type: String, default: '' },
  defaultOpen: { type: Boolean, default: true },
  storageKey: { type: String, default: '' },
  tone: { type: String, default: 'default' },
})

const localOpen = ref(props.defaultOpen)
const persistedOpen = props.storageKey ? persistedRef(`lab.disclosure.${props.storageKey}.v1`, props.defaultOpen) : null
const open = persistedOpen ?? localOpen

watch(
  () => props.defaultOpen,
  (value) => {
    if (!props.storageKey) open.value = value
  },
)

function onToggle(event) {
  open.value = event.target.open
}
</script>

<template>
  <details class="ds" :class="`tone-${tone}`" :open="open" @toggle="onToggle">
    <summary>
      <span class="ds-title">{{ title }}</span>
      <strong v-if="meta" class="ds-meta">{{ meta }}</strong>
      <ChevronDown :size="13" class="ds-chevron" />
    </summary>
    <div class="ds-body">
      <slot />
    </div>
  </details>
</template>

<style>
.ds {
  display: grid;
  border-bottom: 1px solid var(--line);
  min-width: 0;
}
.ds:last-child {
  border-bottom: none;
}
.ds > summary {
  min-height: 32px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 8px;
  align-items: center;
  padding: 4px 2px;
  list-style: none;
  cursor: pointer;
  user-select: none;
}
.ds > summary::-webkit-details-marker {
  display: none;
}
.ds-title {
  color: var(--ink-secondary);
  font-size: 0.74rem;
  font-weight: 600;
}
.ds > summary:hover .ds-title {
  color: var(--ink);
}
.ds-meta {
  min-width: 0;
  padding: 1px 6px;
  border-radius: var(--r-xs);
  background: var(--surface-alt);
  color: var(--muted);
  font-family: var(--mono);
  font-size: 0.65rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ds-chevron {
  color: var(--muted);
  transition: transform 140ms ease;
  flex-shrink: 0;
}
.ds[open] > summary .ds-chevron {
  transform: rotate(180deg);
}
.ds-body {
  display: grid;
  gap: 8px;
  padding: 2px 0 10px;
  min-width: 0;
}
.ds.tone-muted .ds-title {
  color: var(--muted);
}
.ds.tone-research .ds-title {
  color: var(--blue);
}
</style>
