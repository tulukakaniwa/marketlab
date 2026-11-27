<script setup>
import { computed, onMounted } from 'vue'
import { clock } from '../../domain/eth-replay/minute.js'
import { useEthReplay } from '../../composables/useEthReplay.js'
import MarketLines from './MarketLines.vue'
import '../../styles/eth-decision.css'

const emit = defineEmits(['back'])
const { index, date, minute, playing, speed, view: v, jump, step, retry, error } = useEthReplay()
const l = computed(() => v.value?.liquidity)
const n = (value, places = 2) =>
  Number.isFinite(value)
    ? value.toLocaleString('en-US', {
        minimumFractionDigits: places,
        maximumFractionDigits: places,
      })
    : '—'
const sign = (value) => (Number.isFinite(value) && value > 0 ? '+' + n(value) : n(value))
function seek(d, m) {
  playing.value = false
  jump(d, m)
}
function next(m) {
  playing.value = false
  step(m)
}
const end = computed(() => index.value?.days.at(-1))
onMounted(() => {
  document.title = 'ETH 决策回放 · Market Lab'
})
</script>

<template>
  <main class="eth-replay">
    <header class="eth-head">
      <a href="./" @click.prevent="emit('back')">← Market Lab 工作台</a><span>历史回放 · UTC</span>
    </header>
    <div class="eth-heading">
      <div>
        <h1>ETH 决策回放</h1>
        <p>ETH/USDT 现货策略 · Uniswap v3 五池 · Binance 现货与永续</p>
      </div>
      <div v-if="index" class="eth-sample">
        <b>{{ index.days.length }} 个交易日</b><small>{{ index.days[0] }} — {{ end }}</small>
      </div>
    </div>
    <section v-if="index" class="eth-clock">
      <div class="eth-controls">
        <label
          >回放日期
          <input type="date" :value="date" :min="index.days[0]" :max="end" @change="seek($event.target.value, minute)"
        /></label>
        <strong class="eth-time">{{ clock(minute) }} <small>UTC</small></strong>
        <div class="eth-buttons">
          <button :disabled="(date === index.days[0] && minute === 0) || !v" @click="next(-1)">−1 分</button>
          <button class="eth-play" :disabled="!v || (date === end && minute === 1439)" @click="playing = !playing">
            {{ playing ? '暂停' : '播放' }}
          </button>
          <button :disabled="(date === end && minute === 1439) || !v" @click="next(1)">+1 分</button>
          <select v-model.number="speed" aria-label="回放速度">
            <option v-for="s in [1, 4, 12, 30]" :key="s" :value="s">{{ s }} 分/秒</option>
          </select>
        </div>
      </div>
      <input
        aria-label="当日回放分钟"
        type="range"
        min="0"
        max="1439"
        step="1"
        :value="minute"
        @input="seek(date, +$event.target.value)"
      />
      <nav aria-label="回放定位">
        <span>定位</span> <button @click="seek(index.days[0], 0)">样本起点</button
        ><button @click="seek(date, 179)">02:59 观察窗结束</button>
        <button @click="seek(date, 195)">03:15 开仓判定</button><button @click="seek(end, 1439)">样本终点</button>
      </nav>
    </section>
    <p v-if="error" role="alert">{{ error }} <button @click="retry">重新读取</button></p>
    <p v-else-if="!v" role="status">正在读取回放月份…</p>
    <template v-else>
      <div class="eth-grid">
        <section class="eth-card eth-decision">
          <div class="eth-label">当时的决策</div>
          <h2>{{ v.state.title }}</h2>
          <p>{{ v.state.why }}</p>
          <ul v-if="v.checks.length" class="eth-checks">
            <li v-for="(c, i) in v.checks" :key="c.label">
              <span :class="c.pass ? 'yes' : 'no'">{{ c.pass ? '通过' : '未过' }}</span>
              {{ ['净空间覆盖成本', '五池同价净补为正', '现货与永续守住', '承接或三段持续净买'][i] }}
            </li>
          </ul>
          <dl v-if="v.account.position">
            <div>
              <dt>持仓目标 / 止损</dt>
              <dd>{{ n(v.account.position.target) }} / {{ n(v.account.position.stop) }}</dd>
            </div>
            <div>
              <dt>到期 UTC</dt>
              <dd>{{ new Date(v.account.position.expiry * 1000).toISOString().slice(0, 10) }} 00:00</dd>
            </div>
          </dl>
        </section>
        <section class="eth-card">
          <div class="eth-label">日线剩余净空间 · USDT / ETH</div>
          <h2>{{ sign(v.g) }}</h2>
          <p>
            {{
              v.target == null ? '当日公式未给出可交易目标。' : '按当时现货价买入、在冻结目标卖出，已扣双边费用与滑点。'
            }}
          </p>
          <dl>
            <div>
              <dt>成本锚 / 冻结下沿</dt>
              <dd>{{ n(v.signal.anchor) }} / {{ n(v.signal.low) }}</dd>
            </div>
            <div>
              <dt>目标 / 期限</dt>
              <dd>{{ n(v.target) }} / {{ v.signal.H ?? '—' }} 日</dd>
            </div>
            <div>
              <dt>03:15 判定净空间</dt>
              <dd>{{ sign(v.frozen) }}</dd>
            </div>
          </dl>
        </section>
        <section class="eth-card eth-profit">
          <div class="eth-label">累计已实现净收益 · USDT</div>
          <h2>{{ sign(v.account.net) }}</h2>
          <p>初始 10,000 USDT，每次买入 1 ETH。</p>
          <dl>
            <div>
              <dt>只做卖压承接基准</dt>
              <dd>{{ sign(v.account.base) }}</dd>
            </div>
            <div>
              <dt>组合相对基准</dt>
              <dd>{{ sign(v.account.net - v.account.base) }}</dd>
            </div>
            <div>
              <dt>持仓按现价平仓净浮盈</dt>
              <dd>{{ sign(v.mark) }}</dd>
            </div>
          </dl>
        </section>
      </div>
      <section class="eth-card eth-chain">
        <div class="eth-section-head">
          <div>
            <h2>五池同价深度与主动成交</h2>
            <p>固定美元锚下方 0.5% 价带，容量和交易者买卖均以 ETH 计。链上事件采用 16 分钟确认缓冲。</p>
          </div>
          <b v-if="l">{{ l.n }} / 179 分钟已确认</b>
        </div>
        <template v-if="l">
          <div class="eth-facts">
            <span
              >锚价 <b>{{ n(l.usd) }} USD</b></span
            ><span
              >总净补 <b>{{ sign(l.delta) }} ETH</b></span
            >
            <span
              >窗口累计至 <b>{{ clock(l.n) }} UTC</b>（不含）</span
            >
          </div>
          <div class="eth-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>交易池 · 费率</th>
                  <th>起始深度</th>
                  <th>已确认深度</th>
                  <th>净补深度</th>
                  <th>主动买入</th>
                  <th>主动卖出</th>
                  <th>净买</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in l.rows" :key="p.address">
                  <th :title="p.address">{{ p.name.split('-')[0] }} · {{ +p.name.split('-')[1] / 10000 }}%</th>
                  <td>{{ n(p.initial) }}</td>
                  <td>{{ n(p.depth) }}</td>
                  <td>{{ sign(p.delta) }}</td>
                  <td>{{ n(p.buy) }}</td>
                  <td>{{ n(p.sell) }}</td>
                  <td>{{ sign(p.buy - p.sell) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="eth-stages">
            <div v-for="(start, j) in [0, 60, 120]" :key="start">
              <small>{{ ['00:00–01:00', '01:00–02:00', '02:00–02:59'][j] }} 净买</small>
              <strong>{{ l.n <= start ? '—' : sign(l.sums[j]) }} <small>ETH</small></strong
              ><small>{{ l.n >= [60, 120, 179][j] ? '该段已确认' : l.n > start ? '该段累计中' : '等待该段' }}</small>
            </div>
          </div>
          <p>
            匹配卖单冲击（bp / ETH） · {{ l.impact ? l.impact.map((x) => n(x, 4)).join(' → ') : '—' }}
            <template v-if="l.counts"> · {{ l.matched }} 个匹配池，三段各 {{ l.counts.join(' / ') }} 笔交易</template>
          </p>
        </template>
        <p v-else class="eth-empty">
          {{
            v.signal.eligible ? '正在等待起始区块确认，尚无可见的链上深度。' : '日线未触发，归档未采集该日五池窗口。'
          }}
        </p>
      </section>
      <section class="eth-card">
        <div class="eth-section-head">
          <div>
            <h2>跨市场价格</h2>
            <p>Binance ETHUSDT · 最近最多 179 个时点 · 分钟收盘，00:00 使用当日开盘</p>
          </div>
          <b>基差 {{ sign(v.basis) }} bp</b>
        </div>
        <div class="eth-facts">
          <span class="eth-spot"
            >● 现货 <b>{{ n(v.spot) }}</b></span
          ><span class="eth-perp"
            >● 永续 <b>{{ n(v.perp) }}</b></span
          >
          <span
            >观察窗后半段涨跌 <b>{{ sign(v.markets[0]) }} / {{ sign(v.markets[1]) }} bp</b></span
          >
        </div>
        <MarketLines :series="v.series" />
      </section>
      <section class="eth-card">
        <h2>成交与费用</h2>
        <p>截至 {{ date }} {{ clock(minute) }} UTC。每边手续费 10 bp、滑点 2 bp。永续仅作为价格观测。</p>
        <div v-if="v.account.closed.length" class="eth-table-wrap">
          <table>
            <thead>
              <tr>
                <th>开仓 → 平仓（UTC）</th>
                <th>触发路径</th>
                <th>买 / 卖参考价</th>
                <th>毛利</th>
                <th>手续费</th>
                <th>滑点</th>
                <th>净损益</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in v.account.closed" :key="t.exit.time">
                <th>
                  {{ t.entry.time }} → {{ t.exit.time }}<small>{{ t.exit.reason }}</small>
                </th>
                <td>{{ t.entry.route }}</td>
                <td>{{ n(t.entry.price) }} / {{ n(t.exit.price) }}</td>
                <td>{{ sign(t.exit.gross) }}</td>
                <td>{{ n(t.exit.fee, 4) }}</td>
                <td>{{ n(t.exit.slip, 4) }}</td>
                <td>{{ sign(t.exit.net) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="eth-empty">截至此刻尚无已平仓交易。</p>
        <p v-if="v.account.position">
          在仓 · {{ v.account.position.time }} UTC · {{ v.account.position.route }} · 买入参考价
          {{ n(v.account.position.price) }}
        </p>
      </section>
      <details class="eth-card">
        <summary>查看冻结规则和数据口径</summary>
        <p>
          日线从 2021-07-01 预热，使用此前已收盘日线计算成本锚和下沿，再以当日开盘求目标与期限。判定净空间为目标 ×
          0.9998 × 0.999 减参考价 × 1.0002 × 1.001。
        </p>
        <p>
          03:15 统一检查净空间大于零、五池净补深度大于零、现货和永续 02:58 收盘均不低于
          01:28。在此基础上，全窗净卖且相近卖压下三段冲击严格递减（至少两池，每段至少五笔），或三个分段各自净买，产生买入许可。
        </p>
        <p>
          03:16
          下一分钟开盘买入。分钟收盘触及目标或对称止损（两倍入场参考价减目标），下一分钟开盘卖出；到期按预定开盘价退出。持仓期间不叠加。账本按原研究的现货成交时刻逐笔结算。
        </p>
        <p>
          五池为以太坊 Uniswap v3，Chainlink 汇率在窗口起点冻结，Swap 统计交易者方向，Mint / Burn
          重算固定价带容量。链上窗口仅在日线出现候选时采集。交易所归档缺失的分钟保留空缺。
        </p>
      </details>
    </template>
  </main>
</template>
