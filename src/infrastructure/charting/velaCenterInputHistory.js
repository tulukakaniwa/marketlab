const DATE_SCENARIOS = new Set(['supplyDemand', 'fundamental'])

/** Use the official unified history; replays address the current instance of this scoped type. */
export function createVelaCenterInputHistory({ getHistory, getRecord, getObservationDate, isLive }) {
  return ({ type, formula, previous, current }) => {
    const date = getObservationDate()
    const apply = (values) => {
      if (!isLive() || (DATE_SCENARIOS.has(formula) && date !== getObservationDate())) return
      getRecord(type)?.handle?.setInputs(values)
    }
    getHistory()?.push({ undo: () => apply({ ...previous }), redo: () => apply({ ...current }) })
  }
}
