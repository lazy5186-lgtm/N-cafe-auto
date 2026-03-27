const { exec } = require('child_process');
const os = require('os');
const ipChecker = require('./ip-checker');
const adbHelper = require('./adb-helper');
const { delay } = require('./browser-manager');
const store = require('../data/store');

function findInterfaceName() {
  const interfaces = os.networkInterfaces();
  const priorityPatterns = [
    /이더넷 2/i,
    /ethernet 2/i,
    /iphone usb/i,
    /이더넷/i,
    /ethernet/i,
    /wi-fi/i,
    /wifi/i,
  ];

  const names = Object.keys(interfaces);
  for (const pattern of priorityPatterns) {
    const match = names.find(n => pattern.test(n));
    if (match) return match;
  }

  for (const [name, addrs] of Object.entries(interfaces)) {
    const hasExternal = addrs.some(a => !a.internal && a.family === 'IPv4');
    if (hasExternal) return name;
  }

  return null;
}

function execCommand(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message));
      else resolve(stdout);
    });
  });
}

// === netsh 방식 ===
async function changeIPviaNetsh(interfaceName, logFn) {
  const log = logFn || (() => {});
  const iface = interfaceName || findInterfaceName();

  if (!iface) {
    throw new Error('네트워크 인터페이스를 찾을 수 없습니다.');
  }

  const oldIp = await ipChecker.getPublicIP();
  log(`현재 IP: ${oldIp || '확인 불가'}`);

  try {
    await execCommand('net session');
  } catch (e) {
    throw new Error('관리자 권한이 필요합니다. 앱을 관리자 권한으로 실행하세요.');
  }

  log(`인터페이스 "${iface}" 비활성화 중...`);
  try {
    await execCommand(`netsh interface set interface "${iface}" disabled`);
  } catch (e) {
    log(`비활성화 실패: ${e.message}`);
    try {
      await execCommand(`netsh interface set interface "${iface}" enabled`);
    } catch (_) { /* ignore */ }
    throw new Error(`인터페이스 비활성화 실패: ${e.message}. 관리자 권한으로 앱을 실행하세요.`);
  }

  log('3초 대기...');
  await delay(3000);

  log(`인터페이스 "${iface}" 활성화 중...`);
  try {
    await execCommand(`netsh interface set interface "${iface}" enabled`);
  } catch (e) {
    log(`활성화 실패, 3초 후 재시도...`);
    await delay(3000);
    try {
      await execCommand(`netsh interface set interface "${iface}" enabled`);
      log('재시도 활성화 성공');
    } catch (e2) {
      throw new Error(`인터페이스 활성화 실패: ${e2.message}. 수동으로 "${iface}"를 활성화하세요.`);
    }
  }

  log('11초 대기 (IP 할당 대기)...');
  await delay(11000);

  const newIp = await ipChecker.getPublicIP();
  log(`변경 전: ${oldIp || '?'} → 변경 후: ${newIp || '?'}`);

  if (oldIp && newIp && oldIp === newIp) {
    log('⚠ IP가 변경되지 않았습니다.');
  }

  return newIp;
}

// === ADB 방식 ===
async function changeIPviaADB(settings, logFn) {
  const log = logFn || (() => {});
  const deviceId = (settings.ipChange && settings.ipChange.adb && settings.ipChange.adb.deviceId) || null;
  const maxRetries = 3;

  let oldIp = null;
  try { oldIp = await ipChecker.getPublicIP(); } catch (_) {}

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    await adbHelper.toggleMobileData(deviceId, log);

    let newIp = null;
    for (let i = 0; i < 15; i++) {
      await delay(1000);
      try {
        newIp = await ipChecker.getPublicIP();
        if (newIp && newIp !== oldIp) {
          log(`변경 완료: ${newIp}`);
          return newIp;
        }
      } catch (e) {
        // 네트워크 아직 복구 안됨
      }
    }

    if (newIp && newIp === oldIp && attempt < maxRetries) {
      log(`IP 동일(${newIp}), 재시도 ${attempt}/${maxRetries}...`);
      continue;
    }

    if (newIp) {
      log(`변경 완료: ${newIp}`);
      return newIp;
    }

    log(`IP 확인 실패`);
    return newIp;
  }

  return null;
}

// === 디스패처 ===
async function changeIP(interfaceName, logFn) {
  const settings = store.loadSettings();
  const method = (settings.ipChange && settings.ipChange.method) || 'adb';

  if (method === 'adb') {
    return await changeIPviaADB(settings, logFn);
  } else {
    return await changeIPviaNetsh(interfaceName || (settings.ipChange && settings.ipChange.interfaceName), logFn);
  }
}

function checkInterface(interfaceName) {
  const interfaces = os.networkInterfaces();
  if (interfaceName && interfaces[interfaceName]) {
    const addrs = interfaces[interfaceName];
    const ipv4 = addrs.find(a => a.family === 'IPv4' && !a.internal);
    return {
      exists: true,
      name: interfaceName,
      ip: ipv4 ? ipv4.address : null,
    };
  }
  const detected = findInterfaceName();
  if (detected) {
    const addrs = interfaces[detected];
    const ipv4 = addrs.find(a => a.family === 'IPv4' && !a.internal);
    return {
      exists: true,
      name: detected,
      ip: ipv4 ? ipv4.address : null,
    };
  }
  return { exists: false, name: null, ip: null };
}

module.exports = { findInterfaceName, changeIP, checkInterface };
