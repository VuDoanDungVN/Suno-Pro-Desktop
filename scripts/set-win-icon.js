// Ghi icon (build/icon.ico) + tên sản phẩm vào file .exe đã đóng gói —
// KHÔNG cần Wine. Dùng `resedit`/`pe-library` (thư viện JS thuần, tự đọc/ghi
// cấu trúc PE trực tiếp) thay cho `rcedit` (cần chạy 1 file .exe thật, nên
// cần Wine trên máy không phải Windows). Chạy SAU khi scripts/package-win.js
// đã đóng gói xong (bản đó cố tình bỏ icon để electron-packager khỏi tự gọi
// rcedit/đòi Wine).
const fs = require('fs');
const path = require('path');
const PELibrary = require('pe-library');
const ResEdit = require('resedit');

const projectDir = path.join(__dirname, '..');
const exePath = path.join(projectDir, 'out', 'Suno Pro-win32-x64', 'Suno Pro.exe');
const iconPath = path.join(projectDir, 'build', 'icon.ico');
const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'));

function parseVersion(v) {
  const parts = String(v || '0.0.0').split('.').map((n) => parseInt(n, 10) || 0);
  while (parts.length < 4) parts.push(0);
  return parts.slice(0, 4);
}

function main() {
  if (!fs.existsSync(exePath)) throw new Error('Không thấy ' + exePath + ' — chạy "npm run package:win" trước đã.');
  if (!fs.existsSync(iconPath)) throw new Error('Không thấy ' + iconPath);

  const data = fs.readFileSync(exePath);
  const exe = PELibrary.NtExecutable.from(data);
  const res = PELibrary.NtExecutableResource.from(exe);

  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(iconPath));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  if (!groups.length) throw new Error('Không tìm thấy icon group nào trong file .exe gốc để thay thế.');
  for (const group of groups) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
      res.entries,
      group.id,
      group.lang,
      iconFile.icons.map((item) => item.data)
    );
  }

  const [maj, min, patch, build] = parseVersion(pkg.version);
  const viList = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  for (const vi of viList) {
    vi.setFileVersion(maj, min, patch, build, 1033);
    vi.setProductVersion(maj, min, patch, build, 1033);
    vi.setStringValues(
      { lang: 1033, codepage: 1200 },
      {
        FileDescription: 'Suno Pro',
        ProductName: 'Suno Pro',
        InternalName: 'Suno Pro',
        OriginalFilename: 'Suno Pro.exe'
      }
    );
    vi.outputToResourceEntries(res.entries);
  }

  res.outputResource(exe);
  const newBinary = Buffer.from(exe.generate());

  // Không ghi đè thẳng lên chính nó khi đang đọc dở (README khuyến cáo) —
  // ghi ra file tạm trong CÙNG thư mục rồi đổi tên đè lên, an toàn hơn ghi
  // chéo ổ đĩa.
  const tmpPath = exePath + '.tmp';
  fs.writeFileSync(tmpPath, newBinary);
  fs.renameSync(tmpPath, exePath);
  console.log('Đã ghi icon + thông tin phiên bản vào: ' + exePath);
}

main();
