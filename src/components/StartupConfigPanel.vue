<script setup>
defineProps({
  input: { type: Object, required: true },
  featureFlags: { type: Object, required: true },
  overlays: { type: Object, required: true },
})
</script>

<template>
  <section class="startup-config">
    <header>
      <span>启动配置</span>
      <strong>数据运算链路</strong>
    </header>

    <div class="sc-chain">
      <span>MarketData</span>
      <b>→</b>
      <span>StrategyPlanning</span>
      <b>+</b>
      <span :class="{ off: !featureFlags.replayAccount }">ReplayAccount</span>
      <b>+</b>
      <span :class="{ off: !featureFlags.portfolioResearch }">FormulaResearch</span>
    </div>

    <div class="sc-grid">
      <label class="sc-toggle">
        <input v-model="featureFlags.replayAccount" type="checkbox" />
        <span>启用回放旁路</span>
      </label>
      <label class="sc-toggle">
        <input v-model="featureFlags.replayAutoProfile" type="checkbox" :disabled="!featureFlags.replayAccount" />
        <span>回放辅助选档</span>
      </label>
      <label class="sc-toggle">
        <input v-model="featureFlags.portfolioResearch" type="checkbox" />
        <span>显示组合研究</span>
      </label>
      <label class="sc-toggle">
        <input v-model="overlays.equityPane" type="checkbox" :disabled="!featureFlags.replayAccount" />
        <span>权益子图</span>
      </label>
    </div>

    <div class="sc-inputs">
      <label>
        <span>账户资金</span>
        <input v-model.number="input.capital" type="number" min="0" step="100" />
      </label>
      <label>
        <span>底仓名义</span>
        <input v-model.number="input.baseNotional" type="number" min="0" step="100" />
      </label>
    </div>

    <p>
      默认计划只消费 MarketData、GetDelta/成本带与显式账户输入。回放和组合研究是旁路功能，只有打开后才显示；回放辅助选档只改 profile，不改写公式链。
    </p>
  </section>
</template>

<style>
.startup-config { display: grid; gap: 9px; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface-alt); }
.startup-config header { display: grid; gap: 2px; }
.startup-config header span { color: var(--green); font-size: 0.62rem; font-weight: 900; letter-spacing: 0.06em; text-transform: uppercase; }
.startup-config header strong { font-size: 0.95rem; }
.sc-chain { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; font-size: 0.68rem; color: var(--muted); }
.sc-chain span { border: 1px solid var(--line); border-radius: 999px; padding: 2px 6px; background: var(--panel); color: var(--green); font-weight: 800; }
.sc-chain span.off { color: var(--muted); opacity: 0.65; }
.sc-chain b { font-weight: 800; color: var(--muted); }
.sc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.sc-toggle { display: flex; gap: 6px; align-items: center; min-width: 0; border: 1px solid var(--line); border-radius: 5px; padding: 5px 7px; background: var(--bg); cursor: pointer; }
.sc-toggle:has(input:checked) { border-color: var(--green); background: var(--surface-active); }
.sc-toggle input { margin: 0; }
.sc-toggle span { color: var(--ink); font-size: 0.72rem; font-weight: 700; overflow-wrap: anywhere; }
.sc-inputs { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
.sc-inputs label { display: grid; gap: 2px; min-width: 0; }
.sc-inputs span { color: var(--muted); font-size: 0.62rem; font-weight: 800; text-transform: uppercase; }
.sc-inputs input { min-width: 0; min-height: 28px; border: 1px solid var(--line); border-radius: 5px; padding: 3px 7px; background: var(--bg); color: var(--ink); font-variant-numeric: tabular-nums; }
.startup-config p { margin: 0; color: var(--muted); font-size: 0.66rem; line-height: 1.45; }
</style>
