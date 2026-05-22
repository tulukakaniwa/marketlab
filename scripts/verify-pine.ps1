param(
  [string]$Path = ".\bl-esw-pinbar-market-lab.pine"
)

$ErrorActionPreference = "Stop"

$content = Get-Content -LiteralPath $Path -Raw
$lines = Get-Content -LiteralPath $Path
$errors = New-Object System.Collections.Generic.List[string]

if ($lines.Count -eq 0 -or $lines[0] -notmatch '^//@version=(5|6)$') {
  $errors.Add("First line must be Pine version declaration")
}

if ($content -notmatch 'shorttitle="([^"]{1,10})"') {
  $errors.Add("shorttitle must exist and be 10 chars or less")
}

foreach ($signal in @("Low Buy", "Wait Stop", "Deep Discount", "Trim", "No Chase")) {
  if ($content -notmatch [regex]::Escape($signal)) {
    $errors.Add("Missing chart signal: $signal")
  }
}

if ($content -notmatch 'cost_fast_anchor' -or $content -notmatch 'cost_slow_anchor') {
  $errors.Add("Missing adaptive three-layer cost anchor")
}

if ($content -notmatch 'lab_buy' -or $content -notmatch 'lab_sell' -or $content -notmatch 'lab_wait_stop' -or $content -notmatch 'lab_deep_discount' -or $content -notmatch 'lab_overheat') {
  $errors.Add("Missing core market lab signal variables (lab_buy / lab_sell / lab_wait_stop / lab_deep_discount / lab_overheat)")
}

$assignments = [regex]::Matches($content, '(?m)^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=')
$names = @{}
foreach ($match in $assignments) {
  $name = $match.Groups[1].Value
  if (-not $names.ContainsKey($name)) {
    $names[$name] = 0
  }
  $names[$name] += 1
}

$dupes = $names.GetEnumerator() | Where-Object { $_.Value -gt 1 } | Select-Object -ExpandProperty Key
if ($dupes) {
  $errors.Add("Duplicate variable definitions: $($dupes -join ', ')")
}

if ($content -match '(?m)^\s*p_high\s*=') {
  $errors.Add("Do not use p_high because it can collide with plot handles")
}

if ($content -notmatch 'auto_adapt\s*=\s*input\.bool\(false,') {
  $errors.Add("auto_adapt must default to false to align with JS")
}
if ($content -notmatch 'adaptive_cost\s*=\s*input\.bool\(false,') {
  $errors.Add("adaptive_cost must default to false to align with JS")
}
if ($content -notmatch 'relax_mode\s*=\s*input\.bool\(false,') {
  $errors.Add("relax_mode must default to false to align with JS")
}

$stdevMatches = [regex]::Matches($content, 'ta\.stdev\(([^)]*)\)')
foreach ($m in $stdevMatches) {
  $stdevArgs = $m.Groups[1].Value -split ',' | ForEach-Object { $_.Trim() }
  if ($stdevArgs.Count -lt 3 -or $stdevArgs[2] -ne 'false') {
    $errors.Add("ta.stdev must pass biased=false third arg: ta.stdev($($m.Groups[1].Value))")
  }
}

if ($content -match 'ta\.atr\(') {
  $errors.Add("Do not call ta.atr directly; use simple-mean ATR via ta.sma(true_range, 14)")
}

foreach ($v in @('lp_lower', 'lp_upper', 'position_label', 'match_pct')) {
  if ($content -notmatch "(?m)(^|\s)$v\s*=") {
    $errors.Add("Missing alignment variable: $v")
  }
}

if ($errors.Count -gt 0) {
  $errors | ForEach-Object { Write-Error $_ }
  exit 1
}

Write-Output "Pine static checks passed"
