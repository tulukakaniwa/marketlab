import { computed } from 'vue'
import { buildCostPath, buildMarketStatePath } from '../domain/market/cost.js'
import { buildFormulaPath } from '../domain/market/formulaPath.js'

/**
 * 市场态计算层：滚动 VWAP 成本带、年化波动、ATR、动量、Δ 价格带等
 *
 * 二级缓存：rows → tdpy → marketStates
 *   - 同一 rows 不同 tdpy 互不污染
 *   - 全局唯一 marketStates 来源，回放层不再重复计算
 *
 * tdpy 由 effectiveInput 注入（store 层基于品种自动判断 + 用户覆盖），
 * 本层不直接读 input，避免 tdpy 字段散落到多个组件。
 *
 * @param {Ref<Array>} rows
 * @param {Ref<number>} cursor
 * @param {ComputedRef<object>} effectiveInput  必须含 tradingDaysPerYear（来自 labStore.effectiveInput）
 */
export function useMarketState(rows, cursor, effectiveInput) {
  // WeakMap<rows, Map<tdpy, states>>
  const marketStatePathCache = new WeakMap()

  function getMarketStatePath(r) {
    const tdpy = Number(effectiveInput.value.tradingDaysPerYear) || 365
    let bucket = marketStatePathCache.get(r)
    if (!bucket) {
      bucket = new Map()
      marketStatePathCache.set(r, bucket)
    }
    if (!bucket.has(tdpy)) bucket.set(tdpy, buildMarketStatePath(r, tdpy))
    return bucket.get(tdpy)
  }

  const activeRows = computed(() => rows.value.slice(0, cursor.value + 1))
  const marketStateFull = computed(() => rows.value.length ? getMarketStatePath(rows.value) : [])
  const market = computed(() => marketStateFull.value[cursor.value] ?? null)
  const costPath = computed(() => buildCostPath(rows.value))
  const formulaPath = computed(() => buildFormulaPath(rows.value, effectiveInput.value))

  return { activeRows, marketStateFull, market, costPath, formulaPath }
}
