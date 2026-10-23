// Pool event layouts: Uniswap/v3-core, IUniswapV3PoolEvents.sol.
// Decode only public pool logs. This does not identify a wallet's trading intent.
export const POOL_EVENT_TOPICS = Object.freeze({
  Mint: '0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde',
  Burn: '0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c',
  Swap: '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67',
  Collect: '0x70935338e69775456a85ddef226c395fb668b63fa0115f5f20610b388e6ca9c0',
})

export const isHash = (value) => typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value)
export const isAddress = (value) => typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value)

export function rpcInteger(value) {
  if (Number.isSafeInteger(value) && value >= 0) return value
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) throw new Error('invalid-rpc-integer')
  const integer = BigInt(value)
  if (integer > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('unsafe-rpc-integer')
  return Number(integer)
}

export function eventTimeSeconds(value) {
  if (Number.isSafeInteger(value) && value >= 0) return value
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT.*Z$/.test(value)) return null
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) && milliseconds % 1000 === 0 ? milliseconds / 1000 : null
}

function wordInteger(word, bits, signed = false) {
  if (typeof word !== 'string' || !/^[0-9a-f]{64}$/i.test(word)) throw new Error('invalid-abi-word')
  const unsigned = BigInt(`0x${word}`)
  const mask = (1n << BigInt(bits)) - 1n
  let value = unsigned & mask
  if (signed && value >= 1n << BigInt(bits - 1)) value -= 1n << BigInt(bits)
  const encoded = value < 0n ? (1n << 256n) + value : value
  if (encoded !== unsigned) throw new Error('noncanonical-abi-word')
  return value
}

function addressWord(word) {
  wordInteger(word, 160)
}

export function decodePoolLog(log, block) {
  if (!log || !isAddress(log.address) || !isHash(log.blockHash) || !isHash(log.transactionHash)) {
    throw new Error('invalid-log-identity')
  }
  if (log.removed !== false) throw new Error('removed-or-unconfirmed-log')
  const blockNumber = rpcInteger(log.blockNumber)
  if (!block || blockNumber !== block.number || log.blockHash.toLowerCase() !== block.hash?.toLowerCase()) {
    throw new Error('log-block-mismatch')
  }
  if (!Number.isSafeInteger(block.timestamp) || block.timestamp < 0) throw new Error('invalid-block-time')
  const type = Object.keys(POOL_EVENT_TOPICS).find((name) => POOL_EVENT_TOPICS[name] === log.topics?.[0]?.toLowerCase())
  if (!type) throw new Error('unsupported-pool-event')
  const topicCount = type === 'Swap' ? 3 : 4
  if (log.topics.length !== topicCount || !log.topics.every(isHash)) throw new Error('invalid-log-topics')
  const dataWords = { Mint: 4, Burn: 3, Swap: 5, Collect: 3 }[type]
  if (typeof log.data !== 'string' || !new RegExp(`^0x[0-9a-f]{${dataWords * 64}}$`, 'i').test(log.data)) {
    throw new Error('invalid-log-data')
  }
  const words = log.data.slice(2).match(/.{64}/g)
  addressWord(log.topics[1].slice(2))
  const event = {
    type,
    blockNumber,
    blockHash: log.blockHash.toLowerCase(),
    transactionIndex: rpcInteger(log.transactionIndex),
    logIndex: rpcInteger(log.logIndex),
    transactionHash: log.transactionHash.toLowerCase(),
    removed: false,
    eventTime: new Date(block.timestamp * 1000).toISOString(),
  }
  if (type === 'Swap') {
    addressWord(log.topics[2].slice(2))
    return {
      ...event,
      amount0Raw: wordInteger(words[0], 256, true).toString(),
      amount1Raw: wordInteger(words[1], 256, true).toString(),
      sqrtPriceX96: wordInteger(words[2], 160).toString(),
      liquidity: wordInteger(words[3], 128).toString(),
      tick: Number(wordInteger(words[4], 24, true)),
    }
  }
  const tickLower = Number(wordInteger(log.topics[2].slice(2), 24, true))
  const tickUpper = Number(wordInteger(log.topics[3].slice(2), 24, true))
  if (type === 'Mint' || type === 'Collect') addressWord(words[0])
  if (type === 'Collect') {
    return {
      ...event,
      tickLower,
      tickUpper,
      amount0Raw: wordInteger(words[1], 128).toString(),
      amount1Raw: wordInteger(words[2], 128).toString(),
    }
  }
  const offset = type === 'Mint' ? 1 : 0
  const liquidity = wordInteger(words[offset], 128)
  return {
    ...event,
    tickLower,
    tickUpper,
    liquidityDeltaRaw: (type === 'Burn' ? -liquidity : liquidity).toString(),
    amount0Raw: wordInteger(words[offset + 1], 256).toString(),
    amount1Raw: wordInteger(words[offset + 2], 256).toString(),
  }
}

export function eventMatchesLog(event, decoded) {
  return Object.entries(decoded).every(([key, value]) => {
    if (key === 'eventTime') return eventTimeSeconds(event?.eventTime) === eventTimeSeconds(value)
    if (key === 'blockHash' || key === 'transactionHash') return event?.[key]?.toLowerCase() === value
    return event?.[key] === value
  })
}
