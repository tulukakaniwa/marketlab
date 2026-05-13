<script setup>
defineProps({
  brief: { type: Object, required: true },
})

function money(value) {
  if (!Number.isFinite(value)) return '无'
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value)
}
</script>

<template>
  <section class="execution-panel">
    <div>
      <span>{{ brief.profileLabel }}</span>
      <strong>{{ brief.title }}</strong>
      <em>{{ brief.bias }}</em>
      <small>{{ brief.reason }}</small>
    </div>
    <article>
      <span>建议首笔</span>
      <strong>{{ money(brief.notional) }}</strong>
    </article>
    <article>
      <span>挂单价</span>
      <strong>{{ money(brief.price) }}</strong>
    </article>
    <article>
      <span>失效线</span>
      <strong>{{ money(brief.stop) }}</strong>
    </article>
    <article>
      <span>回归目标</span>
      <strong>{{ money(brief.target) }}</strong>
    </article>
  </section>
</template>
