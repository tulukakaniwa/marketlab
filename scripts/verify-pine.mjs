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

// 信号体系按 JS buildEntryTiming 同步：5 类核心信号
for (const signal of ['Low Buy', 'Wait Stop', 'Deep Discount', 'Trim', 'No Chase']) {
  if (!content.includes(signal)) errors.push(`Missing chart signal: ${signal}`)
}

// 成本锚保留三档候选，adaptive_cost 决定是否混合
if (!content.includes('cost_fast_anchor') || !content.includes('cost_slow_anchor')) {
  errors.push('Missing adaptive three-layer cost anchor')
}

// 同步 JS 后核心信号变量
if (!content.includes('lab_buy') || !content.includes('lab_sell') || !content.includes('lab_wait_stop') || !content.includes('lab_deep_discount') || !content.includes('lab_overheat')) {
  errors.push('Missing core market lab signal variables (lab_buy / lab_sell / lab_wait_stop / lab_deep_discount / lab_overheat)')
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
