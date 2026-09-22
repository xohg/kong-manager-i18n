<#
.SYNOPSIS
  Kong Manager OSS 中文国际化 —— 一键注入 / 重新注入

.DESCRIPTION
  把 i18n-zh.js 注入到运行中的 Kong 容器, 并在 index.html 的 <head> 里
  插入一行 <script> 引用(插在应用主包之前)。

  设计要点:
  - index.html 的补丁是【从容器当前文件现场生成】的, 不硬编码 bundle hash。
    因此 Kong 镜像升级(如 index-a9568421.js 变成别的 hash)后重跑本脚本即可,
    index.patched.html 会跟着刷新, compose 挂载继续有效。
  - 幂等: 已注入过就跳过, 重复执行安全。

  为什么不能用 kconfig.js:
    /kconfig.js 被 Kong nginx 的精确匹配 location 占用, 由 Lua
    (Kong.admin_gui_kconfig_content) 动态生成, 且 generate_kconfig 只枚举
    kong.conf 的 6 个变量、无自定义注入口。往 gui 目录放静态 kconfig.js
    永远不会被读取。故只能在 index.html 上做这一行插入。

.PARAMETER Container
  Kong 容器名, 默认 kong-wsdl-test

.PARAMETER Verify
  注入后做一次 HTTP 校验(默认开启)

.EXAMPLE
  .\apply-i18n.ps1
  .\apply-i18n.ps1 -Container kong-wsdl-test
#>
param(
  [string]$Container = "kong-wsdl-test",
  [switch]$Verify = $true
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$srcJs = Join-Path $here "i18n-zh.js"
$srcIdx = Join-Path $here "index.patched.html"
$bakIdx = Join-Path $here "index.orig.html"

if (-not (Test-Path $srcJs)) { throw "缺少 i18n-zh.js: $srcJs" }

# ---------- 0. 容器存活检查 ----------
$running = docker ps --filter "name=^/$Container$" --format "{{.Names}}"
if (-not $running) { throw "容器 $Container 未在运行。先: docker compose -f compose-kong.yml up -d" }
Write-Host "[0/5] 容器 $Container 运行中" -ForegroundColor Green

# ---------- 1. 备份原始 index.html(仅首次) ----------
if (-not (Test-Path $bakIdx)) {
  docker cp "${Container}:/usr/local/kong/gui/index.html" "$bakIdx" | Out-Null
  Write-Host "[1/5] 已备份原始 index.html -> index.orig.html" -ForegroundColor Green
} else {
  Write-Host "[1/5] 备份已存在, 跳过 (index.orig.html)" -ForegroundColor DarkGray
}

# ---------- 2. 从容器当前 index.html 现场生成补丁 ----------
$tmp = Join-Path $env:TEMP "km-index-current.html"
if (Test-Path $tmp) { Remove-Item $tmp -Force }
docker cp "${Container}:/usr/local/kong/gui/index.html" "$tmp" | Out-Null

$html = Get-Content $tmp -Raw -Encoding UTF8
if ($html -match 'i18n-zh\.js') {
  Write-Host "[2/5] index.html 已含注入行, 跳过改写" -ForegroundColor DarkGray
} else {
  # 插到第一个 <script type="module" 之前 —— 经典脚本会先于 module 执行
  $tag = '<script type="text/javascript" src="/__km_base__/i18n-zh.js?v=4"></script>'
  $m = [regex]::Match($html, '<script\s+type="module"')
  if (-not $m.Success) { throw "index.html 里找不到 <script type=`"module`"> 锚点, 无法注入" }
  $html = $html.Insert($m.Index, "$tag`r`n    ")
  [System.IO.File]::WriteAllText($tmp, $html, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "[2/5] 已生成补丁 index.html" -ForegroundColor Green
}

# 固化一份到仓库目录, 供 compose 只读挂载
Copy-Item $tmp $srcIdx -Force

# ---------- 3. 注入两个文件 ----------
docker cp "$srcJs"  "${Container}:/usr/local/kong/gui/i18n-zh.js"   | Out-Null
docker cp "$srcIdx" "${Container}:/usr/local/kong/gui/index.html"   | Out-Null
Write-Host "[3/5] 文件已注入 /usr/local/kong/gui/" -ForegroundColor Green

# ---------- 4. 容器内确认 ----------
$ls = docker exec $Container sh -c "ls -la /usr/local/kong/gui/i18n-zh.js /usr/local/kong/gui/index.html"
Write-Host "[4/5] 容器内文件:" -ForegroundColor Green
$ls | ForEach-Object { Write-Host "      $_" }

# ---------- 5. HTTP 校验 ----------
if ($Verify) {
  Start-Sleep -Milliseconds 500
  $code = curl.exe -s -o NUL -w "%{http_code}" "http://127.0.0.1:8002/i18n-zh.js?v=4"
  # 注意: 不要用 $home 作变量名, $HOME 是 PowerShell 只读自动变量, 赋值会抛异常
  $homeHtml = curl.exe -s "http://127.0.0.1:8002/"
  $hasTag = if ($homeHtml -match 'i18n-zh\.js') { "YES" } else { "NO" }
  Write-Host "[5/5] /i18n-zh.js -> HTTP $code ; 首页含注入标签: $hasTag" -ForegroundColor Green
  if ($code -ne "200" -or $hasTag -ne "YES") {
    Write-Warning "校验未通过, 请检查容器端口映射(127.0.0.1:8002->8002)"
  }
}

Write-Host ""
Write-Host "完成。打开 http://127.0.0.1:8002/ , 右上角导航栏内即为中/英切换按钮。" -ForegroundColor Cyan
Write-Host "提示: 浏览器若缓存旧版, 用 Ctrl+F5 强制刷新。" -ForegroundColor DarkGray
