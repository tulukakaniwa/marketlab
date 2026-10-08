import { describe, expect, it } from 'vitest'
import {
  velaCenterInputsSchema,
  velaCenterDefaultInputs,
  velaCenterInputValues,
  velaCenterInputChanges,
  velaCenterRejectedInputKeys,
} from '../velaCenterInputs.js'
import {
  STATISTICAL_CENTER_DEFAULTS,
  STATISTICAL_CENTER_LIMITS,
} from '../../../domain/market-model/statisticalCenter.js'
import { ECONOMIC_CENTER_DEFAULTS } from '../../../domain/market-model/economicCenters.js'

describe('native center input boundary', () => {
  it('exposes only real domain inputs and copies their declared defaults/bounds', () => {
    const statistical = velaCenterInputsSchema('statisticalCenter')
    expect(statistical.map(({ key, defval }) => [key, defval])).toEqual(Object.entries(STATISTICAL_CENTER_DEFAULTS))
    expect(
      statistical.every(
        ({ min, max }) =>
          min === STATISTICAL_CENTER_LIMITS.minimumObservations && max === STATISTICAL_CENTER_LIMITS.maximumLookback,
      ),
    ).toBe(true)
    expect(velaCenterInputsSchema('vwapCost')[0]).toMatchObject({
      defval: ECONOMIC_CENTER_DEFAULTS.lookback,
      max: ECONOMIC_CENTER_DEFAULTS.maximumLookback,
    })
    expect(velaCenterInputsSchema('cohortCost')).toEqual([])
    expect(velaCenterDefaultInputs('supplyDemand')).toEqual({ enabled: false, a: '', b: '', c: '', d: '' })
    expect(velaCenterDefaultInputs('fundamental')).toEqual({
      enabled: false,
      nextDividend: '',
      requiredReturn: '',
      growthRate: '',
    })
    expect(velaCenterInputsSchema('supplyDemand').map(({ type }) => type)).toEqual([
      'bool',
      'string',
      'string',
      'string',
      'string',
    ])
  })
  it('keeps explicit missing values blank and returns null commands rather than silently substituting defaults', () => {
    const values = velaCenterInputValues('statisticalCenter', {
      statisticalCenter: { lookback: null, minObservations: 30 },
    })
    expect(values).toEqual({ lookback: '', minObservations: 30 })
    expect(velaCenterInputChanges('statisticalCenter', values, { lookback: 120, minObservations: 30 })).toEqual([
      { formula: 'statisticalCenter', key: 'lookback', value: null },
    ])
    expect(velaCenterInputChanges('statisticalCenter', values, values)).toEqual([])
    expect(velaCenterInputValues('statisticalCenter', {})).toEqual(STATISTICAL_CENTER_DEFAULTS)
  })
  it('bridges real booleans and optional numeric text without inventing missing numbers', () => {
    const defaults = velaCenterDefaultInputs('supplyDemand')
    expect(velaCenterInputChanges('supplyDemand', { ...defaults, enabled: true, a: '20.5' }, defaults)).toEqual([
      { formula: 'supplyDemand', key: 'enabled', value: true },
      { formula: 'supplyDemand', key: 'a', value: 20.5 },
    ])
    expect(velaCenterInputChanges('supplyDemand', defaults, { ...defaults, enabled: true, a: 20.5 })).toEqual([
      { formula: 'supplyDemand', key: 'enabled', value: false },
      { formula: 'supplyDemand', key: 'a', value: null },
    ])
    expect(
      velaCenterInputChanges(
        'vwapCost',
        { lookback: '120', amountPerVolumeToPrice: '0.01' },
        {
          lookback: 120,
          amountPerVolumeToPrice: '',
        },
      ),
    ).toEqual([{ formula: 'vwapCost', key: 'amountPerVolumeToPrice', value: 0.01 }])
    expect(velaCenterRejectedInputKeys('supplyDemand', { ...defaults, enabled: 'false', a: 'oops' })).toEqual([
      'enabled',
      'a',
    ])
  })
})
