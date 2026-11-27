<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { Moon, Sun, Menu, List, MoreHorizontal } from 'lucide-vue-next'
import { summarizeRegime } from '../domain/decision/narrative.js'
import { deriveWindows } from '../domain/market-data/cost.js'
import { useBreakpoint } from '../composables/useBreakpoint.js'
import ProfileChip from './ProfileChip.vue'

const { isCompact } = useBreakpoint()

const overflowOpen = ref(false)
function toggleOverflow() {
  overflowOpen.value = !overflowOpen.value
}
function closeOverflow() {
  overflowOpen.value = false
}

function onDocClick(e) {
  if (!overflowOpen.value) return
  if (e.target.closest('.tb-overflow-wrap')) return
  closeOverflow()
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))

const props = defineProps({
  source: { type: Object, default: null },
  researchOnly: { type: Boolean, default: false },
  market: { type: Object, default: null },
  rows: { type: Array, default: () => [] },
  decision: { type: Object, default: null },
  extremeness: { type: Number, default: 0 },
  profileId: { type: String, required: true },
  autoProfile: { type: Boolean, required: true },
  profileList: { type: Array, required: true },
  recommendedId: { type: String, default: 'balanced' },
  theme: { type: String, default: 'light' },
})

const emit = defineEmits([
  'set-profile',
  'set-auto-profile',
  'toggle-theme',
  'reset',
  'mobile-open-left',
  'mobile-open-right',
  'open-market-impact',
  'open-eth-replay',
])

function openImpactResearch() {
  emit('open-market-impact')
  closeOverflow()
}

function openEthReplay() {
  emit('open-eth-replay')
  closeOverflow()
}

function toggleThemeFromOverflow() {
  emit('toggle-theme')
  closeOverflow()
}

function resetFromOverflow() {
  emit('reset')
  closeOverflow()
}

function setProfileFromOverflow(profileId) {
  emit('set-profile', profileId)
  closeOverflow()
}

function toggleAutoProfileFromOverflow() {
  emit('set-auto-profile', !props.autoProfile)
  closeOverflow()
}

const dailyChange = computed(() => {
  const r = props.rows
  if (r.length < 2) return null
  const last = r.at(-1).close
  const prev = r.at(-2).close
  if (!Number.isFinite(last) || !Number.isFinite(prev) || prev <= 0) return null
  return (last - prev) / prev
})

const narrativeText = computed(() => {
  const m = props.market
  if (!m) return '载入 K 线后判断'
  const window = props.rows.length ? deriveWindows(props.rows.length).cost : null
  return summarizeRegime({
    markPrice: m.markPrice,
    costAnchor: m.costAnchor,
    costDistance: m.costDistance,
    costWindow: window,
  })
})

const recommendation = computed(() => props.decision?.state || null)

function money(v) {
  return Number.isFinite(v) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(v) : '—'
}
function pctSign(v) {
  if (!Number.isFinite(v)) return '—'
  const sign = v >= 0 ? '+' : ''
  return `${sign}${(v * 100).toFixed(2)}%`
}
</script>

<template>
  <header class="topbar">
    <button
      v-if="isCompact"
      class="tb-mobile-btn tb-mobile-left"
      type="button"
      aria-label="打开菜单"
      @click="$emit('mobile-open-left')"
    >
      <Menu :size="20" />
    </button>
    <div class="tb-brand">
      <span
        >Market Lab <em v-if="source">{{ source.symbol }} · {{ source.interval }}</em></span
      >
      <h1>{{ source?.label ?? '行情研究台' }}</h1>
    </div>

    <div v-if="market" class="tb-summary">
      <div class="tb-segment tb-price">
        <strong>{{ money(market.markPrice) }}</strong>
        <em :class="{ up: (dailyChange ?? 0) >= 0, down: (dailyChange ?? 0) < 0 }">{{ pctSign(dailyChange) }}</em>
      </div>
      <div v-if="!researchOnly" class="tb-segment tb-narrative" :title="narrativeText">{{ narrativeText }}</div>
      <div v-if="recommendation" class="tb-segment tb-action">
        <span>结构</span>
        <strong>{{ recommendation }}</strong>
        <em title="正态参考下的偏离极端度，不是胜率">偏离 {{ Math.round(extremeness * 100) }}%</em>
      </div>
    </div>

    <div class="tb-actions tb-desktop-only">
      <nav class="tb-nav-pills" aria-label="专项研究入口">
        <button class="tb-nav-pill" type="button" @click="openImpactResearch">冲击研究</button>
        <a class="tb-nav-pill" href="?view=eth-replay" @click.prevent="openEthReplay">ETH 决策回放</a>
      </nav>
      <ProfileChip
        v-if="!researchOnly"
        :profile-id="profileId"
        :auto-profile="autoProfile"
        :profile-list="profileList"
        :recommended-id="recommendedId"
        @set="(id) => emit('set-profile', id)"
        @set-auto="(v) => emit('set-auto-profile', v)"
      />
      <button class="tb-theme" type="button" title="切换主题" @click="$emit('toggle-theme')">
        <Moon v-if="theme === 'light'" :size="14" />
        <Sun v-else :size="14" />
      </button>
      <button class="tb-reset" type="button" title="清空持久化参数" @click="$emit('reset')">重置</button>
    </div>

    <div v-if="isCompact" class="tb-overflow-wrap">
      <button
        class="tb-mobile-btn tb-overflow-btn"
        type="button"
        aria-label="更多"
        aria-haspopup="menu"
        :aria-expanded="overflowOpen ? 'true' : 'false'"
        @click="toggleOverflow"
      >
        <MoreHorizontal :size="20" />
      </button>
      <div v-if="overflowOpen" class="tb-overflow-menu" @click.stop>
        <div class="tb-overflow-section">研究表面</div>
        <button class="tb-overflow-item" type="button" @click="openImpactResearch">ETH 市场冲击研究</button>
        <a class="tb-overflow-item" href="?view=eth-replay" @click.prevent="openEthReplay">ETH 分钟决策回放</a>
        <div class="tb-overflow-section">全局控制</div>
        <button class="tb-overflow-item" type="button" @click="toggleThemeFromOverflow">
          切换主题（当前 {{ theme === 'dark' ? '深色' : '浅色' }}）
        </button>
        <button class="tb-overflow-item" type="button" @click="resetFromOverflow">重置工作台</button>
        <template v-if="!researchOnly">
          <div class="tb-overflow-section">策略档位</div>
          <button
            v-for="p in profileList"
            :key="p.id"
            type="button"
            class="tb-overflow-item"
            :class="{ 'is-active': p.id === profileId && !autoProfile }"
            @click="setProfileFromOverflow(p.id)"
          >
            {{ p.label || p.id }}
            <span v-if="p.id === recommendedId" class="tb-recommended">推荐</span>
          </button>
          <button
            type="button"
            class="tb-overflow-item"
            :class="{ 'is-active': autoProfile }"
            @click="toggleAutoProfileFromOverflow"
          >
            自动跟随回放：{{ autoProfile ? '开' : '关' }}
          </button>
        </template>
      </div>
    </div>

    <button
      v-if="isCompact"
      class="tb-mobile-btn tb-mobile-right"
      type="button"
      aria-label="打开标的列表"
      @click="$emit('mobile-open-right')"
    >
      <List :size="20" />
    </button>
  </header>
</template>

<style src="../styles/topbar.css"></style>
