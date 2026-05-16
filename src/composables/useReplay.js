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
 * @param {object} featureFlags                 显式开关；默认不跑回放
 */
export function useReplay(rows, input, effectiveInput, marketStateFull, featureFlags = {}) {
  const profileReplays = computed(() => strategyProfileList.map((profile) => ({
    profile,
    replay: featureFlags.replayAccount
      ? buildDailyReplay(rows.value, { ...input, strategyProfile: profile.id }, marketStateFull.value)
      : emptyReplay(),
  })))

  const recommendedProfile = computed(() => chooseProfile(
    profileReplays.value,
    Number(input.capital) + Number(input.baseNotional || 0),
  ))

  const replay = computed(() => featureFlags.replayAccount
    ? buildDailyReplay(rows.value, effectiveInput.value, marketStateFull.value)
    : emptyReplay())

  return { profileReplays, recommendedProfile, replay }
}

function emptyReplay() {
  return {
    profileId: '',
    profileLabel: '',
    range: '',
    startDate: '',
    endDate: '',
    trades: [],
    equityCurve: [],
    tradeCount: 0,
    winRate: 0,
    totalPnl: 0,
    realizedPnl: 0,
    totalNotional: 0,
    returnOnUsedNotional: 0,
    maxDrawdown: 0,
    maxDrawdownPct: 0,
    maxDrawdownStart: null,
    maxDrawdownEnd: null,
    drawdownCurve: [],
    cash: 0,
    base: 0,
    openValue: 0,
    openCost: 0,
    status: 'disabled',
  }
}

function chooseProfile(items, capital) {
  if (!items.length) return strategyProfileList[1]
  if (items.every((item) => item.replay?.status)) return strategyProfileList[1]
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
