<script setup>
defineProps({
  data: { type: Object, default: null },
  chart: { type: Object, default: null },
  pctFmt: { type: Function, required: true },
})

function sessionText(value) {
  return Number.isFinite(value) ? `${value % 1 === 0 ? value : value.toFixed(1)} 会话` : '—'
}
</script>

<template>
  <div class="ff-card">
    <template v-if="data?.status === 'ok'">
      <header class="ff-head">
        <span class="fc-ttl">同态复现生存</span>
        <strong class="green">中位 {{ sessionText(data.recurrencePeriodSessions) }}</strong>
        <em>k={{ data.neighbourCount }} · 仅研究</em>
      </header>

      <svg v-if="chart?.stepLine" :viewBox="`0 0 ${chart.W} ${chart.H}`" class="fc-svg">
        <line
          :x1="chart.PL"
          :x2="chart.W - chart.PR"
          :y1="chart.zeroY"
          :y2="chart.zeroY"
          stroke="var(--line)"
          stroke-width="1"
        />
        <line
          :x1="chart.PL"
          :x2="chart.W - chart.PR"
          :y1="chart.halfY"
          :y2="chart.halfY"
          stroke="var(--muted)"
          stroke-width="0.9"
          stroke-dasharray="4,3"
        />
        <polygon v-if="chart.bandPolygon" :points="chart.bandPolygon" fill="var(--blue-dim)" opacity="0.55" />
        <polyline :points="chart.stepLine" fill="none" stroke="var(--green)" stroke-width="2" />
        <circle v-if="chart.medianDot" :cx="chart.medianDot.x" :cy="chart.medianDot.y" r="4" fill="var(--amber)" />
        <text
          v-if="chart.medianDot"
          :x="chart.medianDot.x + 6"
          :y="chart.medianDot.y - 5"
          class="fc-tick"
          fill="var(--amber)"
        >
          S=50% @ {{ sessionText(data.recurrencePeriodSessions) }}
        </text>
        <text :x="chart.PL" :y="chart.zeroY + 14" class="fc-tick">0 会话</text>
        <text :x="chart.W - chart.PR" :y="chart.zeroY + 14" text-anchor="end" class="fc-tick">
          {{ chart.maxTime }} 会话
        </text>
        <text :x="chart.PL + 4" :y="chart.topY + 10" class="fc-tick">S(t)=100%</text>
      </svg>

      <div class="ff-metrics">
        <div>
          <b>中位重返</b><span>{{ sessionText(data.recurrencePeriodSessions) }}</span>
        </div>
        <div>
          <b>Q1 – Q3</b
          ><span>{{
            Number.isFinite(data.recurrencePeriodQ1Sessions)
              ? `${data.recurrencePeriodQ1Sessions.toFixed(1)}–${data.recurrencePeriodQ3Sessions.toFixed(1)}`
              : '—'
          }}</span>
        </div>
        <div>
          <b>完成周期</b><span>{{ data.completedEventCount }} 次</span>
        </div>
        <div>
          <b>当前驻留</b><span>{{ data.currentEpisodeAgeSessions }} 会话</span>
        </div>
      </div>

      <div class="ff-note">
        邻域半径 {{ pctFmt(data.recurrenceRadius) }}（经验分位 {{ pctFmt(data.empiricalRadiusRank) }}） · Kaplan–Meier
        乘积极限生存曲线与对数双对数 Greenwood 95% 区间，不进入默认挂单。
      </div>
    </template>
    <div v-else class="ff-empty">等待至少 1 个完整离开再重返样本周期</div>
  </div>
</template>
