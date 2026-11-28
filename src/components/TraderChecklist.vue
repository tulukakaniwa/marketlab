<script setup>
defineProps({
  checklist: { type: Object, required: true },
  showHeader: { type: Boolean, default: true },
  openGroups: { type: Array, default: () => ['entry'] },
})

const statusLabel = {
  ok: '就绪',
  wait: '观察',
  missing: '缺输入',
  research: '研究',
  off: '关闭',
}

function groupStatus(group) {
  const firstActive = group.items.find((item) => item.status !== 'off') ?? group.items[0]
  return firstActive ? (statusLabel[firstActive.status] ?? '观察') : '观察'
}
</script>

<template>
  <section class="tc">
    <header v-if="showHeader">
      <span>风控清单</span>
      <strong>{{ statusLabel[checklist.status] ?? '观察' }}</strong>
    </header>

    <details v-for="group in checklist.groups" :key="group.id" class="tc-group" :open="openGroups.includes(group.id)">
      <summary>
        <h4>{{ group.label }}</h4>
        <strong>{{ groupStatus(group) }}</strong>
      </summary>
      <article
        v-for="item in group.items"
        :key="`${group.id}-${item.label}`"
        class="tc-row"
        :class="`is-${item.status}`"
      >
        <div>
          <span>{{ item.label }}</span>
          <strong>{{ item.title }}</strong>
        </div>
        <p>{{ item.detail }}</p>
      </article>
    </details>
  </section>
</template>

<style>
.tc {
  display: grid;
  gap: 8px;
  min-width: 0;
}
.tc header {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: baseline;
}
.tc header span {
  color: var(--muted);
  font-size: 0.66rem;
  font-weight: 600;
}
.tc header strong {
  color: var(--ink);
  font-size: 0.75rem;
}
.tc-group {
  display: grid;
  gap: 5px;
}
.tc-group summary {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  align-items: center;
  min-height: 22px;
  list-style: none;
  cursor: pointer;
}
.tc-group summary::-webkit-details-marker {
  display: none;
}
.tc-group h4 {
  margin: 0;
  color: var(--muted);
  font-size: 0.66rem;
  font-weight: 600;
}
.tc-group summary strong {
  color: var(--muted);
  font-size: 0.64rem;
}
.tc-row {
  display: grid;
  gap: 2px;
  padding: 6px 8px;
  border-left: 2px solid var(--line-strong);
  border-radius: var(--r-xs);
  background: var(--surface-alt);
  min-width: 0;
}
.tc-row div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: baseline;
}
.tc-row span {
  color: var(--muted);
  font-size: 0.65rem;
  font-weight: 600;
}
.tc-row strong {
  font-size: 0.74rem;
  text-align: right;
}
.tc-row p {
  margin: 0;
  color: var(--muted);
  font-size: 0.66rem;
  line-height: 1.35;
  overflow-wrap: anywhere;
}
.tc-row.is-ok {
  border-left-color: var(--green);
}
.tc-row.is-wait {
  border-left-color: var(--amber);
}
.tc-row.is-missing {
  border-left-color: var(--red);
}
.tc-row.is-research {
  border-left-color: var(--blue);
}
.tc-row.is-off {
  opacity: 0.65;
}
</style>
