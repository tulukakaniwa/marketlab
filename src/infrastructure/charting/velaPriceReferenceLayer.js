import { paintPriceReferenceMap } from './priceReferencePainter.js'
import { paintImpactReferenceMap } from './impactReferencePainter.js'
import { toVelaTime } from './velaResearchAdapter.js'

/** Channel payloads belong to one chart; a globally mounted layer with no payload stays empty. */
export function createVelaPriceReferenceLayer({ id, isDestroyed, onPaint }) {
  return {
    id,
    placement: 'above-data',
    create() {
      let canvas = null
      return {
        mount(value) {
          canvas = value
        },
        render({ data, coords, bounds, scale, theme }) {
          const ctx = canvas?.getContext('2d')
          if (!ctx) return
          ctx.setTransform(1, 0, 0, 1, 0, 0)
          ctx.clearRect(0, 0, canvas.width, canvas.height)
          if (isDestroyed() || !data) return
          if (coords && bounds) {
            const dpr = coords.dpr || 1
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
            paintPriceReferenceMap(ctx, {
              path: data.referenceMap?.path ?? [],
              costPath: data.costPath ?? [],
              enabled: data.enabled,
              dark: isDarkBackground(theme?.background),
              projectX: (date) => coords.timeToX(toVelaTime(date)),
              projectY: (price) => coords.priceToY(price, scale, bounds),
              bounds: { left: 0, top: bounds.top, width: coords.width, height: bounds.height },
              barSpacing: coords.pxPerBar(),
            })
            paintImpactReferenceMap(ctx, {
              snapshot: data.impactMap,
              enabled: data.impactEnabled,
              dark: isDarkBackground(theme?.background),
              projectX: (date) => coords.timeToX(toVelaTime(date)),
              projectY: (price) => coords.priceToY(price, scale, bounds),
              bounds: { left: 0, top: bounds.top, width: coords.width, height: bounds.height },
              barSpacing: coords.pxPerBar(),
            })
          }
          onPaint()
        },
        destroy() {
          canvas = null
        },
      }
    },
  }
}

function isDarkBackground(color = '#ffffff') {
  const hex = color.match(/^#([\da-f]{6}|[\da-f]{3})$/i)?.[1]
  const rgb = hex
    ? (hex.length === 3 ? [...hex].map((value) => value + value).join('') : hex)
        .match(/.{2}/g)
        .map((value) => parseInt(value, 16))
    : color
        .match(/[\d.]+/g)
        ?.slice(0, 3)
        .map(Number)
  return rgb?.length === 3 && rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 < 128
}
