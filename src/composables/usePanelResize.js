import { computed, onBeforeUnmount } from 'vue'

export function usePanelResize(lab) {
  let dragging = null
  let pendingW = 0
  let rafId = null

  function onResizerMouseDown(side, event) {
    dragging = side
    event.preventDefault()
    document.addEventListener('mousemove', onResizerMouseMove)
    document.addEventListener('mouseup', onResizerMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  function onResizerMouseMove(event) {
    if (!dragging) return
    pendingW = dragging === 'left' ? event.clientX : window.innerWidth - event.clientX
    if (rafId) return
    rafId = requestAnimationFrame(flushW)
  }

  function flushW() {
    if (dragging === 'left') lab.setLeftPanelW(pendingW)
    if (dragging === 'right') lab.setRightPanelW(pendingW)
    rafId = null
  }

  function cleanupDrag() {
    dragging = null
    if (typeof document !== 'undefined') {
      document.removeEventListener('mousemove', onResizerMouseMove)
      document.removeEventListener('mouseup', onResizerMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  function onResizerMouseUp() {
    cleanupDrag()
  }

  function onResizerDblclick(side) {
    if (side === 'left') lab.resetLeftPanelW()
    else lab.resetRightPanelW()
  }

  onBeforeUnmount(cleanupDrag)

  const rootStyle = computed(() => ({
    '--left-w': `${lab.activeLeftTab === 'compute' ? Math.max(lab.leftPanelW, 360) : lab.leftPanelW}px`,
    '--right-w': `${lab.rightPanelW}px`,
  }))

  return {
    rootStyle,
    onResizerMouseDown,
    onResizerDblclick,
  }
}
