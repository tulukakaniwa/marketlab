import { getSqrtRatioAtTick, Q96 } from './uniswapV3Math.js'
import { instant } from './impactChartTime.js'

const positive = (value) => Number.isFinite(value) && value > 0
const empty = (reason) => ({ nodes: [], reason })

export function buildLpChartNodes(report, availableMs) {
  const pool = report.pool
  const index = pool?.baseTokenIndex
  const base = pool?.[`token${index}`]
  const quote = pool?.[`token${1 - index}`]
  if (![0, 1].includes(index) || !['ETH', 'WETH'].includes(base?.symbol) || quote?.symbol !== 'USDC')
    return empty('unsupported-pool-pair')
  if (![base.decimals, quote.decimals].every((value) => Number.isInteger(value) && value >= 0 && value <= 255))
    return empty('invalid-token-decimals')
  if (!Array.isArray(report.actions) || report.actions.length > 20000) return empty('invalid-action-list')
  const seen = new Set()
  const groups = new Map()
  for (const action of report.actions) {
    const event = action?.event
    if (!['Mint', 'Burn'].includes(event?.type)) continue
    const eventMs = instant(event.eventTime)
    if (eventMs === null || eventMs > availableMs) return empty('availability-precedes-event')
    const eventId = `${event.transactionHash}:${event.logIndex}`
    if (!event.transactionHash || !Number.isInteger(event.logIndex)) return empty('invalid-action-identity')
    if (seen.has(eventId)) continue
    seen.add(eventId)
    const raw = event.liquidityDeltaRaw
    // A zero Burn is a protocol fee-accounting poke, not liquidity removal.
    if (event.type === 'Burn' && raw === '0') continue
    if (typeof raw !== 'string' || raw.length > 40 || !/^-?[1-9]\d*$/.test(raw))
      return empty('invalid-action-liquidity')
    const delta = BigInt(raw)
    if ((event.type === 'Mint' && delta < 0n) || (event.type === 'Burn' && delta > 0n))
      return empty('invalid-action-direction')
    let edges
    try {
      if (!(event.tickLower < event.tickUpper)) return empty('invalid-action-range')
      edges = [event.tickLower, event.tickUpper].map((tick) => tickPrice(tick, pool)).sort((a, b) => a - b)
    } catch {
      return empty('invalid-action-range')
    }
    const price = Math.sqrt(edges[0]) * Math.sqrt(edges[1])
    if (![...edges, price].every(positive)) return empty('invalid-action-price')
    const key = `lp:${event.type}:${event.tickLower}:${event.tickUpper}`
    const node = groups.get(key) ?? {
      id: key,
      label: event.type === 'Mint' ? 'LP 增加 · |ΔL|' : 'LP 减少 · |ΔL|',
      action: event.type,
      price,
      lowerPrice: edges[0],
      upperPrice: edges[1],
      tickLower: event.tickLower,
      tickUpper: event.tickUpper,
      rawValue: '0',
      signedLiquidityDeltaRaw: '0',
      unit: 'liquidity-raw',
      eventCount: 0,
    }
    node.rawValue = (BigInt(node.rawValue) + (delta < 0n ? -delta : delta)).toString()
    node.signedLiquidityDeltaRaw = (BigInt(node.signedLiquidityDeltaRaw) + delta).toString()
    node.eventCount += 1
    groups.set(key, node)
  }
  return { nodes: [...groups.values()], reason: null }
}

function tickPrice(tick, pool) {
  const sqrt = Number(getSqrtRatioAtTick(tick)) / Number(Q96)
  const token1Per0 = sqrt ** 2 * 10 ** (pool.token0.decimals - pool.token1.decimals)
  return pool.baseTokenIndex === 0 ? token1Per0 : 1 / token1Per0
}

export function buildOptionsChartNodes(report, availableMs) {
  if (!Array.isArray(report.tradeRows) || report.tradeRows.length > 1000) return empty('invalid-option-rows')
  const contracts = new Map()
  const ids = new Set()
  for (const row of report.tradeRows) {
    if (row?.quality !== 'ready' || row.observedTradeValid !== true) continue
    const tradeMs = instant(row.tradeTime)
    const tickerMs = instant(row.tickerTime)
    const expiryMs = instant(row.expiry)
    if ([tradeMs, tickerMs, expiryMs].some((value) => value === null)) return empty('missing-option-evidence-time')
    if (tradeMs > availableMs || tickerMs > availableMs) return empty('availability-precedes-option-evidence')
    if (!row.id || !row.instrumentName?.startsWith('ETH-')) return empty('unsupported-option-identity')
    if (ids.has(row.id)) continue
    ids.add(row.id)
    if (
      !positive(row.strikePriceUsd) ||
      !positive(row.amountEth) ||
      !Number.isFinite(row.openInterestEth) ||
      row.openInterestEth < 0
    )
      return empty('invalid-option-observation')
    const existing = contracts.get(row.instrumentName)
    if (
      existing &&
      (existing.price !== row.strikePriceUsd ||
        existing.expiryMs !== expiryMs ||
        existing.rawValue !== row.openInterestEth)
    )
      return empty('conflicting-contract-observations')
    const node = existing ?? {
      id: `options:${row.instrumentName}`,
      label: '期权 OI · ETH',
      price: row.strikePriceUsd,
      lowerPrice: row.strikePriceUsd,
      upperPrice: row.strikePriceUsd,
      rawValue: row.openInterestEth,
      tradeVolumeEth: 0,
      unit: 'ETH',
      expiryMs,
    }
    node.tradeVolumeEth += row.amountEth
    contracts.set(row.instrumentName, node)
  }
  return { nodes: [...contracts.values()], reason: null }
}
