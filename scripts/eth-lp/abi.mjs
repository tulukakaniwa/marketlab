// ABI signatures: Uniswap/v3-core IUniswapV3Pool{State,Immutables}.sol.
// Ethereum ABI integers stay BigInt until bounded fields are decoded.
export const SELECTORS = Object.freeze({
  slot0: '0x3850c7bd',
  liquidity: '0x1a686502',
  ticks: '0xf30dba93',
  tickBitmap: '0x5339c296',
  token0: '0x0dfe1681',
  token1: '0xd21220a7',
  fee: '0xddca3f43',
  tickSpacing: '0xd0c93a7c',
  factory: '0xc45a0155',
  getPool: '0x1698ee82',
  decimals: '0x313ce567',
  symbol: '0x95d89b41',
})
export const POOL_ADDRESS = '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640'
export const FACTORY_ADDRESS = '0x1f98431c8ad98523631ae4a59f267346ea31f984'
export const TOKEN_ADDRESSES = Object.freeze({
  USDC: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  WETH: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
})
export const EVENT_TOPICS = Object.freeze({
  Mint: '0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde',
  Burn: '0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c',
  Swap: '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67',
  Collect: '0x70935338e69775456a85ddef226c395fb668b63fa0115f5f20610b388e6ca9c0',
})

export function words(hex, count) {
  if (typeof hex !== 'string' || !/^0x(?:[0-9a-fA-F]{64})+$/.test(hex)) {
    throw new Error('Malformed ABI words')
  }
  const result = hex.slice(2).match(/.{64}/g)
  if (count !== undefined && result.length !== count) throw new Error('Unexpected ABI word count')
  return result
}
export function uint(word, bits = 256) {
  const value = BigInt(`0x${word}`)
  if (value < 0n || value >= 1n << BigInt(bits)) throw new Error(`Invalid uint${bits}`)
  return value
}
export function int(word, bits = 256) {
  const raw = uint(word)
  const value = BigInt.asIntN(bits, raw)
  if (BigInt.asUintN(256, value) !== raw) throw new Error(`Invalid int${bits} sign extension`)
  return value
}
export function address(word) {
  if (uint(word) >= 1n << 160n) throw new Error('Invalid ABI address')
  return `0x${word.slice(-40).toLowerCase()}`
}
export function argument(value) {
  const raw = BigInt(value)
  if (raw < -(1n << 255n) || raw >= 1n << 256n) throw new Error('ABI argument out of range')
  return BigInt.asUintN(256, raw).toString(16).padStart(64, '0')
}
export function quantity(value) {
  const raw = BigInt(value)
  if (raw < 0n || raw > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('RPC quantity out of range')
  return `0x${raw.toString(16)}`
}
export function numberQuantity(value) {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) throw new Error('Invalid RPC quantity')
  const parsed = Number(BigInt(value))
  if (!Number.isSafeInteger(parsed)) throw new Error('Unsafe RPC quantity')
  return parsed
}
export function symbol(hex) {
  const encoded = words(hex)
  if (uint(encoded[0]) !== 32n || encoded.length < 2) throw new Error('Invalid token symbol ABI offset')
  const length = Number(uint(encoded[1]))
  if (length < 1 || length > 32 || encoded.length !== 3) throw new Error('Unsupported token symbol')
  return Buffer.from(encoded[2].slice(0, length * 2), 'hex').toString('utf8')
}
export function header(raw) {
  if (!raw || !/^0x[0-9a-f]{64}$/i.test(raw.hash) || !/^0x[0-9a-f]{64}$/i.test(raw.parentHash)) {
    throw new Error('Missing or malformed block header')
  }
  return {
    number: numberQuantity(raw.number),
    hash: raw.hash.toLowerCase(),
    parentHash: raw.parentHash.toLowerCase(),
    timestamp: numberQuantity(raw.timestamp),
  }
}
export function bitmapTicks(bitmap, wordPosition, tickSpacing) {
  const bits = uint(words(bitmap, 1)[0])
  const ticks = []
  for (let bit = 0; bit < 256; bit += 1) {
    if ((bits & (1n << BigInt(bit))) !== 0n) {
      const tick = (wordPosition * 256 + bit) * tickSpacing
      if (tick < -887272 || tick > 887272) throw new Error('Initialized tick outside protocol range')
      ticks.push(tick)
    }
  }
  return ticks
}
