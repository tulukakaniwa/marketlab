<script setup>
import { onUnmounted, ref } from 'vue'
import '../../styles/eth-impact-research.css'
import { useEthImpactResearchStore } from '../../stores/ethImpactResearchStore.js'
import ResearchImport from './ResearchImport.vue'
import LpResearchPanel from './LpResearchPanel.vue'
import OptionsResearchPanel from './OptionsResearchPanel.vue'
const store = useEthImpactResearchStore()
const tab = ref('lp')
onUnmounted(() => store.cancelPending())
</script>

<template>
  <section class="impact-lab" aria-label="ETH 市场动作研究">
    <nav class="research-tabs" aria-label="研究市场">
      <button :aria-pressed="tab === 'lp'" :class="{ active: tab === 'lp' }" @click="tab = 'lp'">
        <span>01</span>LP 动作与承接深度
      </button>
      <button :aria-pressed="tab === 'options'" :class="{ active: tab === 'options' }" @click="tab = 'options'">
        <span>02</span>期权成交与对冲情景
      </button>
      <span class="tabs-note">观测与假设分别标记</span>
    </nav>
    <ResearchImport
      :kind="tab"
      :state="tab === 'lp' ? store.lp : store.options"
      @import="store.importFile"
      @clear="store.clear"
    />
    <LpResearchPanel
      v-if="tab === 'lp' && store.lp.phase === 'ready'"
      :report="store.lp.report"
      :selected="store.selectedAction"
      :action="store.activeAction"
      @select="store.selectAction"
    />
    <OptionsResearchPanel
      v-else-if="tab === 'options' && store.options.phase === 'ready'"
      :report="store.options.report"
      :scenario="store.optionScenario"
      @scenario="store.setOptionScenario"
    />
    <section
      v-else
      class="welcome-workspace"
      :aria-busy="['verifying', 'computing'].includes((tab === 'lp' ? store.lp : store.options).phase)"
    >
      <div class="welcome-copy">
        <span class="eyebrow">{{
          tab === 'lp' ? 'OBSERVED LIQUIDITY / CONDITIONAL IMPACT' : 'OBSERVED TRADES / EXPLICIT ASSUMPTION'
        }}</span>
        <h2>
          {{
            ['verifying', 'computing'].includes((tab === 'lp' ? store.lp : store.options).phase)
              ? '正在核验与计算…'
              : '从一份可核验的数据开始'
          }}
        </h2>
        <p>
          {{
            tab === 'lp'
              ? '选择已采集的 LP 研究包，比较每次 Mint / Burn 前后同一笔订单的成交结果。'
              : '选择期权研究包，查看成交、OI 与 IV。增量对冲情景需要手动开启。'
          }}
        </p>
        <div class="welcome-flow">
          <span>{{ tab === 'lp' ? 'Mint / Burn' : '真实成交' }}</span
          ><i>→</i><span>{{ tab === 'lp' ? '活跃 L' : '声明假设' }}</span
          ><i>→</i><span>条件冲击</span>
        </div>
      </div>
      <div class="empty-grid" aria-hidden="true">
        <div class="empty-grid-label">WAITING FOR VERIFIED INPUT</div>
        <span class="empty-axis">PRICE / DEPTH</span><span class="empty-cross">+</span>
      </div>
    </section>
    <div class="bottom-boundary">
      <span>本地文件 · 仅研究 · 无执行权限</span><span>不改写 GetDelta / OrderPlan</span>
    </div>
  </section>
</template>
