<script setup>
import SimulationInputs from './SimulationInputs.vue'
import OptionPortfolioInputs from './OptionPortfolioInputs.vue'
import ObservationDateControl from './ObservationDateControl.vue'
import AdvancedSettingsContent from './AdvancedSettingsContent.vue'
import ChartOverlayToggles from './ChartOverlayToggles.vue'
import StartupConfigPanel from './StartupConfigPanel.vue'
import StrategyProfileInputs from './StrategyProfileInputs.vue'

defineProps({
  input: { type: Object, required: true },
  rows: { type: Array, required: true },
  cursor: { type: Number, required: true },
  observationDate: { type: String, default: '' },
  featureFlags: { type: Object, required: true },
  profileList: { type: Array, required: true },
  graph: { type: Object, default: null },
  tdpyMeta: { type: Object, required: true },
  effectiveTdpy: { type: Number, default: null },
  symbol: { type: String, default: '' },
  overlays: { type: Object, required: true },
  theme: { type: String, default: 'dark' },
})

const emit = defineEmits([
  'override-tdpy',
  'reset-tdpy',
  'set-theme',
  'reset-all',
  'set-observation-date',
  'latest-observation',
  'set-overlay',
  'set-path-scenario',
  'set-lp-scenario-field',
  'patch-input',
  'set-feature-flag',
])
</script>

<template>
  <div class="sd-drawer">
    <section class="sd-section">
      <h3 class="sd-h">时间回拨</h3>
      <ObservationDateControl
        :rows="rows"
        :cursor="cursor"
        :observation-date="observationDate"
        @set-date="(date) => emit('set-observation-date', date)"
        @latest="emit('latest-observation')"
      />
    </section>

    <section class="sd-section">
      <h3 class="sd-h">价格带引擎</h3>
      <SimulationInputs :input="input" :graph="graph" @patch-input="(patch) => emit('patch-input', patch)" />
    </section>

    <section class="sd-section">
      <h3 class="sd-h">回放开关</h3>
      <StartupConfigPanel
        :input="input"
        :feature-flags="featureFlags"
        :overlays="overlays"
        :rows="rows"
        :cursor="cursor"
        @patch-input="(patch) => emit('patch-input', patch)"
        @set-feature-flag="(flag, value) => emit('set-feature-flag', flag, value)"
        @set-overlay="(key, value) => emit('set-overlay', key, value)"
      />
    </section>

    <section class="sd-section">
      <h3 class="sd-h">档位校准</h3>
      <StrategyProfileInputs
        :input="input"
        :profile-list="profileList"
        :graph="graph"
        @patch-input="(patch) => emit('patch-input', patch)"
      />
    </section>

    <section class="sd-section">
      <h3 class="sd-h">期权与 LP 情景</h3>
      <OptionPortfolioInputs
        :input="input"
        @patch-input="(patch) => emit('patch-input', patch)"
        @set-path-scenario="(value) => emit('set-path-scenario', value)"
        @set-lp-scenario-field="(field, value) => emit('set-lp-scenario-field', field, value)"
      />
    </section>

    <section class="sd-section">
      <h3 class="sd-h">年化交易日口径</h3>
      <AdvancedSettingsContent
        :tdpy-meta="tdpyMeta"
        :effective-tdpy="effectiveTdpy"
        :symbol="symbol"
        @override="(s, v) => emit('override-tdpy', s, v)"
        @reset="(s) => emit('reset-tdpy', s)"
      />
    </section>

    <section class="sd-section">
      <h3 class="sd-h">全部叠加图层</h3>
      <ChartOverlayToggles :overlays="overlays" @change="(key, value) => emit('set-overlay', key, value)" />
    </section>
  </div>
</template>

<style>
.sd-drawer {
  display: grid;
  gap: 12px;
  min-width: 0;
}
.sd-drawer > * {
  min-width: 0;
}
.sd-section {
  display: grid;
  gap: 6px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
  min-width: 0;
}
.sd-section:last-child {
  border-bottom: none;
}
.sd-h {
  margin: 0;
  color: var(--muted);
  font-size: 0.68rem;
  font-weight: 600;
}
</style>
