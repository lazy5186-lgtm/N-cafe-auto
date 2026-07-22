# N Cafe Auto — 코드스왑 배포 스크립트 (로컬 빌드 모델: 빌드와 서버가 같은 PC)
#
#   1. 코드 수정
#   2. package.json + update-server/version.json 의 version 을 **같이** 올림
#   3. deploy.bat 더블클릭  ← 여기 (빌드 → 버전 점검 → 서버 재시작 → ping 확인)
#
# ★ 서버를 항상 재시작한다: 매니페스트는 요청 시점 계산이라 dist-src/·version.json 변경은 즉시
#   반영되지만, server.js 자신의 코드(INCLUDE 등)는 프로세스가 뜰 때 한 번 메모리에 올라간다.
#   몇 초 끊기는 대가로 "옛 server.js 가 메모리에 남는" 사고를 없앤다.

$ErrorActionPreference = 'Stop'

$PROJECT   = 'C:\Users\coala\OneDrive\Desktop\ASC\N_cafe_auto'
$TASK_NAME = 'NCafeAutoUpdateServer'
$PORT      = 9250
$PING_URL  = "http://127.0.0.1:$PORT/api/ping"

function Say($msg, $color = 'Gray') { Write-Host $msg -ForegroundColor $color }
function Head($msg) { Write-Host ''; Write-Host "-- $msg " -ForegroundColor Cyan -NoNewline; Write-Host ('-' * [Math]::Max(0, 60 - $msg.Length)) -ForegroundColor DarkGray }

Set-Location $PROJECT

Head '1. 빌드 (dist-src 재생성)'
npm run build
if ($LASTEXITCODE -ne 0) { Say '  X 빌드 실패' 'Red'; exit 1 }
Say '  OK dist-src/ 재생성 완료' 'Green'

Head '2. 버전 점검'
# ★ 이 구조에서 제일 흔한 실수: 서버는 version.json 과 앱이 보낸 버전을 비교만 한다.
#   버전을 안 올리면 에러 없이 사용자에게 영원히 "최신"으로 보인다.
$pkgVer = (Get-Content 'package.json' -Raw | ConvertFrom-Json).version
$srvVer = (Get-Content 'update-server\version.json' -Raw | ConvertFrom-Json).version
Say "  package.json          : $pkgVer"
Say "  update-server/version : $srvVer"
if ($pkgVer -ne $srvVer) {
  Say ''
  Say '  X 두 버전이 다릅니다. 둘 다 올려서 다시 빌드하세요.' 'Red'
  Say '    (앱은 자기 package.json 버전을 보내고, 서버는 version.json 과 비교합니다.)' 'Red'
  exit 1
} else {
  Say '  OK 일치' 'Green'
}

Head '3. 서버 재시작'
$task = Get-ScheduledTask -TaskName $TASK_NAME -ErrorAction SilentlyContinue
if ($task) {
  if ($task.State -eq 'Running') { Stop-ScheduledTask -TaskName $TASK_NAME; Start-Sleep -Seconds 2 }
  Start-ScheduledTask -TaskName $TASK_NAME
  Say '  작업 스케줄러로 재시작했습니다.'
} else {
  # 작업 스케줄러 미등록 — 떠 있는 node 서버를 종료하고 백그라운드로 새로 띄운다.
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like '*update-server*server.js*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 1
  Start-Process -FilePath 'node' -ArgumentList 'update-server\server.js' -WorkingDirectory $PROJECT -WindowStyle Hidden
  Say '  작업 "'$TASK_NAME'" 미등록 → node 서버를 백그라운드로 새로 띄웠습니다.' 'Yellow'
  Say '  (부팅 자동시작을 원하면 update-server\Windows-setup.md 참고)' 'Yellow'
}

# 뜰 때까지 기다린다 — 고정 sleep 은 느린 날에 실패로 오판한다.
$ping = $null
foreach ($i in 1..10) {
  Start-Sleep -Seconds 1
  try { $ping = Invoke-RestMethod -Uri $PING_URL -TimeoutSec 3; break } catch { }
}
if (-not $ping) {
  Say '  X 서버가 응답하지 않습니다.' 'Red'
  Say '    로그: C:\ProgramData\n-cafe-auto-update\server.log' 'Red'
  exit 1
}
Say "  OK 서버 응답 — 배포 중인 버전: $($ping.version)" 'Green'
if ($ping.version -ne $srvVer) {
  Say "  ! 서버가 알리는 버전($($ping.version))이 version.json($srvVer)과 다릅니다." 'Yellow'
}

Head '완료'
Say '  사용자는 앱 재시작 후 새 버전을 받아갑니다.' 'Green'
Write-Host ''
