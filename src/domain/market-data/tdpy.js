const TDPY = {
  crypto: { value: 365, basis: 'crypto', label: '加密 365' },
  us: { value: 252, basis: 'us', label: '美股 252' },
  hk: { value: 242, basis: 'hk', label: '港股 242' },
  cn: { value: 242, basis: 'cn', label: 'A 股 242' },
  fallback: { value: 365, basis: 'fallback', label: '默认 365' },
}

const CRYPTO_TOKENS = ['BTC', 'ETH', 'USDT', 'USDC', 'BNB', 'SOL']

export function inferTdpy(sample) {
  if (!sample || typeof sample !== 'object') return { ...TDPY.fallback }

  const market = sample.market
  const symbol = String(sample.symbol || '').toUpperCase()

  if (market === '加密') return { ...TDPY.crypto }
  if (CRYPTO_TOKENS.some((token) => symbol.includes(token))) return { ...TDPY.crypto }

  if (market === '港股') return { ...TDPY.hk }
  if (/\.HK$/.test(symbol)) return { ...TDPY.hk }

  if (market === 'A股') return { ...TDPY.cn }
  if (/^\d{6}$/.test(symbol)) return { ...TDPY.cn }

  if (market === '美股') return { ...TDPY.us }
  if (/^[A-Z]{1,5}$/.test(symbol)) return { ...TDPY.us }

  return { ...TDPY.fallback }
}
