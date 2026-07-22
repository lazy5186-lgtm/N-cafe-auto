# 코드스왑 업데이트 서버 — 내 PC 상시 가동 설정 (N Cafe Auto)

서버는 **내 PC** 에서 돈다. 고객(원격 사용자)은 공유기 **포트포워딩 + DDNS** 로 이 PC 에 접속한다.
빌드와 서버가 같은 PC 이므로 git 전송 없이 `npm run build` → 서버 재시작이면 끝난다.

> ⚠ **평문 HTTP 경고.** 이 업데이터는 받은 코드를 **그대로 실행**한다. 인터넷에 포트를 여는 순간,
> 그 포트로 위조 서버가 응답하면 임의 코드가 고객 PC 에서 돈다. 제대로 하려면 HTTPS + 코드서명이
> 필요하다. 최소한 (1) 포트를 꼭 필요한 만큼만 열고, (2) 나중에 코드스왑 단독 전환 시 도메인+HTTPS
> (Caddy/Cloudflare Tunnel 등)로 감싸는 걸 권장한다.

---

## 0. 배포 전 반드시 — 앱에 서버 주소 박기

`src/updater.js` 의 `DEFAULT_SERVER_URL` 이 고객 앱에 그대로 박혀 나간다. 기본값은 테스트용
`http://127.0.0.1:9250` 이다. **고객 배포 빌드를 만들기 전에 본인 DDNS 주소로 교체**한다:

```js
// src/updater.js
const DEFAULT_SERVER_URL = 'http://내DDNS주소:9250';   // 예: http://mycafe.iptime.org:9250
```

- 이 값은 `settings.json` 의 `updateServerUrl` 로 덮어쓸 수 있다(리빌드 없이 주소 변경). 다만
  고객은 보통 설정 파일을 안 건드리므로 **박아 넣는 값이 실제 주소여야 한다.**
- 포트(9250)는 `update-server/server.js` 와 반드시 일치.

## 1. 사전 준비
- Node.js 설치 (`C:\Program Files\nodejs\node.exe` — 경로 다르면 `run-server.bat` 수정)
- `npm run build` 로 `dist-src/` 가 있어야 서버가 서빙할 게 생긴다.

## 2. DDNS 설정 (IP 가 바뀌어도 고객이 찾게)
가정용 인터넷은 공인 IP 가 주기적으로 바뀐다. 하드코딩한 IP 는 바뀌면 배포된 앱이 전부 서버를
못 찾으므로 **DDNS 호스트명**을 쓴다.
- **공유기 내장 DDNS**: iptime → 고급설정 > 특수기능 > DDNS (예: `mycafe.iptime.org`)
- 또는 no-ip / duckdns 같은 무료 DDNS 클라이언트
- 정한 호스트명을 위 `DEFAULT_SERVER_URL` 에 넣는다.

## 3. 공유기 포트포워딩
공유기 관리페이지에서 **외부 포트 9250 → 이 PC 의 내부 IP:9250 (TCP)** 규칙을 추가한다.
- 이 PC 의 내부 IP 는 공유기에서 **DHCP 예약**으로 고정(재부팅해도 안 바뀌게).

## 4. 방화벽 (인바운드 9250 개방)
```powershell
New-NetFirewallRule -DisplayName 'NCafeAutoUpdateServer' -Direction Inbound -Protocol TCP -LocalPort 9250 -Action Allow
```

## 5. 서버 상시 가동 — 둘 중 하나

**(A) 간단 — 내 세션에서 실행** (내가 로그인해 있을 때만 돎)
- `update-server\run-server.bat` 을 시작프로그램에 넣거나, 그냥 더블클릭.

**(B) 권장 — 작업 스케줄러 (SYSTEM, 부팅 시 자동, 로그인 불필요)**
관리자 PowerShell:
```powershell
$action  = New-ScheduledTaskAction -Execute 'C:\Users\coala\OneDrive\Desktop\ASC\N_cafe_auto\update-server\run-server.bat'
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName 'NCafeAutoUpdateServer' -Action $action -Trigger $trigger -Principal $principal
Start-ScheduledTask -TaskName 'NCafeAutoUpdateServer'
```
`deploy.bat` 은 이 작업이 있으면 그걸 재시작하고, 없으면 node 서버를 백그라운드로 직접 띄운다.

## 6. 일상 배포
1. 코드 수정
2. `package.json` + `update-server/version.json` 의 `version` 을 **같이** 올린다
   (코드스왑 버전은 마지막 GitHub 릴리스 버전보다 **높아야** 앱이 적용한다)
3. `update-server\deploy.bat` 더블클릭 → 빌드 + 버전 점검 + 서버 재시작 + ping 확인

## 7. 상태 확인 · 로그 · 롤백
- 상태: 브라우저로 `http://127.0.0.1:9250/api/ping` (또는 DDNS 주소)
- 로그: `C:\ProgramData\n-cafe-auto-update\server.log` (OneDrive 밖 — 동기화 churn 방지)
- 롤백: `version.json` 을 이전 버전으로 되돌리고 서버 재시작. 개별 앱에서 문제가 나면 그 PC 의
  `%APPDATA%\n-cafe-auto\app\` 폴더를 지우면 내장(설치본) 코드로 되돌아간다.

## 주의
- 프로젝트가 OneDrive 안이면 "클라우드 전용화"될 때 SYSTEM 이 못 읽어 서버가 조용히 깨진다.
  폴더를 "이 장치에 항상 유지"로 고정(`attrib +P "<폴더>\*" /s /d` — 와일드카드 필수).
- **electron-updater 와 공존**: 한 버전은 GitHub(설치본) 아니면 코드스왑, **한 채널로만** 올린다.
  같은 버전 번호를 양쪽에 동시에 올리면 이중 업데이트로 꼬인다. 네이티브/바이너리(adb, Electron
  버전업 등)가 바뀌면 코드스왑이 아니라 GitHub 설치본 릴리스로 나가야 한다.
