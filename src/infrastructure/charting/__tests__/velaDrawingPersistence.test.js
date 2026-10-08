import { describe, expect, it } from 'vitest'
import { DrawingStore } from '@luxalgo/vela'
import { mapDrawingPanes, migrateLegacyDrawings, readDrawingLibrary } from '../velaDrawingPersistence.js'

describe('legacy drawing migration into the real Vela store', () => {
  it('preserves ids, prices, dates/seconds and box geometry in the native serializer', () => {
    const time = Date.UTC(2026, 9, 8)
    const document = migrateLegacyDrawings(
      [
        { id: 'h', type: 'horizontal', price: 101 },
        { id: 't', type: 'trend', start: { time: time / 1000, price: 102 }, end: { time: '2026-10-09', price: 99 } },
        {
          id: 'b',
          type: 'range',
          start: { time: { year: 2026, month: 10, day: 8 }, price: 97 },
          end: { time: '2026-10-09', price: 103 },
        },
      ],
      time,
    )
    const store = new DrawingStore()
    store.load(document)
    expect(store.serialize().drawings.map(({ id, type, anchors, paneId }) => ({ id, type, anchors, paneId }))).toEqual([
      { id: 'h', type: 'hline', anchors: [{ time, price: 101 }], paneId: 'price' },
      {
        id: 't',
        type: 'trendline',
        anchors: [
          { time, price: 102 },
          { time: time + 86400000, price: 99 },
        ],
        paneId: 'price',
      },
      {
        id: 'b',
        type: 'box',
        anchors: [
          { time, price: 97 },
          { time: time + 86400000, price: 103 },
        ],
        paneId: 'price',
      },
    ])
  })
  it('filters corrupt legacy input rather than converting invalid times or prices', () => {
    expect(
      migrateLegacyDrawings(
        [
          { id: 'bad', type: 'horizontal', price: -1 },
          {
            id: 'bad-date',
            type: 'trend',
            start: { time: 'not-a-date', price: 1 },
            end: { time: '2026-10-08', price: 2 },
          },
        ],
        1,
      ).drawings,
    ).toEqual([])
    expect(readDrawingLibrary({ getItem: () => '{broken' }, 'key').byScope).toEqual({})
    expect(mapDrawingPanes({ drawings: [null, false, 'invalid'] }, (pane) => pane).drawings).toEqual([])
  })
  it('changes only pane identities while retaining native tool-specific state', () => {
    const document = {
      version: 1,
      drawings: [
        { id: 'f', type: 'fibretracement', paneId: 'generated-42', props: { levels: [0, 0.5, 1] }, anchors: [] },
      ],
    }
    expect(mapDrawingPanes(document, () => 'lab:greeks.delta').drawings[0]).toEqual({
      ...document.drawings[0],
      paneId: 'lab:greeks.delta',
    })
    expect(document.drawings[0].paneId).toBe('generated-42')
  })
})
