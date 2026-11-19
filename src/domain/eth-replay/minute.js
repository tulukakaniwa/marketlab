// Clock values are UTC minute boundaries. At 03:15, the 03:14 candle is closed.
const fee = 0.001
const slip = 0.0002
const buyFactor = (1 + fee) * (1 + slip)
const sellFactor = (1 - fee) * (1 - slip)
const stages = [
  [0, 60],
  [60, 120],
  [120, 179],
]

export function clock(minute) {
  return [Math.floor(minute / 60), minute % 60].map((v) => String(v).padStart(2, '0')).join(':')
}

function quote(day, venue, minute) {
  if (minute === 0) return day[venue + 'Open'] ?? null
  const cents = day[venue][minute - 1]
  return cents == null ? null : cents / 100
}

function changeBp(end, start) {
  return end == null || !start ? null : (end / start - 1) * 10000
}

function liquidity(chain, pools, minute) {
  if (!chain || minute < 16) return null
  const n = Math.min(179, minute - 16)
  const sums = stages.map(() => 0)
  const rows = pools.map((pool, i) => {
    let delta = 0,
      buy = 0,
      sell = 0
    for (let j = 0; j < n; j++) {
      const [change, bought, sold] = chain.frames[i][j]
      delta += change
      buy += bought
      sell += sold
      sums[Math.min(2, Math.floor(j / 60))] += bought - sold
    }
    return {
      name: pool.name,
      address: pool.address,
      initial: chain.initial[i],
      depth: chain.initial[i] + delta,
      delta,
      buy,
      sell,
    }
  })
  return {
    n,
    rows,
    sums,
    usd: chain.usd,
    delta: rows.reduce((s, p) => s + p.delta, 0),
    impact: n === 179 ? chain.impact : null,
    comparable: n === 179 && chain.comparable,
    matched: n === 179 ? chain.matched : null,
    counts: n === 179 ? chain.counts : null,
  }
}

function wallet(index, now) {
  const closed = []
  let position = null,
    net = 0,
    base = 0
  for (const event of index.fills) {
    if (event.time > now) break
    if (event.side === 'buy') position = event
    else {
      closed.push({ entry: position, exit: event })
      position = null
      net += event.net
    }
  }
  for (const settlement of index.baseExits) {
    if (settlement.time > now) break
    base += settlement.net
  }
  return { position, closed, net, base }
}

function verdict(eligible, minute, book, checks, account, day) {
  const { position, closed } = account
  if (position?.time === day + ' ' + clock(minute)) {
    return { title: '买入 1 ETH', why: position.route + '于上一分钟获得许可，本分钟现货开盘成交。' }
  }
  if (position) return { title: '持有 1 ETH', why: position.route + '已开仓。按入场时冻结的目标、止损和到期日管理。' }
  const last = closed.at(-1)?.exit
  if (last?.time.startsWith(day) && last.time.endsWith(clock(minute)))
    return { title: '平仓', why: last.reason + '，本分钟开盘卖出 1 ETH。' }
  if (!eligible) return { title: '等待', why: '日线折价与期限条件未触发，当日没有开仓候选。' }
  if (minute < 195)
    return {
      title: '观察',
      why:
        minute < 179
          ? '日线出现候选，等待 179 分钟内的五池成交和同价深度。'
          : '观察窗已结束，等待链上确认及 03:14 现货收盘价。',
    }
  if (!book || !checks.length) return { title: '等待', why: '缺少已确认的链上窗口，无法判定开仓。' }
  const failed = checks.filter((c) => !c.pass).map((c) => c.label)
  if (failed.length) return { title: '等待', why: failed.join('；') + '。今日判定已冻结。' }
  const route = book.sums.every((f) => f > 0) ? '三段持续净买' : '卖压承接'
  if (minute === 195) return { title: '买入许可', why: route + '成立，等待 03:16 现货开盘成交。' }
  return { title: '等待', why: '今日判定时刻已过，只在预定开盘时刻建立一个仓位。' }
}

export function replayAt(index, day, minute) {
  const date = day.signal.date
  const spot = quote(day, 'spot', minute),
    perp = quote(day, 'perp', minute)
  const l = liquidity(day.chain, index.pools, minute)
  const markets = ['spot', 'perp'].map((v) => (minute >= 179 ? changeBp(quote(day, v, 179), quote(day, v, 89)) : null))
  const target = day.signal.eligible ? day.signal.target : null
  const remaining = (p) => (target != null && p != null ? target * sellFactor - p * buyFactor : null)
  const g = remaining(spot)
  const frozen = minute >= 195 && target != null ? remaining(quote(day, 'spot', 195)) : null
  const checks = []
  let buy = false,
    absorption = false
  if (l?.n === 179 && minute >= 195) {
    buy = l.sums.every((v) => v > 0)
    const i = l.impact
    absorption = l.sums.reduce((a, b) => a + b, 0) < 0 && l.comparable && i && i[0] > i[1] && i[1] > i[2]
    checks.push(
      { label: '剩余净空间未覆盖成本', pass: frozen > 0 },
      { label: '五池同价深度未增加', pass: l.delta > 0 },
      { label: '现货或永续后半窗回落', pass: markets.every((v) => v != null && v >= 0) },
      { label: '卖压承接与三段净买均未成立', pass: Boolean(buy || absorption) },
    )
  }
  const account = wallet(index, date + ' ' + clock(minute))
  const state = verdict(day.signal.eligible, minute, l, checks, account, date)
  const mark = account.position && spot != null ? spot * sellFactor - account.position.price * buyFactor : null
  const series = []
  for (let m = Math.max(0, minute - 178); m <= minute; m++) {
    series.push({ minute: m, spot: quote(day, 'spot', m), perp: quote(day, 'perp', m) })
  }
  return {
    date,
    minute,
    signal: day.signal,
    target,
    spot,
    perp,
    basis: changeBp(perp, spot),
    markets,
    g,
    frozen,
    liquidity: l,
    checks,
    buy,
    absorption,
    account,
    state,
    mark,
    series,
  }
}
