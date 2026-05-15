<script setup>
defineProps({
  checklist: { type: Object, required: true },
})

const statusLabel = {
  ok: '可用',
  wait: '观察',
  missing: '缺输入',
  research: '研究层',
  off: '未启用',
}
</script>

<template>
  <section class="tc">
    <header>
      <span>交易员检查单</span>
      <strong>{{ statusLabel[checklist.status] ?? '观察' }}</strong>
    </header>

    <div v-for="group in checklist.groups" :key="group.id" class="tc-group">
      <h4>{{ group.label }}</h4>
      <article v-for="item in group.items" :key="`${group.id}-${item.label}`" class="tc-row" :class="`is-${item.status}`">
        <div>
          <span>{{ item.label }}</span>
          <strong>{{ item.title }}</strong>
        </div>
        <p>{{ item.detail }}</p>
      </article>
    </div>
  </section>
</template>

<style>
.tc { display: grid; gap: 9px; padding: 10px; border: 1px solid var(--line); border-radius: 7px; background: var(--surface-alt); min-width: 0; }
.tc header { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
.tc header span { color: var(--green); font-size: 0.62rem; font-weight: 900; letter-spacing: 0.06em; text-transform: uppercase; }
.tc header strong { color: var(--ink); font-size: 0.78rem; }
.tc-group { display: grid; gap: 5px; }
.tc-group h4 { margin: 0; color: var(--muted); font-size: 0.64rem; font-weight: 900; letter-spacing: 0.04em; text-transform: uppercase; }
.tc-row { display: grid; gap: 3px; padding: 7px 8px; border: 1px solid var(--line); border-left-width: 3px; border-radius: 5px; background: var(--bg); min-width: 0; }
.tc-row div { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
.tc-row span { color: var(--muted); font-size: 0.62rem; font-weight: 800; text-transform: uppercase; }
.tc-row strong { font-size: 0.76rem; text-align: right; }
.tc-row p { margin: 0; color: var(--muted); font-size: 0.66rem; line-height: 1.35; overflow-wrap: anywhere; }
.tc-row.is-ok { border-left-color: var(--green); }
.tc-row.is-wait { border-left-color: #b8860b; }
.tc-row.is-missing { border-left-color: var(--red); }
.tc-row.is-research { border-left-color: var(--blue); }
.tc-row.is-off { opacity: 0.72; }
</style>
