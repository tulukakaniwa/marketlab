export const number = (value, digits = 2) =>
  Number.isFinite(value)
    ? new Intl.NumberFormat('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value)
    : '—'
export const signed = (value, digits = 2) =>
  Number.isFinite(value) ? `${value > 0 ? '+' : ''}${number(value, digits)}` : '—'
export const compactRaw = (value) => {
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) return '—'
  const negative = value.startsWith('-')
  const digits = negative ? value.slice(1) : value
  if (digits.length <= 6) return `${negative ? '−' : ''}${digits}`
  return `${negative ? '−' : ''}${digits[0]}.${digits.slice(1, 4)}e${digits.length - 1}`
}
export const timestamp = (value) => {
  if (value === null || value === undefined || value === '') return '—'
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString().replace('T', ' ').replace('.000Z', ' UTC') : '—'
}
export const quoteStatus = (value) =>
  ({ complete: '完整成交', partial: '覆盖内部分成交', invalid: '不可报价' })[value] ?? '—'
