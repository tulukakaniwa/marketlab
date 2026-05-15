import { describe, expect, it } from 'vitest'
import { formulaSourceAudit } from '../formulas/sourceAudit.js'

describe('formula source audit', () => {
  it('keeps blog/desmos research formulas out of the executable chain by default', () => {
    expect(formulaSourceAudit.length).toBeGreaterThanOrEqual(8)
    const executable = formulaSourceAudit.filter((entry) => entry.executable)
    expect(executable.map((entry) => entry.id)).toEqual(['delta-band'])

    const research = formulaSourceAudit.filter((entry) => !entry.executable)
    expect(research.every((entry) => ['research-only', 'protocol-unverified', 'implemented'].includes(entry.status))).toBe(true)
    expect(research.find((entry) => entry.id === 'portfolio')?.status).toBe('research-only')
    expect(research.find((entry) => entry.id === 'amm-geometry')?.status).toBe('protocol-unverified')
  })

  it('records source ids, IO, and boundaries for every migrated formula group', () => {
    for (const entry of formulaSourceAudit) {
      expect(entry.sources.length).toBeGreaterThan(0)
      expect(entry.inputs.length).toBeGreaterThan(0)
      expect(entry.outputs.length).toBeGreaterThan(0)
      expect(entry.boundary.length).toBeGreaterThan(10)
    }
  })
})
