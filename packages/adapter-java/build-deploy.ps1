# Alice Mod JE — 一键构建 + 部署到测试服务器
# 用法: .\build-deploy.ps1
# 运行 remapJar 构建模组 jar，自动复制到 serverjava/mods/
# 等效于: ./gradlew.bat build

Write-Host "=== Alice Mod JE Build & Deploy ===" -ForegroundColor Cyan
Write-Host ""

# 记录开始时间
$startTime = Get-Date

# 切换到项目目录
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $projectDir

try {
    # 执行 Gradle 构建 (remapJar + deployToServer)
    Write-Host "[1/2] Building..." -ForegroundColor Yellow
    $buildResult = .\gradlew.bat build 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "BUILD FAILED!" -ForegroundColor Red
        $buildResult | Write-Host
        exit 1
    }
    Write-Host "[1/2] Build OK" -ForegroundColor Green

    # 确认部署结果
    $jarPath = Join-Path $projectDir "build\libs\alice-mod-adapter.jar"
    $targetDir = "..\..\serverjava\mods"
    $targetPath = Join-Path $projectDir $targetDir "alice-mod-adapter.jar"

    if (Test-Path $targetPath) {
        $elapsed = [math]::Round(((Get-Date) - $startTime).TotalSeconds, 1)
        $size = (Get-Item $targetPath).Length / 1KB
        Write-Host "[2/2] Deployed: $targetPath" -ForegroundColor Green
        Write-Host "       Size: $([math]::Round($size, 1)) KB" -ForegroundColor Gray
        Write-Host "       Time: $elapsed s" -ForegroundColor Gray
        Write-Host ""
        Write-Host "=== Done ===" -ForegroundColor Cyan
    } else {
        Write-Host "WARNING: Deployed jar not found at target!" -ForegroundColor Yellow
    }
}
finally {
    Pop-Location
}
