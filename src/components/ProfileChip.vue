<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'

const props = defineProps({
  profileId: { type: String, required: true },
  autoProfile: { type: Boolean, required: true },
  profileList: { type: Array, required: true },
  recommendedId: { type: String, default: 'balanced' },
})

const emit = defineEmits(['set', 'set-auto'])

const open = ref(false)
const wrapper = ref(null)

const TONES = {
  conservative: 'tone-blue',
  balanced: 'tone-green',
  aggressive: 'tone-orange',
}

const activeLabel = computed(() => {
  const id = props.autoProfile ? props.recommendedId : props.profileId
  return props.profileList.find((p) => p.id === id)?.label ?? '均衡'
})

const tone = computed(() => {
  if (props.autoProfile) return 'tone-neutral'
  return TONES[props.profileId] ?? 'tone-neutral'
})

function toggle() {
  open.value = !open.value
  if (open.value) {
    setTimeout(() => document.addEventListener('mousedown', onOutside), 0)
  }
}

function close() {
  open.value = false
  document.removeEventListener('mousedown', onOutside)
}

function onOutside(e) {
  if (wrapper.value && !wrapper.value.contains(e.target)) close()
}

function setAuto() {
  emit('set-auto', true)
  close()
}
function set(id) {
  emit('set', id)
  close()
}

onBeforeUnmount(() => document.removeEventListener('mousedown', onOutside))
</script>

<template>
  <div ref="wrapper" :class="['profile-chip', tone]">
    <button type="button" class="pc-trigger" @click="toggle">
      <span class="pc-dot" />
      <span>{{ autoProfile ? `自动 · ${activeLabel}` : activeLabel }}</span>
      <span class="pc-arrow">▾</span>
    </button>
    <ul v-if="open" class="pc-menu">
      <li :class="{ active: autoProfile }" @click="setAuto">
        <span class="pc-dot tone-neutral" />
        自动跟档
      </li>
      <li
        v-for="p in profileList"
        :key="p.id"
        :class="[
          'pc-item',
          `tone-${p.id === 'conservative' ? 'blue' : p.id === 'balanced' ? 'green' : 'orange'}`,
          { active: !autoProfile && profileId === p.id },
        ]"
        @click="set(p.id)"
      >
        <span class="pc-dot" />
        {{ p.label }}
      </li>
    </ul>
  </div>
</template>

<style>
.profile-chip {
  position: relative;
}
.pc-trigger {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  min-height: 28px;
  padding: 3px 9px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--surface);
  color: var(--ink);
  font-size: 0.72rem;
  font-weight: 600;
}
.pc-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--muted);
  display: inline-block;
}
.tone-blue .pc-dot,
.pc-item.tone-blue .pc-dot {
  background: var(--blue);
}
.tone-green .pc-dot,
.pc-item.tone-green .pc-dot {
  background: var(--green);
}
.tone-orange .pc-dot,
.pc-item.tone-orange .pc-dot {
  background: var(--amber);
}
.pc-arrow {
  color: var(--muted);
  font-size: 0.62rem;
}
.pc-menu {
  position: absolute;
  top: calc(100% + 5px);
  right: 0;
  min-width: 148px;
  padding: 4px;
  margin: 0;
  list-style: none;
  background: var(--panel);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-pop);
  z-index: 35;
}
.pc-menu li {
  display: flex;
  gap: 7px;
  align-items: center;
  padding: 6px 9px;
  border-radius: var(--r-xs);
  cursor: pointer;
  font-size: 0.75rem;
}
.pc-menu li:hover {
  background: var(--surface-hover);
}
.pc-menu li.active {
  background: var(--surface-active);
  color: var(--green);
  font-weight: 600;
}
</style>
