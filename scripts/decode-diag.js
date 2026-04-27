// 진단 캐시 파일 복호화 (gzip + base64)
// 사용법: node scripts/decode-diag.js <path-to-.cache>
// 결과: 콘솔에 진단 정보 출력 + 같은 폴더에 PNG 저장

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('사용법: node scripts/decode-diag.js <path>');
  process.exit(1);
}

const encoded = fs.readFileSync(inputPath, 'utf8');
const json = zlib.gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8');
const data = JSON.parse(json);

console.log('=== 진단 정보 ===');
console.log('label:', data.label);
console.log('ts:', data.ts);
console.log('url:', data.info && data.info.url);
console.log('title:', data.info && data.info.title);
console.log('--- 본문 텍스트 (첫 2000자) ---');
console.log(data.info && data.info.bodyText);

if (data.screenshot) {
  const outPng = inputPath.replace(/\.cache$/, '.png');
  fs.writeFileSync(outPng, Buffer.from(data.screenshot, 'base64'));
  console.log(`\n스크린샷 저장: ${outPng}`);
}

const outJson = inputPath.replace(/\.cache$/, '.json');
const { screenshot, ...rest } = data;
fs.writeFileSync(outJson, JSON.stringify(rest, null, 2), 'utf8');
console.log(`전체 JSON 저장: ${outJson}`);
