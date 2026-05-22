// JS 双胞胎：逐行镜像 bl-esw-pinbar-market-lab.pine 的计算逻辑
// 任何 Pine 改动必须同步改这里，否则 src/test/pine-equivalence.test.js 会失败

import { pathToFileURL } from 'node:url'

const DEFAULTS = {
  cost_len: 60,
  recent_len: 20,
  vol_len: 60,
  holding_days: 30,
  trading_days: 365,
  target_return_pct: 30,
  lp_range_width: 0.10,
  lp_skew: 1.0,
  profile: 'Balanced',
  auto_adapt: false,
  relax_mode: false,
  adaptive_cost: false,
}

function biasedStdev(values) {
  // Pine ta.stdev 默认 biased=true（除以 n）
  if (values.length < 1) return 0
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function wilderAtr(rows, period = 14) {
  // Pine ta.atr 用 RMA：RMA[i] = (RMA[i-1]*(n-1) + tr[i]) / n
  const trs = rows.map((row, i) => {
    if (i === 0) return row.high - row.low
    const prevClose = rows[i - 1].close
    return Math.max(row.high - row.low, Math.abs(row.high - prevClose), Math.abs(row.low - prevClose))
  })
  let rma = trs.slice(0, period).reduce((s, v) => s + v, 0) / period
  for (let i = period; i < trs.length; i += 1) {
    rma = (rma * (period - 1) + trs[i]) / period
  }
  return rma
}

function vwapTypical(rows) {
  if (!rows.length) return 0
  const totalVol = rows.reduce((s, r) => s + r.volume, 0)
  if (totalVol <= 0) {
    return rows.reduce((s, r) => s + (r.high + r.low + r.close) / 3, 0) / rows.length
  }
  return rows.reduce((s, r) => s + ((r.high + r.low + r.close) / 3) * r.volume, 0) / totalVol
}

export function pineEquivalent(rows, inputs = {}) {
  const opts = { ...DEFAULTS, ...inputs }
  if (rows.length < opts.cost_len + 5) {
    throw new Error(`pineEquivalent 需要至少 ${opts.cost_len + 5} 根 K 线`)
  }
  const last = rows.at(-1)

  // cost anchor (VWAP of typical price)
  const anchorRows = rows.slice(-opts.cost_len)
  const cost_anchor = vwapTypical(anchorRows)

  // log returns（最近 cost_len 期，从 cost_len+1 行算 cost_len 个收益）
  const bandRows = rows.slice(-(opts.cost_len + 1))
  const logRets = bandRows.slice(1).map((row, i) => Math.log(row.close / bandRows[i].close))
  const vol_estimate = biasedStdev(logRets) * Math.sqrt(Math.min(opts.recent_len, logRets.length))
  const min_band = Math.max(vol_estimate * 0.25, 0.005)
  const band_width = Math.max(vol_estimate, min_band)
  const cost_low = cost_anchor * (1 - band_width)
  const cost_high = cost_anchor * (1 + band_width)

  // annual vol（用 vol_len 个收益，biased stdev）
  const volRows = rows.slice(-(opts.vol_len + 1))
  const volRets = volRows.slice(1).map((row, i) => Math.log(row.close / volRows[i].close))
  const annual_vol = Math.max(biasedStdev(volRets) * Math.sqrt(opts.trading_days), 0.01)

  // atr_pct（Wilder RMA 14）
  const atr_14 = wilderAtr(rows, 14)
  const atr_pct = last.close > 0 ? atr_14 / last.close : 0

  // GetDelta band
  const target_return = opts.target_return_pct / 100
  const wave_raw = annual_vol * Math.sqrt(opts.holding_days / (opts.trading_days * 2 * Math.PI))
  const wave = Math.min(wave_raw, 0.99)
  let long_cost = NaN, long_high = NaN, long_low = NaN
  if (wave > 0 && wave < 1 && last.close > 0) {
    const long_ratio = ((1 + wave) / (1 - wave)) ** 2
    long_cost = last.close * (target_return * long_ratio - target_return + 1) ** 2 / long_ratio
    long_high = long_cost * long_ratio
    long_low = long_cost / long_ratio
  }

  // z score（用 holding 周期化）
  const period_vol = annual_vol > 0 ? annual_vol * Math.sqrt(opts.holding_days / opts.trading_days) : 0.01
  const cost_distance = cost_anchor > 0 ? last.close / cost_anchor - 1 : 0
  const z_score = period_vol > 0 ? cost_distance / period_vol : 0

  return {
    cost_anchor, cost_low, cost_high,
    annual_vol, atr_pct,
    long_cost, long_high, long_low,
    z_score, cost_distance, period_vol,
    band_width,
    last_close: last.close,
  }
}

// CLI 用法：node scripts/verify-pine-equivalence.mjs public/data/GOOG-1d.csv
// pathToFileURL 处理 Windows 三斜杠（file:///F:/...）和 Unix 差异
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { readFileSync } = await import('node:fs')
  const { resolve } = await import('node:path')
  const { parseCsvText } = await import('../src/domain/market-data/ohlcv.js')
  const path = process.argv[2] || 'public/data/GOOG-1d.csv'
  const text = readFileSync(resolve(process.cwd(), path), 'utf8')
  const rows = parseCsvText(text)
  console.log(JSON.stringify(pineEquivalent(rows), null, 2))
}
