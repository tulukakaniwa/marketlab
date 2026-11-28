<script setup>
defineProps({
  model: { type: Object, default: null },
  defaultOpen: { type: Boolean, default: false },
  compact: { type: Boolean, default: false },
})
</script>

<template>
  <details v-if="model" class="workbench-summary" :class="{ compact }" :open="defaultOpen">
    <summary>
      <span class="ws-data" :class="`state-${model.data.state}`">{{ model.data.label }}</span>
      <strong>{{ model.gate.marketState }}</strong>
      <span class="ws-candidate">{{ model.gate.candidateLabel }}</span>
      <span class="ws-gate">{{ model.gate.executionLabel }}</span>
      <span class="ws-reason">{{ model.reason }}</span>
      <span class="ws-more">诊断详情 ▾</span>
    </summary>
    <div class="ws-grid">
      <article>
        <span>样本状态</span>
        <strong>{{ model.data.label }}</strong>
        <small>{{ model.data.detail }} · {{ model.data.source }} · {{ model.data.modelLabel }}</small>
      </article>
      <article>
        <span>当前门禁</span>
        <strong>{{ model.gate.candidateLabel }} · 执行{{ model.gate.executionLabel }}</strong>
        <small>市场结构：{{ model.gate.marketState }}</small>
      </article>
      <article>
        <span>触发原因</span>
        <strong>{{ model.reason }}</strong>
      </article>
      <article>
        <span>{{ model.review?.label || '复核节点' }}</span>
        <strong>{{ model.review?.value || '下一交易会话复核结构' }}</strong>
      </article>
      <article>
        <span>下一步</span>
        <strong>{{ model.nextCheck }}</strong>
      </article>
    </div>
    <p class="ws-foot">
      {{ model.disclosure }} <b>{{ model.data.claimLabel || '口径待核验' }}</b>
    </p>
  </details>
</template>

<style scoped>
.workbench-summary {
  min-width: 0;
  container-type: inline-size;
  border-radius: var(--r-sm);
  background: var(--surface-alt);
  border: 1px solid var(--line);
}
.workbench-summary.compact {
  border: none;
  background: transparent;
}
.workbench-summary summary {
  min-height: 24px;
  display: inline-flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  padding: 2px 4px;
  cursor: pointer;
  list-style: none;
}
.workbench-summary:not(.compact) summary {
  display: flex;
  padding: 6px 8px;
}
.workbench-summary summary::-webkit-details-marker {
  display: none;
}
.ws-data,
.ws-candidate,
.ws-gate {
  border-radius: var(--r-xs);
  padding: 1px 6px;
  font-size: 0.66rem;
  font-weight: 600;
  white-space: nowrap;
}
.ws-data {
  color: var(--green);
  background: var(--green-dim);
}
.ws-data.state-stale,
.ws-data.state-invalid {
  color: var(--red);
  background: var(--red-dim);
}
.ws-gate {
  color: var(--blue);
  background: var(--blue-dim);
}
.ws-candidate {
  color: var(--ink-secondary);
  background: var(--surface-hover);
}
.workbench-summary summary > strong {
  font-size: 0.74rem;
  font-weight: 600;
}
.ws-reason {
  max-width: 300px;
  overflow: hidden;
  color: var(--muted);
  font-size: 0.7rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ws-more {
  color: var(--muted);
  font-size: 0.68rem;
  font-weight: 600;
  white-space: nowrap;
}
.ws-more:hover {
  color: var(--green);
}
.ws-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 1px;
  margin-top: 4px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  overflow: hidden;
  background: var(--line);
}
.ws-grid article {
  min-width: 0;
  display: grid;
  align-content: start;
  gap: 3px;
  padding: 8px 10px;
  background: var(--panel);
}
.ws-grid span {
  color: var(--muted);
  font-size: 0.64rem;
  font-weight: 600;
}
.ws-grid strong {
  font-size: 0.74rem;
  line-height: 1.38;
  overflow-wrap: anywhere;
}
.ws-grid small {
  color: var(--muted);
  font-size: 0.65rem;
  line-height: 1.35;
}
.ws-foot {
  margin: 0;
  padding: 5px 4px 2px;
  color: var(--muted);
  font-size: 0.66rem;
  line-height: 1.35;
}
.ws-foot b {
  margin-left: 4px;
  color: var(--blue);
  font-weight: 600;
}
@container (max-width: 820px) {
  .ws-grid {
    grid-template-columns: 1fr 1fr;
  }
  .ws-grid article:last-child {
    grid-column: 1 / -1;
  }
}
</style>
