import { formulaCoreStages } from './registryCoreStages.js'
import { formulaFusionStages } from './registryFusionStages.js'

export const formulaStages = [...formulaCoreStages, ...formulaFusionStages]

export const formulaEdges = formulaStages.flatMap((stage) =>
  stage.feeds.map((target) => ({ source: stage.id, target })),
)

export const formulaCapabilities = [
  {
    id: 'market-path',
    label: '市场路径引擎',
    role: '把 K 线统一成成本、波动和公式路径',
    stages: ['path', 'cost', 'volatility'],
    action: '回答现在离市场成本有多远，波动是否允许挂单。',
  },
  {
    id: 'move-derivative',
    label: '波动定价引擎',
    role: '把任意入场价和方向/结构目标绑定的公式周期翻成价格带；期权敏感度另用独立到期期限',
    stages: ['delta-band', 'option-greeks', 'asian-option'],
    action: '回答应该给价格留多宽、风险曲率来自哪里。',
  },
  {
    id: 'liquidity-amm',
    label: '流动性库存引擎',
    role: '把 LP、AMM 不变量和流动性分布放到同一套库存语言里',
    stages: [
      'lp-inventory',
      'lp-research-range',
      'liquidity-fingerprint',
      'lp-pool-coverage',
      'amm-geometry',
      'capital-efficiency',
    ],
    action: '回答已声明 LP 情景或完整真实仓位的库存、区间效率和再平衡压力。',
  },
  {
    id: 'portfolio-execution',
    label: '组合执行引擎',
    role: '模拟挂单只接成本带、GetDelta 和账户输入；LP/期权/永续仍是研究视图',
    stages: ['funding', 'portfolio', 'order-plan'],
    action: '回答模拟挂单刻度、持仓窗口和失效线；组合研究不参与模拟挂单。',
  },
  {
    id: 'formula-fusion',
    label: '公式融合',
    role: '将两个以上基础公式融合成研究视图，未进入模拟挂单',
    stages: ['deviation-score', 'risk-surface', 'net-lp-efficiency', 'net-carry'],
    action: '回答偏离和风险曲面的观察，不输出默认策略结论。',
  },
  {
    id: 'second-order',
    label: '二阶分析',
    role: '速度 · 凸性 · 不确定性 · 同态复现：均值回归、凸性项、波动率区间与生存分布',
    stages: ['mean-reversion', 'dynamic-holding-state', 'gamma-pnl', 'vol-confidence', 'state-recurrence'],
    action: '展示 AR 样本速度、动态持仓状态、Gamma 情景值、波动样本区间与状态复现生存曲线。',
  },
]

export function getFormulaCapability(id) {
  return formulaCapabilities.find((item) => item.id === id) ?? formulaCapabilities[0]
}

export function getCapabilityStages(capabilityId) {
  const capability = getFormulaCapability(capabilityId)
  return capability.stages.map(getFormulaStage)
}

export function getFormulaStage(id) {
  return formulaStages.find((stage) => stage.id === id) ?? formulaStages[0]
}
