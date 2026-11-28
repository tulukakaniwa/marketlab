import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles/base.css'
import './styles/workbench-cards.css'
import './styles/app-shell.css'
import './styles/chart.css'
import './styles/main-chart.css'
import './styles/chart-workspace.css'
import './styles/decision.css'
import './styles/replay.css'
import './styles/status.css'

createApp(App).use(createPinia()).mount('#app')
