<script setup>
import { computed, onMounted, ref } from 'vue'

const props = defineProps({
  field: { type: String, required: true },
  value: { type: Number, required: true },
})

const emit = defineEmits(['confirm', 'cancel'])

const META = {
  entryPrice: { label: '入场价 P', unit: '', step: 0.01, min: 0.01, max: 1e9, scale: 1 },
  iv: { label: '年化波动率 σ', unit: '%', step: 0.5, min: 1, max: 500, scale: 0.01 },
  deltaSlope: { label: '目标增量 d', unit: '%', step: 0.5, min: 1, max: 500, scale: 0.01 },
  exitTargetReturn: { label: '止盈目标', unit: '%', step: 0.5, min: 0, max: 500, scale: 0.01 },
}

const meta = computed(() => META[props.field] ?? META.entryPrice)

const inputValue = ref('')
const inputEl = ref(null)

onMounted(() => {
  inputValue.value = String(Number((props.value / meta.value.scale).toFixed(4)))
  inputEl.value?.focus()
  inputEl.value?.select()
})

const numericInput = computed(() => Number(inputValue.value))
const isValid = computed(() => {
  const n = numericInput.value
  if (!Number.isFinite(n)) return false
  if (n < meta.value.min || n > meta.value.max) return false
  if (meta.value.integer && !Number.isInteger(n)) return false
  return true
})

function confirm() {
  if (!isValid.value) return
  const final = numericInput.value * meta.value.scale
  emit('confirm', final)
}

function cancel() {
  emit('cancel')
}
</script>

<template>
  <div class="param-popover">
    <header>{{ meta.label }}</header>
    <label>
      <input
        ref="inputEl"
        v-model="inputValue"
        type="number"
        :min="meta.min"
        :max="meta.max"
        :step="meta.step"
        :class="{ invalid: !isValid }"
        @keydown.enter.prevent="confirm"
        @keydown.escape.prevent="cancel"
      />
      <span v-if="meta.unit">{{ meta.unit }}</span>
    </label>
    <div class="pp-actions">
      <button type="button" class="pp-cancel" @click="cancel">取消</button>
      <button type="button" class="pp-apply" :disabled="!isValid" @click="confirm">应用</button>
    </div>
  </div>
</template>

<style>
.param-popover {
  width: 210px;
  padding: 10px 12px;
  background: var(--panel);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-pop);
  display: grid;
  gap: 8px;
}
.param-popover header {
  color: var(--muted);
  font-size: 0.68rem;
  font-weight: 600;
}
.param-popover label {
  display: flex;
  gap: 5px;
  align-items: center;
}
.param-popover input {
  flex: 1;
  min-width: 0;
  min-height: 30px;
  font-size: 0.84rem;
}
.param-popover input.invalid {
  border-color: var(--amber);
}
.param-popover label span {
  color: var(--muted);
  font-family: var(--mono);
  font-size: 0.74rem;
}
.pp-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}
.pp-actions button {
  min-height: 26px;
  padding: 2px 10px;
  font-size: 0.72rem;
}
.pp-apply:not(:disabled) {
  background: var(--green);
  border-color: var(--green);
  color: #fff;
}
.pp-apply:not(:disabled):hover {
  filter: brightness(1.06);
}
.pp-cancel {
  background: transparent;
  color: var(--muted);
}
</style>
