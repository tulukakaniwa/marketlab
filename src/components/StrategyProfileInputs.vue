<script setup>
defineProps({
  input: { type: Object, required: true },
  profileList: { type: Array, required: true },
})

const FIELDS = [
  { key: 'strategyEdgeSigma', label: '入场偏离σ', min: 0.1, max: 3, step: 0.05 },
  { key: 'strategyMomentumSigma', label: '动量阈值σ', min: -2, max: 2, step: 0.05 },
  { key: 'strategyCostSlopeSigma', label: '成本下行σ', min: 0, max: 3, step: 0.05 },
  { key: 'strategyRiskPct', label: '风险预算%', min: 0.1, max: 8, step: 0.1, pct: true },
  { key: 'strategyExposurePct', label: '仓位上限%', min: 1, max: 100, step: 1, pct: true },
  { key: 'strategyFirstWeight', label: '首笔比例%', min: 5, max: 100, step: 1, pct: true },
  { key: 'strategyCooldownFactor', label: '冷却系数', min: 0.25, max: 8, step: 0.25 },
  { key: 'strategyTakeProfitSigma', label: '止盈 ATR', min: 0.1, max: 5, step: 0.1 },
  { key: 'strategyCutLossSigma', label: '风控 ATR', min: 0.1, max: 5, step: 0.1 },
]

function valueOf(input, field) {
  const value = Number(input[field.key])
  if (!Number.isFinite(value)) return ''
  return field.pct ? Number((value * 100).toFixed(2)) : value
}

function setValue(input, field, raw) {
  const value = Number(raw)
  if (!Number.isFinite(value)) return
  const normalized = field.pct ? value / 100 : value
  input[field.key] = Math.min(field.max / (field.pct ? 100 : 1), Math.max(field.min / (field.pct ? 100 : 1), normalized))
}
</script>

<template>
  <section class="strategy-profile-inputs">
    <div class="spi-head">
      <strong>策略档位</strong>
      <select v-model="input.strategyProfile">
        <option v-for="profile in profileList" :key="profile.id" :value="profile.id">{{ profile.label }}</option>
      </select>
    </div>

    <div v-if="input.strategyProfile === 'custom'" class="spi-grid">
      <label v-for="field in FIELDS" :key="field.key">
        <span>{{ field.label }}</span>
        <input
          type="number"
          :min="field.min"
          :max="field.max"
          :step="field.step"
          :value="valueOf(input, field)"
          @input="setValue(input, field, $event.target.value)"
        />
      </label>
    </div>
    <p v-else>当前使用预设档位。选择“自定义”后，可调整入场、仓位、止盈、风控和冷却参数。</p>
  </section>
</template>

<style>
.strategy-profile-inputs { display: grid; gap: 8px; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface-alt); }
.spi-head { display: grid; grid-template-columns: 1fr minmax(100px, 0.7fr); gap: 8px; align-items: center; }
.spi-head strong { color: var(--green); font-size: 0.78rem; }
.spi-head select,
.spi-grid input { min-width: 0; min-height: 30px; border: 1px solid var(--line); border-radius: 5px; background: var(--bg); color: var(--ink); padding: 3px 7px; font-variant-numeric: tabular-nums; }
.spi-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
.spi-grid label { display: grid; gap: 3px; min-width: 0; }
.spi-grid span { color: var(--muted); font-size: 0.64rem; font-weight: 800; }
.strategy-profile-inputs p { margin: 0; color: var(--muted); font-size: 0.68rem; line-height: 1.45; }
</style>
