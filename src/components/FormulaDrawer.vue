<script setup>
import { computed } from 'vue'
import { X } from 'lucide-vue-next'
import { formulaStages } from '../domain/formulas/registry.js'

/**
 * 公式详情抽屉：解释当前公式如何参与决策
 *
 * 内容分四段：
 *   1. 角色与口径（role / inputs / outputs）
 *   2. 公式（LaTeX-like 字符串，原样展示）
 *   3. 当前值（从 graph / market 实时取）
 *   4. 决策落点（feeds → 它影响哪些下游公式 / 决策项）
 */
const props = defineProps({
  open: { type: Boolean, default: false },
  formulaId: { type: String, default: '' },
  graph: { type: Object, default: () => ({}) },
  market: { type: Object, default: null },
})

const emit = defineEmits(['close'])

const stage = computed(() => formulaStages.find(s => s.id === props.formulaId))

// 反向索引：哪个公式 feeds 到 formulaId
const feedsFromHere = computed(() => stage.value?.feeds ?? [])
const fedFromUpstream = computed(() => formulaStages.filter(s => s.feeds?.includes(props.formulaId)).map(s => s.id))

// 当前值：根据 formulaId 从 graph / market 取
const currentValues = computed(() => {
  const id = props.formulaId
  const g = props.graph
  const m = props.market
  if (!id) return []
  const v = []
  switch (id) {
    case 'path':
      v.push(['行数', m?.rows ?? '—'])
      v.push(['日期范围', m?.range ?? '—'])
      break
    case 'cost':
      v.push(['成本锚', fmt(m?.costAnchor)])
      v.push(['偏离', pct(m?.costDistance)])
      v.push(['上沿 / 下沿', `${fmt(m?.costHigh)} / ${fmt(m?.costLow)}`])
      v.push(['5日斜率', pct(m?.costSlope5)])
      break
    case 'volatility':
      v.push(['年化波动', pct(m?.annualVol)])
      v.push(['ATR%', pct(m?.atrPercent)])
      v.push(['5日动量', pct(m?.momentum5)])
      break
    case 'delta-band':
      v.push(['多头低', fmt(g.deltaBands?.long?.low)])
      v.push(['多头成本', fmt(g.deltaBands?.long?.cost)])
      v.push(['多头高', fmt(g.deltaBands?.long?.high)])
      v.push(['e_T', f4(g.deltaBands?.wave)])
      break
    case 'option-greeks':
      v.push(['价格', fmt(g.option?.price)])
      v.push(['Delta', f4(g.option?.delta)])
      v.push(['Gamma', f4(g.option?.gamma)])
      v.push(['Theta', f4(g.option?.theta)])
      v.push(['Vega', f4(g.option?.vega)])
      break
    case 'lp-inventory':
      v.push(['LP 价值', fmt(g.lpV3?.value)])
      v.push(['库存 Delta', f4(g.lpV3?.inventoryDelta)])
      v.push(['IL', pct(g.impermanentLoss?.impermanentLoss)])
      break
    case 'capital-efficiency':
      v.push(['效率倍数', `${(g.efficiency?.efficiency ?? 0).toFixed(2)}×`])
      v.push(['区间下沿', f4(g.efficiency?.lower)])
      v.push(['区间上沿', f4(g.efficiency?.upper)])
      break
    case 'funding':
      v.push(['资金费率', pct(g.funding?.ratio)])
      v.push(['累计资金成本', f4(g.funding?.funding)])
      break
    case 'portfolio':
      v.push(['组合价值', fmt(g.portfolio)])
      break
    case 'order-plan':
      v.push(['挂单档数', g.plan?.primaryOrders?.length ?? 0])
      v.push(['失效下沿', fmt(g.plan?.invalidation?.lower)])
      v.push(['失效上沿', fmt(g.plan?.invalidation?.upper)])
      v.push(['决策状态', g.decision?.state ?? '—'])
      break
    default:
      v.push(['详见公式图', '点击中央公式面板查看可视化'])
  }
  return v
})

// 决策落点描述
const decisionImpact = computed(() => {
  const id = props.formulaId
  const map = {
    path: '所有下游计算的输入口径',
    cost: '决定挂单的成本锚、上下沿、回归目标',
    volatility: '决定挂单间距与失效阈值',
    'delta-band': '直接生成挂单价格梯队（试仓/加仓/极值）',
    'option-greeks': '提供方向风险（Delta）与曲率（Gamma）参考',
    'asian-option': '研究层：Asian/Bachelier 与 LP payoff 的贴合关系未完成',
    'lp-inventory': '展示 LP 库存暴露；不进入默认挂单',
    'liquidity-fingerprint': '研究层：连续分布到真实 LP 区间权重的积分和离散化规则未完成',
    'amm-geometry': '研究层：Lambert W / Numoen / AMM 关系待按原图和协议逐式重读',
    'capital-efficiency': '展示区间效率估计；不进入默认挂单',
    funding: '研究层：仅 TWAP 估计，未接真实永续资金费率和结算制度',
    portfolio: '研究层：组合视图不参与默认挂单',
    'order-plan': '最终输出：挂买/挂卖/失效线/目标价',
    'deviation-score': '判断当前偏离是否够强，是否触发交易',
    'risk-surface': '展示不同价格上的 Greeks 曲线，挂单前看曲率',
    'net-lp-efficiency': '研究层：IL × CE 估计不能当作 LP 可行结论',
    'net-carry': '研究层：Funding × Cost 估计不能当作持仓结论',
    'mean-reversion': '估计回归速度，决定持仓时长',
    'gamma-pnl': '凸性头寸的实际波动收益估计',
    'vol-confidence': '当前 IV 估计的置信区间',
  }
  return map[id] ?? '该公式参与研究层，不直接进入挂单结论'
})

function fmt(v) { return Number.isFinite(v) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(v) : '—' }
function f4(v) { return Number.isFinite(v) ? v.toFixed(4) : '—' }
function pct(v) { return Number.isFinite(v) ? `${(v * 100).toFixed(2)}%` : '—' }

function close() { emit('close') }

function onKeydown(e) {
  if (e.key === 'Escape') close()
}
</script>

<template>
  <Transition name="drawer">
    <div v-if="open && stage" class="fd-overlay" @click.self="close" @keydown="onKeydown" tabindex="-1">
      <aside class="fd-drawer">
        <header class="fd-head">
          <div>
            <span>{{ stage.layer }} · {{ stage.label }}</span>
            <strong>{{ stage.role }}</strong>
          </div>
          <button class="fd-close" @click="close" aria-label="关闭">
            <X :size="18" />
          </button>
        </header>

        <section class="fd-block">
          <h4>当前值</h4>
          <dl>
            <template v-for="[k, v] in currentValues" :key="k">
              <dt>{{ k }}</dt>
              <dd>{{ v }}</dd>
            </template>
          </dl>
        </section>

        <section class="fd-block">
          <h4>决策落点</h4>
          <p>{{ decisionImpact }}</p>
        </section>

        <section class="fd-block">
          <h4>输入 / 输出</h4>
          <dl>
            <dt>输入</dt>
            <dd>{{ stage.inputs.join(' · ') }}</dd>
            <dt>输出</dt>
            <dd>{{ stage.outputs.join(' · ') }}</dd>
          </dl>
        </section>

        <section v-if="stage.formulas.length" class="fd-block">
          <h4>公式</h4>
          <pre v-for="f in stage.formulas" :key="f">{{ f }}</pre>
        </section>

        <section v-if="feedsFromHere.length || fedFromUpstream.length" class="fd-block">
          <h4>依赖关系</h4>
          <p v-if="fedFromUpstream.length"><b>上游</b>{{ fedFromUpstream.join(' / ') }}</p>
          <p v-if="feedsFromHere.length"><b>下游</b>{{ feedsFromHere.join(' / ') }}</p>
        </section>

        <section class="fd-block fd-status">
          <span :class="stage.status === 'implemented' ? 'live' : 'mapped'">
            {{ stage.status === 'implemented' ? '已计算' : '研究层（不参与默认挂单）' }}
          </span>
        </section>
      </aside>
    </div>
  </Transition>
</template>

<style>
.fd-overlay { position: fixed; inset: 0; z-index: 100; background: rgba(0,0,0,0.32); display: flex; justify-content: flex-end; }
.fd-drawer { width: min(420px, 92vw); height: 100%; overflow-y: auto; background: var(--panel); border-left: 1px solid var(--line); padding: 16px 18px; display: grid; gap: 16px; align-content: start; }
.fd-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--line); }
.fd-head span { display: block; color: var(--green); font-size: 0.62rem; font-weight: 900; letter-spacing: 0.07em; text-transform: uppercase; margin-bottom: 4px; }
.fd-head strong { font-size: 0.95rem; line-height: 1.35; color: var(--ink); }
.fd-close { width: 28px; height: 28px; display: grid; place-items: center; border: 1px solid var(--line); border-radius: 999px; background: var(--bg); color: var(--ink); cursor: pointer; }
.fd-close:hover { border-color: var(--green); color: var(--green); }
.fd-block { display: grid; gap: 6px; }
.fd-block h4 { margin: 0; color: var(--green); font-size: 0.66rem; font-weight: 900; letter-spacing: 0.06em; text-transform: uppercase; }
.fd-block p { margin: 0; color: var(--ink); font-size: 0.82rem; line-height: 1.5; }
.fd-block p b { color: var(--muted); margin-right: 6px; font-size: 0.7rem; font-weight: 800; text-transform: uppercase; }
.fd-block dl { display: grid; grid-template-columns: 90px 1fr; gap: 4px 10px; margin: 0; }
.fd-block dt { color: var(--muted); font-size: 0.74rem; font-weight: 700; }
.fd-block dd { margin: 0; color: var(--ink); font-size: 0.82rem; font-variant-numeric: tabular-nums; }
.fd-block pre { margin: 0; padding: 6px 8px; background: var(--bg); border: 1px solid var(--line); border-radius: 5px; color: var(--blue); font-size: 0.72rem; overflow-x: auto; white-space: pre-wrap; word-break: break-word; }
.fd-status { padding-top: 10px; border-top: 1px solid var(--line); }
.fd-status span { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 0.7rem; font-weight: 800; }
.fd-status .live { background: var(--surface-active); color: var(--green); border: 1px solid var(--green); }
.fd-status .mapped { background: var(--surface-alt); color: var(--muted); border: 1px solid var(--line); }

.drawer-enter-active, .drawer-leave-active { transition: opacity 0.18s; }
.drawer-enter-active .fd-drawer, .drawer-leave-active .fd-drawer { transition: transform 0.22s ease; }
.drawer-enter-from, .drawer-leave-to { opacity: 0; }
.drawer-enter-from .fd-drawer, .drawer-leave-to .fd-drawer { transform: translateX(100%); }
</style>
