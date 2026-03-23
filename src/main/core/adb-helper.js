const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { delay } = require('./browser-manager');

function getAdbPath() {
  // 프로덕션
  if (app && app.isPackaged) {
    const p = path.join(process.resourcesPath, 'adb', 'adb.exe');
    if (fs.existsSync(p)) return p;
  }
  // 개발
  const devPath = path.join(__dirname, '..', '..', '..', 'resources', 'adb', 'adb.exe');
  if (fs.existsSync(devPath)) return devPath;
  // 시스템 PATH
  return 'adb';
}

function execAdb(args, timeout) {
  timeout = timeout || 15000;
  const adbPath = getAdbPath();
  const cmd = `"${adbPath}" ${args}`;
  return new Promise((resolve, reject) => {
    exec(cmd, { encoding: 'utf8', timeout }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message));
      else resolve(stdout.trim());
    });
  });
}

async function isAdbAvailable() {
  try {
    await execAdb('version');
    return true;
  } catch (e) {
    return false;
  }
}

async function getConnectedDevices() {
  const output = await execAdb('devices');
  const lines = output.split('\n').slice(1); // skip "List of devices attached"
  const devices = [];
  for (const line of lines) {
    const parts = line.trim().split('\t');
    if (parts.length === 2) {
      devices.push({ serial: parts[0], status: parts[1] });
    }
  }
  return devices;
}

async function checkDeviceStatus(deviceId) {
  const available = await isAdbAvailable();
  if (!available) {
    throw new Error('ADB를 찾을 수 없습니다.');
  }

  const devices = await getConnectedDevices();
  if (devices.length === 0) {
    throw new Error('ADB 기기가 연결되지 않았습니다. USB 디버깅을 활성화하세요.');
  }

  let device;
  if (deviceId) {
    device = devices.find(d => d.serial === deviceId);
    if (!device) throw new Error(`기기 "${deviceId}"를 찾을 수 없습니다.`);
  } else {
    device = devices.find(d => d.status === 'device');
    if (!device) {
      const unauthorized = devices.find(d => d.status === 'unauthorized');
      if (unauthorized) throw new Error('USB 디버깅 권한을 허용하세요 (폰 화면 확인).');
      throw new Error('사용 가능한 ADB 기기가 없습니다.');
    }
  }

  if (device.status === 'unauthorized') {
    throw new Error('USB 디버깅 권한을 허용하세요 (폰 화면 확인).');
  }

  // 모델명 가져오기
  let model = '';
  try {
    const deviceArg = deviceId ? `-s ${deviceId}` : '';
    model = await execAdb(`${deviceArg} shell getprop ro.product.model`);
  } catch (e) { /* ignore */ }

  return { connected: true, serial: device.serial, status: device.status, model };
}

async function toggleMobileData(deviceId, logFn) {
  const log = logFn || (() => {});
  const deviceArg = deviceId ? `-s ${deviceId}` : '';

  log('모바일 데이터 OFF...');
  await execAdb(`${deviceArg} shell svc data disable`);

  await delay(500);

  log('모바일 데이터 ON...');
  await execAdb(`${deviceArg} shell svc data enable`);
}

module.exports = { getAdbPath, isAdbAvailable, getConnectedDevices, checkDeviceStatus, toggleMobileData };
