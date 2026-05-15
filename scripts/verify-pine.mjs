#!/usr/bin/env node
import { readFileSync } from 'node:fs'

const file = process.argv[2] || 'bl-esw-pinbar-market-lab.pine'
const content = readFileSync(file, 'utf8')
const lines = content.split(/\r?\n/)
const errors = []

if (!/^\/\/@version=(5|6)$/.test(lines[0] || '')) {
  errors.push('First line must be Pine version declaration')
}

if (!/shorttitle="([^"]{1,10})"/.test(content)) {
  errors.push('shorttitle must exist and be 10 chars or less')
}

for (const signal of ['Try', 'Low Buy', 'Pull Buy', 'Reclaim', 'Wait', 'Deep', 'Trim', 'No Chase']) {
  if (!content.includes(signal)) errors.push(`Missing chart signal: ${signal}`)
}

if (!content.includes('cost_fast_anchor') || !content.includes('cost_slow_anchor')) {
  errors.push('Missing adaptive three-layer cost anchor')
}

if (!content.includes('lab_pull_buy') || !content.includes('lab_reclaim_buy')) {
  errors.push('Missing trend pullback/reclaim buy logic')
}

const names = new Map()
for (const match of content.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)) {
  names.set(match[1], (names.get(match[1]) || 0) + 1)
}
const duplicates = [...names].filter(([, count]) => count > 1).map(([name]) => name)
if (duplicates.length) errors.push(`Duplicate variable definitions: ${duplicates.join(', ')}`)

if (/^\s*p_high\s*=/m.test(content)) {
  errors.push('Do not use p_high because it can collide with plot handles')
}

if (errors.length) {
  for (const error of errors) console.error(error)
  process.exit(1)
}

console.log('Pine static checks passed')
