import { VelaWorkspace } from '@luxalgo/vela/workspace'
import { toVelaBars } from '../velaResearchAdapter.js'

// Only the renderer is headless: chart execution, native handles and history are real Vela.
class HeadlessRenderer {
  constructor(options) {
    this.options = options
    this.features = [
      'attribution',
      'dialogHost',
      'indicatorTitles',
      'indicatorValues',
      'timezone',
      'priceStyle',
      'autoScale',
      'settingsSections',
      'sessionZones',
    ]
    this.capabilities = { paneManagement: true }
    this.config = { candles: { upColor: '#0e7558', downColor: '#a93226' }, priceStyle: 'candles' }
    return new Proxy(this, {
      get: (target, key) =>
        key in target ? target[key] : typeof key === 'string' && key.startsWith('on') ? () => () => {} : () => {},
    })
  }
  supports() {
    return false
  }
  getConfig() {
    return this.config
  }
  get(key) {
    return this.config[key]
  }
  set(key, value) {
    this.config[key] = value
  }
  addIndicator(model) {
    return { id: model.id }
  }
  getVisibleRange() {
    return null
  }
  getSettingsSchema() {
    return []
  }
}

export async function createHeadlessWorkspace(element, rows) {
  const workspace = new VelaWorkspace(element, {
    renderer: HeadlessRenderer,
    layout: false,
    persist: false,
    topbar: false,
    bottombar: false,
    statusline: false,
    watermark: false,
    drawings: false,
    drawingToolbar: false,
    volume: false,
    live: false,
    symbol: 'LOCAL',
    timeframe: '1D',
    data: toVelaBars(rows),
  })
  await workspace.active.chart.ready()
  return workspace
}
