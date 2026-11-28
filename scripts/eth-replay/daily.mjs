// Export the frozen daily layer with Market Lab's own formulas and the historical warm-up.
import { readFileSync } from 'node:fs'
import { deepStrictEqual } from 'node:assert'
import { join } from 'node:path'
import { buildLatentLiquidityPath } from '../../research/latent-liquidity-lab/src/latentLiquidity.js'
import { deriveCycleHorizonAt } from '../../research/latent-liquidity-lab/src/cycleHorizon.js'

const source = process.argv[2]
const read = (name) => JSON.parse(readFileSync(join(source, name), 'utf8'))
const rows = read('长段-days.json')
const archived = read('长段-signals.json')
const input = { tradingDaysPerYear: 365 }
const first = rows.findIndex((r) => r.date === archived[0].date)
if (first <= 0) throw new Error('Missing daily warm-up')
const signals = []
for (let i = first; i < rows.length; i++) {
  const history = rows.slice(0, i)
  const path = buildLatentLiquidityPath(history, input)
  const last = path.at(-1)
  const { date, open } = rows[i]
  const signal = {
    date,
    low: last.costLow,
    anchor: last.costAnchor,
    state: last.state,
    below: history.at(-1).close < last.costLow,
  }
  if (signal.below) {
    const horizon = deriveCycleHorizonAt({ rows: [...history, { date, open }], statePath: path, index: i - 1, input })
    Object.assign(signal, {
      eligible: horizon.eligible,
      target: horizon.targetPrice,
      H: horizon.executionHorizonSessions,
    })
  }
  signals.push(signal)
}
deepStrictEqual(JSON.parse(JSON.stringify(signals)), archived)
process.stdout.write(JSON.stringify(signals))
