<script setup>
defineProps({ rows: { type: Array, required: true }, cursor: { type: Number, required: true } })
defineEmits(['cursor-change'])
const closeTime = (row) =>
  row
    ? new Date(row.completedAt ?? row.closeTime)
        .toISOString()
        .replace('T', ' ')
        .replace(/\.\d{3}Z$/, ' UTC')
    : '—'
</script>

<template>
  <div class="research-observation-control">
    <label for="research-observation">观察收盘</label>
    <input
      id="research-observation"
      type="range"
      :min="0"
      :max="Math.max(0, rows.length - 1)"
      :value="cursor"
      @input="$emit('cursor-change', Number($event.target.value))"
    />
    <time>{{ closeTime(rows[cursor]) }}</time>
    <button type="button" @click="$emit('cursor-change', rows.length - 1)">最新已收盘</button>
  </div>
</template>

<style scoped>
.research-observation-control {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 7px 10px;
  border-bottom: 1px solid var(--line);
  color: var(--muted);
  font-size: 11px;
}
.research-observation-control input {
  flex: 1;
  min-width: 120px;
  accent-color: var(--green);
}
.research-observation-control button {
  background: var(--panel);
  color: var(--ink);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 5px 8px;
  cursor: pointer;
}
</style>
