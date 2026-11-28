# Formal Mathematical Proofs of Market Lab Core Algorithms

本文档给出 Market Lab 核心公式、算子与概率诊断层的完整形式化数学证明。所有定理均与 `src/domain/` 纯函数实现及 `src/domain/__tests__/formalTheorems.test.js` 机器验证单测一一对应。

> [!IMPORTANT]
> 数学恒等式（`exact-identity`）的精确性不自动赋予市场未来预测力或真实交易执行权限。研究层算子统一携带 `executionAuthority: 'none'`，默认模拟挂单仅消费经门禁验证的结构查询输出。

---

## Theorem 1: 前缀因果算子不变性与内生 AR(1) 结构修复周期精确解

### 1.1 前缀截断算子与因果公理

设离散交易会话序列为 $X = (x_0, x_1, \dots, x_T)$，定义前缀截断算子 $\Pi_t(X) = (x_0, x_1, \dots, x_t)$（$0 \le t \le T$）。路径映射 $\Phi$ 满足**严格前缀因果不变性（Prefix Causality）**当且仅当：

$$\forall\, 0 \le t \le T, \qquad \big(\Phi(X)\big)_t = \big(\Phi(\Pi_t(X))\big)_t.$$

在 `cost.js`、`shortHoldHelpers.js`、`latentRecurrence.js` 与 `causalMarketModel.js` 中，任意时刻 $t$ 的窗口长度完全由前缀样本量 $N_t = t + 1$ 内生决定：

$$W_{\text{cost}}(N_t) = \max\!\big(5,\, \lfloor \sqrt{N_t} \rfloor\big), \qquad W_{\text{recent}}(N_t) = \max\!\big(3,\, \lfloor N_t^{1/3} \rfloor\big), \qquad k_{\text{NN}}(N_t) = \lceil \sqrt{N_t - 1} \rceil,$$

不依赖任何外部未来样本或硬编码日历常数，故天然满足 $\big(\Phi(X)\big)_t = \big(\Phi(\Pi_t(X))\big)_t$。

### 1.2 零冲击单调 AR(1) 部分修复周期闭式解

**命题 1.1（`deriveRecoveryHorizon` 精确恒等式）**：设信号时刻偏离量为 $D_0 = (P_{\text{anchor}} - P_{\text{start}})\cdot s > 0$（多头 $s = +1, P_{\text{start}} < P_{\text{target}} < P_{\text{anchor}}$；空头 $s = -1, P_{\text{start}} > P_{\text{target}} > P_{\text{anchor}}$）。记前向部分修复比例为：

$$q = \frac{(P_{\text{target}} - P_{\text{start}})\cdot s}{(P_{\text{anchor}} - P_{\text{start}})\cdot s} \in (0, 1).$$

若成本偏离序列服从过原点的单调均值回归 AR(1) 骨架 $x_{t+1} = \phi x_t$，其中 $\phi \in (0, 1)$，单步衰减率 $\lambda = -\ln\phi > 0$，半衰期 $\text{HL} = \frac{\ln 2}{\lambda} > 0$，则零冲击条件路径 $x_{t+H} = \phi^H x_t$ 达到目标修复比例 $1 - \frac{x_{t+H}}{x_t} = q$ 的唯一正有限周期为：

$$H(q, \text{HL}) = \text{HL} \cdot \log_2\!\left(\frac{1}{1 - q}\right).$$

**证明**：
由 $\phi = e^{-\lambda} = 2^{-1/\text{HL}}$ 及 $x_t \neq 0$，零冲击条件路径满足：

$$1 - \frac{x_{t+H}}{x_t} = 1 - \phi^H = 1 - 2^{-H / \text{HL}} = q \iff 2^{-H / \text{HL}} = 1 - q.$$

因 $q \in (0, 1) \iff 1 - q \in (0, 1)$，对两边取以 $2$ 为底的对数得：

$$-\frac{H}{\text{HL}} = \log_2(1 - q) \iff H = \text{HL} \cdot \log_2\!\left(\frac{1}{1 - q}\right) > 0.$$

由于 $q \mapsto \log_2\frac{1}{1-q}$ 在 $(0, 1)$ 上严格递增且值域为 $(0, +\infty)$，解唯一：

- 当 $q = \frac{1}{2}$ 时，$H = \text{HL}$；
- 当 $q = \frac{3}{4}$ 时，$H = 2\,\text{HL}$；
- 当 $q = \frac{7}{8}$ 时，$H = 3\,\text{HL}$。

若限价单在下一交易会话以更优价格 $P_{\text{fill}}$ 成交（多头 $P_{\text{fill}} \le P_{\text{start}} < P_{\text{target}} < P_{\text{anchor}}$），重绑定修复比例 $q(P_{\text{fill}}) = \frac{P_{\text{target}} - P_{\text{fill}}}{P_{\text{anchor}} - P_{\text{fill}}}$ 对 $P_{\text{fill}}$ 求导：

$$\frac{\partial q}{\partial P_{\text{fill}}} = -\frac{P_{\text{anchor}} - P_{\text{target}}}{(P_{\text{anchor}} - P_{\text{fill}})^2} < 0,$$

说明成交价越深，到达同一结构目标 $P_{\text{target}}$ 占总缺口的比例 $q(P_{\text{fill}})$ 严格增大，重绑定周期 $H(q(P_{\text{fill}}), \text{HL})$ 严格单调递增且始终有界。$\blacksquare$

---

## Theorem 2: `GetDelta` 集中流动性—永续期权同构、多空 $(1-d)$ 对偶、负凸性与精确逆双射

### 2.1 归一化集中流动性价值函数

对任意成本中心 $K > 0$ 与区间放大因子 $r > 1$，定义区间 $[P_a, P_b] = [K/r, Kr]$ 上的归一化 Uniswap v3 库存价值函数（对应 `getDeltaBandValue`）：

$$V(P; K, r) = \begin{cases} P, & 0 < P \le K/r, \\ \dfrac{2\sqrt{PKr} - P - K}{r - 1}, & K/r < P < Kr, \\ K, & P \ge Kr. \end{cases}$$

### 2.2 局部斜率定锚、无条件内点性与空头 $(1-d)$ 严格对偶

**命题 2.1（局部斜率 $C^1$ 连续与无条件内点性）**：

1. $V(\cdot; K, r) \in C^1((0, +\infty))$，且在区间内部 $P \in (K/r, Kr)$ 的一阶导数（局部有效 token0 暴露斜率）为：
   $$V'(P; K, r) = \frac{\sqrt{Kr / P} - 1}{r - 1} \in (0, 1).$$
2. 给定入场价 $P_0 > 0$、$r > 1$ 与目标局部斜率 $d \in [0, 1]$，方程 $V'(P_0; K_L, r) = d$ 有唯一正根：
   $$K_L(P_0, r, d) = P_0 \frac{\big(d(r - 1) + 1\big)^2}{r},$$
   且入场价无条件落在该多头区间内：$\dfrac{K_L}{r} \le P_0 \le K_L r$。

**证明**：
对 $P \in (K/r, Kr)$ 求导：

$$V'(P; K, r) = \frac{1}{r - 1}\left(\frac{\sqrt{Kr}}{\sqrt{P}} - 1\right) = \frac{\sqrt{Kr / P} - 1}{r - 1}.$$

左端点极限 $\lim_{P \downarrow K/r} V'(P) = \frac{r - 1}{r - 1} = 1$，右端点极限 $\lim_{P \uparrow Kr} V'(P) = \frac{1 - 1}{r - 1} = 0$，与分段线性区导数一致，故 $V \in C^1((0, +\infty))$。
令 $\frac{\sqrt{K_L r / P_0} - 1}{r - 1} = d$，整理得 $\sqrt{K_L r / P_0} = d(r - 1) + 1$。因 $r > 1, d \in [0, 1]$，右端 $\theta \triangleq d(r - 1) + 1 \in [1, r]$，平方得 $K_L = P_0 \theta^2 / r$。由 $1 \le \theta \le r$ 立得：

$$\frac{K_L}{r} = P_0 \frac{\theta^2}{r^2} \le P_0 \le P_0 \theta^2 = K_L r.$$

**命题 2.2（空头侧 $(1-d)$ 对偶对称恒等式）**：
`GetDelta` 空头成本中心定义为 $K_S(P_0, r, d) = P_0 \left(\frac{d}{r} - d + 1\right)^2 r$。则对一切 $r > 1, d \in [0, 1]$，成立精确代数恒等式：

$$K_S(P_0, r, d) \equiv K_L(P_0, r, 1 - d), \qquad V'(P_0; K_S, r) \equiv 1 - d,$$

从而叠加 $-1$ 单位现货空头对冲后的净头寸 $\Pi_{\text{short}}(P) = V(P; K_S, r) - P$ 在 $P_0$ 处具有**精确局部净斜率 $-d$**：

$$\Pi_{\text{short}}'(P_0) = V'(P_0; K_S, r) - 1 = (1 - d) - 1 = -d, \qquad \frac{K_S}{r} \le P_0 \le K_S r.$$

**证明**：
展开空头括号项并提取 $1/r$：

$$\frac{d}{r} - d + 1 = \frac{d - dr + r}{r} = \frac{(1 - d)r - (1 - d) + 1}{r} = \frac{(1 - d)(r - 1) + 1}{r}.$$

代入 $K_S$ 定义式：

$$K_S = P_0 \left(\frac{(1 - d)(r - 1) + 1}{r}\right)^2 r = P_0 \frac{\big((1 - d)(r - 1) + 1\big)^2}{r} = K_L(P_0, r, 1 - d).$$

因 $1 - d \in [0, 1]$，由命题 2.1 立得 $\frac{K_S}{r} \le P_0 \le K_S r$ 且 $V'(P_0; K_S, r) = 1 - d$，故 $\Pi_{\text{short}}'(P_0) = -d$。$\blacksquare$

### 2.3 永续负凸性（Concentrated-Liquidity Gamma）与逆双射定理

**命题 2.3（`getDeltaBandCurvature` 局部负凸性）**：
在活跃区间 $P \in (K/r, Kr)$ 内，$V(P; K, r)$ 二阶连续可微且严格凹：

$$\Gamma_{\text{LP}}(P) = V''(P; K, r) = -\frac{\sqrt{Kr}}{2(r - 1)P^{3/2}} < 0, \qquad \Gamma_{\text{dollar}}(P) = P^2 V''(P) = -\frac{\sqrt{PKr}}{2(r - 1)} < 0;$$

在区间外 $P \notin [K/r, Kr]$，$\Gamma_{\text{LP}}(P) = 0$。

**证明**：对 $V'(P) = \frac{\sqrt{Kr}}{r - 1} P^{-1/2} - \frac{1}{r - 1}$ 关于 $P$ 求导即得 $V''(P) = -\frac{\sqrt{Kr}}{2(r - 1)} P^{-3/2} < 0$。$\blacksquare$

**命题 2.4（`invertDeltaBand` 精确逆双射）**：
固定 $P_0 > 0$、周期会话数 $H > 0$、年交易会话基准 $N_{\text{tdpy}} > 0$ 与乘子 $z > 0$。定义时间尺度 $\tau_H = \sqrt{\frac{H}{2\pi N_{\text{tdpy}}}}$，开集定义域 $\mathcal{D} = \left(0, \frac{1}{\tau_H}\right) \times [0, 1]$，值域 $\mathcal{R} = \left\{(P_a, P_b) \in \mathbb{R}_+^2 : P_a \le P_0 \le P_b,\; \sqrt{P_b / P_a} > z\right\}$。则前向算子 $\mathcal{F}: (\sigma, d) \mapsto (P_a, P_b)$ 是从 $\mathcal{D}$ 到 $\mathcal{R}$ 的双射，其唯一闭式逆算子 $\mathcal{F}^{-1}(P_a, P_b)$ 为：

$$r_{\text{obs}} = \sqrt{\frac{P_b}{P_a}}, \quad K_{\text{imp}} = \sqrt{P_a P_b}, \quad \rho = \sqrt{\frac{r_{\text{obs}}}{z}}, \quad w = \frac{\rho - 1}{\rho + 1}, \quad \sigma_{\text{imp}} = \frac{w}{\tau_H}, \quad d_{\text{imp}} = \frac{\sqrt{P_b / P_0} - 1}{r_{\text{obs}} - 1}.$$

**证明**：
由前向定义 $P_a = K / r_{\text{obs}}, P_b = K r_{\text{obs}}$（其中 $r_{\text{obs}} = z\left(\frac{1 + w}{1 - w}\right)^2$, $w = \sigma \tau_H \in (0, 1)$）：

1. 相乘与相除立得 $P_a P_b = K^2 \implies K_{\text{imp}} = \sqrt{P_a P_b}$；$P_b / P_a = r_{\text{obs}}^2 \implies r_{\text{obs}} = \sqrt{P_b / P_a} > z$。
2. 令 $\rho = \sqrt{r_{\text{obs}} / z} > 1$，由 Möbius 变换 $\rho = \frac{1 + w}{1 - w}$ 反解得 $w = \frac{\rho - 1}{\rho + 1} \in (0, 1)$，双射唯一，故 $\sigma_{\text{imp}} = w / \tau_H \in (0, 1/\tau_H)$。
3. 由 $P_b = K_{\text{imp}} r_{\text{obs}} = P_0 \big(d(r_{\text{obs}} - 1) + 1\big)^2$ 开方得 $\sqrt{P_b / P_0} = d(r_{\text{obs}} - 1) + 1$，因 $P_0 \in [P_a, P_b]$ 且 $P_b / P_a = r_{\text{obs}}^2$，有 $1 \le \sqrt{P_b / P_0} \le r_{\text{obs}}$，故 $d_{\text{imp}} = \frac{\sqrt{P_b / P_0} - 1}{r_{\text{obs}} - 1} \in [0, 1]$ 唯一确定。$\blacksquare$

---

## Theorem 3: CK 端点比资本效率拐点定理（回文四次方程根式闭式解与有偏五次唯一性）

### 3.1 端点比资本效率与二阶导数五次多项式

对算术宽度 $x \in (0, 1)$ 与上下行非对称比例 $\alpha \ge 0$，设区间下沿 $P_a = P_0(1 - x)$，上沿 $P_b = P_0(1 + \alpha x)$。在区间几何中点 $\sqrt{P_a P_b}$ 评估的 Uniswap v3 相对全范围资本效率为：

$$\text{CE}(x; \alpha) = \frac{1}{1 - \left(\dfrac{1 - x}{1 + \alpha x}\right)^{1/4}}.$$

令变换变量 $u(x) = \left(\frac{1 - x}{1 + \alpha x}\right)^{1/4} \in (0, 1)$，则 $u^4 = \frac{1 - x}{1 + \alpha x} \iff x = \frac{1 - u^4}{1 + \alpha u^4}$，且 $\text{CE} = \frac{1}{1 - u}$。

**命题 3.1（二阶导数因子分解与 $\forall \alpha \ge 0$ 唯一拐点存在性）**：
对任意 $\alpha \ge 0$，$\text{CE}(x; \alpha)$ 关于 $x \in (0, 1)$ 的二阶导数为：

$$\frac{d^2\text{CE}}{dx^2} = \frac{(1 + \alpha u^4)^3}{16(1 + \alpha)^2 (1 - u)^3 u^7} \cdot P_\alpha(u), \qquad P_\alpha(u) \triangleq 3\alpha u^5 - 5\alpha u^4 - 5u + 3.$$

**证明**：
由 $\ln(u^4) = \ln(1 - x) - \ln(1 + \alpha x)$，两边对 $x$ 求导：

$$\frac{4 u'(x)}{u} = -\frac{1}{1 - x} - \frac{\alpha}{1 + \alpha x} = -\frac{1 + \alpha}{(1 - x)(1 + \alpha x)}.$$

代入恒等式 $1 - x = \frac{(1 + \alpha)u^4}{1 + \alpha u^4}$ 与 $1 + \alpha x = \frac{1 + \alpha}{1 + \alpha u^4}$，消去 $(1 + \alpha)$ 得：

$$u'(x) = -\frac{(1 + \alpha u^4)^2}{4(1 + \alpha) u^3} < 0.$$

于是 $\text{CE}(x) = (1 - u)^{-1}$ 的一阶导数为：

$$\frac{d\text{CE}}{dx} = (1 - u)^{-2} u'(x) = -\frac{(1 + \alpha u^4)^2}{4(1 + \alpha)(1 - u)^2 u^3} < 0.$$

令 $g(u) = (1 + \alpha u^4)^2 (1 - u)^{-2} u^{-3}$，取对数对 $u$ 求导：

$$\frac{g'(u)}{g(u)} = \frac{8\alpha u^3}{1 + \alpha u^4} + \frac{2}{1 - u} - \frac{3}{u} = \frac{8\alpha u^4(1 - u) + 2u(1 + \alpha u^4) - 3(1 - u)(1 + \alpha u^4)}{u(1 - u)(1 + \alpha u^4)}.$$

展开分子：

$$
\begin{aligned}
N(u) &= (8\alpha u^4 - 8\alpha u^5) + (2u + 2\alpha u^5) - (3 + 3\alpha u^4 - 3u - 3\alpha u^5) \\
&= -(3\alpha u^5 - 5\alpha u^4 - 5u + 3) = -P_\alpha(u).
\end{aligned}
$$

由链式法则 $\frac{d^2\text{CE}}{dx^2} = -\frac{1}{4(1 + \alpha)} g'(u) u'(x)$，代入 $-\frac{1}{4(1 + \alpha)} u'(x) = \frac{(1 + \alpha u^4)^2}{16(1 + \alpha)^2 u^3} > 0$，即得命题二阶导数精确分解式。
因前置因子在 $u \in (0, 1)$ 上严格为正，$\frac{d^2\text{CE}}{dx^2} = 0 \iff P_\alpha(u) = 0$。考察 $P_\alpha(u)$ 在 $[0, 1]$ 上的性质：

1. 端点异号：$P_\alpha(0) = 3 > 0$，$P_\alpha(1) = -2(1 + \alpha) < 0$。
2. 凹性与单调性：$P_\alpha''(u) = 60\alpha u^2(u - 1) \le 0$（$\forall u \in [0, 1], \alpha \ge 0$），结合 $P_\alpha'(0) = -5 < 0$ 知 $\forall u \in [0, 1]$ 有 $P_\alpha'(u) \le -5 < 0$。

因此 $P_\alpha(u)$ 在 $[0, 1]$ 上严格单调递减，在 $(0, 1)$ 内存在唯一拐点根 $u^*(\alpha)$：

- 当 $\alpha = 0$（单侧下沿变动）时：$P_0(u) = 3 - 5u = 0 \implies u^*(0) = \frac{3}{5}$，$x^*(0) = 1 - \left(\frac{3}{5}\right)^4 = \frac{544}{625} = 0.8704$，$\text{CE}^*(0) = \frac{5}{2} = 2.5$。$\blacksquare$

### 3.2 对称情形（$\alpha = 1$）的精确根式闭式解

**命题 3.2（CK 对称拐点根式解）**：当 $\alpha = 1$ 时，$P_1(u) = 3u^5 - 5u^4 - 5u + 3 = 0$ 在 $(0, 1)$ 内的唯一根与对应最优宽度 $x^*$ 具有初等根式闭式解：

$$u^*(1) = \frac{4 + \sqrt{10} - \sqrt{8\sqrt{10} - 10}}{6} \approx 0.5418305988017907, \qquad x^*(1) = \frac{\sqrt{5 + 2\sqrt{10}}}{4} \approx 0.8412991785660751.$$

**证明**：
注意到 $P_1(-1) = -3 - 5 + 5 + 3 = 0$，因式分解出 $(u + 1)$：

$$3u^5 - 5u^4 - 5u + 3 = (u + 1)\big(3u^4 - 8u^3 + 8u^2 - 8u + 3\big).$$

对 $u \in (0, 1)$，$u + 1 > 0$，四次因子为标准回文多项式。两边除以 $u^2 > 0$ 并令 $v = u + u^{-1} > 2$（故 $u^2 + u^{-2} = v^2 - 2$）：

$$3(u^2 + u^{-2}) - 8(u + u^{-1}) + 8 = 3(v^2 - 2) - 8v + 8 = 3v^2 - 8v + 2 = 0.$$

二次方程两根为 $v_\pm = \frac{4 \pm \sqrt{10}}{3}$。因 $u \in (0, 1) \implies v = u + u^{-1} > 2$，而 $\frac{4 - \sqrt{10}}{3} < 2 < \frac{4 + \sqrt{10}}{3}$，唯一合法解为 $v^* = \frac{4 + \sqrt{10}}{3}$。
再由 $u^2 - v^* u + 1 = 0$ 且 $u \in (0, 1)$ 取小根，因 $(v^*)^2 - 4 = \frac{26 + 8\sqrt{10} - 36}{9} = \frac{8\sqrt{10} - 10}{9} > 0$：

$$u^* = \frac{v^* - \sqrt{(v^*)^2 - 4}}{2} = \frac{4 + \sqrt{10} - \sqrt{8\sqrt{10} - 10}}{6}.$$

记 $w^* \triangleq (u^*)^{-2} + (u^*)^2 = (v^*)^2 - 2 = \frac{8(1 + \sqrt{10})}{9} > 2$，则 $\big((u^*)^{-2} - (u^*)^2\big)^2 = (w^*)^2 - 4 = \frac{380 + 128\sqrt{10}}{81}$。由 $x^* = \frac{1 - (u^*)^4}{1 + (u^*)^4} = \frac{(u^*)^{-2} - (u^*)^2}{(u^*)^{-2} + (u^*)^2} > 0$：

$$(x^*)^2 = \frac{(w^*)^2 - 4}{(w^*)^2} = \frac{380 + 128\sqrt{10}}{64(11 + 2\sqrt{10})} = \frac{95 + 32\sqrt{10}}{16(11 + 2\sqrt{10})}.$$

利用精确因式分解 $(11 + 2\sqrt{10})(5 + 2\sqrt{10}) = 55 + 32\sqrt{10} + 40 = 95 + 32\sqrt{10}$ 约去 $(11 + 2\sqrt{10})$：

$$(x^*)^2 = \frac{5 + 2\sqrt{10}}{16} \implies x^* = \frac{\sqrt{5 + 2\sqrt{10}}}{4} \approx 0.8412991785660751.$$

证毕！$\blacksquare$

---

## Theorem 4: Spot-Carry 风险中性 Bachelier 解析 Greeks 与平价恒等式

### 4.1 定价核与包络引理

设当前现价 $S > 0$，行权价 $K > 0$，无风险利率 $r \in \mathbb{R}$，分红/便利收益率 $q \in \mathbb{R}$，持有成本率 $b = r - q$，到期年化时间 $T = H_{\text{opt}} / N_{\text{tdpy}} > 0$，绝对正态波动率 $\sigma_N > 0$（单位：报价币/$\sqrt{\text{年}}$）。风险中性远期价与到期标准差定义为：

$$F = S e^{bT} = S e^{(r - q)T}, \qquad \sigma_T = \sigma_N \sqrt{T}, \qquad d = \frac{F - K}{\sigma_T}.$$

贴现看涨与看跌价格（`bachelierCarryOption`）为：

$$C = e^{-rT}\big[(F - K)\Phi(d) + \sigma_T \phi(d)\big], \qquad P = e^{-rT}\big[(K - F)\Phi(-d) + \sigma_T \phi(d)\big].$$

**引理 4.1（Bachelier 边界消去恒等式）**：对标准正态密度 $\phi(d) = \frac{1}{\sqrt{2\pi}}e^{-d^2/2}$，因 $\phi'(d) = -d\phi(d)$ 且 $F - K = d\sigma_T$，恒有：

$$(F - K)\phi(d) + \sigma_T \phi'(d) = d\sigma_T \phi(d) - d\sigma_T \phi(d) \equiv 0.$$

### 4.2 闭式 Greeks 与看涨—看跌平价定理

**命题 4.2（解析 Greeks 与 Put-Call Parity）**：
由引理 4.1，对任意参数微扰，$d$ 的内层导数项在未贴现核 $U_C = (F - K)\Phi(d) + \sigma_T\phi(d)$ 中恒消去（$\partial_d U_C = (F - K)\phi(d) + \sigma_T\phi'(d) = 0$），从而立即导出全部精确闭式 Greeks：

1. **Delta**：$\Delta_C = \frac{\partial C}{\partial S} = e^{-rT} \Phi(d) \frac{\partial F}{\partial S} = e^{-qT}\Phi(d)$，$\Delta_P = e^{-qT}(\Phi(d) - 1)$。
2. **Gamma**：$\Gamma_C = \Gamma_P = \frac{\partial \Delta}{\partial S} = e^{-qT}\phi(d)\frac{\partial d}{\partial S} = \frac{e^{(r - 2q)T}\phi(d)}{\sigma_N\sqrt{T}} > 0$。
3. **Normal Vega**：$\nu_N = \frac{\partial C}{\partial \sigma_N} = \frac{\partial P}{\partial \sigma_N} = e^{-rT}\phi(d)\frac{\partial \sigma_T}{\partial \sigma_N} = e^{-rT}\sqrt{T}\,\phi(d) > 0$。
4. **Annual Theta**（日历时间流逝率 $\Theta = -\frac{\partial V}{\partial T}$）：
   对 $V = e^{-rT} U$ 求关于 $T$ 的偏导：
   $$\frac{\partial C}{\partial T} = -r C + e^{-rT}\left(\Phi(d)\frac{\partial F}{\partial T} + \phi(d)\frac{\partial \sigma_T}{\partial T}\right) = -r C + b S e^{-qT}\Phi(d) + \frac{e^{-rT}\sigma_N\phi(d)}{2\sqrt{T}}.$$
   注意到 $S\Delta_C = S e^{-qT}\Phi(d)$（对看跌同样因 $-(K-F)' = F'$ 得 $b S e^{-qT}(\Phi(d)-1) = b S \Delta_P$），多空统一为：
   $$\Theta_{\text{annual}} = -\frac{\partial V}{\partial T} = r V - (r - q) S \Delta - \frac{e^{-rT}\sigma_N\phi(d)}{2\sqrt{T}}, \qquad \Theta_{\text{session}} = \frac{\Theta_{\text{annual}}}{N_{\text{tdpy}}}.$$
5. **Rho（每 1% 无风险利率变动）**：
   因 $\frac{\partial F}{\partial r} = T F$，有 $\frac{\partial V}{\partial r} = -T V + e^{-rT} \frac{\partial U}{\partial F} (T F) = -T V + T S \Delta$，故：
   $$\rho_{1\%} = \frac{1}{100}\frac{\partial V}{\partial r} = \frac{T(S\Delta - V)}{100}.$$
6. **精确平价恒等式**：利用 $\Phi(d) + \Phi(-d) = 1$，验证：
   $$C - P = e^{-rT}(F - K) = S e^{-qT} - K e^{-rT}, \quad \Delta_C - \Delta_P = e^{-qT}, \quad \Theta_C - \Theta_P = q S e^{-qT} - r K e^{-rT}, \quad \rho_C - \rho_P = \frac{T K e^{-rT}}{100}.$$

**注记（与零漂移鞅 Bachelier 的测度区分，对应 `ERRATA E-038`）**：原 `bachelierOption` 对远期直接取零漂移鞅 $F \equiv S$，此时 $C_0 - P_0 = e^{-rT}(S - K) \neq S e^{-qT} - K e^{-rT}$（除非 $r = q = 0$ 或 $r = q$ 且 $K$ 特殊），与现货持有成本测度不兼容，故 `bachelierOption` 保持 `Theta / Rho = null`，而将风险中性现货持有成本测度独立建模为 `bachelierCarryOption`（`model: 'bachelier-carry'`）。$\blacksquare$

---

## Theorem 5: Joseph 协方差正定保持、吸收有限体积概率质量守恒与 KM 对数双对数置信带

### 5.1 Joseph 形式卡尔曼更新对称正定性

在 `kalmanEquilibrium.js` 中，状态协方差采用 Joseph 稳定形式更新：

$$P_{t|t} = (I - K_t H) P_{t|t-1} (I - K_t H)^\top + K_t R K_t^\top.$$

**证明**：设先验 $P_{t|t-1} \succ 0$，观测噪声方差 $R > 0$。对任意非零向量 $v \in \mathbb{R}^d \setminus \{0\}$：

- 若 $(I - K_t H)^\top v \neq 0$，则由 $P_{t|t-1} \succ 0$ 有 $v^\top (I - K_t H) P_{t|t-1} (I - K_t H)^\top v > 0$，且第二项 $v^\top K_t R K_t^\top v = R \|K_t^\top v\|^2 \ge 0$，故 $v^\top P_{t|t} v > 0$；
- 若 $(I - K_t H)^\top v = 0$，则 $v = H^\top K_t^\top v \neq 0 \implies K_t^\top v \neq 0$，从而第二项 $R \|K_t^\top v\|^2 > 0$！

因此无论增益 $K_t$ 是否最优，对称矩阵 $P_{t|t}$ 恒严格正定（$P_{t|t} \succ 0$）。$\blacksquare$

### 5.2 马尔可夫切换吸收有限体积首达概率质量守恒

**命题 5.1（`solveFirstPassage` 精确概率守恒 $L_t + U_t + S_t \equiv 1$）**：
设对数价格吸收区间 $(\ell, u)$ 被划分为 $G$ 个互不相交单元 $C_j = [e_{j-1}, e_j)$（$e_0 = \ell < e_1 < \dots < e_G = u$）。对任意源对数价格 $x$ 与状态分量 $r \in \{1, \dots, R\}$（条件均值 $\mu_r(x)$，方差 $\sigma_r^2 > 0$），单元转移核定义为：

$$p_{r,\text{low}}(x) = \Phi\!\left(\frac{\ell - \mu_r(x)}{\sigma_r}\right), \quad p_{r,j}(x) = \Phi\!\left(\frac{e_j - \mu_r(x)}{\sigma_r}\right) - \Phi\!\left(\frac{e_{j-1} - \mu_r(x)}{\sigma_r}\right), \quad p_{r,\text{high}}(x) = 1 - \Phi\!\left(\frac{u - \mu_r(x)}{\sigma_r}\right).$$

若马尔可夫状态转移矩阵 $\Pi \in \mathbb{R}_+^{R \times R}$ 行随机（$\forall s, \sum_{r=1}^R \Pi_{s,r} = 1$）且初始状态权重满足 $\sum_{s=1}^R w_s = 1$，则对任意会话步 $t \ge 1$，累计下穿概率 $L_t$、累计上穿概率 $U_t$ 与内部存活质量 $S_t = \sum_{r=1}^R \sum_{j=1}^G m_t(r, j)$ 恒满足：

$$L_t + U_t + S_t = 1, \qquad L_t \ge L_{t-1} \ge 0, \qquad U_t \ge U_{t-1} \ge 0, \qquad S_t \ge 0.$$

**证明**：
首先对任意 $(r, x)$，伸缩求和立得单步核质量守恒：

$$p_{r,\text{low}}(x) + \sum_{j=1}^G p_{r,j}(x) + p_{r,\text{high}}(x) = \Phi(z_0) + \big(\Phi(z_G) - \Phi(z_0)\big) + \big(1 - \Phi(z_G)\big) = 1.$$

归纳法：

- $t = 1$：一步混合权重 $w_r^{(1)} = \sum_{s=1}^R w_s \Pi_{s,r} \ge 0$ 满足 $\sum_{r=1}^R w_r^{(1)} = \sum_{s=1}^R w_s \left(\sum_{r=1}^R \Pi_{s,r}\right) = 1$。故 $L_1 + U_1 + S_1 = \sum_{r=1}^R w_r^{(1)} \big(p_{r,\text{low}}(0) + p_{r,\text{high}}(0) + \sum_{j=1}^G p_{r,j}(0)\big) = \sum_{r=1}^R w_r^{(1)} \cdot 1 = 1$。
- 设第 $t-1$ 步成立 $L_{t-1} + U_{t-1} + S_{t-1} = 1$。第 $t$ 步从存活单元 $(s, i)$ 迁入目标状态 $r$ 的混合质量为 $\tilde{m}_t(r, i) = \sum_{s=1}^R m_{t-1}(s, i)\Pi_{s,r}$，对 $r$ 求和得 $\sum_{r=1}^R \tilde{m}_t(r, i) = \sum_{s=1}^R m_{t-1}(s, i)$，再对 $i$ 求和恰好等于 $S_{t-1}$！每个 $\tilde{m}_t(r, i)$ 经单位质量核分配至 $(\Delta L_t, \Delta U_t, m_t)$，故 $\Delta L_t + \Delta U_t + S_t = \sum_{r, i} \tilde{m}_t(r, i) \cdot 1 = S_{t-1}$。代入归纳假设：
  $$L_t + U_t + S_t = (L_{t-1} + \Delta L_t) + (U_{t-1} + \Delta U_t) + S_t = L_{t-1} + U_{t-1} + S_{t-1} = 1.$$
  证毕！$\blacksquare$

### 5.3 Kaplan–Meier 生存函数与对数双对数 Greenwood 区间有界性

在 `deriveStateRecurrence` 中，对有序离开再重返等待时间 $t_1 < t_2 < \dots < t_M$（在险数 $n_j$，完成重返事件数 $d_j$，$1 \le d_j \le n_j$），乘积极限估计 $\hat{S}(t_k) = \prod_{j=1}^k \left(1 - \frac{d_j}{n_j}\right) \in [0, 1]$。当 $0 < \hat{S}(t_k) < 1$ 时，令 Greenwood 累积和 $G_k = \sum_{j=1}^k \frac{d_j}{n_j(n_j - d_j)} > 0$，对变换 $\Lambda = \ln(-\ln \hat{S})$ 应用 Delta 方法得 $\text{SE}(\Lambda_k) = \frac{\sqrt{G_k}}{|\ln \hat{S}(t_k)|} > 0$。反变换回生存概率空间：

$$\hat{S}_{\text{low}}(t_k) = \hat{S}(t_k)^{\exp(z_{0.975}\,\text{SE}(\Lambda_k))}, \qquad \hat{S}_{\text{high}}(t_k) = \hat{S}(t_k)^{\exp(-z_{0.975}\,\text{SE}(\Lambda_k))}.$$

因底数 $\hat{S}(t_k) \in (0, 1)$ 且指数 $\exp(\pm z_{0.975}\,\text{SE}(\Lambda_k)) \in (0, +\infty)$，无需人工截断即恒有：

$$0 < \hat{S}_{\text{low}}(t_k) < \hat{S}(t_k) < \hat{S}_{\text{high}}(t_k) < 1.$$

$\blacksquare$

---

## Theorem 6: 挂单梯度 $\sqrt{P}$ 几何等 Tick 排布与条件首达分解

**命题 6.1（集中流动性等 Tick 几何排布与 AM-GM 不等式）**：
设梯队共 $m \ge 2$ 档，首档基准价 $P_{\text{start}} > 0$，尾档边界价 $P_{\text{end}} > 0$（$P_{\text{start}} \neq P_{\text{end}}$），分位权重 $\theta_k = \frac{k}{m - 1} \in [0, 1]$（$k = 0, \dots, m - 1$）。定义几何排布价（`evaluateOrderLadderDiagnostics`）：

$$P_{\text{geo}, k} = P_{\text{start}}^{1 - \theta_k} P_{\text{end}}^{\theta_k}.$$

1. **等对数/等 Tick 间距**：在 Uniswap v3 对数 Tick 坐标 $\iota(P) = \log_{1.0001}(P)$ 及平方根对数坐标 $\ln\sqrt{P}$ 下，相邻两档间距恒为常数：
   $$\ln P_{\text{geo}, k+1} - \ln P_{\text{geo}, k} = \frac{1}{m - 1}\ln\!\left(\frac{P_{\text{end}}}{P_{\text{start}}}\right), \qquad \frac{\sqrt{P_{\text{geo}, k+1}}}{\sqrt{P_{\text{geo}, k}}} = \left(\frac{P_{\text{end}}}{P_{\text{start}}}\right)^{\frac{1}{2(m-1)}}.$$
2. **严格算术—几何安全垫**：对三档梯队中档（$m = 3, \theta_1 = 1/2$），由严格均值不等式（$P_{\text{start}} \neq P_{\text{end}}$）：
   $$P_{\text{geo}, 1} = \sqrt{P_{\text{start}} P_{\text{end}}} < \frac{P_{\text{start}} + P_{\text{end}}}{2} = P_{\text{arith}, 1},$$
   且差值恒有精确平方表示：$P_{\text{arith}, 1} - P_{\text{geo}, 1} = \frac{1}{2}\big(\sqrt{P_{\text{start}}} - \sqrt{P_{\text{end}}}\big)^2 > 0$。
3. **首达成交互斥完备分解**：对深度买入挂单 $0 < L_k < S_0 < T_k$（或卖出挂单 $0 < T_k < S_0 < L_k$），定义首达停时 $\tau_{\text{fill}} = \inf\{t \ge 1 : S_t \text{ 触及 } L_k\}$，$\tau_{\text{target}} = \inf\{t \ge 1 : S_t \text{ 触及 } T_k\}$。因 $L_k \neq T_k$，单会话收盘价不能同时落在 $(-\infty, L_k]$ 与 $[T_k, +\infty)$，故在任意有限周期 $H \ge 1$ 上三事件两两互斥且完备：
   $$p_{\text{fillBeforeTarget}}(k) + p_{\text{targetBeforeFill}}(k) + p_{\text{neither}}(k) = 1.$$
   阶梯期望成交名义本金与条件触价加权入场均价由线性期望精确给出：
   $$\mathbb{E}[N_{\text{filled}}] = \sum_{k=0}^{m-1} N_k \, p_{\text{fillBeforeTarget}}(k), \qquad \bar{P}_{\text{prob}} = \frac{\sum_{k=0}^{m-1} N_k \, p_{\text{fillBeforeTarget}}(k)}{\sum_{k=0}^{m-1} (N_k / P_k)\, p_{\text{fillBeforeTarget}}(k)}.$$

$\blacksquare$
