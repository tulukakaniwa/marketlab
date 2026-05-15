import { describe, expect, it } from 'vitest'
import { buildLiquidityRackModel } from '../research-visualization/liquidityRackModel.js'

describe('buildLiquidityRackModel', () => {
  it('构建价格仓查询模型，不修改挂单计划', () => {
    const rows = Array.from({ length: 80 }, (_, i) => {
      const close = 100 + Math.sin(i / 8) * 8
      return { date: `2024-01-${String((i % 28) + 1).padStart(2, '0')}`, open: close - 1, high: close + 2, low: close - 2, close, volume: 1000 }
    })
    const costPath = rows.map((row) => ({ date: row.date, anchor: 100, lower: 92, upper: 108 }))
    const formulaPath = rows.map((row) => ({ date: row.date, deltaLower: 90, deltaUpper: 112 }))
    const primaryOrders = [
      { side: 'buy', role: '试仓', price: 94, notional: 1000 },
      { side: 'sell', role: '减压', price: 109, notional: 500 },
    ]
    const graph = { inputs: { entryPrice: 100 }, plan: { primaryOrders } }

    const model = buildLiquidityRackModel({ rows, costPath, formulaPath, graph, activeIndex: 79, binCount: 72 })

    expect(model.shelves).toHaveLength(72)
    expect(model.ticks).toHaveLength(5)
    expect(model.priceStep).toBeGreaterThan(0)
    expect(model.meta.compositionLabel).toContain('不是市场盘口')
    expect(model.meta.orderLabel).toBe('挂单刻度来自 OrderPlan')
    expect(model.markers.map((m) => m.label)).toEqual(['现价', '成本', 'Δ上', 'Δ下'])
    expect(model.orderTicks).toHaveLength(2)
    expect(graph.plan.primaryOrders).toBe(primaryOrders)
  })
})
