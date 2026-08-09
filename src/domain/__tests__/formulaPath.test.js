import { describe, expect, it } from 'vitest'
import { FORMULA_PATH_FIELDS, buildFormulaPath } from '../market-data/formulaPath.js'
import { resolveExplicitScenarioHorizonSessions } from '../market-data/formulaPathScenarioInput.js'

const DEPRECATED_CANONICAL_PATH_ALIASES = [
  'formulaHorizonDays',
  'optionThetaDaily',
  'lpInventoryDelta',
  'impermanentLoss',
  'fundingProxy',
]

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
  it('显式 scenario adapter 在关闭时不消费旧周期字段', () => {
    expect(resolveExplicitScenarioHorizonSessions({ formulaHorizonDays: 9, holdingDays: 7 })).toBeNull()
    expect(
      resolveExplicitScenarioHorizonSessions({
        formulaHorizonDays: 9,
        holdingDays: 7,
        pathUsesScenarioInputs: false,
      }),
    ).toBeNull()
    expect(
      resolveExplicitScenarioHorizonSessions({
        formulaHorizonDays: 9,
        holdingDays: 7,
        pathUsesScenarioInputs: true,
      }),
    ).toBe(9)
  })

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
    const ignoredLegacyInput = buildFormulaPath(rows, {
      formulaHorizonDays: 9,
      deltaSlope: 0.3,
      tradingDaysPerYear: 242,
    })
    const explicitLegacyAdapter = buildFormulaPath(rows, {
      formulaHorizonDays: 9,
      deltaSlope: 0.3,
      tradingDaysPerYear: 242,
      pathUsesScenarioInputs: true,
    })

    expect(ordinary[2].formulaHorizonSessions).toBeNull()
    expect(scenario[2].formulaHorizonSessions).toBe(7)
    expect(ignoredLegacyInput[2].formulaHorizonSessions).toBeNull()
    expect(explicitLegacyAdapter[2].formulaHorizonSessions).toBe(9)
    expect(scenario[2].fieldStates.formulaHorizonSessions.context.executionAuthority).toBe('none')
    expect(scenario[2].fieldStates.formulaHorizonSessions.context.status).toBe('eligible')
    expect(scenario[2].fieldStates.formulaHorizonSessions.context.resultClaimClass).toBe('scenario-proxy')
    expect(scenario[2]).not.toHaveProperty('formulaHorizonDays')
    expect(scenario[2].fieldStates).not.toHaveProperty('formulaHorizonDays')
  })

  it('v2 全区间与 v3 指定区间 IL 只以 canonical 字段输出', () => {
    const row = buildFormulaPath(makeRows(20), {
      lpScenarioEnabled: true,
      lpScenarioStartPrice: 110,
      lpScenarioRangeWidth: 0.2,
      lpScenarioSkew: 1,
      lpScenarioLiquidity: 10,
      pathUsesScenarioInputs: true,
      formulaHorizonSessions: 8,
      tradingDaysPerYear: 242,
    }).at(-1)

    expect(row.fullRangeV2IlProxy).toBeTypeOf('number')
    expect(row.rangeV3Il).toBeTypeOf('number')
    expect(row).not.toHaveProperty('impermanentLoss')
    expect(row.fieldStates).not.toHaveProperty('impermanentLoss')
    expect(row).not.toHaveProperty('lpInventoryDelta')
    expect(row.fieldStates).not.toHaveProperty('lpInventoryDelta')
  })

  it('不把通用 LP 参数或期权路径情景隐式变成 LP 头寸', () => {
    const row = buildFormulaPath(makeRows(20), {
      startPrice: 110,
      rangeWidth: 0.2,
      skew: 1,
      liquidity: 10,
      pathUsesScenarioInputs: true,
      formulaHorizonSessions: 8,
      tradingDaysPerYear: 242,
    }).at(-1)

    for (const field of [
      'lpLowerPrice',
      'lpUpperPrice',
      'lpValue',
      'lpInventoryDeltaToken0',
      'lpNormalizedDelta',
      'capitalEfficiency',
      'fullRangeV2IlProxy',
      'rangeV3Il',
    ]) {
      expect(row[field]).toBeNull()
    }
    expect(row.fieldStates.lpValue.status).toBe('missing-input')
    expect(row.fieldStates.lpValue.missingInputs).toEqual(['declared-lp-scenario-or-complete-position'])
  })

  it('池聚合快照只标在观察日，绝不伪造为历史指标路径', () => {
    const path = buildFormulaPath(makeRows(20), {
      lpOnchainSnapshot: {
        hasPool: true,
        quotePrice: 101,
        poolCoverage: { reserveUsd: 1000, volumeUsd24h: 250, topPoolReserveShare: 0.4 },
      },
      tradingDaysPerYear: 242,
    })

    expect(path.slice(0, -1).every((row) => row.lpRealPrice === null)).toBe(true)
    expect(path.slice(0, -1).every((row) => row.lpRealDivergence === null)).toBe(true)
    expect(path.slice(0, -1).every((row) => row.lpPoolTurnover24h === null)).toBe(true)
    expect(path.slice(0, -1).every((row) => row.lpPoolTopReserveShare === null)).toBe(true)
    expect(path.at(-1)).toMatchObject({
      lpRealPrice: 101,
      lpPoolTurnover24h: 0.25,
      lpPoolTopReserveShare: 0.4,
    })
    expect(path.at(-1).fieldStates.lpRealPrice.source).toBe('lp-pool-coverage')
  })

  it('期权路径只使用明确的每交易会话 Theta 字段', () => {
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
    expect(row.fieldStates.optionThetaPerSession.status).toBe('research-only')
    expect(row).not.toHaveProperty('optionThetaDaily')
    expect(row.fieldStates).not.toHaveProperty('optionThetaDaily')
  })

  it('canonical row、fieldStates 和字段注册表不暴露 deprecated aliases', () => {
    const row = buildFormulaPath(makeRows(40), {
      pathUsesScenarioInputs: true,
      formulaHorizonSessions: 8,
      optionTenorSessions: 20,
      strikePrice: 100,
      deltaSlope: 0.3,
      tradingDaysPerYear: 242,
    }).at(-1)

    for (const alias of DEPRECATED_CANONICAL_PATH_ALIASES) {
      expect(row).not.toHaveProperty(alias)
      expect(row.fieldStates).not.toHaveProperty(alias)
      expect(FORMULA_PATH_FIELDS).not.toHaveProperty(alias)
    }
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
    expect(row.fieldStates.deltaUpper.status).toBe('missing-input')
    expect(row.fieldStates.deltaUpper.missingInputs).not.toContain('formula-derived-horizon')
    expect(row.fieldStates.deltaUpper.missingInputs).toContain('trading-days-per-year')
    expect(row.fieldStates.optionDelta.missingInputs).toContain('trading-days-per-year')
  })

  it('结构目标不适用时 Delta 继承 not-applicable，不提示补充周期', () => {
    const row = buildFormulaPath(makeRows(100), { deltaSlope: 0.3, tradingDaysPerYear: 242 }).at(-1)

    expect(row.fieldStates.formulaHorizonSessions.status).toBe('not-applicable')
    expect(row.fieldStates.formulaHorizonSessions.context.status).toBe('not-applicable')
    expect(row.fieldStates.formulaHorizonSessions.context.resultClaimClass).toBeNull()
    expect(row.fieldStates.deltaUpper.status).toBe('not-applicable')
    expect(row.fieldStates.deltaUpper.missingInputs).not.toContain('formula-derived-horizon')
    expect(row.fieldStates.deltaUpper.blockedReasons).toEqual(row.fieldStates.formulaHorizonSessions.blockedReasons)
  })

  it('AR 前缀门禁失败时 Delta 继承 model-gate-failed，同时保留真实输入缺口', () => {
    const row = buildFormulaPath(makeRows(4), { deltaSlope: 0.3, tradingDaysPerYear: 242 }).at(-1)

    expect(row.fieldStates.formulaHorizonSessions.status).toBe('model-gate-failed')
    expect(row.fieldStates.formulaHorizonSessions.context.status).toBe('model-gate-failed')
    expect(row.fieldStates.formulaHorizonSessions.context.resultClaimClass).toBeNull()
    expect(row.fieldStates.deltaUpper.status).toBe('model-gate-failed')
    expect(row.fieldStates.deltaUpper.missingInputs).toContain('realized-volatility')
    expect(row.fieldStates.deltaUpper.missingInputs).not.toContain('formula-derived-horizon')
  })

  it('周期结构输入确实无效时 Delta 才标 missing-input', () => {
    const rows = makeRows(100)
    rows[rows.length - 1] = { ...rows.at(-1), open: 0, high: 0, low: 0, close: 0 }
    const row = buildFormulaPath(rows, { deltaSlope: 0.3, tradingDaysPerYear: 242 }).at(-1)

    expect(row.fieldStates.formulaHorizonSessions.status).toBe('missing-input')
    expect(row.fieldStates.formulaHorizonSessions.context.status).toBe('missing-input')
    expect(row.fieldStates.formulaHorizonSessions.context.resultClaimClass).toBe('missing-input')
    expect(row.fieldStates.deltaUpper.status).toBe('missing-input')
    expect(row.fieldStates.deltaUpper.missingInputs).toContain('formula-horizon-inputs')
    expect(row.fieldStates.deltaUpper.missingInputs).not.toContain('formula-derived-horizon')
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
    expect(row).not.toHaveProperty('fundingProxy')
    expect(row.fieldStates).not.toHaveProperty('fundingProxy')
    expect(row.fieldStates.netCarry.context.availableAt).toBe('session-0019:close')
    expect(missingKnownAt.netCarry).toBeNull()
    expect(missingKnownAt.fieldStates.netCarry.status).toBe('missing-input')
  })
})
