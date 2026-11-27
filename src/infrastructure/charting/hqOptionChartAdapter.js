import { createHqNetworkFilter, toHqSymbol } from './hqChartDataAdapter.js'
import { destroyHqChartSafely } from './hqChartLifecycle.js'
import {
  applyHqResearchSeriesStyle,
  buildHqResearchChartConfig,
  toHqResearchIndexResponse,
} from './hqChartResearchAdapter.js'

let hqChartModulePromise = null

export async function loadHqOptionRuntime() {
  if (!hqChartModulePromise) {
    hqChartModulePromise = import('hqchart')
      .then((module) => module.default ?? module)
      .catch((error) => {
        hqChartModulePromise = null
        throw error
      })
  }
  return hqChartModulePromise
}

/**
 * 期权专用 HQChart 适配器：仅服务期权研究面板（标的参考线 + Delta / Gamma / Theta 多轴副图），
 * 不挂载主图 K 线菜单、画线弹窗或通用技术指标目录。
 */
export async function createHqOptionChartAdapter({
  element,
  getRows,
  getSource,
  getOptionModel,
  dark = false,
  signal,
  loadRuntime = loadHqOptionRuntime,
} = {}) {
  assertNotAborted(signal)
  if (!element) throw new Error('HQ 期权图容器不存在')
  if (!element.clientWidth || !element.clientHeight) throw new Error('HQ 期权图容器尺寸为 0')

  const HQChart = await loadRuntime()
  assertNotAborted(signal)
  const ChartApi = HQChart?.Chart
  if (!ChartApi?.JSChart?.Init) throw new Error('HQChart JSChart API 不可用')
  applyHqTheme(ChartApi, dark)

  let destroyed = false
  let readyTimer = null
  let resolveReady
  let rejectReady
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  const abortReady = () => rejectReady?.(abortError())
  signal?.addEventListener('abort', abortReady, { once: true })

  const eventIds = ChartApi.JSCHART_EVENT_ID
  const initialModel = getOptionModel?.()
  const initialRows = getRows?.() ?? []
  const researchConfig = buildHqResearchChartConfig(initialModel, { windowOffset: 1 })
  const networkFilter = createHqNetworkFilter({
    getRows,
    getSource,
    getResearchResponse: (apiId) => toHqResearchIndexResponse(getOptionModel?.(), apiId, getSource?.() ?? {}),
  })

  const chart = ChartApi.JSChart.Init(element)
  element.JSChart = chart

  try {
    const result = chart.SetOption(
      buildHqOptionChartOption({
        source: getSource?.() ?? {},
        pageSize: initialRows.length,
        researchConfig,
        networkFilter,
        eventIds,
        onHistoryReady: () => resolveReady?.(),
        onReloadIndexResource: (data) => applyHqResearchSeriesStyle(data, getOptionModel?.()),
        onReloadOverlayResource: (data) => applyHqResearchSeriesStyle(data, getOptionModel?.()),
      }),
    )
    if (result === false) throw new Error('HQ 期权图配置被拒绝')
    readyTimer = setTimeout(() => rejectReady?.(new Error('HQ 期权图首帧超时')), 8000)
    await ready
    assertNotAborted(signal)
    clearTimeout(readyTimer)
    readyTimer = null
    chart.OnSize?.({ Type: 2 })
  } catch (error) {
    clearTimeout(readyTimer)
    destroyHqChartSafely(chart, element)
    throw error
  } finally {
    signal?.removeEventListener('abort', abortReady)
  }

  return {
    resize() {
      if (!destroyed) chart.OnSize?.({ Type: 2 })
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      clearTimeout(readyTimer)
      destroyHqChartSafely(chart, element)
    },
    raw: chart,
  }
}

export function buildHqOptionChartOption({
  source = {},
  pageSize = 120,
  researchConfig = {},
  networkFilter,
  eventIds,
  onHistoryReady,
  onReloadIndexResource,
  onReloadOverlayResource,
} = {}) {
  const callbacks = []
  if (eventIds?.RECV_HISTROY_DATA) {
    callbacks.push({ event: eventIds.RECV_HISTROY_DATA, callback: onHistoryReady })
  }
  if (eventIds?.ON_RELOAD_INDEX_CHART_RESOURCE) {
    callbacks.push({
      event: eventIds.ON_RELOAD_INDEX_CHART_RESOURCE,
      callback: (_, data) => onReloadIndexResource?.(data),
    })
  }
  if (eventIds?.ON_RELOAD_OVERLAY_INDEX_CHART_RESOURCE) {
    callbacks.push({
      event: eventIds.ON_RELOAD_OVERLAY_INDEX_CHART_RESOURCE,
      callback: (_, data) => onReloadOverlayResource?.(data),
    })
  }

  const count = Math.max(2, Number(pageSize) || 2)
  return {
    Type: '历史K线图',
    Symbol: toHqSymbol(source),
    Language: 'CN',
    Windows: [
      {
        Index: 'EMPTY',
        Modify: false,
        Change: false,
        Close: false,
        Overlay: false,
        MaxMin: false,
        TitleWindow: false,
        AddIndexWindow: false,
        IsShowIndexName: false,
        TitleHeight: 0,
      },
      ...(researchConfig.windows ?? []),
    ],
    Frame: [
      { Height: 2.2, SplitCount: 3, StringFormat: 0, YCoordinateType: 0 },
      ...(researchConfig.frames ?? []).map((frame) => ({ ...frame, YCoordinateType: 0 })),
    ],
    OverlayIndex: researchConfig.overlayIndex ?? [],
    Border: { Left: 4, Right: 54, Top: 8, Bottom: 20, AutoRight: { MinWidth: 54, Blank: 4 } },
    KLine: {
      Period: 0,
      Right: 0,
      DragMode: 1,
      ZoomType: 1,
      DrawType: 1,
      PageSize: count,
      PageSizeV2: count,
      MaxRequestDataCount: count,
      RightSpaceCount: 4,
      IsShowTooltip: false,
      IsShowMaxMinPrice: false,
      EnablePrediction: false,
    },
    KLineTitle: { IsShow: false },
    CorssCursorInfo: { IsShowCorss: true, IsShowCorssPoint: true, Right: 2, Bottom: 1 },
    IsAutoUpdate: false,
    EnableResize: false,
    IsShowRightMenu: false,
    NetworkFilter: networkFilter,
    EventCallback: callbacks,
    TooltipDialog: { Enable: false },
    ModifyIndexParamDialog: { Enable: false },
    SearchIndexDialog: { Enable: false },
  }
}

function applyHqTheme(ChartApi, dark) {
  const styleId = dark ? ChartApi.STYLE_TYPE_ID?.BLACK_ID : ChartApi.STYLE_TYPE_ID?.WHITE_ID
  if (styleId === undefined || !ChartApi.HQChartStyle?.GetStyleConfig) return
  const style = ChartApi.HQChartStyle.GetStyleConfig(styleId)
  ChartApi.JSChart.SetStyle?.(style)
  ChartApi.JSChart.SetCSSStyle?.(styleId)
}

function assertNotAborted(signal) {
  if (signal?.aborted) throw abortError()
}

function abortError() {
  return new DOMException('HQ 期权图初始化已取消', 'AbortError')
}
