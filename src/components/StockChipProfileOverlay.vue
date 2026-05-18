<script setup>
import { computed } from 'vue'
import { buildVolumePriceProfile } from '../domain/research-visualization/volumePriceProfile.js'

const props = defineProps({
  rows: { type: Array, required: true },
})

const profile = computed(() => buildVolumePriceProfile({
  rows: props.rows,
  activeIndex: props.rows.length - 1,
  visibleWindow: 180,
  binCount: 36,
}))
const visibleBins = computed(() => [...profile.value.bins].reverse())

function money(value) {
  return Number.isFinite(value)
    ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value)
    : '—'
}

function volume(value) {
  if (!Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  if (abs >= 1e8) return `${(value / 1e8).toFixed(2)}亿`
  if (abs >= 1e4) return `${(value / 1e4).toFixed(1)}万`
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(value)
}
</script>

<template>
  <aside v-if="profile.bins.length" class="scp" aria-label="个股筹码图">
    <header class="scp-head">
      <span>筹码</span>
      <strong>成交量代理</strong>
    </header>
    <div class="scp-meta">
      <span>POC {{ money(profile.poc?.mid) }}</span>
      <span>{{ profile.rows }}K</span>
    </div>
    <div class="scp-bars">
      <div
        v-for="bin in visibleBins"
        :key="bin.index"
        class="scp-row"
        :class="{ poc: bin.isPoc, current: bin.isCurrent, value: bin.inValueArea }"
        :title="`${money(bin.lower)} - ${money(bin.upper)} · ${volume(bin.volume)}`"
      >
        <span class="scp-price">{{ money(bin.mid) }}</span>
        <div class="scp-track">
          <i class="scp-down" :style="{ width: `${bin.intensity * bin.downShare * 100}%` }" />
          <i class="scp-up" :style="{ width: `${bin.intensity * bin.upShare * 100}%` }" />
        </div>
      </div>
    </div>
    <footer class="scp-foot">
      <span>VA {{ money(profile.valueArea?.lower) }}-{{ money(profile.valueArea?.upper) }}</span>
      <span>量 {{ volume(profile.totalVolume) }}</span>
    </footer>
  </aside>
</template>

<style>
.scp {
  position: absolute; top: 64px; right: 58px; z-index: 18;
  width: min(210px, calc(100% - 96px)); max-height: calc(100% - 132px);
  display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto;
  padding: 8px; border: 1px solid var(--line); border-radius: 6px;
  background: rgba(251,250,244,0.9); backdrop-filter: blur(4px);
  box-shadow: 0 1px 3px rgba(0,0,0,0.06); pointer-events: none;
}
.dark .scp { background: rgba(34,36,31,0.9); }
.scp-head, .scp-meta, .scp-foot { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; min-width: 0; }
.scp-head span { color: var(--green); font-size: 0.68rem; font-weight: 900; letter-spacing: 0.06em; }
.scp-head strong { color: var(--muted); font-size: 0.62rem; font-weight: 800; }
.scp-meta, .scp-foot { color: var(--muted); font-size: 0.62rem; font-weight: 700; font-variant-numeric: tabular-nums; }
.scp-bars { display: grid; gap: 1px; min-height: 0; overflow: hidden; padding: 5px 0; }
.scp-row { display: grid; grid-template-columns: 50px minmax(0, 1fr); align-items: center; gap: 5px; min-height: 6px; opacity: 0.74; }
.scp-row.value { opacity: 0.92; }
.scp-row.poc, .scp-row.current { opacity: 1; }
.scp-price { color: var(--muted); font-size: 0.56rem; text-align: right; font-variant-numeric: tabular-nums; }
.scp-track { display: flex; justify-content: flex-end; height: 5px; border-radius: 2px; background: rgba(120,120,120,0.08); overflow: hidden; }
.scp-up { height: 100%; background: rgba(14,117,88,0.58); }
.scp-down { height: 100%; background: rgba(169,50,38,0.48); }
.scp-row.poc .scp-track { outline: 1px solid rgba(139,90,22,0.82); }
.scp-row.current .scp-price { color: var(--ink); font-weight: 900; }
.scp-row.current .scp-track { box-shadow: inset 0 0 0 1px rgba(39,79,159,0.75); }
@media (max-width: 760px) {
  .scp { display: none; }
}
</style>
