import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './styles/base.css'
import './styles/app-shell.css'
import './styles/chart.css'
import './styles/main-chart.css'
import './styles/chart-workspace.css'
import './styles/hq-chart-terminal.css'
import './styles/hq-chart-terminal-responsive.css'
import './styles/decision.css'
import './styles/replay.css'
import './styles/status.css'

const entry =
  new URLSearchParams(location.search).get('view') === 'eth-replay'
    ? import('./components/eth-replay/EthDecisionReplay.vue')
    : import('./App.vue')
entry.then(({ default: page }) => createApp(page).use(createPinia()).mount('#app'))
