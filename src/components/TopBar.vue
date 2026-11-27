<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { Moon, Sun, Menu, List, MoreHorizontal, RotateCcw, ChevronDown } from 'lucide-vue-next'
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
  'toggle-right',
  'mobile-open-left',
  'mobile-open-right',
  'open-market-impact',
  'open-eth-replay',
  'open-recommended-pool',
])

function openImpactResearch() {
  emit('open-market-impact')
  closeOverflow()
}

function openEthReplay() {
  emit('open-eth-replay')
  closeOverflow()
}

function openRecommendedPool() {
  emit('open-recommended-pool')
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
      aria-label="打开左侧工具面板"
      @click="$emit('mobile-open-left')"
    >
      <Menu :size="18" />
    </button>

    <div class="tb-left">
      <div class="tb-logo" aria-hidden="true">
        <span class="tb-logo-dot" />
        <span class="tb-logo-text">ML</span>
      </div>

      <button
        type="button"
        class="tb-symbol-btn"
        title="切换市场标的"
        @click="isCompact ? $emit('mobile-open-right') : $emit('toggle-right')"
      >
        <code v-if="source?.symbol" class="tb-ticker">{{ source.symbol }}</code>
        <span class="tb-name">{{ source?.label ?? '选择标的' }}</span>
        <span v-if="source?.interval" class="tb-interval">{{ source.interval }}</span>
        <ChevronDown :size="13" class="tb-chevron" />
      </button>

      <div v-if="market" class="tb-telemetry">
        <div class="tb-price">
          <strong>{{ money(market.markPrice) }}</strong>
          <em v-if="dailyChange !== null" :class="{ up: dailyChange >= 0, down: dailyChange < 0 }">
            {{ pctSign(dailyChange) }}
          </em>
        </div>

        <div v-if="!researchOnly && Number.isFinite(market.costAnchor)" class="tb-anchor-stat">
          <span>成本锚</span>
          <strong>{{ money(market.costAnchor) }}</strong>
          <em :class="{ up: (market.costDistance ?? 0) >= 0, down: (market.costDistance ?? 0) < 0 }">
            {{ pctSign(market.costDistance) }}
          </em>
        </div>

        <div v-if="recommendation" class="tb-regime-badge">
          <span class="tb-regime-state">{{ recommendation }}</span>
          <em title="偏离度（非胜率）">偏离 {{ Math.round(extremeness * 100) }}%</em>
        </div>
      </div>
    </div>

    <div class="tb-actions tb-desktop-only">
      <nav class="tb-nav-pills" aria-label="研究视图切换">
        <button class="tb-nav-pill" type="button" @click="openImpactResearch">冲击研究</button>
        <a class="tb-nav-pill" href="?surface=eth-replay" @click.prevent="openEthReplay">ETH 回放</a>
        <a class="tb-nav-pill" href="?surface=recommended-pool" @click.prevent="openRecommendedPool">A股门禁</a>
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

      <button
        class="tb-icon-btn"
        type="button"
        :title="theme === 'dark' ? '切至亮色' : '切至暗色'"
        @click="$emit('toggle-theme')"
      >
        <Sun v-if="theme === 'dark'" :size="14" />
        <Moon v-else :size="14" />
      </button>
      <button class="tb-icon-btn" type="button" title="重置默认参数" @click="$emit('reset')">
        <RotateCcw :size="14" />
      </button>
    </div>

    <div v-if="isCompact" class="tb-mobile-actions">
      <div class="tb-overflow-wrap">
        <button
          class="tb-mobile-btn tb-overflow-btn"
          type="button"
          aria-label="更多"
          aria-haspopup="menu"
          :aria-expanded="overflowOpen ? 'true' : 'false'"
          @click="toggleOverflow"
        >
          <MoreHorizontal :size="18" />
        </button>
        <div v-if="overflowOpen" class="tb-overflow-menu" @click.stop>
          <div class="tb-overflow-section">专项视图</div>
          <button class="tb-overflow-item" type="button" @click="openImpactResearch">ETH 市场冲击研究</button>
          <a class="tb-overflow-item" href="?surface=eth-replay" @click.prevent="openEthReplay">ETH 分钟决策回放</a>
          <a class="tb-overflow-item" href="?surface=recommended-pool" @click.prevent="openRecommendedPool">
            A股研究门禁报告
          </a>
          <div class="tb-overflow-section">工作台</div>
          <button class="tb-overflow-item" type="button" @click="toggleThemeFromOverflow">
            切换主题（当前{{ theme === 'dark' ? '暗色' : '亮色' }}）
          </button>
          <button class="tb-overflow-item" type="button" @click="resetFromOverflow">重置默认参数</button>
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
              回放选档：{{ autoProfile ? '开' : '关' }}
            </button>
          </template>
        </div>
      </div>

      <button
        class="tb-mobile-btn tb-mobile-right"
        type="button"
        aria-label="打开标的列表"
        @click="$emit('mobile-open-right')"
      >
        <List :size="18" />
      </button>
    </div>
  </header>
</template>

<style src="../styles/topbar.css"></style>
