// Ghi URL worker (production/staging) vào electron/worker-env.json TRƯỚC khi đóng gói app —
// chạy tự động từ các script "package:*" trong package.json, không cần sửa tay electron/main.js.
// Dùng: node scripts/set-worker-env.js production|staging

const fs = require('fs');
const path = require('path');

const URLS = {
  production: 'https://suno-pro-worker.vudungit92.workers.dev',
  staging: 'https://suno-pro-worker-staging.vudungit92.workers.dev',
};

const target = process.argv[2];
if (!URLS[target]) {
  console.error('Dùng: node scripts/set-worker-env.js production|staging');
  process.exit(1);
}

const filePath = path.join(__dirname, '..', 'electron', 'worker-env.json');
fs.writeFileSync(filePath, JSON.stringify({ workerApi: URLS[target] }, null, 2) + '\n');
console.log(`Đã ghi electron/worker-env.json → ${target} (${URLS[target]})`);
