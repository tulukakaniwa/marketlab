<script setup>
import { onMounted, ref, watch } from 'vue'
import { paintPriceReferenceMap } from '../infrastructure/charting/priceReferencePainter.js'
import { paintImpactReferenceMap } from '../infrastructure/charting/impactReferencePainter.js'

const props = defineProps({
  snapshot: { type: Object, default: null },
  impactSnapshot: { type: Object, default: null },
  viewport: { type: Object, required: true },
  costPath: { type: Array, default: () => [] },
  dark: { type: Boolean, default: false },
})
const canvas = ref(null)
function paint() {
  const element = canvas.value
  const ctx = element?.getContext('2d')
  if (!ctx) return
  const view = props.viewport
  element.width = Math.round(view.width * view.pixelRatio)
  element.height = Math.round(view.height * view.pixelRatio)
  ctx.setTransform(view.pixelRatio, 0, 0, view.pixelRatio, 0, 0)
  // Weekly/monthly HQ bars use their exact closing session snapshot. Keep
  // invalid daily points as gaps, even when they are not period endpoints.
  const path = (props.snapshot?.path ?? []).filter((point) => point.status !== 'ready' || view.hasDate(point.date))
  paintPriceReferenceMap(ctx, { ...view, path, costPath: props.costPath, dark: props.dark })
  // Non-endpoint sessions remain breaks: a weekly/monthly line must not bridge
  // a node that disappeared within its aggregated candle.
  const impactPath = (props.impactSnapshot?.path ?? []).map((point) =>
    view.hasDate(point.date) ? point : { ...point, status: 'unmapped-period', nodes: [] },
  )
  paintImpactReferenceMap(ctx, {
    ...view,
    snapshot: props.impactSnapshot ? { ...props.impactSnapshot, path: impactPath } : null,
    dark: props.dark,
  })
}
watch(() => [props.snapshot, props.impactSnapshot, props.viewport, props.costPath, props.dark], paint, {
  flush: 'post',
})
onMounted(paint)
</script>

<template>
  <canvas
    ref="canvas"
    class="price-reference-canvas"
    aria-hidden="true"
    :style="{ width: `${viewport.width}px`, height: `${viewport.height}px` }"
  />
</template>

<style scoped>
.price-reference-canvas {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  z-index: 2;
}
</style>
