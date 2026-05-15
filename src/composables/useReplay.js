import { computed } from 'vue'
import { buildDailyReplay } from '../domain/replay/dailyReplay.js'
import { strategyProfileList } from '../domain/planning/orderPlan.js'

/**
 * 回放层：跑当前 profile 的回放，再并行跑三档 profile 用于评分选档
 *
 * @param {Ref<Array>} rows
 * @param {object} input              reactive
 * @param {ComputedRef<object>} effectiveInput
 * @param {ComputedRef<Array>} marketStateFull  来自 useMarketState，避免重算
 */
export function useReplay(rows, input, effectiveInput, marketStateFull) {
  const profileReplays = computed(() => strategyProfileList.map((profile) => ({
    profile,
    replay: buildDailyReplay(rows.value, { ...input, strategyProfile: profile.id }, marketStateFull.value),
  })))

  const recommendedProfile = computed(() => chooseProfile(
    profileReplays.value,
    Number(input.capital) + Number(input.baseNotional || 0),
  ))

  const replay = computed(() => buildDailyReplay(rows.value, effectiveInput.value, marketStateFull.value))

  return { profileReplays, recommendedProfile, replay }
}

function chooseProfile(items, capital) {
  if (!items.length) return strategyProfileList[1]
  const accountSize = Math.max(capital || 0, 1)
  const scored = items.map((item) => {
    const replay = item.replay
    const drawdownPenalty = Math.abs(replay.maxDrawdown || 0) / accountSize
    const turnoverPenalty = Math.max(replay.tradeCount - 36, 0) * 0.0008
    const emptyPenalty = replay.tradeCount ? 0 : 0.01
    return {
      profile: item.profile,
      score: (replay.returnOnUsedNotional || 0) - drawdownPenalty * 0.85 - turnoverPenalty - emptyPenalty,
    }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored[0]?.profile ?? strategyProfileList[1]
}
