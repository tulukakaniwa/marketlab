import { describe, expect, it } from 'vitest'
import { buildFormulaPath } from '../market-data/formulaPath.js'

function makeRows(count, start = 0) {
  return Array.from({ length: count }, (_, offset) => {
    const index = start + offset
    const close = 100 + 20 * 0.86 ** index + Math.sin(index / 3) * 0.1
    return {
      date: `session-${String(index).padStart(4, '0')}`,
      timestamp: index,
      open: close + 0.05,
      high: close + 0.8,
      low: close - 0.8,
      close,
      volume: 1000 + index,
    }
  })
}

describe('buildFormulaPath causal horizon contract', () => {
  it('追加未来极端数据不会改写历史公式路径', () => {
    const prefix = makeRows(80)
    const future = makeRows(20, 80).map((row, offset) => ({
      ...row,
      open: 1000 + offset,
      high: 2000 + offset,
      low: 1,
      close: 1500 + offset,
      volume: 999999,
    }))
    const input = { deltaSlope: 0.3, tradingDaysPerYear: 242 }

    expect(buildFormulaPath([...prefix, ...future], input).slice(0, prefix.length)).toEqual(
      buildFormulaPath(prefix, input),
    )
  })

  it('普通 holdingDays 不再成为隐藏周期；只有显式情景模式才消费它', () => {
    const rows = makeRows(20)
    const ordinary = buildFormulaPath(rows, { holdingDays: 7, deltaSlope: 0.3, tradingDaysPerYear: 242 })
    const scenario = buildFormulaPath(rows, {
      holdingDays: 7,
      deltaSlope: 0.3,
      tradingDaysPerYear: 242,
      pathUsesScenarioInputs: true,
    })

    expect(ordinary[2].formulaHorizonSessions).toBeNull()
    expect(scenario[2].formulaHorizonSessions).toBe(7)
    expect(scenario[2].fieldStates.formulaHorizonSessions.context.executionAuthority).toBe('none')
    expect(scenario[2].fieldStates.formulaHorizonSessions.context.resultClaimClass).toBe('scenario-proxy')
    expect(scenario[2].fieldStates.formulaHorizonDays.context.legacyAliasOf).toBe('formulaHorizonSessions')
    expect(scenario[2].fieldStates.formulaHorizonDays.context.deprecated).toBe(true)
  })

  it('v2 全区间与 v3 指定区间 IL 分字段输出，旧名只指向 v2', () => {
    const row = buildFormulaPath(makeRows(20), {
      startPrice: 110,
      rangeWidth: 0.2,
      liquidity: 10,
      pathUsesScenarioInputs: true,
      formulaHorizonSessions: 8,
      tradingDaysPerYear: 242,
    }).at(-1)

    expect(row.fullRangeV2IlProxy).toBeTypeOf('number')
    expect(row.rangeV3Il).toBeTypeOf('number')
    expect(row.impermanentLoss).toBe(row.fullRangeV2IlProxy)
    expect(row.fieldStates.impermanentLoss.status).toBe('deprecated')
    expect(row.fieldStates.impermanentLoss.context.legacyAliasOf).toBe('fullRangeV2IlProxy')
    expect(row.fieldStates.impermanentLoss.context.deprecated).toBe(true)
  })

  it('期权路径使用明确 Greek 字段，旧 Theta/日名称仅保留为 deprecated alias', () => {
    const row = buildFormulaPath(makeRows(40), {
      pathUsesScenarioInputs: true,
      formulaHorizonSessions: 8,
      optionTenorSessions: 20,
      strikePrice: 100,
      deltaSlope: 0.3,
      tradingDaysPerYear: 242,
    }).at(-1)

    expect(row.optionDelta).toBeTypeOf('number')
    expect(row.optionGamma).toBeTypeOf('number')
    expect(row.optionThetaPerSession).toBeTypeOf('number')
    expect(row.optionThetaDaily).toBe(row.optionThetaPerSession)
    expect(row.fieldStates.optionThetaPerSession.status).toBe('research-only')
    expect(row.fieldStates.optionThetaDaily.status).toBe('deprecated')
    expect(row.fieldStates.optionThetaDaily.context.legacyAliasOf).toBe('optionThetaPerSession')
    expect(row.fieldStates.optionThetaDaily.context.deprecated).toBe(true)
  })

  it('缺少 tradingDaysPerYear 时保留路径但阻断年化波动、GetDelta 与期权', () => {
    const row = buildFormulaPath(makeRows(40), {
      pathUsesScenarioInputs: true,
      formulaHorizonSessions: 8,
      optionTenorSessions: 20,
      strikePrice: 100,
      iv: 0.3,
      deltaSlope: 0.3,
    }).at(-1)

    expect(row.iv).toBe(0.3)
    expect(row.deltaUpper).toBeNull()
    expect(row.optionDelta).toBeNull()
    expect(row.fieldStates.deltaUpper.missingInputs).toContain('trading-days-per-year')
    expect(row.fieldStates.optionDelta.missingInputs).toContain('trading-days-per-year')
  })

  it('显式 carry 情景也必须提供方向、终点、来源、可知时点、共同名义和日历映射', () => {
    const rows = makeRows(20)
    const base = {
      pathUsesScenarioInputs: true,
      formulaHorizonSessions: 3,
      formulaHorizonSide: 'long',
      horizonTargetPrice: 150,
      horizonTargetSource: 'test-explicit-target',
      horizonAvailableAt: 'session-0019:close',
      perpTwap: 101,
      spotTwap: 100,
      fundingPositionSide: 'short',
      fundingSessionDurationHours: 24,
      fundingSessionCalendarId: 'CRYPTO-UTC-24H',
      recoveryNotionalBasis: 'cycle-start-quote-notional',
      fundingNotionalBasis: 'cycle-start-quote-notional',
      tradingDaysPerYear: 242,
    }
    const row = buildFormulaPath(rows, base).at(-1)
    const missingKnownAt = buildFormulaPath(rows, { ...base, horizonAvailableAt: null }).at(-1)

    expect(row.cumulativeFundingProxy).toBeTypeOf('number')
    expect(row.netCarry).toBeTypeOf('number')
    expect(row.fieldStates.netCarry.context.availableAt).toBe('session-0019:close')
    expect(missingKnownAt.netCarry).toBeNull()
    expect(missingKnownAt.fieldStates.netCarry.status).toBe('missing-input')
  })
})
