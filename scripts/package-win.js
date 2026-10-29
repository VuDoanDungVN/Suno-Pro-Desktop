// Đóng gói bản Windows (win32/x64) từ máy Mac/Linux — KHÔNG cần Wine.
//
// electron-packager dùng `rcedit` để ghi icon/version/company vào file .exe,
// và rcedit cần Wine để chạy trên máy không phải Windows. Wine không bắt
// buộc phải có NẾU không có gì để rcedit ghi: electron-packager chỉ gọi
// rcedit khi 1 trong 5 field này có giá trị — icon, win32metadata,
// appCopyright, appVersion, buildVersion (xem node_modules/electron-packager/
// src/win32.js::needsRcedit()). `appVersion`/`win32metadata.CompanyName` lại
// TỰ ĐỘNG lấy từ field "version"/"author" trong package.json thật (xem
// electron-packager/src/infer.js) nếu không chặn trước — nên script này tạm
// thời SỬA package.json trên đĩa (xoá "version", giữ "author" rỗng sẵn có),
// chạy electron-packager, rồi PHỤC HỒI lại y nguyên bản gốc ngay sau đó (kể
// cả khi lỗi, nhờ try/finally) — không có field nào trong 5 field trên có
// giá trị nữa → bỏ qua rcedit hẳn, không cần Wine.
//
// Đổi lại: bản .exe dùng icon mặc định của Electron, không có version/company
// info riêng. Nếu cần đầy đủ y như bản Mac, cài Wine rồi chạy thẳng:
//   npx electron-packager . "Suno Pro" --platform=win32 --arch=x64 \
//     --icon=build/icon.ico --out=out --overwrite --prune=true
const fs = require('fs');
const path = require('path');
const packager = require('electron-packager');

const projectDir = path.join(__dirname, '..');
const pkgPath = path.join(projectDir, 'package.json');

async function main() {
  const originalText = fs.readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(originalText);
  const patched = { ...pkg, version: '' };
  fs.writeFileSync(pkgPath, JSON.stringify(patched, null, 2) + '\n');
  try {
    await packager({
      dir: projectDir,
      name: 'Suno Pro',
      productName: 'Suno Pro',
      out: path.join(projectDir, 'out'),
      platform: 'win32',
      arch: 'x64',
      overwrite: true,
      prune: true,
      asar: true,
      // Không đóng gói kèm source Worker (worker/ — toàn bộ "recipe" gọi Suno,
      // logic license/admin), tài liệu nội bộ (docs/), script build (scripts/),
      // hay metadata git — tất cả chỉ cần trên máy dev, không cần (và không
      // được) nằm trong bản phát hành cho khách.
      ignore: [
        /^\/out($|\/)/,
        /^\/dist\/assets\/.*\.map$/,
        /^\/worker($|\/)/,
        /^\/docs($|\/)/,
        /^\/scripts($|\/)/,
        /^\/\.git($|\/)/,
        /^\/README\.md$/,
        /^\/\.gitignore$/
      ]
    });
  } finally {
    fs.writeFileSync(pkgPath, originalText);
  }
  console.log('Đã đóng gói xong bản Windows (không icon/version riêng — xem comment đầu file để biết cách thêm icon qua Wine).');
}

main().catch((err) => {
  // Luôn phục hồi package.json trước khi thoát, kể cả khi lỗi xảy ra TRƯỚC
  // dòng try — an toàn vì writeFileSync(pkgPath, originalText) ở finally đã
  // chạy nếu đã vào tới try; nếu lỗi xảy ra TRƯỚC try (vd. đọc file hỏng),
  // package.json chưa hề bị sửa nên không cần phục hồi gì thêm.
  console.error(err);
  process.exit(1);
});
