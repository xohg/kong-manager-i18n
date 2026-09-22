# 从 Kong Manager OSS 3.6 打包产物中提取 UI 英文文案候选
# 用法: pwsh -File extract-strings.ps1
$dir = Join-Path $PSScriptRoot '..\.tmp-probe\km-gui\assets'
$out = Join-Path $PSScriptRoot '..\.tmp-probe\km-strings.txt'
$set = New-Object System.Collections.Generic.HashSet[string]

Get-ChildItem $dir -Filter *.js | ForEach-Object {
  $t = [IO.File]::ReadAllText($_.FullName)
  foreach ($m in [regex]::Matches($t, '"((?:[^"\\\r\n]|\\.)*)"')) {
    [void]$set.Add($m.Groups[1].Value)
  }
}

$candidates = $set | Where-Object {
  $s = $_
  if ($s.Length -lt 2 -or $s.Length -gt 90) { return $false }
  if ($s -match '[<>{}=\\/:]|\\n|\\u') { return $false }
  if ($s -match '^(?:[a-z0-9]+[A-Z][a-zA-Z0-9]*|[a-z]+_[a-z]+)$') { return $false }
  if ($s -cmatch '^[A-Z_0-9\-]+$') { return $false }
  if ($s -notmatch '[A-Za-z]') { return $false }
  if ($s -match '^(?:#|\.|@|data:|http|function|var |return |window\.|document\.|use[A-Z]|kong|__)') { return $false }
  ($s -match '^[A-Za-z].*\s.*[A-Za-z]') -or ($s -cmatch '^[A-Z][a-z]{2,}$')
} | Sort-Object -Unique

$candidates | Set-Content $out -Encoding utf8
"total candidates: $($candidates.Count) -> $out"
