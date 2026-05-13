import { csvParse } from 'd3-dsv'

export const btcHistorySource = {
  id: 'binance-btcusdt-1d-2017-2025',
  label: 'BTCUSDT 日线',
  symbol: 'BTCUSDT',
  interval: '1日',
  source: 'Binance 公共数据',
  url: '/data/btcusdt-1d-2017-2025.csv',
}

export const marketSamples = [
  btcHistorySource,
  {
    id: 'yahoo-nvda-1d-2025-2026',
    label: 'NVDA 近一年',
    symbol: 'NVDA',
    interval: '1日',
    source: 'Yahoo Finance Chart API',
    url: '/data/nvda-1d-2025-2026.csv',
  },
  {
    id: 'yahoo-tsla-1d-2025-2026',
    label: 'TSLA 近一年',
    symbol: 'TSLA',
    interval: '1日',
    source: 'Yahoo Finance Chart API',
    url: '/data/tsla-1d-2025-2026.csv',
  },
]

export function parseCsvText(text) {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return []
  const firstLine = trimmed.split(/\r?\n/, 1)[0]
  if (/^\d/.test(firstLine) && firstLine.split(',').length >= 6) return parseBinanceKlines(trimmed)
  return parseOhlcv(csvParse(trimmed))
}

export function parseBinanceKlines(text) {
  return String(text ?? '')
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const cols = line.split(',')
      const rawTimestamp = Number(cols[0])
      const timestamp = rawTimestamp > 9999999999999 ? Math.floor(rawTimestamp / 1000) : rawTimestamp
      return {
        date: new Date(timestamp).toISOString().slice(0, 10),
        timestamp,
        open: numberValue(cols[1]),
        high: numberValue(cols[2]),
        low: numberValue(cols[3]),
        close: numberValue(cols[4]),
        volume: numberValue(cols[5]),
      }
    })
    .filter(isValidOhlcv)
    .sort((a, b) => a.timestamp - b.timestamp)
}

export function parseOhlcv(rows) {
  return rows
    .map((row) => {
      const rawDate = pick(row, ['date', 'time', 'datetime', 'timestamp', 'Date', 'Time', 'Datetime'])
      const timestamp = parseTimestamp(rawDate)
      return {
        date: Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : String(rawDate ?? ''),
        timestamp,
        open: numberValue(pick(row, ['open', 'Open', 'o'])),
        high: numberValue(pick(row, ['high', 'High', 'h'])),
        low: numberValue(pick(row, ['low', 'Low', 'l'])),
        close: numberValue(pick(row, ['close', 'Close', 'c', 'adj close', 'Adj Close'])),
        volume: numberValue(pick(row, ['volume', 'Volume', 'vol', 'v'])),
      }
    })
    .filter(isValidOhlcv)
    .sort((a, b) => a.timestamp - b.timestamp)
}

function pick(row, keys) {
  const key = keys.find((candidate) => row[candidate] !== undefined)
  return key ? row[key] : undefined
}

function numberValue(value) {
  return Number(String(value ?? '').replaceAll(',', ''))
}

function parseTimestamp(value) {
  const raw = String(value ?? '').trim()
  const numeric = Number(raw)
  if (Number.isFinite(numeric)) {
    if (numeric > 1000000000000) return numeric
    if (numeric > 1000000000) return numeric * 1000
  }
  return new Date(raw).getTime()
}

function isValidOhlcv(row) {
  return (
    row.date &&
    Number.isFinite(row.timestamp) &&
    [row.open, row.high, row.low, row.close].every((value) => Number.isFinite(value) && value > 0) &&
    row.high >= Math.max(row.open, row.close) &&
    row.low <= Math.min(row.open, row.close) &&
    Number.isFinite(row.volume) &&
    row.volume >= 0
  )
}
