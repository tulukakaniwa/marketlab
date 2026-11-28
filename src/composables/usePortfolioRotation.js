import { ref, shallowRef } from 'vue'
import { loadMarketCsv } from '../data/generated/market-csv-index.js'
import { parseCsvText } from '../domain/market-data/ohlcv.js'
import { inferTdpy } from '../domain/market-data/tdpy.js'
import { ROTATION_PRESETS, evaluatePortfolioRotation } from '../domain/strategy-planning/portfolioRotationEngine.js'

const parsedRowsCache = new Map()

/**
 * Command-driven async ViewModel for Cross-Asset Capital-Recycling Portfolio Rotation.
 * Never executes unbounded multi-asset history scans inside a synchronous computed property.
 */
export function usePortfolioRotation(allSamplesRef) {
  const open = ref(false)
  const visited = ref(false)
  const running = ref(false)
  const error = ref('')
  const presetId = ref(ROTATION_PRESETS[0].id)
  const maxSlots = ref(5)
  const useMakerLadder = ref(true)
  const result = shallowRef(null)
  let runTicket = 0

  async function openRotation() {
    visited.value = true
    open.value = true
    if (!result.value && !running.value) {
      await runRotation()
    }
  }

  function closeRotation() {
    open.value = false
  }

  async function setPreset(nextPresetId) {
    if (!ROTATION_PRESETS.some((p) => p.id === nextPresetId)) return
    presetId.value = nextPresetId
    await runRotation()
  }

  async function setMaxSlots(nextSlots) {
    maxSlots.value = Math.max(2, Math.min(8, Number(nextSlots) || 5))
    await runRotation()
  }

  async function toggleMakerLadder() {
    useMakerLadder.value = !useMakerLadder.value
    await runRotation()
  }

  async function runRotation() {
    const ticket = ++runTicket
    running.value = true
    error.value = ''
    try {
      const preset = ROTATION_PRESETS.find((p) => p.id === presetId.value) ?? ROTATION_PRESETS[0]
      const sampleLookup = new Map((allSamplesRef.value ?? []).map((s) => [s.symbol, s]))
      // Yield one macrotask so loading state paints cleanly before CPU work
      await new Promise((resolve) => setTimeout(resolve, 16))

      const universe = []
      for (const symbol of preset.symbols) {
        const meta = sampleLookup.get(symbol) ?? fallbackSampleMeta(symbol)
        const rows = await loadRowsForSample(meta)
        if (!rows.length) continue
        const tdpy = inferTdpy(meta).value
        universe.push({
          symbol,
          label: meta.label ?? symbol,
          market: meta.market ?? '',
          tradingDaysPerYear: tdpy,
          rows,
        })
      }

      if (ticket !== runTicket) return
      result.value = evaluatePortfolioRotation({
        universe,
        maxSlots: maxSlots.value,
        useMakerLadder: useMakerLadder.value,
        feeRate: 0.001,
      })
    } catch (err) {
      if (ticket === runTicket) {
        error.value = err?.message || '组合轮动计算失败'
      }
    } finally {
      if (ticket === runTicket) running.value = false
    }
  }

  return {
    open,
    visited,
    running,
    error,
    presets: ROTATION_PRESETS,
    presetId,
    maxSlots,
    useMakerLadder,
    result,
    openRotation,
    closeRotation,
    setPreset,
    setMaxSlots,
    toggleMakerLadder,
    runRotation,
  }
}

async function loadRowsForSample(sample) {
  if (parsedRowsCache.has(sample.symbol)) return parsedRowsCache.get(sample.symbol)
  const url = sample.url ?? `/data/${sample.symbol.replace('.', '_')}-1d.csv`
  let text = await loadMarketCsv(url)
  if (text === null && typeof fetch === 'function') {
    const res = await fetch(url)
    if (res.ok) text = await res.text()
  }
  if (!text) return []
  const rows = parseCsvText(text)
  parsedRowsCache.set(sample.symbol, rows)
  return rows
}

function fallbackSampleMeta(symbol) {
  const isCrypto = symbol.endsWith('USDT')
  const isHk = symbol.endsWith('.HK')
  const isCn = /^[0-9]{6}$/.test(symbol)
  return {
    symbol,
    label: symbol,
    market: isCrypto ? '加密' : isHk ? '港股' : isCn ? 'A股' : '美股',
    url: `/data/${symbol.replace('.', '_')}-1d.csv`,
  }
}
