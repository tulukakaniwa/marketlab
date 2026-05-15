<script setup>
/**
 * 问题驱动导航：把四个市场问题作为入口，每个问题关联一组公式。
 *
 * 取代了过去"先选公式再看值"的反向流程：用户先回答自己关心什么问题，
 * 公式只是支撑回答的依据。
 *
 * 详细设计见 docs/formula-understanding-audit.md
 */
defineProps({
  activeFormulaId: { type: String, required: true },
  source: { type: Object, default: null },
  input: { type: Object, required: true },
})

const emit = defineEmits(['select-formula', 'focus-search', 'open-drawer'])

// 四个核心问题 → 公式组映射
const questions = [
  {
    id: 'q-symbol',
    title: '1 · 看什么品种与周期？',
    hint: '右侧市场列表选择数据集',
    formulas: ['path', 'cost'],
    action: 'focus-search',
  },
  {
    id: 'q-entry',
    title: '2 · 入场价与持仓窗口？',
    hint: '调右栏 entryPrice / holdingDays / IV / targetReturn',
    formulas: ['delta-band'],
    primary: 'delta-band',
  },
  {
    id: 'q-edge',
    title: '3 · 盈利来源是哪一类？',
    hint: '四选一：成本回归 · 手续费 · 波动率 · 资金费率',
    options: [
      { id: 'edge-cost', label: '成本回归', formula: 'deviation-score' },
      { id: 'edge-fees', label: '手续费收益', formula: 'net-lp-efficiency' },
      { id: 'edge-vol',  label: '波动率错配', formula: 'risk-surface' },
      { id: 'edge-fund', label: '资金费率', formula: 'net-carry' },
    ],
  },
  {
    id: 'q-invalid',
    title: '4 · 这条路径上哪里失效？',
    hint: '查看失效线、目标价、持仓窗口',
    formulas: ['order-plan'],
    primary: 'order-plan',
  },
]

function selectQuestion(q) {
  if (q.action === 'focus-search') emit('focus-search')
  else if (q.primary) emit('select-formula', q.primary)
}

function selectEdgeOption(opt) {
  emit('select-formula', opt.formula)
}

function openWhy(formulaId, e) {
  e.stopPropagation()
  emit('open-drawer', formulaId)
}
</script>

<template>
  <nav class="qn-nav">
    <div v-for="q in questions" :key="q.id" class="qn-block">
      <button
        type="button"
        class="qn-head"
        :class="{ active: q.formulas?.includes(activeFormulaId) }"
        @click="selectQuestion(q)"
      >
        <strong>{{ q.title }}</strong>
        <small>{{ q.hint }}</small>
        <span
          v-if="q.primary"
          class="qn-why"
          role="button"
          tabindex="0"
          @click="openWhy(q.primary, $event)"
          @keydown.enter.stop="openWhy(q.primary, $event)"
        >为什么</span>
      </button>
      <div v-if="q.options" class="qn-opts">
        <button
          v-for="opt in q.options"
          :key="opt.id"
          type="button"
          class="qn-opt"
          :class="{ active: opt.formula === activeFormulaId }"
          @click="selectEdgeOption(opt)"
        >
          {{ opt.label }}
        </button>
      </div>
    </div>
    <p class="qn-hint">公式只在点"为什么"时出现，不再左栏堆公式名。</p>
  </nav>
</template>

<style>
.qn-nav { display: flex; flex-direction: column; gap: 8px; }
.qn-block { display: grid; gap: 4px; }
.qn-head { display: grid; gap: 2px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 7px; background: var(--bg); color: var(--ink); cursor: pointer; text-align: left; position: relative; }
.qn-why { position: absolute; top: 6px; right: 6px; padding: 2px 7px; border: 1px solid var(--line); border-radius: 999px; color: var(--muted); font-size: 0.6rem; font-weight: 800; letter-spacing: 0.04em; cursor: pointer; }
.qn-why:hover { border-color: var(--blue); color: var(--blue); }
.qn-head:hover { border-color: var(--green); }
.qn-head.active { border-color: var(--green); background: var(--surface-active); }
.qn-head strong { font-size: 0.84rem; font-weight: 800; line-height: 1.25; }
.qn-head small { color: var(--muted); font-size: 0.66rem; line-height: 1.35; }
.qn-opts { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 0 4px; }
.qn-opt { min-height: 28px; border: 1px solid var(--line); border-radius: 5px; background: transparent; color: var(--ink); font-size: 0.7rem; font-weight: 700; cursor: pointer; }
.qn-opt:hover { border-color: var(--green); }
.qn-opt.active { border-color: var(--green); background: var(--surface-active); }
.qn-hint { margin: 6px 0 0; padding: 6px 8px; color: var(--muted); font-size: 0.62rem; line-height: 1.4; border-top: 1px dashed var(--line); }
</style>
