const { app, BrowserWindow, ipcMain, dialog, session, shell, clipboard, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const { exec, execSync, spawn } = require('child_process');

let mainWindow;

// The app/project was renamed to "Suno Pro", but Electron's default
// userData folder is derived from the app name — pinning it explicitly to
// the OLD folder name keeps activation.json/trial.json/suno-session.json
// exactly where they already were, so renaming never resets a saved Suno
// session (or anything else) for anyone upgrading from the old build.
app.setPath('userData', path.join(app.getPath('appData'), 'chicken-remastering'));

const previewDir = path.join(os.tmpdir(), 'chicken-mastering-preview');
if (!fs.existsSync(previewDir)) {
  fs.mkdirSync(previewDir, { recursive: true });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 500,
    height: 560,
    minWidth: 500,
    minHeight: 320,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    backgroundColor: '#0a0a0a',
    icon: path.join(__dirname, '../image.png')
  });

  // Windows: force the window icon explicitly — the constructor option can be
  // overridden by the executable's icon on the taskbar in dev mode.
  if (process.platform === 'win32') {
    mainWindow.setIcon(path.join(__dirname, '../image.png'));
  }

  // Always try to load from dist first, fall back to dev server
  const distPath = path.join(__dirname, '../dist/index.html');
  if (fs.existsSync(distPath)) {
    mainWindow.loadFile(distPath);
  } else if (!app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(distPath);
  }
  
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }
}

// Window control handlers
ipcMain.handle('window-minimize', () => mainWindow.minimize());
ipcMain.handle('window-maximize', () => {
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.handle('window-close', () => mainWindow.close());

// Let the renderer ask the window to match its own content height (the
// page's natural scrollHeight), so the window never carries empty space
// below a short page nor clips a tall one. Width is left untouched;
// height is clamped to a sane range and to the window's own min/max
// constraints (which Electron already enforces on setContentSize).
ipcMain.handle('window-resize-to-content', (event, height) => {
  if (!mainWindow || typeof height !== 'number' || !Number.isFinite(height)) return;
  const targetHeight = Math.max(320, Math.min(Math.round(height), 2000));
  const [width] = mainWindow.getContentSize();
  mainWindow.setContentSize(width, targetHeight, true);
});

// File selection
ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Audio Files', extensions: ['mp3', 'wav', 'flac', 'aac', 'm4a'] }]
  });
  return result.filePaths[0] || null;
});

// Batch file selection (multiple files)
ipcMain.handle('select-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio Files', extensions: ['mp3', 'wav', 'flac', 'aac', 'm4a'] }]
  });
  return result.filePaths || [];
});

// Select output directory for batch export
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return result.filePaths[0] || null;
});

// Save file dialog
ipcMain.handle('save-file', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: [{ name: 'WAV File', extensions: ['wav'] }]
  });
  return result.filePath || null;
});

// Save MP3 dialog (Easy / Normal / Hard one-click exports)
ipcMain.handle('save-mp3', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: 'chicken-mastered.mp3',
    filters: [{ name: 'MP3 Audio', extensions: ['mp3'] }]
  });
  return result.filePath || null;
});

// Preset export dialog
ipcMain.handle('save-json', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: 'mastering-presets.json',
    filters: [{ name: 'Presets JSON', extensions: ['json'] }]
  });
  return result.filePath || null;
});

// Preset import dialog
ipcMain.handle('open-json', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Presets JSON', extensions: ['json'] }]
  });
  return result.filePaths[0] || null;
});

// Quick existence check (used by the restored batch queue)
ipcMain.handle('file-exists', (event, filePath) => {
  return !!filePath && fs.existsSync(filePath);
});

// Read audio file
ipcMain.handle('read-audio-file', async (event, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('File not found');
  }
  
  try {
    const buffer = fs.readFileSync(filePath);
    return Array.from(new Uint8Array(buffer));
  } catch (error) {
    throw new Error(`Failed to read file: ${error.message}`);
  }
});

// Write file (for WAV export)
ipcMain.handle('write-file', async (event, filePath, data) => {
  if (!filePath) {
    throw new Error('No file path specified');
  }
  
  try {
    const buffer = Buffer.from(data);
    fs.writeFileSync(filePath, buffer);
    return { success: true };
  } catch (error) {
    throw new Error(`Failed to write file: ${error.message}`);
  }
});

// Get system info
ipcMain.handle('get-system-info', () => ({
  platform: process.platform,
  arch: process.arch,
  isPackaged: app.isPackaged,
  appPath: app.getAppPath(),
  electronVersion: process.versions.electron,
  nodeVersion: process.versions.node
}));

// ─── License activation ──────────────────────────────────────────────────────

// Pick a stable, physical MAC address for licensing purposes.
function pickPrimaryMac() {
  const ifaces = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] || []) {
      const mac = (info && info.mac || '').trim();
      if (!mac || mac === '00:00:00:00:00:00') continue;
      const n = name.toLowerCase();
      let score = 0;
      if (/^(eth|en|wlan|wi-?fi|local|ethernet)/.test(n)) score += 4;
      if (/wlan|wi-?fi/.test(n)) score += 2;
      if (!info.internal) score += 2;
      if (info.family === 'IPv4' || info.family === 4) score += 1;
      if (/veth|vmnet|virtual|virtualbox|docker|loopback|^lo$|bluetooth|bt|tunnel|utun|tap|tailscale|zerotier|ppp/.test(n)) score -= 6;
      candidates.push({ name, mac, score, addr: info.address || '' });
    }
  }
  candidates.sort((a, b) =>
    b.score - a.score ||
    a.name.localeCompare(b.name) ||
    a.mac.localeCompare(b.mac)
  );
  return candidates.length ? candidates[0].mac : '';
}

ipcMain.handle('get-mac-address', () => pickPrimaryMac());

// Các vị trí lưu mã kích hoạt, theo thứ tự ưu tiên:
//   1) folder chứa file .exe (hỗ trợ chạy portable / cài theo user — as-is writable)
//   2) %APPDATA%/<app> (luôn ghi được cho user; dự phòng khi .exe nằm trong Program Files)
function activationCandidates() {
  const dirs = [];
  if (app.isPackaged) {
    dirs.push(path.dirname(process.execPath));
  }
  dirs.push(app.getPath('userData'));
  return dirs.map((dir) => path.join(dir, 'activation.json'));
}

ipcMain.handle('activation-load', () => {
  for (const file of activationCandidates()) {
    try {
      if (fs.existsSync(file)) {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (data && typeof data.code === 'string' && data.code) return data;
      }
    } catch (e) {
      console.error(`activation-load error (${file}):`, e.message);
    }
  }
  return null;
});

ipcMain.handle('activation-save', (event, payload) => {
  try {
    if (!payload || typeof payload !== 'object') return { ok: false };
    if (typeof payload.mac !== 'string' || typeof payload.code !== 'string') return { ok: false };
    if (payload.code.length > 128) return { ok: false };
    const content = JSON.stringify({
      mac: payload.mac,
      code: payload.code,
      savedAt: Date.now()
    }, null, 2);
    const failures = [];
    let wrote = 0;
    for (const file of activationCandidates()) {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
        wrote++;
      } catch (e) {
        failures.push(file);
      }
    }
    return { ok: wrote > 0, failures };
  } catch (e) {
    console.error('activation-save error:', e);
    return { ok: false };
  }
});

// ─── Trial license (72h, anti-reinstall) ─────────────────────────────────────
// Trial "sunoforfun" mở 72h tính từ lúc nhập mã. Chống gỡ-cài-lại bằng 3
// anchor độc lập + đối chiếu chéo, lấy trạng thái xấu nhất:
//   A) trial.json cạnh activation.json (exe dir + userData)
//   B) Registry HKCU\Software\ChickenMastering (uninstaller không dọn)
//   C) %ProgramData%\ChickenMastering\trial.dat (ngoài profile user)
// Gian lận (anchor lệch, vặn đồng hồ, clone sang máy khác) → khóa trial luôn.
const TRIAL_HOURS = 7200;
const TRIAL_MS = TRIAL_HOURS * 3600 * 1000;
const TRIAL_REG_KEY = 'HKCU\\Software\\ChickenMastering';
// macOS: anchor B tương đương, lưu qua `defaults` trong
// ~/Library/Preferences/<domain>.plist — không nằm trong userData nên trình
// gỡ cài qua kéo-vào-Thùng-rác không dọn theo.
const TRIAL_MAC_DOMAIN = 'com.chickenmastering.trial';
const TRIAL_SKEW_MS = 5 * 60 * 1000;

function trialProgramDataFile() {
  const base = process.env.ProgramData || 'C:\\ProgramData';
  return path.join(base, 'ChickenMastering', 'trial.dat');
}

// Mốc C, ngoài phạm vi userData của user — trên Windows là %ProgramData%
// (không bị trình gỡ cài xóa). Trên macOS /Library/Application Support đóng
// vai trò tương đương, nhưng cần quyền admin để ghi; nếu không có quyền thì
// fallback về ~/Library/Application Support (vẫn tách khỏi userData gốc).
function trialProgramDataFiles() {
  if (process.platform === 'darwin') {
    return [
      '/Library/Application Support/ChickenMastering/trial.dat',
      path.join(os.homedir(), 'Library', 'Application Support', 'ChickenMastering', 'trial.dat')
    ];
  }
  return [trialProgramDataFile()];
}

function trialFileCandidates() {
  const dirs = [];
  try {
    if (app.isPackaged) dirs.push(path.dirname(process.execPath));
  } catch (e) {}
  try {
    dirs.push(app.getPath('userData'));
  } catch (e) {}
  return dirs.map((dir) => path.join(dir, 'trial.json'));
}

function trialMachineMacs() {
  const out = [];
  try {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const info of ifaces[name] || []) {
        const hex = String((info && info.mac) || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
        if (hex && hex !== '000000000000' && !out.includes(hex)) out.push(hex);
      }
    }
  } catch (e) {}
  return out.sort();
}

function trialReadFiles() {
  const found = [];
  for (const file of trialFileCandidates()) {
    try {
      if (!fs.existsSync(file)) continue;
      const d = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (d && Number.isFinite(+d.trialStart)) {
        found.push({
          trialStart: +d.trialStart,
          state: typeof d.state === 'string' ? d.state : 'active',
          macs: Array.isArray(d.macs) ? d.macs : [],
          lastSeen: Number.isFinite(+d.lastSeen) ? +d.lastSeen : 0
        });
      }
    } catch (e) {}
  }
  for (const pd of trialProgramDataFiles()) {
    try {
      if (!fs.existsSync(pd)) continue;
      const d = JSON.parse(fs.readFileSync(pd, 'utf8'));
      if (d && Number.isFinite(+d.trialStart)) {
        found.push({
          trialStart: +d.trialStart,
          state: typeof d.state === 'string' ? d.state : 'active',
          macs: Array.isArray(d.macs) ? d.macs : [],
          lastSeen: Number.isFinite(+d.lastSeen) ? +d.lastSeen : 0
        });
      }
    } catch (e) {}
  }
  return found;
}

function trialReadRegistry() {
  if (process.platform === 'darwin') {
    try {
      const q = (key) => {
        try {
          return execSync(`defaults read "${TRIAL_MAC_DOMAIN}" ${key}`, { timeout: 5000 }).toString().trim();
        } catch (e) {
          return '';
        }
      };
      const start = q('TrialStart');
      if (!start || !Number.isFinite(+start)) return null;
      return {
        trialStart: +start,
        state: q('State') || 'active',
        macs: (q('Macs') || '').split(',').map((s) => s.trim()).filter(Boolean),
        lastSeen: Number.isFinite(+q('LastSeen')) ? +q('LastSeen') : 0
      };
    } catch (e) {
      return null;
    }
  }
  try {
    const q = (v) => {
      try {
        const out = execSync(`reg query "${TRIAL_REG_KEY}" /v ${v}`, { windowsHide: true, timeout: 5000 }).toString();
        const m = out.match(/REG_\w+\s+(.+?)\s*$/m);
        return m ? m[1].trim() : '';
      } catch (e) {
        return '';
      }
    };
    const start = q('TrialStart');
    if (!start || !Number.isFinite(+start)) return null;
    return {
      trialStart: +start,
      state: q('State') || 'active',
      macs: (q('Macs') || '').split(',').map((s) => s.trim()).filter(Boolean),
      lastSeen: Number.isFinite(+q('LastSeen')) ? +q('LastSeen') : 0
    };
  } catch (e) {
    return null;
  }
}

function trialWriteAll(fields) {
  const content = JSON.stringify({ ...fields, lastSeen: Date.now() }, null, 2);
  for (const file of trialFileCandidates()) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    } catch (e) {}
  }
  for (const pd of trialProgramDataFiles()) {
    try {
      fs.mkdirSync(path.dirname(pd), { recursive: true });
      fs.writeFileSync(pd, content);
    } catch (e) {}
  }
  if (process.platform === 'darwin') {
    try {
      const macsStr = (fields.macs || []).join(',');
      execSync(`defaults write "${TRIAL_MAC_DOMAIN}" TrialStart -string "${fields.trialStart}"`, { timeout: 8000 });
      execSync(`defaults write "${TRIAL_MAC_DOMAIN}" State -string "${fields.state}"`, { timeout: 8000 });
      execSync(`defaults write "${TRIAL_MAC_DOMAIN}" Macs -string "${macsStr}"`, { timeout: 8000 });
      execSync(`defaults write "${TRIAL_MAC_DOMAIN}" LastSeen -string "${Date.now()}"`, { timeout: 8000 });
    } catch (e) {}
  }
  if (process.platform === 'win32') {
    try {
      execSync(`reg add "${TRIAL_REG_KEY}" /v TrialStart /t REG_SZ /d "${fields.trialStart}" /f`, { windowsHide: true, timeout: 8000 });
      execSync(`reg add "${TRIAL_REG_KEY}" /v State /t REG_SZ /d "${fields.state}" /f`, { windowsHide: true, timeout: 8000 });
      execSync(`reg add "${TRIAL_REG_KEY}" /v Macs /t REG_SZ /d "${(fields.macs || []).join(',')}" /f`, { windowsHide: true, timeout: 8000 });
      execSync(`reg add "${TRIAL_REG_KEY}" /v LastSeen /t REG_SZ /d "${Date.now()}" /f`, { windowsHide: true, timeout: 8000 });
    } catch (e) {}
  }
}

// Hợp nhất anchors, lấy trạng thái xấu nhất. Có tác dụng phụ: refresh
// lastSeen khi còn active; ghi locked/expired khi phát hiện vi phạm.
function getTrialStatus() {
  const now = Date.now();
  const anchors = trialReadFiles();
  const reg = trialReadRegistry();
  if (reg) anchors.push(reg);
  if (!anchors.length) return { state: 'fresh', trialStart: 0, trialEnd: 0, hoursLeft: 0 };
  if (anchors.some((a) => a.state === 'locked')) {
    trialWriteAll({ trialStart: anchors[0].trialStart, state: 'locked', macs: anchors[0].macs });
    return { state: 'locked', trialStart: anchors[0].trialStart, trialEnd: 0, hoursLeft: 0 };
  }
  const trialStart = Math.min(...anchors.map((a) => a.trialStart));
  const storedMacs = [];
  for (const a of anchors) {
    for (const m of a.macs || []) if (!storedMacs.includes(m)) storedMacs.push(m);
  }
  const myMacs = trialMachineMacs();
  const lastSeen = Math.max(0, ...anchors.map((a) => a.lastSeen || 0));
  const lock = () => {
    trialWriteAll({ trialStart, state: 'locked', macs: storedMacs.length ? storedMacs : myMacs });
    return { state: 'locked', trialStart, trialEnd: trialStart + TRIAL_MS, hoursLeft: 0 };
  };
  if (trialStart > now + TRIAL_SKEW_MS) return lock(); // trialStart ở tương lai
  if (lastSeen > 0 && now < lastSeen - TRIAL_SKEW_MS) return lock(); // vặn ngược đồng hồ
  if (storedMacs.length && myMacs.length && !myMacs.some((m) => storedMacs.includes(m))) {
    return lock(); // file trial copy sang máy khác
  }
  if (now - trialStart >= TRIAL_MS) {
    trialWriteAll({ trialStart, state: 'expired', macs: storedMacs.length ? storedMacs : myMacs });
    return { state: 'expired', trialStart, trialEnd: trialStart + TRIAL_MS, hoursLeft: 0 };
  }
  trialWriteAll({ trialStart, state: 'active', macs: storedMacs.length ? storedMacs : myMacs });
  const trialEnd = trialStart + TRIAL_MS;
  return { state: 'active', trialStart, trialEnd, hoursLeft: Math.max(0, (trialEnd - now) / 3600000) };
}

ipcMain.handle('trial-status', () => {
  try {
    return getTrialStatus();
  } catch (e) {
    return { state: 'fresh', trialStart: 0, trialEnd: 0, hoursLeft: 0 };
  }
});

ipcMain.handle('trial-start', () => {
  const s = getTrialStatus();
  if (s.state === 'active') return s;
  if (s.state === 'fresh') {
    const now = Date.now();
    const macs = trialMachineMacs();
    trialWriteAll({ trialStart: now, state: 'active', macs });
    return { state: 'active', trialStart: now, trialEnd: now + TRIAL_MS, hoursLeft: TRIAL_HOURS };
  }
  throw new Error(
    s.state === 'locked'
      ? 'Trial trên máy này đã bị khóa do phát hiện gian lận (cài lại/xóa dữ liệu/vặn đồng hồ). Vui lòng nhập mã kích hoạt lifetime.'
      : 'Mã trial đã hết hạn trên máy này và không dùng lại được. Vui lòng nhập mã kích hoạt lifetime.'
  );
});

// ─── Suno upload (official Studio API, using the user's own session) ─────────
// This mirrors exactly what the suno.com "Upload Audio" feature does in the
// browser, so a file mastered here lands in the user's own Suno library:
//   1. init upload   POST /api/uploads/audio/            → presigned URL + id
//   2. presigned     POST <S3 URL> (multipart: fields + file)
//   3. finish        POST /api/uploads/audio/{id}/upload-finish/
//   4. status poll   GET  /api/uploads/audio/{id}/       → clip_id when done
//   5. finalize      POST /api/uploads/audio/{id}/initialize-clip/
// Auth: the user pastes their suno.com session — either a raw Bearer token
// (eyJ…) you get from window.Clerk.session.getToken(), or the Cookie header
// (contains __client/__session). When __client is present we mint a fresh
// short-lived JWT through Clerk; otherwise __session is itself a valid token.

const SUNO_API = 'https://studio-api.prod.suno.com';
const SUNO_CLERK = 'https://clerk.suno.com';
const SUNO_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function sunoSessionFile() {
  return path.join(app.getPath('userData'), 'suno-session.json');
}

// Turn Suno's poll-row rejection into a readable sentence instead of raw JSON.
function sunoRejectionText(row, status) {
  const type = String(row.error_type || '');
  const raw = String(row.error_message || '').trim();
  const known = {
    upload_failure_match_audible_magic:
      'Nội dung trùng với một recording đã có trong catalog của Suno (bộ nhận diện Audible Magic).',
    upload_failure_match_acrcloud:
      'Nội dung trùng với một recording đã có trong catalog của Suno (bộ nhận diện ACRCloud).',
    upload_failure_match_pex:
      'Nội dung trùng với một recording đã có trong catalog của Suno (bộ nhận diện âm thanh).',
    upload_failure_duration: 'Độ dài bài không hợp lệ (Suno yêu cầu 2–10 phút).',
    upload_failure_file_size: 'File quá lớn.',
    upload_failure_format: 'Định dạng file không được Suno hỗ trợ.',
    upload_failure_corrupt: 'File hỏng hoặc không giải mã được.',
    upload_failure_tos: 'Chưa chấp thuận điều khoản upload của Suno.'
  };
  const desc = known[type] || raw || `trạng thái “${status}”`;
  const parts = [`Suno từ chối file — ${desc}`];
  if (known[type] && raw) parts.push(`(${raw})`);
  if (type) parts.push(`[${type}]`);
  if (/upload_failure_match/.test(type)) {
    parts.push('→ Suno chỉ nhận audio bạn sở hữu quyền; audio trùng bản ghi có sẵn sẽ bị chặn ở máy chủ.');
  }
  return parts.join(' ');
}

function sunoParseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key && value) out[key] = value;
  }
  return out;
}

function sunoLooksLikeJwt(value) {
  return /^eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}$/.test(String(value || '').trim());
}

// Short stable account fingerprint from the JWT payload (sub claim). Used to
// detect "session flips" — uploads done under account A while the browser
// shows account B (multi-Google-login machines). Display-only, no secrets.
function sunoJwtSub(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return '';
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return String(payload.sub || payload.user_id || payload.uid || '');
  } catch (e) {
    return '';
  }
}

// Accept several practical formats and normalize to a Cookie-style header or
// raw bearer token: full cURL command, "Cookie: …" header line, "authorization:
// Bearer eyJ…" header line, plain "k=v; k2=v2" cookie text, or an eyJ token.
function sunoExtractSession(raw) {
  let text = String(raw || '').trim();
  if (!text) return '';
  if (/^curl\b/i.test(text) || /-H\s+['"]Cookie:/i.test(text)) {
    const cookieMatch = text.match(/Cookie:\s*([^'"]+)/i);
    if (cookieMatch) return cookieMatch[1].trim();
    const authMatch = text.match(/[Aa]uthorization:\s*(?:Bearer\s+)?([A-Za-z0-9._-]{20,})/);
    if (authMatch) return authMatch[1].trim();
  }
  const cookieLine = text.match(/^Cookie:\s*(.+)$/i);
  if (cookieLine) return cookieLine[1].trim();
  const authLine = text.match(/^authorization:\s*(?:Bearer\s+)?([A-Za-z0-9._-]{20,})$/i);
  if (authLine) return authLine[1].trim();
  return text;
}

function sunoBrowserTokenHeader() {
  const inner = Buffer.from(JSON.stringify({ timestamp: Date.now() })).toString('base64');
  return JSON.stringify({ token: inner });
}

function sunoBaseHeaders(token, cookieHeader) {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Browser-Token': sunoBrowserTokenHeader(),
    Accept: 'application/json, text/plain, */*',
    Origin: 'https://suno.com',
    Referer: 'https://suno.com/studio',
    'User-Agent': SUNO_USER_AGENT
  };
  if (cookieHeader) headers.Cookie = cookieHeader;
  return headers;
}

async function sunoRequest(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch (e) {
    json = { raw: text.slice(0, 300) };
  }
  return { status: res.status, ok: res.ok, json };
}

// Resolve the pasted session into a usable Bearer token (+ optional cookie header).
async function sunoResolveToken(session) {
  const raw = sunoExtractSession(session);
  if (!raw) throw new Error('Chưa có session Suno. Dán session tài khoản Suno vào trước.');
  if (sunoLooksLikeJwt(raw)) return { token: raw, cookieHeader: null };

  const cookies = sunoParseCookies(raw);
  const clientVal = cookies.__client;
  const sessionVal = cookies.__session;
  const cookieHeader = raw;

  // Prefer minting a fresh, short-lived JWT through Clerk when __client exists.
  if (clientVal) {
    const qs = '__clerk_api_version=2025-11-10&_clerk_js_version=5.102.1';
    try {
      const clientRes = await sunoRequest(`${SUNO_CLERK}/v1/client?${qs}`, {
        method: 'GET',
        headers: {
          Authorization: clientVal,
          Cookie: cookieHeader,
          Origin: 'https://suno.com',
          Referer: 'https://suno.com/',
          'User-Agent': SUNO_USER_AGENT
        }
      });
      const sid = clientRes.json && clientRes.json.response && clientRes.json.response.last_active_session_id;
      if (sid) {
        const tokenRes = await sunoRequest(`${SUNO_CLERK}/v1/client/sessions/${sid}/tokens?${qs}`, {
          method: 'POST',
          headers: {
            Authorization: clientVal,
            Cookie: cookieHeader,
            Origin: 'https://suno.com',
            Referer: 'https://suno.com/',
            'User-Agent': SUNO_USER_AGENT
          }
        });
        if (tokenRes.json && tokenRes.json.jwt) {
          return { token: tokenRes.json.jwt, cookieHeader };
        }
      }
    } catch (e) {
      console.error('Clerk token mint failed, falling back to __session:', e.message);
    }
  }

  if (sessionVal) return { token: sessionVal, cookieHeader };
  throw new Error('Không đọc được token từ session. Dán cả Cookie header (chứa __client/__session) hoặc token eyJ… từ suno.com.');
}

async function sunoQuota(token, cookieHeader) {
  const r = await sunoRequest(`${SUNO_API}/api/billing/info/`, {
    method: 'GET',
    headers: sunoBaseHeaders(token, cookieHeader)
  });
  if (r.status === 401) {
    throw new Error('Session Suno hết hạn hoặc không hợp lệ (401). Đăng nhập lại suno.com rồi dán session mới.');
  }
  if (!r.ok) throw new Error(`Kiểm tra session thất bại: HTTP ${r.status}`);
  const b = r.json || {};
  return {
    creditsLeft: b.total_credits_left != null ? b.total_credits_left : null,
    monthlyLimit: b.monthly_limit != null ? b.monthly_limit : null,
    monthlyUsage: b.monthly_usage != null ? b.monthly_usage : null,
    period: b.period || null,
    accountSub: sunoJwtSub(token).slice(0, 8)
  };
}

async function sunoUploadAudio({ token, cookieHeader, buffer, filename, title, artist, onProgress }) {
  const base = sunoBaseHeaders(token, cookieHeader);
  const name = path.basename(filename || 'upload.mp3');
  const ext = (path.extname(name) || '.mp3').slice(1).toLowerCase() || 'mp3';
  const mime = ext === 'wav' ? 'audio/wav' : ext === 'flac' ? 'audio/flac' : 'audio/mpeg';
  const progress = (msg) => {
    try { if (typeof onProgress === 'function') onProgress(msg); } catch (e) {}
  };

  // Pre-flight so an expired session fails fast with a friendly message.
  progress('Đang kiểm tra session Suno…');
  const quota = await sunoRequest(`${SUNO_API}/api/billing/info/`, {
    method: 'GET',
    headers: base
  });
  if (quota.status === 401) {
    throw new Error('Session Suno hết hạn hoặc không hợp lệ (401). Dán session mới.');
  }

  // 1) Open the upload.
  try {
    const sub = sunoJwtSub(token);
    if (sub) debugLogMain('[suno] upload auth sub=' + sub.slice(0, 8) + '…');
  } catch (e) {}
  progress('Đang mở phiên upload trên Suno…');
  const initRes = await sunoRequest(`${SUNO_API}/api/uploads/audio/`, {
    method: 'POST',
    headers: { ...base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ extension: ext, upload_type: 'studio_file_upload' })
  });
  if (!initRes.ok) {
    throw new Error(`Mở phiên upload thất bại: HTTP ${initRes.status} ${JSON.stringify(initRes.json).slice(0, 220)}`);
  }
  const nested = initRes.json && initRes.json.upload && typeof initRes.json.upload === 'object'
    ? initRes.json.upload : {};
  const presignedUrl = initRes.json.url || nested.url || '';
  const fields = initRes.json.fields || nested.fields || {};
  const uploadId = initRes.json.id || initRes.json.upload_id || nested.id || '';
  if (!presignedUrl || !uploadId) {
    throw new Error('Upload init không trả về presigned URL hợp lệ: ' + JSON.stringify(initRes.json).slice(0, 220));
  }

  // 2) Push the file to the presigned URL (multipart: fields + file).
  progress('Đang tải file lên máy chủ Suno…');
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
  form.append('file', new Blob([buffer], { type: mime }), name);
  const presignedRes = await fetch(presignedUrl, { method: 'POST', body: form });
  if (!presignedRes.ok) {
    throw new Error(`Tải file lên Suno thất bại: HTTP ${presignedRes.status} ${(await presignedRes.text()).slice(0, 220)}`);
  }

  // 3) Tell Suno the upload is complete.
  progress('Đang báo Suno hoàn tất upload…');
  const finishRes = await sunoRequest(`${SUNO_API}/api/uploads/audio/${uploadId}/upload-finish/`, {
    method: 'POST',
    headers: { ...base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ upload_type: 'studio_file_upload', upload_filename: name })
  });
  if (!finishRes.ok) throw new Error(`Hoàn tất upload thất bại: HTTP ${finishRes.status}`);

  // 4) Poll until Suno reports complete / mints a clip id.
  let clipId = '';
  let lastRow = null;
  let lastStatus = '';
  const deadline = Date.now() + 5 * 60 * 1000;
  const pollStarted = Date.now();
  let lastProgress = 0;
  while (Date.now() < deadline) {
    const st = await sunoRequest(`${SUNO_API}/api/uploads/audio/${uploadId}/`, {
      method: 'GET',
      headers: base
    });
    const row = st.json && st.json.data ? st.json.data : (st.json || {});
    const status = String(row.status || row.state || '').toLowerCase();
    lastRow = row;
    lastStatus = status;
    clipId = row.clip_id || row.clipId || row.song_id || '';
    if (pollStarted && Date.now() - pollStarted < 6000) {
      try {
        debugLogMain('[suno] poll-first keys=' + Object.keys(row).join(',') + ' status=' + status + ' clipId=' + (clipId ? 'yes' : 'no'));
      } catch (e) {}
    }
    if (row.error_type) {
      throw new Error(sunoRejectionText(row, status || 'error'));
    }
    if (['complete', 'completed', 'ready', 'success', 'succeeded', 'finished', 'done'].includes(status) || clipId) break;
    if (/failed|rejected|blocked|error/.test(status)) {
      throw new Error(sunoRejectionText(row, status));
    }
    const elapsed = Math.round((Date.now() - pollStarted) / 1000);
    if (elapsed - lastProgress >= 4) {
      lastProgress = elapsed;
      progress(`Suno đang xử lý file… ${elapsed}s (tối đa 300s)`);
    }
    await new Promise((r) => setTimeout(r, 1800));
  }

  // 5) Finalize the clip (TOS accepted) so it lands in the library.
  // For short parts Suno reports "complete" with NO clip id in the poll row
  // and only mints it in initialize-clip — so always attempt it when the
  // upload reached a terminal state.
  progress('Đang ghi bài vào thư viện Suno…');
  let finalizedId = clipId;
  let muted = !!(lastRow && lastRow.copyright_muted);
  const terminal = ['complete', 'completed', 'ready', 'success', 'succeeded', 'finished', 'done'].includes(lastStatus);
  if (!finalizedId && !terminal && Date.now() < deadline) {
    throw new Error('Hết thời gian chờ Suno xử lý file (5 phút). Thử lại.');
  }
  try {
    const ic = await sunoRequest(`${SUNO_API}/api/uploads/audio/${uploadId}/initialize-clip/`, {
      method: 'POST',
      headers: { ...base, 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_audio_upload_tos_accepted: true })
    });
    finalizedId = ic.json.clip_id || ic.json.clipId || ic.json.song_id || ic.json.id || finalizedId;
    if (ic.json && ic.json.copyright_muted) muted = true;
  } catch (e) {
    console.warn('initialize-clip warning:', e.message);
  }
  if (!finalizedId) {
    if (lastRow && lastRow.error_type) throw new Error(sunoRejectionText(lastRow, lastStatus || 'error'));
    throw new Error('Suno xử lý xong nhưng không trả clip ID (trạng thái: ' + (lastStatus || '?') + '). Thử lại.');
  }

  // 6) Best-effort metadata (optional upstream capability; ignore failures).
  let metadataApplied = false;
  try {
    const md = await sunoRequest(`${SUNO_API}/api/uploads/audio/${uploadId}/metadata/`, {
      method: 'PATCH',
      headers: { ...base, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title || name.replace(/\.(mp3|wav|flac)$/i, ''),
        artist: artist || ''
      })
    });
    metadataApplied = md.ok;
  } catch (e) {
    metadataApplied = false;
  }

  return {
    clipId: finalizedId,
    songUrl: `https://suno.com/song/${finalizedId}`,
    metadataApplied,
    muted
  };
}

// Session persistence + IPC surface
// Append-only debug log in userData — used to see exactly how far a run got
// even when the on-screen status toast is missed.
ipcMain.handle('debug-log', (event, line) => {
  try {
    const file = path.join(app.getPath('userData'), 'debug.log');
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${String(line).slice(0, 500)}\r\n`);
  } catch (e) { /* logging must never break the app */ }
  return { ok: true };
});

// Main-side equivalent (main process has no window.electronAPI).
function debugLogMain(line) {
  try {
    const file = path.join(app.getPath('userData'), 'debug.log');
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${String(line).slice(0, 500)}\r\n`);
  } catch (e) { /* logging must never break the app */ }
}

ipcMain.handle('suno-session-load', () => {
  try {
    const file = sunoSessionFile();
    if (!fs.existsSync(file)) return { session: '' };
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { session: typeof data.session === 'string' ? data.session : '' };
  } catch (e) {
    return { session: '' };
  }
});

ipcMain.handle('suno-session-save', (event, session) => {
  try {
    const normalized = sunoExtractSession(session);
    if (typeof session !== 'string' || !normalized) return { ok: false };
    fs.mkdirSync(path.dirname(sunoSessionFile()), { recursive: true });
    fs.writeFileSync(sunoSessionFile(), JSON.stringify({ session: normalized, savedAt: Date.now() }, null, 2));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('suno-verify', async (event, session) => {
  const { token, cookieHeader } = await sunoResolveToken(session);
  return sunoQuota(token, cookieHeader);
});

// Toast notification so an upload is never silent (click opens the song).
ipcMain.handle('suno-notify', (event, payload) => {
  try {
    const p = payload || {};
    if (!Notification.isSupported()) return { ok: false, error: 'Hệ thống không hỗ trợ toast' };
    const n = new Notification({
      title: String(p.title || 'Chicken Mastering'),
      body: String(p.body || '').slice(0, 400)
    });
    if (p.url && /^https:\/\//.test(String(p.url))) {
      n.on('click', () => shell.openExternal(String(p.url)));
    }
    n.show();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('suno-upload', async (event, payload) => {
  if (!payload || typeof payload !== 'object') throw new Error('Payload không hợp lệ');
  if (!payload.session || !payload.buffer) throw new Error('Thiếu session hoặc dữ liệu file');
  const { token, cookieHeader } = await sunoResolveToken(payload.session);
  return sunoUploadAudio({
    token,
    cookieHeader,
    buffer: Buffer.from(payload.buffer),
    filename: payload.filename || 'upload.mp3',
    title: payload.title || '',
    artist: payload.artist || '',
    onProgress: (msg) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('suno-upload-progress', msg);
      }
    }
  });
});

// ─── Suno download (public link → WAV, no login needed) ─────────────────────
// Reads a public suno.com song page (/s/…, /song/…, /hook/…) and presents the
// media URL Suno itself exposes there — same source the usesuno downloader
// uses (page-embedded clip JSON → media_urls → CDN file).
const SUNO_DL_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function sunoParseShareLink(link) {
  const s = String(link || '').trim();
  const m = s.match(/suno\.com\/(s\/[A-Za-z0-9_-]+|song\/[0-9a-fA-F-]+|hook\/[A-Za-z0-9_-]+)/i);
  if (!m) throw new Error('Link không hợp lệ. Dán link dạng suno.com/s/… hoặc suno.com/song/… hoặc suno.com/hook/…');
  return m[1];
}

function sunoExtractClipInfo(html) {
  const flat = String(html || '').replace(/\\"/g, '"');
  let title = '';
  let audioUrl = '';
  const clipTitle = flat.match(/"clip":\{[^}]{0,2000}?"title":"((?:[^"\\]|\\.)+)"/);
  if (clipTitle) {
    try { title = JSON.parse('"' + clipTitle[1] + '"'); }
    catch (e) { title = clipTitle[1]; }
  }
  const media = flat.match(/"media_urls":\[\{"url":"([^"]+)"/);
  if (media) audioUrl = media[1];
  if (!audioUrl) {
    const anyCdn = flat.match(/"(https:\/\/[a-z0-9.-]*cloudfront\.net[^"]+\.(?:m4a|mp3))"/i);
    if (anyCdn) audioUrl = anyCdn[1];
  }
  if (!title) {
    const og = String(html || '').match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i);
    if (og) title = og[1];
  }
  let clipId = '';
  const clipSection = flat.match(/"clip":\{[^}]{0,3000}/);
  if (clipSection) {
    const idM = clipSection[0].match(/"id":"([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})"/);
    if (idM) clipId = idM[1];
  }
  if (!clipId && audioUrl) {
    // Newer pages embed no clip JSON, but the UUID sits in the media/cover URL.
    const fromMedia = audioUrl.match(/\/clip\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/);
    if (fromMedia) clipId = fromMedia[1];
  }
  if (!clipId) {
    const fromImg = flat.match(/image_large_([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/);
    if (fromImg) clipId = fromImg[1];
  }
  if (!audioUrl) throw new Error('Không tìm thấy file audio công khai trong link này (bài private, đã xóa hoặc Suno đổi cấu trúc trang).');
  return { title: title || 'suno-track', audioUrl, clipId };
}

ipcMain.handle('suno-download-resolve', async (event, link) => {
  const pagePath = sunoParseShareLink(link);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch('https://suno.com/' + pagePath, {
      headers: { 'User-Agent': SUNO_DL_UA, Accept: 'text/html,application/xhtml+xml' },
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error('Suno trả về HTTP ' + res.status + ' — kiểm tra lại link (bài private/đã xóa sẽ lỗi).');
    const html = await res.text();
    if (!html || html.length < 1000) throw new Error('Trang Suno trả về rỗng — thử lại sau ít phút.');
    const info = sunoExtractClipInfo(html);
    const ext = (info.audioUrl.split('?')[0].split('.').pop() || 'm4a').toLowerCase().slice(0, 4);
    return { title: info.title, audioUrl: info.audioUrl, clipId: info.clipId || '', sourceExt: ext };
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('Hết giờ chờ Suno (30s) — mạng chậm hoặc Suno chặn request, thử lại sau.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
});

const sunoDlSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Official download: prepare a signed URL through Suno's own download APIs
// (needs the user's session — same one used for upload). Prefers Studio WAV
// when the account has the studio feature, else Library MP3 (transcoded to
// WAV locally by the renderer). The public CDN file is encrypted and cannot
// be decoded without the browser player, so this route is the reliable one.
async function sunoPrepareOfficialDownload(session, clipId) {
  if (!clipId) throw new Error('Không lấy được clip ID từ link — thử link khác.');
  const { token, cookieHeader } = await sunoResolveToken(session);
  const auth = () => sunoBaseHeaders(token, cookieHeader);
  const featLog = [];
  let hasStudio = false;
  try {
    const billing = await sunoRequest(`${SUNO_API}/api/billing/info/`, { headers: auth() });
    const bj = (billing && billing.json) || {};
    const feats = bj.accessible_features || bj.features || [];
    const list = Array.isArray(feats) ? feats.map((f) => (f && typeof f === 'object' ? (f.key || f.name || f.code || f.id || '?') : String(f))) : [];
    hasStudio = list.includes('studio');
    featLog.push('features=' + (list.join(',') || '(none)'));
  } catch (e) { hasStudio = false; featLog.push('billing-fail'); }
  const prepLog = async (tag, obj) => {
    try {
      debugLogMain('[sunodl] ' + tag + ' = ' + JSON.stringify(obj).slice(0, 300));
    } catch (e) {}
  };
  if (hasStudio) {
    let studioOk = false;
    let studioUrl = '';
    for (let i = 0; i < 12; i++) {
      const r = await sunoRequest(`${SUNO_API}/api/studio/clip/${clipId}/download?format=wav`, { headers: auth() });
      const j = (r && r.json) || {};
      if (i === 0) await prepLog('studio-first', j);
      if (j.download_url && (!j.status || j.status === 'ready')) { studioOk = true; studioUrl = j.download_url; break; }
      if (j.status === 'rate_limited') throw new Error('Suno giới hạn lượt tải (rate limited) — thử lại sau ít phút.');
      if (j.status && j.status !== 'processing' && j.status !== 'pending' && j.status !== 'queued') break;
      await sunoDlSleep(5000);
    }
    if (studioOk) return { url: studioUrl, format: 'wav' };
    featLog.push('studio-timeout-fallback-library');
  }
  await sunoRequest(`${SUNO_API}/api/download/authorize`, {
    method: 'POST',
    headers: { ...auth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ item_id: clipId, item_type: 'clip' })
  });
  for (let i = 0; i < 12; i++) {
    const p = await sunoRequest(`${SUNO_API}/api/download/clip/${clipId}?format=mp3`, { headers: auth() });
    const pj = (p && p.json) || {};
    if (i === 0) await prepLog('library-first', pj);
    const url = pj.download_url || pj.url || '';
    if (url) return { url, format: 'mp3' };
    if (pj.status && pj.status !== 'processing' && pj.status !== 'pending' && pj.status !== 'queued' && pj.status !== 'converting') break;
    await sunoDlSleep(5000);
  }
  throw new Error('Suno không trả link tải (' + featLog.join(' | ') + ') — có thể bài này không cho download ở gói của bạn.');
}

ipcMain.handle('suno-download-prepare', async (event, payload) => {
  if (!payload || typeof payload !== 'object') throw new Error('Payload không hợp lệ');
  return sunoPrepareOfficialDownload(payload.session, payload.clipId);
});

// Save dialog for Suno downloads, prefilled with the track title.
ipcMain.handle('suno-download-save', async (event, filename) => {
  const safe = String(filename || 'suno-track').replace(/[\\/:*?"<>|]/g, '-').slice(0, 120) || 'suno-track';
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: safe + '.wav',
    filters: [{ name: 'WAV Audio', extensions: ['wav'] }]
  });
  return result.filePath || null;
});

const SUNO_MANGO_HOSTS = ['https://studio-api.prod.suno.com', 'https://studio-api-prod.suno.com'];

// AES-GCM unwrap per Suno's web player (module 913328 logic):
// wrapped = base64(iv[12] + ciphertext+tag[16]); AAD = contentId (clip uuid).
// WebCrypto accepts 16/24/32-byte GCM keys (the SHA-256 user key is 32 bytes
// → AES-256-GCM); mirror that instead of hardcoding AES-128.
function sunoGcmCipher(keyLen) {
  if (keyLen === 16) return 'aes-128-gcm';
  if (keyLen === 24) return 'aes-192-gcm';
  if (keyLen === 32) return 'aes-256-gcm';
  throw new RangeError('Invalid key length: ' + keyLen);
}

function sunoCtrCipher(keyLen) {
  if (keyLen === 16) return 'aes-128-ctr';
  if (keyLen === 24) return 'aes-192-ctr';
  if (keyLen === 32) return 'aes-256-ctr';
  throw new RangeError('Invalid key length: ' + keyLen);
}

function sunoGcmUnwrap(wrappedB64, contentId, keyBytes) {
  const crypto = require('crypto');
  const key = Buffer.from(keyBytes);
  const raw = Buffer.from(String(wrappedB64 || ''), 'base64');
  if (raw.length < 12 + 16 + 1) throw new Error('License key bọc sai định dạng.');
  const iv = raw.slice(0, 12);
  const tag = raw.slice(raw.length - 16);
  const ct = raw.slice(12, raw.length - 16);
  const dec = crypto.createDecipheriv(sunoGcmCipher(key.length), key, iv);
  dec.setAAD(Buffer.from(String(contentId), 'utf8'));
  dec.setAuthTag(tag);
  return Buffer.concat([dec.update(ct), dec.final()]);
}

// Fetch the per-track Mango license and AES-CTR-decrypt Suno's CDN audio.
// Mirrors the browser player's createResilientDecryptedReader pipeline.
async function sunoMangoDecrypt(session, clipId, encBytes) {
  const crypto = require('crypto');
  const { token } = await sunoResolveToken(session);
  const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest();
  const userKey = token ? sha256(token) : null;
  const headers = token ? sunoBaseHeaders(token, null) : {
    Origin: 'https://suno.com',
    Referer: 'https://suno.com/',
    'User-Agent': SUNO_DL_UA
  };
  let rights = null;
  let lastErr = '';
  for (const host of SUNO_MANGO_HOSTS) {
    try {
      const res = await fetch(host + '/api/mango/rights', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content_params: { content_id: clipId, content_type: 'clip' } })
      });
      const text = await res.text();
      try { rights = text ? JSON.parse(text) : {}; }
      catch (e) { lastErr = host + ' HTTP ' + res.status + ' non-JSON'; continue; }
      if (res.ok && rights && rights.key && rights.iv) break;
      lastErr = host + ' HTTP ' + res.status + ' ' + String(text).slice(0, 160);
      rights = null;
    } catch (e) {
      lastErr = host + ' ' + (e && e.message ? e.message : String(e));
      rights = null;
    }
  }
  if (!rights) throw new Error('Không xin được license giải mã (' + lastErr + ').');
  const gk = rights.glt ? sha256(String(rights.glt)) : null;
  const uk = userKey || gk;
  if (!uk) throw new Error('License thiếu guest token cho phát ẩn danh.');
  const contentKey = sunoGcmUnwrap(rights.key, clipId, uk);
  const contentIv = sunoGcmUnwrap(rights.iv, clipId, uk);
  const dec = crypto.createDecipheriv(sunoCtrCipher(contentKey.length), contentKey, contentIv);
  const plain = Buffer.concat([dec.update(Buffer.from(encBytes)), dec.final()]);
  if (plain.length < 10000) throw new Error('Giải mã xong nhưng dữ liệu quá nhỏ — sai key.');
  return Array.from(new Uint8Array(plain));
}

ipcMain.handle('suno-download-decrypt', async (event, payload) => {
  if (!payload || typeof payload !== 'object') throw new Error('Payload không hợp lệ');
  if (!payload.clipId || !payload.bytes) throw new Error('Thiếu clipId hoặc dữ liệu audio.');
  return sunoMangoDecrypt(payload.session, payload.clipId, payload.bytes);
});

// ─── Suno Split-Studio (split mp3 → upload parts → assemble in Studio) ──────
// Port of the TOOL SUNO Extension split-studio pipeline (cvt3.js):
//   POST /api/studio/create-or-load-project-for-clip/{seed}
//   GET  /api/studio/project/{id} → state
//   POST /api/studio/save-project {project_id, state, title}
//   POST /api/studio/render-state {…, export_mode:"fullsong_export"} → clip id
//   POST /api/feed/v3 {filters:{ids:{presence:"True",clipIds}}} poll → audio_url
const SUNO_STUDIO_HOSTS = ['https://studio-api.prod.suno.com', 'https://studio-api-prod.suno.com'];

async function sunoStudioFetch(path, { token, cookieHeader, method = 'GET', body, timeoutMs = 30000 }) {
  const headers = sunoBaseHeaders(token, cookieHeader);
  const payload = body !== undefined ? JSON.stringify(body) : undefined;
  if (payload !== undefined) headers['Content-Type'] = 'application/json';
  let lastErr = '';
  for (const host of SUNO_STUDIO_HOSTS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(host + path, { method, headers, signal: ctrl.signal, ...(payload !== undefined ? { body: payload } : {}) });
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : {}; } catch (e) { json = { raw: String(text).slice(0, 200) }; }
      if (!res.ok) {
        if (res.status === 404) { lastErr = host + ' 404'; continue; }
        throw new Error('Suno Studio API HTTP ' + res.status + ' ' + JSON.stringify(json).slice(0, 220));
      }
      return json;
    } catch (e) {
      lastErr = (e && e.message) || String(e);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('Không gọi được Suno Studio API (' + lastErr + ').');
}

function sunoStudioDownbeats(totalBeats, bps, n = 4) {
  const out = [];
  for (let r = 0; r < Math.ceil(totalBeats); r += 1) out.push([r / bps, (r % n) + 1]);
  return out;
}

// ─── Suno Split session persistence ─────────────────────────────────────────
// Parts (mp3 bytes) + manifest (clipIds, statuses) live under userData so an
// app restart never loses a 70-part upload run. Bytes are read lazily, only
// for parts that still need uploading.
function sunoSplitDir() {
  return path.join(app.getPath('userData'), 'sunosplit');
}

function sunoSplitSafeKey(name) {
  return String(name || 'session').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80) || 'session';
}

ipcMain.handle('suno-split-write-parts', async (event, payload) => {
  const key = sunoSplitSafeKey(payload && payload.key) + '-' + Date.now();
  const dir = path.join(sunoSplitDir(), key);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of (payload && payload.files) || []) {
    const name = String(f.name || '').replace(/[\\/:*?"<>|]/g, '-');
    if (!name || !f.data) continue;
    fs.writeFileSync(path.join(dir, name), Buffer.from(f.data));
  }
  return { key };
});

ipcMain.handle('suno-split-save-manifest', async (event, payload) => {
  const key = sunoSplitSafeKey(payload && payload.key);
  const dir = path.join(sunoSplitDir(), key);
  fs.mkdirSync(dir, { recursive: true });
  const manifest = { ...(payload && payload.manifest), savedAt: Date.now() };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  return { ok: true };
});

ipcMain.handle('suno-split-list', () => {
  const root = sunoSplitDir();
  let dirs = [];
  try { dirs = fs.readdirSync(root); } catch (e) { return { sessions: [] }; }
  const sessions = [];
  for (const d of dirs) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(root, d, 'manifest.json'), 'utf8'));
      const parts = Array.isArray(m.parts) ? m.parts : [];
      sessions.push({
        key: d,
        fileName: m.fileName || d,
        savedAt: m.savedAt || 0,
        total: parts.length,
        done: parts.filter((p) => p.status === 'done' && p.clipId).length,
        projectId: m.projectId || '',
        studioUrl: m.studioUrl || ''
      });
    } catch (e) {}
  }
  sessions.sort((a, b) => b.savedAt - a.savedAt);
  return { sessions: sessions.slice(0, 5) };
});

ipcMain.handle('suno-split-load', async (event, key) => {
  const dir = path.join(sunoSplitDir(), sunoSplitSafeKey(key));
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  return { manifest };
});

ipcMain.handle('suno-split-read-part', async (event, payload) => {
  const dir = path.join(sunoSplitDir(), sunoSplitSafeKey(payload && payload.key));
  const name = String((payload && payload.filename) || '').replace(/[\\/:*?"<>|]/g, '-');
  const buf = fs.readFileSync(path.join(dir, name));
  return Array.from(new Uint8Array(buf));
});

ipcMain.handle('suno-split-clear', async (event, key) => {
  const dir = path.join(sunoSplitDir(), sunoSplitSafeKey(key));
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  return { ok: true };
});

ipcMain.handle('suno-split-assemble', async (event, payload) => {
  if (!payload || typeof payload !== 'object') throw new Error('Payload không hợp lệ');
  const { session, seedClipId, seedTitle, seedDurationSec, parts } = payload;
  if (!seedClipId || !Array.isArray(parts) || parts.length === 0) throw new Error('Thiếu seed clip hoặc danh sách parts.');
  const { token, cookieHeader } = await sunoResolveToken(session);
  const auth = { token, cookieHeader };
  const sorted = parts.slice().sort((a, b) => a.number - b.number);

  const created = await sunoStudioFetch('/api/studio/create-or-load-project-for-clip/' + encodeURIComponent(seedClipId), { ...auth, method: 'POST' });
  if (!created || typeof created.id !== 'string' || !created.id) throw new Error('Suno không trả project ID.');
  const projectId = created.id;

  const proj = await sunoStudioFetch('/api/studio/project/' + encodeURIComponent(projectId), auth);
  if (!proj || !proj.state || typeof proj.state !== 'object') throw new Error('Suno trả project không có arrangement state.');
  // s_() port: fill every default the Studio UI requires to render clips.
  const rawState = JSON.parse(JSON.stringify(proj.state || {}));
  const state = {
    amplitude: 1, sections: {}, lyricsCorrectionsByClipId: {},
    metronome: { enabled: false, amplitude: 1 }, midiNotePreviewEnabled: true,
    markersRegistry: {},
    timeSignatureChanges: [{ startBeats: 0, subdivisionsPerBar: 4, beatsPerSubdivision: 1 }],
    loop: { enabled: false, startBeats: 0, endBeats: 0 },
    songFadeInBeats: 0, songFadeOutBeats: 0,
    layout: { editorPanelType: null, midiAutomationLaneId: { category: 'noteProperty', property: 'velocity' }, midiAutomationLaneHeight: 24, arrangementEditorHeight: 280 },
    editorPointerModes: { audio: 'select', midi: 'select' },
    masterSignalChain: [], midiControllerSignalChain: [], masterRoutingMode: 'linear', routing: {},
    ...rawState,
    timing: { ...(rawState?.timing || {}) },
    selection: {
      anchorBeats: 0, focusBeats: 0, trackIds: [], focusedTrackId: null, focusedTakeLaneId: null,
      focusedArea: 'timeline', arrangementAnchorBeats: null, arrangementFocusBeats: null,
      noteIds: [], pluginIds: [], warpMarkerSeconds: {}, automationPointIndices: [],
      contextBeforeBeats: 32, contextAfterBeats: 32
    }
  };

  let bps = state?.timing?.bps;
  if (!(Number.isFinite(bps) && bps >= 0.3 && bps <= 5)) {
    const fb = state?.timing?.fallbackBPS;
    bps = (Number.isFinite(fb) && fb >= 0.3 && fb <= 5) ? fb : 2;
  }
  if (!Array.isArray(state.tracks)) state.tracks = [];
  let track = state.tracks.find((t) => t?.type === 'audio' && Array.isArray(t.clips));
  if (!track) {
    const crypto = require('crypto');
    track = {
      type: 'audio', id: crypto.randomUUID(), input: null, color: '#02AF4A', name: 'Audio Track',
      clips: [], clipCreationIntents: [], height: 86, solo: false, mute: false, arm: false,
      amplitude: 1, balance: 0, instrument: { type: 'song' }, soloTakeLaneId: null, takeLanesExpanded: false,
      takeLanes: [], eq: { enabled: true,
        band1: { type: 'highpass', enabled: false, frequency: 60, gain: 0, q: 0.707 },
        band2: { type: 'lowshelf', enabled: true, frequency: 160, gain: 0, q: 0.707 },
        band3: { type: 'peaking', enabled: true, frequency: 450, gain: 0, q: 0.707 },
        band4: { type: 'peaking', enabled: true, frequency: 1200, gain: 0, q: 0.707 },
        band5: { type: 'highshelf', enabled: true, frequency: 3200, gain: 0, q: 0.707 },
        band6: { type: 'lowpass', enabled: false, frequency: 8800, gain: 0, q: 0.707 } },
      signalChain: [], routingMode: 'linear'
    };
    state.tracks.push(track);
    state.timing = { type: 'follow-track', fallbackBPS: bps, trackId: track.id };
  } else if (state.timing?.type === 'follow-track') {
    state.timing = { fallbackBPS: bps, trackId: track.id, ...state.timing };
  } else {
    state.timing = { bpsAutomation: [], ...state.timing, bps, type: 'manual', lockBPS: true };
  }

  const crypto = require('crypto');
  const wanted = new Map([[seedClipId, { number: 1, title: seedTitle || 'Part 1', durationSec: seedDurationSec }]]);
  for (const p of sorted) wanted.set(p.clipId, { number: p.number, title: p.title, durationSec: p.durationSec });
  const keep = [];
  const others = [];
  for (const c of track.clips) {
    if (c?.asset?.id && wanted.has(c.asset.id)) keep.push(c);
    else others.push(c);
  }
  const placed = new Map(keep.map((c) => [c.asset.id, c]));
  let cursor = placed.size
    ? Math.min(...[...placed.values()].map((c) => (Number.isFinite(c.startBeats) ? c.startBeats : 0)))
    : others.reduce((m, c) => (Number.isFinite(c?.endBeats) ? Math.max(m, c.endBeats) : m), 0);
  const ordered = [...wanted.entries()].map(([clipId, meta]) => ({ clipId, ...meta })).sort((a, b) => a.number - b.number);
  const fresh = [];
  for (const it of ordered) {
    const len = (Number.isFinite(it.durationSec) && it.durationSec > 0) ? it.durationSec * bps : null;
    if (!(len > 0)) throw new Error(`Part ${it.number} chưa có độ dài — không đặt lên timeline được.`);
    const start = cursor;
    const end = cursor + len;
    const ex = placed.get(it.clipId);
    // Always rebuild from the exact r_ template so clips placed by older
    // app builds (missing amplitude/curves) get repaired on re-assemble.
    fresh.push({
      type: 'audio', streaming: false, mute: false, reversed: false,
      fadeInBeats: 0, fadeOutBeats: 0, fadeInCurve: 1, fadeOutCurve: 1,
      transposition: 0, formantCorrection: 0, amplitude: 1,
      ...(ex || {}), id: (ex && ex.id) || crypto.randomUUID(),
      asset: { type: 'clip', id: it.clipId }, name: it.title, color: track.color || '#02AF4A',
      startBeats: start, endBeats: end, readStartBeats: 0,
      loop: { enabled: false, startBeats: 0, endBeats: len },
      warp: { enabled: false, awaitingAnalysis: false, markersHash: null }
    });
    cursor = end;
  }
  track.clips = [...others, ...fresh];

  const rawTitle = String(seedTitle || '').trim().replace(/\.(?:mp3|wav|m4a|flac|ogg|aac|webm)$/i, '').replace(/[\s_-]*part\s*\d+$/i, '').trim() || 'Suno Toolkit Project';
  const baseTitle = '[Split] ' + rawTitle;
  await sunoStudioFetch('/api/studio/save-project', { ...auth, method: 'POST', body: { project_id: projectId, state, title: baseTitle } });

  // Verify: re-read the saved project and confirm our clips are all there,
  // in order and gapless (except intentionally skipped failed parts).
  const check = await sunoStudioFetch('/api/studio/project/' + encodeURIComponent(projectId), auth);
  const checkState = (check && check.state) || {};
  let checkBps = checkState?.timing?.bps;
  if (!(Number.isFinite(checkBps) && checkBps >= 0.3 && checkBps <= 5)) checkBps = bps;
  const audioTracks = (Array.isArray(checkState.tracks) ? checkState.tracks : [])
    .filter((t) => t?.type === 'audio' && Array.isArray(t.clips));
  const ours = [];
  for (const t of audioTracks) {
    for (const c of t.clips) {
      const hit = ordered.find((o) => o.clipId === c?.asset?.id);
      if (hit) ours.push({ number: hit.number, startBeats: c.startBeats, endBeats: c.endBeats });
    }
  }
  ours.sort((a, b) => a.number - b.number);
  const placedNumbers = ours.map((o) => o.number);
  const expectedNumbers = ordered.map((o) => o.number);
  const missing = expectedNumbers.filter((n) => !placedNumbers.includes(n));
  let gapless = true;
  for (let i = 1; i < ours.length; i++) {
    if (Math.abs(ours[i].startBeats - ours[i - 1].endBeats) > 0.001) { gapless = false; break; }
  }
  const totalBeats = ours.length ? ours[ours.length - 1].endBeats : 0;
  const studioUrl = 'https://suno.com/studio?for_clip_id=' + encodeURIComponent(seedClipId) + '&st_project=' + encodeURIComponent(projectId);
  return {
    projectId, studioUrl, partsPlaced: ordered.length, title: baseTitle,
    verified: ours.length,
    totalSec: totalBeats > 0 ? totalBeats / checkBps : 0,
    gapless, missing
  };
});

ipcMain.handle('suno-split-inspect', async (event, payload) => {
  if (!payload || typeof payload !== 'object') throw new Error('Payload không hợp lệ');
  const { session, projectId } = payload;
  if (!projectId) throw new Error('Thiếu project ID — Ghép Studio trước đã.');
  const { token, cookieHeader } = await sunoResolveToken(session);
  const proj = await sunoStudioFetch('/api/studio/project/' + encodeURIComponent(projectId), { token, cookieHeader, timeoutMs: 60000 });
  const state = (proj && proj.state) || {};
  const tracks = (Array.isArray(state.tracks) ? state.tracks : []).map((t, i) => ({
    index: i,
    name: t?.name || ('(track ' + i + ')'),
    type: t?.type || '?',
    id: t?.id || '',
    clipCount: Array.isArray(t?.clips) ? t.clips.length : 0,
    clips: (Array.isArray(t?.clips) ? t.clips : []).slice(0, 200).map((c) => ({
      name: c?.name || '',
      assetId: c?.asset?.id || '',
      startBeats: c?.startBeats ?? null,
      endBeats: c?.endBeats ?? null,
      mute: !!c?.mute
    }))
  }));
  return {
    title: proj.title || '',
    latestVersion: proj.latest_version_id || '',
    timing: state.timing || null,
    tracks
  };
});

ipcMain.handle('suno-split-export', async (event, payload) => {
  if (!payload || typeof payload !== 'object') throw new Error('Payload không hợp lệ');
  const { session, projectId, title } = payload;
  if (!projectId) throw new Error('Thiếu project ID.');
  const { token, cookieHeader } = await sunoResolveToken(session);
  const auth = { token, cookieHeader };
  const proj = await sunoStudioFetch('/api/studio/project/' + encodeURIComponent(projectId), { ...auth, timeoutMs: 60000 });
  if (!proj || !proj.state) throw new Error('Không đọc được project từ Suno.');
  const totalBeats = (Array.isArray(proj.state.tracks) ? proj.state.tracks : [])
    .flatMap((t) => (Array.isArray(t?.clips) ? t.clips : []))
    .reduce((m, c) => (Number.isFinite(c?.endBeats) ? Math.max(m, c.endBeats) : m), 0);
  if (!(totalBeats > 0)) throw new Error('Project chưa có audio nào để render.');
  let bps = proj.state?.timing?.bps;
  if (!(Number.isFinite(bps) && bps >= 0.3 && bps <= 5)) bps = 2;
  const body = {
    title: typeof title === 'string' && title ? title : (proj.title || ''),
    lyrics: '', tags: '', negative_tags: '', style_summary: '', caption: '',
    state: proj.state, start_beats: 0, end_beats: totalBeats,
    project_id: 'default', studio_project_id: projectId,
    ...(proj.latest_version_id ? { studio_project_version_id: proj.latest_version_id } : {}),
    web_client_pathname: '/studio', downbeats: sunoStudioDownbeats(totalBeats, bps),
    export_mode: 'fullsong_export', generate_midi_preview: false
  };
  const ren = await sunoStudioFetch('/api/studio/render-state', { ...auth, method: 'POST', body, timeoutMs: 60000 });
  if (!ren || typeof ren.id !== 'string' || !ren.id) throw new Error('Suno không render được bài từ arrangement này.');
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    const clip = await sunoStudioFetch('/api/feed/v3', { ...auth, method: 'POST', body: { filters: { ids: { presence: 'True', clipIds: [ren.id] } }, limit: 1 }, timeoutMs: 30000 });
    const row = (clip && Array.isArray(clip.clips) ? clip.clips : []).find((r) => r?.id === ren.id) || null;
    const status = String(row?.status || '').toLowerCase();
    if (/error|rejected|failed/.test(status)) throw new Error('Suno render bài thất bại.');
    if (row && typeof row.audio_url === 'string' && row.audio_url) {
      return { clipId: ren.id, songUrl: 'https://suno.com/song/' + encodeURIComponent(ren.id), audioUrl: row.audio_url };
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error('Suno render quá lâu (>10 phút) — mở Studio kiểm tra trực tiếp.');
});

ipcMain.handle('suno-download-bytes', async (event, audioUrl) => {
  const u = String(audioUrl || '');
  if (!/^https:\/\//i.test(u)) throw new Error('URL audio không hợp lệ.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  try {
    const res = await fetch(u, { headers: { 'User-Agent': SUNO_DL_UA }, signal: ctrl.signal });
    if (!res.ok) throw new Error('Tải audio thất bại (HTTP ' + res.status + ') — link CDN có thể đã hết hạn, bấm Download lại để lấy link mới.');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 10000) throw new Error('File tải về quá nhỏ (' + buf.length + ' bytes) — link CDN có thể đã hết hạn.');
    if (buf.length > 200 * 1024 * 1024) throw new Error('File quá lớn (>200MB) — từ chối để tránh treo app.');
    return Array.from(new Uint8Array(buf));
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('Hết giờ tải audio (120s) — mạng chậm, thử lại sau.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
});

// ─── Suno connect (in-app login window, no F12/copy-paste needed) ───────────
// Opens a small login window to suno.com. After the user signs in, the app
// reads the session cookies straight from Electron's cookie store (httpOnly
// cookies included) and stores them as the session — same result as pasting
// the Cookie header, without touching the user's browser or any DPAPI/ABE
// decryption (those encrypted browser stores are not readable from outside).

const SUNO_CONNECT_BASE = 'https://suno.com';
const SUNO_CONNECT_PARTITION = 'persist:suno-connect';
let sunoConnectWindow = null;
let sunoConnectPollTimer = null;
let sunoConnectDone = false;
let sunoClipWatchTimer = null;

function sunoStopConnectPolling() {
  if (sunoConnectPollTimer) {
    clearInterval(sunoConnectPollTimer);
    sunoConnectPollTimer = null;
  }
}

function sunoStopClipWatch() {
  if (sunoClipWatchTimer) {
    clearInterval(sunoClipWatchTimer);
    sunoClipWatchTimer = null;
  }
}

// Persist a session string and send the result (quota check included) back to
// the renderer. Used by both the clipboard auto-import and the connect window.
async function sunoImportSession(text, source, out) {
  const session = sunoExtractSession(text);
  const ok = !!(session && (/__client=|__session=/.test(session) || sunoLooksLikeJwt(session)));
  let info = null;
  let error = null;
  if (ok) {
    try {
      const { token, cookieHeader } = await sunoResolveToken(session);
      info = await sunoQuota(token, cookieHeader);
    } catch (e) {
      error = e.message;
    }
    try {
      const file = sunoSessionFile();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ session, savedAt: Date.now() }, null, 2));
    } catch (e) {
      console.error('suno session save error:', e.message);
    }
    // If the in-app login window is still open (e.g. user used the clipboard
    // path instead), close it without double-finalizing.
    sunoStopConnectPolling();
    sunoConnectDone = true;
    if (sunoConnectWindow && !sunoConnectWindow.isDestroyed()) {
      sunoConnectWindow.destroy();
      sunoConnectWindow = null;
    }
  }
  if (out) {
    out.session = session;
    out.info = info;
    out.error = error;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('suno-connect-result', {
      ok,
      cancelled: false,
      source,
      session,
      info,
      error
    });
  }
  return ok;
}

// Watch the clipboard for ~2 minutes after opening suno.com in the real
// browser. As soon as the user copies a "Copy as cURL" line (or a cookie
// header / bearer token) the session is imported automatically — no paste.
async function sunoStartClipboardWatch() {
  sunoStopClipWatch();
  const deadline = Date.now() + 5 * 60 * 1000;
  sunoClipWatchTimer = setInterval(async () => {
    if (Date.now() > deadline) {
      sunoStopClipWatch();
      return;
    }
    let text = '';
    try {
      text = clipboard.readText();
    } catch (e) {
      return;
    }
    if (!text || text.length < 40) return;
    const looksUseful = /^curl\b/i.test(text) && /Cookie:|authorization:/i.test(text);
    const direct = /__client=|__session=|^eyJ[A-Za-z0-9_-]/.test(text);
    if (looksUseful || direct) {
      const ok = await sunoImportSession(text, 'clipboard');
      if (ok) sunoStopClipWatch();
    }
  }, 800);
}

// ─── Chrome DevTools Protocol helpers (Chromium-based) ──────────────────────
// Find common browser user data/profile paths + executable paths on Windows
function sunoGetBrowserPaths(name) {
  const home = os.homedir();

  // macOS: browsers live in /Applications (or ~/Applications), profiles in
  // ~/Library/Application Support/<Browser>.
  if (process.platform === 'darwin') {
    const appSupport = path.join(home, 'Library', 'Application Support');
    const apps = (rel) => [path.join('/Applications', rel), path.join(home, 'Applications', rel)];
    switch ((name || '').toLowerCase()) {
      case 'chrome':
        return {
          exec: apps('Google Chrome.app/Contents/MacOS/Google Chrome'),
          userDataDir: path.join(appSupport, 'Google', 'Chrome')
        };
      case 'edge':
        return {
          exec: apps('Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
          userDataDir: path.join(appSupport, 'Microsoft Edge')
        };
      case 'brave':
        return {
          exec: apps('Brave Browser.app/Contents/MacOS/Brave Browser'),
          userDataDir: path.join(appSupport, 'BraveSoftware', 'Brave-Browser')
        };
      case 'opera':
        return {
          exec: apps('Opera.app/Contents/MacOS/Opera'),
          userDataDir: path.join(appSupport, 'com.operasoftware.Opera')
        };
      case 'vivaldi':
        return {
          exec: apps('Vivaldi.app/Contents/MacOS/Vivaldi'),
          userDataDir: path.join(appSupport, 'Vivaldi')
        };
      case 'yandex':
        return {
          exec: apps('Yandex.app/Contents/MacOS/Yandex'),
          userDataDir: path.join(appSupport, 'Yandex', 'YandexBrowser')
        };
      case 'coccoc':
        // Cốc Cốc không phát hành bản macOS chính thức.
        return { exec: [], userDataDir: '' };
      default:
        return { exec: [], userDataDir: '' };
    }
  }

  // Windows (bản gốc).
  const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const roaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  switch ((name || '').toLowerCase()) {
    case 'chrome':
      return {
        exec: [path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'), 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'],
        userDataDir: path.join(local, 'Google', 'Chrome', 'User Data')
      };
    case 'edge':
      return {
        exec: [path.join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'],
        userDataDir: path.join(local, 'Microsoft', 'Edge', 'User Data')
      };
    case 'brave':
      return {
        exec: [path.join(local, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'), 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe', 'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'],
        userDataDir: path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data')
      };
    case 'coccoc':
      return { exec: [path.join(local, 'CocCoc', 'Browser', 'Application', 'browser.exe')], userDataDir: path.join(local, 'CocCoc', 'Browser', 'User Data') };
    case 'opera':
      return { exec: [path.join(roaming, 'Opera Software', 'Opera Stable', 'opera.exe'), 'C:\\Program Files\\Opera\\opera.exe'], userDataDir: path.join(roaming, 'Opera Software', 'Opera Stable') };
    case 'vivaldi':
      return { exec: [path.join(local, 'Vivaldi', 'Application', 'vivaldi.exe'), 'C:\\Program Files\\Vivaldi\\Application\\vivaldi.exe'], userDataDir: path.join(local, 'Vivaldi', 'User Data') };
    case 'yandex':
      return { exec: [path.join(local, 'Yandex', 'YandexBrowser', 'Application', 'browser.exe')], userDataDir: path.join(local, 'Yandex', 'YandexBrowser', 'User Data') };
    default:
      return { exec: [], userDataDir: '' };
  }
}

function pickFirstExisting(paths) {
  for (const p of paths || []) {
    try { if (fs.existsSync(p)) return p; } catch (e) {}
  }
  return '';
}

// List profile folders (Default / "Profile 1" …) that hold a cookie database,
// with display names from Local State when available.
function sunoCookieDbPaths(userDir, name) {
  const cands = [
    path.join(userDir, name, 'Network', 'Cookies'),
    path.join(userDir, name, 'Cookies')
  ];
  return cands.filter((p) => { try { return fs.existsSync(p); } catch (e) { return false; } });
}

// Cookie names + host keys are plaintext in the DB (only values are
// encrypted), so a byte scan tells which profile is actually logged in.
function sunoProfileHasSunoCookies(userDir, name) {
  try {
    for (const p of sunoCookieDbPaths(userDir, name)) {
      const fd = fs.openSync(p, 'r');
      try {
        const len = fs.fstatSync(fd).size;
        const buf = Buffer.alloc(Math.min(len, 4 * 1024 * 1024));
        fs.readSync(fd, buf, 0, buf.length, 0);
        if (buf.includes('suno.com') && (buf.includes('__session') || buf.includes('__client'))) return true;
      } finally {
        try { fs.closeSync(fd); } catch (e) {}
      }
    }
  } catch (e) {}
  return false;
}

function sunoListProfiles(userDir) {
  const out = [];
  let state = null;
  try { state = JSON.parse(fs.readFileSync(path.join(userDir, 'Local State'), 'utf8')); } catch (e) {}
  const lastUsed = state && state.profile && state.profile.last_used;
  const names = (state && state.profile && state.profile.info_cache) || {};
  try {
    for (const d of fs.readdirSync(userDir)) {
      if (d !== 'Default' && !/^Profile \d+$/.test(d)) continue;
      if (!sunoCookieDbPaths(userDir, d).length) continue;
      const display = (names[d] && names[d].name) || d;
      out.push({ name: d, display, lastUsed: d === lastUsed, hasSuno: sunoProfileHasSunoCookies(userDir, d) });
    }
  } catch (e) {}
  out.sort((a, b) => (b.hasSuno - a.hasSuno) || (b.lastUsed - a.lastUsed) || (a.name === 'Default' ? -1 : 1));
  return out;
}

// Open the REAL browser visibly with the chosen profile on suno.com so the
// user can log in by hand, then retry the auto-grab. (The hidden CDP browser
// only shows a taskbar icon and can never be typed into — by design.)
ipcMain.handle('suno-open-login-browser', (event, payload) => {
  const browser = (payload && payload.browser) || 'chrome';
  const profile = payload && typeof payload.profile === 'string' ? payload.profile.trim() : '';
  const url = payload && typeof payload.url === 'string' && /^https:\/\//.test(payload.url) ? payload.url : 'https://suno.com/';
  const cfg = sunoGetBrowserPaths(browser);
  const exe = pickFirstExisting(cfg.exec);
  if (!exe) throw new Error(`Không tìm thấy trình duyệt "${browser}" trên máy.`);
  const args = [];
  if (cfg.userDataDir && fs.existsSync(cfg.userDataDir)) {
    args.push(`--user-data-dir=${cfg.userDataDir}`);
    args.push(`--profile-directory=${profile || sunoDetectProfileName(cfg.userDataDir)}`);
  }
  args.push(url);
  try {
    const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false });
    child.on('error', () => {});
    child.unref();
  } catch (e) {
    throw new Error('Không mở được trình duyệt: ' + e.message);
  }
  sunoStartLoginWatch(browser, profile, path.basename(exe));
  return { ok: true };
});

ipcMain.handle('suno-list-profiles', (event, browser) => {
  try {
    const cfg = sunoGetBrowserPaths(browser || 'chrome');
    if (!cfg.userDataDir || !fs.existsSync(cfg.userDataDir)) return { profiles: [] };
    return { profiles: sunoListProfiles(cfg.userDataDir) };
  } catch (e) {
    return { profiles: [] };
  }
});

// Which profile folder (Default / "Profile 1" …) actually holds cookies.
function sunoDetectProfileName(userDir) {
  const hasCookies = (name) =>
    fs.existsSync(path.join(userDir, name, 'Network', 'Cookies')) ||
    fs.existsSync(path.join(userDir, name, 'Cookies'));
  try {
    const ls = JSON.parse(fs.readFileSync(path.join(userDir, 'Local State'), 'utf8'));
    const last = ls && ls.profile && ls.profile.last_used;
    if (last && hasCookies(last)) return last;
  } catch (e) {}
  let other = '';
  try {
    for (const d of fs.readdirSync(userDir)) {
      if (d !== 'Default' && !/^Profile \d+$/.test(d)) continue;
      if (!hasCookies(d)) continue;
      if (d === 'Default') return d;
      if (!other) other = d;
    }
  } catch (e) {}
  return other || 'Default';
}

function sunoCopyOne(src, dest) {
  try {
    if (!fs.existsSync(src)) return false;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    return true;
  } catch (e) {
    return false;
  }
}

// Clone the whole profile folder minus heavy caches into a temp folder.
// A partial clone (cookie DB only) makes Chrome start with a half-broken
// profile that answers CDP but reports zero cookies — the full clone avoids
// that. Launching against the clone lets CDP read cookies without closing —
// or touching — the user's real browser, and sidesteps Chrome/Edge 136+
// refusing remote debugging on the default profile.
const SUNO_CLONE_SKIP_DIRS = new Set([
  'Cache', 'Code Cache', 'GPUCache', 'Service Worker', 'Session Storage',
  'Local Storage', 'IndexedDB', 'Media Cache', 'Weave', 'File System',
  'Application Cache', 'blob_storage', 'VideoDecodeStats', 'optimization_guide_model_store'
]);

function sunoCopyProfileFull(srcProfileDir, destProfileDir) {
  fs.mkdirSync(destProfileDir, { recursive: true });
  let files = 0;
  const stack = [[srcProfileDir, destProfileDir]];
  while (stack.length) {
    const [s, d] = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(s, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of entries) {
      const sp = path.join(s, e.name);
      const dp = path.join(d, e.name);
      try {
        if (e.isDirectory()) {
          if (SUNO_CLONE_SKIP_DIRS.has(e.name)) continue;
          fs.mkdirSync(dp, { recursive: true });
          stack.push([sp, dp]);
        } else if (e.isFile()) {
          if (e.name.endsWith('.log') || e.name.endsWith('.tmp')) continue;
          fs.copyFileSync(sp, dp);
          files++;
          if (files > 4000) return files;
        }
      } catch (err) { /* locked/transient files are skipped */ }
    }
  }
  return files;
}

function sunoCopyProfileSubset(srcUserDir, profileName, destUserDir) {
  const p = (rest) => path.join(srcUserDir, rest);
  const d = (rest) => path.join(destUserDir, rest);
  sunoCopyOne(p('Local State'), d('Local State'));
  const n = sunoCopyProfileFull(p(profileName), d(profileName));
  if (!n) throw new Error(`Không sao chép được cookie của profile "${profileName}"`);
  return n;
}

function sunoBrowserRunning(imageName) {
  return new Promise((resolve) => {
    if (process.platform === 'darwin') {
      // macOS: match by the bundle's executable basename (no .exe suffix),
      // e.g. "Google Chrome".
      const name = String(imageName || '').replace(/\.exe$/i, '');
      if (!name) return resolve(false);
      exec(`pgrep -x "${name.replace(/"/g, '\\"')}"`, (err, stdout) => {
        resolve(!err && !!String(stdout || '').trim());
      });
      return;
    }
    if (process.platform !== 'win32') return resolve(false);
    exec(`tasklist /FI "IMAGENAME eq ${imageName}"`, { windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return resolve(false);
      const esc = String(imageName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      resolve(new RegExp(`^\\s*${esc}\\s`, 'im').test(stdout));
    });
  });
}

function sunoKillTree(pid) {
  return new Promise((resolve) => {
    if (!pid) return resolve();
    if (process.platform !== 'win32') {
      try { process.kill(pid); } catch (e) {}
      return resolve();
    }
    exec(`taskkill /F /T /PID ${pid}`, { windowsHide: true }, () => resolve());
  });
}

// Close a whole browser family — graceful first (so Chrome flushes its cookie
// database), force only if it ignores. Only ever called after the user agreed
// in a dialog.
async function sunoKillByName(imageName) {
  if (process.platform === 'darwin') {
    const name = String(imageName || '').replace(/\.exe$/i, '').replace(/"/g, '\\"');
    if (!name) return;
    // Graceful first (quit) so Chrome/Edge flush their cookie database.
    await new Promise((resolve) => exec(`pkill -x "${name}"`, () => resolve()));
    for (let i = 0; i < 20; i++) {
      if (!(await sunoBrowserRunning(imageName))) return;
      await sunoSleep(400);
    }
    await new Promise((resolve) => exec(`pkill -9 -x "${name}"`, () => resolve()));
    return;
  }
  if (process.platform !== 'win32') return;
  await new Promise((resolve) => exec(`taskkill /IM "${imageName}"`, { windowsHide: true }, () => resolve()));
  for (let i = 0; i < 20; i++) {
    if (!(await sunoBrowserRunning(imageName))) return;
    await sunoSleep(400);
  }
  await new Promise((resolve) => exec(`taskkill /F /T /IM "${imageName}"`, { windowsHide: true }, () => resolve()));
}

const sunoSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Minimal CDP client over the global WebSocket (Node 22 ships one natively),
// so no extra dependency is needed.
function sunoCdpConnect(wsUrl) {
  return new Promise((resolve, reject) => {
    if (typeof WebSocket !== 'function') {
      reject(new Error('Node của app không có WebSocket để giao tiếp với trình duyệt.'));
      return;
    }
    let ws;
    try { ws = new WebSocket(wsUrl); } catch (e) { reject(e); return; }
    let nextId = 1;
    let opened = false;
    const pending = new Map();
    const opener = setTimeout(() => {
      if (opened) return;
      try { ws.close(); } catch (e) {}
      reject(new Error('Không kết nối được cổng debug của trình duyệt.'));
    }, 15000);
    ws.onopen = () => {
      opened = true;
      clearTimeout(opener);
      resolve({ call, close });
    };
    ws.onerror = () => {
      clearTimeout(opener);
      if (!opened) reject(new Error('Lỗi kết nối cổng debug (CDP).'));
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch (e) { return; }
      if (!msg || msg.id == null) return;
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(msg.error.message || 'Lỗi CDP'));
      else p.resolve(msg.result || {});
    };
    function call(method, params, sessionId) {
      return new Promise((res, rej) => {
        const id = nextId++;
        const timer = setTimeout(() => {
          pending.delete(id);
          rej(new Error('Quá hạn chờ phản hồi CDP: ' + method));
        }, 20000);
        pending.set(id, { resolve: res, reject: rej, timer });
        const payload = { id, method, params: params || {} };
        if (sessionId) payload.sessionId = sessionId;
        try { ws.send(JSON.stringify(payload)); } catch (e) { pending.delete(id); clearTimeout(timer); rej(e); }
      });
    }
    function close() { try { ws.close(); } catch (e) {} }
  });
}

// Start the browser with a temporary (or real) profile + a debugging port,
// then read every cookie through CDP. The browser window is thrown off-screen
// and its whole process tree is killed afterwards.
async function sunoCdpGrabCookies(exe, userDataDir, profileName) {
  const port = 9330 + Math.floor(Math.random() * 600);
  const child = spawn(exe, [
    `--user-data-dir=${userDataDir}`,
    `--profile-directory=${profileName}`,
    `--remote-debugging-port=${port}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--no-service-autorun',
    '--hide-crash-restore-bubble',
    '--disable-session-crashed-bubble',
    '--window-position=-24000,-24000',
    '--window-size=900,600',
    'about:blank'
  ], { stdio: 'ignore', windowsHide: false });
  child.on('error', () => { /* spawn failure surfaces as an empty cookie read */ });
  let cdp = null;
  try {
    let version = null;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && !version) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (res.ok) version = await res.json();
      } catch (e) { /* still starting up */ }
      if (!version) await new Promise((r) => setTimeout(r, 400));
    }
    if (!version || !version.webSocketDebuggerUrl) {
      throw new Error('không mở được remote debugging (trình duyệt từ chối cổng debug)');
    }

    cdp = await sunoCdpConnect(version.webSocketDebuggerUrl);
    let cookies = null;
    try {
      const r = await cdp.call('Storage.getCookies', {});
      if (r && r.cookies && r.cookies.length) cookies = r.cookies;
    } catch (e) {}
    if (!cookies) {
      try {
        const r = await cdp.call('Network.getAllCookies', {});
        if (r && r.cookies && r.cookies.length) cookies = r.cookies;
      } catch (e) {}
    }
    if (!cookies) {
      // Last resort: open a tab and ask the Network domain for those URLs.
      try {
        const t = await cdp.call('Target.createTarget', { url: 'https://suno.com/' });
        const att = await cdp.call('Target.attachToTarget', { targetId: t.targetId, flatten: true });
        await cdp.call('Network.enable', {}, att.sessionId);
        const r = await cdp.call('Network.getCookies', { urls: ['https://suno.com/', 'https://clerk.suno.com/'] }, att.sessionId);
        if (r && r.cookies && r.cookies.length) cookies = r.cookies;
        await cdp.call('Target.closeTarget', { targetId: t.targetId });
      } catch (e) {}
    }
    if (!cookies || !cookies.length) throw new Error('trình duyệt phản hồi nhưng không trả cookie nào');
    return cookies;
  } finally {
    if (cdp) { try { cdp.close(); } catch (e) {} }
    try { child.kill(); } catch (e) {}
    await sunoKillTree(child.pid);
    await new Promise((r) => setTimeout(r, 500));
  }
}

// Keep only Suno domains and serialize to a "Cookie:" style header.
function sunoCookiesToHeader(cookies) {
  const byName = {};
  for (const c of cookies || []) {
    const domain = String(c.domain || '').toLowerCase();
    if (!(domain === 'suno.com' || domain.endsWith('.suno.com') || domain === 'clerk.suno.com' || domain.endsWith('.clerk.suno.com'))) continue;
    if (!c.name || !c.value) continue;
    byName[c.name] = c.value;
  }
  return Object.entries(byName).map(([k, v]) => `${k}=${v}`).join('; ');
}

// Read every cookie in the connect partition, keep only Suno-related domains,
// and serialize them back into a "name=value; name2=value2" header.
async function sunoConnectCookieHeader() {
  const ses = session.fromPartition(SUNO_CONNECT_PARTITION);
  const all = await ses.cookies.get({});
  const byName = {};
  for (const c of all) {
    const domain = String(c.domain || '').toLowerCase();
    if (!(domain === 'suno.com' || domain.endsWith('.suno.com') || domain === 'clerk.suno.com' || domain.endsWith('.clerk.suno.com'))) continue;
    if (!c.name || !c.value) continue;
    byName[c.name] = c.value; // dedupe, last write wins
  }
  return Object.entries(byName).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function sunoFinalizeConnect(reason) {
  if (sunoConnectDone) return;
  sunoConnectDone = true;
  sunoStopConnectPolling();
  sunoStopClipWatch();

  let header = '';
  try {
    header = await sunoConnectCookieHeader();
  } catch (e) {
    console.error('suno cookie read error:', e.message);
  }
  const ok = !!(header && /__client=|__session=/.test(header));

  let info = null;
  let error = null;
  if (ok) {
    try {
      const { token, cookieHeader } = await sunoResolveToken(header);
      info = await sunoQuota(token, cookieHeader);
    } catch (e) {
      error = e.message;
    }
    try {
      const file = sunoSessionFile();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ session: header, savedAt: Date.now() }, null, 2));
    } catch (e) {
      console.error('suno session save error:', e.message);
    }
  } else if (reason === 'timeout') {
    error = 'Hết thời gian chờ đăng nhập (30 phút). Cửa sổ đã tự đóng — mở lại để đăng nhập tiếp (đăng nhập xong app tự nhận ngay, không cần chờ hết giờ).';
  } else if (reason !== 'closed') {
    error = 'Chưa thấy session Suno sau khi đăng nhập (thiếu cookie __session/__client).';
  }

  if (sunoConnectWindow && !sunoConnectWindow.isDestroyed()) sunoConnectWindow.destroy();
  sunoConnectWindow = null;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('suno-connect-result', {
      ok,
      cancelled: reason === 'closed',
      session: header,
      info,
      error
    });
  }
}

function openSunoConnectWindow() {
  if (sunoConnectWindow && !sunoConnectWindow.isDestroyed()) {
    sunoConnectWindow.focus();
    return;
  }
  sunoStopClipWatch();
  sunoConnectDone = false;
  const options = {
    width: 430,
    height: 680,
    title: 'Đăng nhập Suno (đóng cửa sổ khi xong)',
    parent: mainWindow,
    modal: false,
    autoHideMenuBar: true,
    webPreferences: {
      partition: SUNO_CONNECT_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  };
  sunoConnectWindow = new BrowserWindow(options);
  sunoConnectWindow.setMenuBarVisibility(false);

  // Let OAuth popups (Google/Apple…) stay inside the same cookie partition.
  sunoConnectWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!/^https:/.test(url)) return { action: 'deny' };
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        ...options,
        parent: mainWindow
      }
    };
  });

  sunoConnectWindow.loadURL(SUNO_CONNECT_BASE);

  sunoConnectWindow.on('closed', () => {
    sunoConnectWindow = null;
    if (!sunoConnectDone) sunoFinalizeConnect('closed');
  });

  // Poll the cookie store: commit as soon as a real login (__client + __session)
  // is seen. Generous 30-minute window — logging in (SSO, picking a browser
  // profile, OTP…) can take a while; success finalizes immediately anyway.
  const startedAt = Date.now();
  sunoConnectPollTimer = setInterval(async () => {
    if (Date.now() - startedAt > 30 * 60 * 1000) {
      await sunoFinalizeConnect('timeout');
      return;
    }
    let header = '';
    try {
      header = await sunoConnectCookieHeader();
    } catch (e) {
      return;
    }
    if (/(?:^|;\s*)__client=[^;]+/.test(header) && /(?:^|;\s*)__session=[^;]+/.test(header)) {
      await sunoFinalizeConnect();
    }
  }, 1200);
}

ipcMain.handle('suno-connect', () => {
  openSunoConnectWindow();
  return { ok: true };
});

ipcMain.handle('suno-connect-close', () => {
  if (sunoConnectWindow && !sunoConnectWindow.isDestroyed()) sunoConnectWindow.close();
  return { ok: true };
});

// Open suno.com in the user's real default browser (already logged in via
// SSO) and start watching the clipboard for a Copy-as-cURL session.
ipcMain.handle('suno-open-browser', () => {
  sunoStopClipWatch();
  shell.openExternal(`${SUNO_CONNECT_BASE}/studio`);
  sunoStartClipboardWatch();
  return { ok: true };
});

// Core grab used by the button AND by the login watcher: read cookies from
// the chosen browser/profile (asking to close the browser if needed) and
// import + save the session. Returns profile info for status messages.
async function sunoGrabSessionFromBrowser(browser, wantedProfile) {
  browser = browser || 'chrome';
  wantedProfile = typeof wantedProfile === 'string' ? wantedProfile.trim() : '';
  sunoStopLoginWatch();
  const cfg = sunoGetBrowserPaths(browser);
  const exe = pickFirstExisting(cfg.exec);
  if (!exe) {
    throw new Error(`Không tìm thấy trình duyệt "${browser}" trên máy. Hãy cài nó, hoặc chọn "Khác" và dùng cách Copy as cURL.`);
  }
  if (!cfg.userDataDir || !fs.existsSync(cfg.userDataDir)) {
    throw new Error(`Không tìm thấy hồ sơ (profile) của ${browser}: ${cfg.userDataDir || '(không rõ đường dẫn)'}`);
  }

  const exeName = path.basename(exe);
  let profileName = sunoDetectProfileName(cfg.userDataDir);
  if (wantedProfile) {
    const ok = sunoListProfiles(cfg.userDataDir).some((p) => p.name === wantedProfile);
    if (!ok) {
      throw new Error(`Profile "${wantedProfile}" không có cookie để đọc — chọn profile khác (profile bạn đã đăng nhập suno.com).`);
    }
    profileName = wantedProfile;
  }
  if (!sunoProfileHasSunoCookies(cfg.userDataDir, profileName)) {
    const others = sunoListProfiles(cfg.userDataDir).filter((p) => p.hasSuno).map((p) => p.display || p.name);
    if (others.length) {
      throw new Error(`Profile "${profileName}" chưa đăng nhập Suno. Profile có dấu hiệu đã login: ${others.join(', ')} — chọn đúng rồi thử lại.`);
    }
  }
  const notes = [];
  let header = '';
  let via = '';
  let closedByUs = false;

  // A running browser holds an exclusive lock on its cookie database, so the
  // file physically cannot be copied. Ask first — never kill silently.
  if (await sunoBrowserRunning(exeName)) {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      buttons: [`Đóng ${browser} và lấy session`, 'Để sau'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: 'Cần đóng ' + browser,
      message: `${browser} đang mở nên file cookie bị khóa, app chưa đọc được.`,
      detail: `App sẽ đóng hẳn ${browser} (${exeName}), mở lại ở cửa sổ tạm thời ở chế độ ẩn để đọc cookie __client/__session, rồi khởi động lại ${browser} như bình thường.\n\nCác tab đang mở thường được khôi phục tự động — hãy lưu những gì đang dở trước khi đồng ý.`
    });
    if (choice !== 0) {
      throw new Error(`Bạn chưa đóng ${exeName}. Hãy đóng hẳn ${browser} rồi bấm lại nút này.`);
    }
    await sunoKillByName(exeName);
    for (let i = 0; i < 30; i++) {
      if (!(await sunoBrowserRunning(exeName))) break;
      await sunoSleep(400);
    }
    if (await sunoBrowserRunning(exeName)) {
      throw new Error(`Không đóng được ${exeName} — hãy đóng tay rồi bấm lại.`);
    }
    closedByUs = true;
  }

  // 1) Preferred: clone the cookie store into a temp profile and debug that —
  //    works on Chrome/Edge 136+, which refuse remote debugging on the real
  //    default profile.
  const tmp = path.join(os.tmpdir(), `chicken-suno-profile-${Date.now()}`);
  const diskHasSuno = sunoProfileHasSunoCookies(cfg.userDataDir, profileName);
  try {
    sunoCopyProfileSubset(cfg.userDataDir, profileName, tmp);
    const h = sunoCookiesToHeader(await sunoCdpGrabCookies(exe, tmp, profileName));
    if (h) { header = h; via = 'sao chép profile'; }
    else if (diskHasSuno) {
      notes.push('bản sao profile: Chrome khóa đọc cookie (app-bound encryption) — file có login nhưng trình duyệt tạm đọc ra rỗng');
    }
    else notes.push('bản sao profile: đọc được cookie nhưng không có cookie suno.com (bạn đã đăng nhập suno.com trên trình duyệt này chưa?)');
  } catch (e) {
    notes.push('bản sao profile: ' + e.message);
  } finally {
    setTimeout(() => {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
    }, 3000);
  }

  // 2) Fallback: debug the real profile directly (only older browsers allow it,
  //    but it costs nothing to try).
  if (!header) {
    try {
      const h = sunoCookiesToHeader(await sunoCdpGrabCookies(exe, cfg.userDataDir, profileName));
      if (h) { header = h; via = 'profile thật'; }
      else notes.push('profile thật: không có cookie suno.com');
    } catch (e) {
      notes.push('profile thật: ' + e.message);
    }
  }

  // Hand the browser back to the user if we were the ones who closed it.
  // Minimize our own window first so the relaunched browser is not hidden
  // behind the app (Windows foreground-lock often leaves it covered and the
  // user cannot click/type into it).
  if (closedByUs) {
    try {
      const back = spawn(exe, [], { detached: true, stdio: 'ignore', windowsHide: false });
      back.on('error', () => {});
      back.unref();
    } catch (e) {}
    try {
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
        mainWindow.minimize();
      }
    } catch (e) {}
  }

  if (!header) {
    if (diskHasSuno) {
      throw new Error(`Profile "${profileName}" có login Suno nhưng Chrome chặn đọc tự động (app-bound). Dùng “Đăng nhập trong app” (cửa sổ chờ 30 phút, xong tự nhận) hoặc “Mở bằng trình duyệt” rồi Copy as cURL.`);
    }
    throw new Error(`Chưa đọc được cookie Suno từ ${browser} (profile "${profileName}"). ${notes.join(' | ')}.`);
  }
  if (/(?:^|;\s*)__(?:client|session)=v\d{2}:/.test(header)) {
    throw new Error('Cookie đọc được nhưng vẫn ở dạng mã hóa — app không giải mã nổi. Dùng "Mở bằng trình duyệt" rồi Copy as cURL.');
  }
  if (!/__client=|__session=/.test(header)) {
    try {
      const child = spawn(exe, [
        `--user-data-dir=${cfg.userDataDir}`,
        `--profile-directory=${profileName}`,
        'https://suno.com/'
      ], { detached: true, stdio: 'ignore', windowsHide: false });
      child.on('error', () => {});
      child.unref();
    } catch (e) {}
    throw new Error(`Profile "${profileName}" chưa đăng nhập Suno — app vừa mở Chrome đúng profile đó cho bạn đăng nhập. Đăng nhập xong, bấm lại nút “Tự lấy session”.`);
  }

  const out = {};
  const ok = await sunoImportSession(header, `cdp-${browser}`, out);
  if (!ok) throw new Error('Không nhận diện được session Suno từ cookie vừa đọc.');
  if (!out.info) throw new Error(out.error || 'Không xác minh được session với Suno — hãy đăng nhập lại.');
  return { ok: true, browser, via, profile: profileName };
}

ipcMain.handle('suno-auto-from-browser', async (_evt, payload) => {
  const browser = (payload && payload.browser) || 'chrome';
  const wantedProfile = payload && typeof payload.profile === 'string' ? payload.profile.trim() : '';
  return sunoGrabSessionFromBrowser(browser, wantedProfile);
});

// Watcher: after "Mở trình duyệt login" opens the real browser, wait until
// the user closes it (i.e. finished logging in), then auto-grab + save the
// session — no extra button press, no stale cached session.
let sunoLoginWatchTimer = null;

function sunoStopLoginWatch() {
  if (sunoLoginWatchTimer) {
    clearInterval(sunoLoginWatchTimer);
    sunoLoginWatchTimer = null;
  }
}

// Visible-window check: Chrome's "continue running background apps" keeps
// chrome.exe alive after all windows close, so process presence alone can
// wait forever. A zero MainWindowHandle count means the user is done.
function sunoBrowserWindowsOpen(imageName) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(false);
    const base = String(imageName || '').replace(/\.exe$/i, '');
    exec(`powershell -NoProfile -Command "(Get-Process -Name '${base}' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Measure-Object).Count"`, { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(true); // fail open: keep waiting, don't grab early
      resolve(parseInt(String(stdout).trim(), 10) > 0);
    });
  });
}

function sunoStartLoginWatch(browser, profileName, exeName) {
  sunoStopLoginWatch();
  const deadline = Date.now() + 30 * 60 * 1000;
  const giveUpAt = Date.now() + 3 * 60 * 1000;
  let seenWindow = false;
  debugLogMain(`[suno] login-watch start browser=${browser} profile=${profileName || '(auto)'}`);
  sunoLoginWatchTimer = setInterval(async () => {
    try {
      if (Date.now() > deadline) {
        sunoStopLoginWatch();
        return;
      }
      const open = await sunoBrowserWindowsOpen(exeName);
      if (open) { seenWindow = true; return; }
      if (!seenWindow) {
        if (Date.now() > giveUpAt) {
          sunoStopLoginWatch();
          debugLogMain('[suno] login-watch: no browser window appeared — spawn may have failed');
        }
        return;
      }
      sunoStopLoginWatch();
      debugLogMain('[suno] login browser closed — auto-grabbing session');
      try {
        const out = await sunoGrabSessionFromBrowser(browser, profileName);
        debugLogMain(`[suno] login-watch grabbed via=${out.via} profile=${out.profile}`);
      } catch (e) {
        debugLogMain('[suno] login-watch grab failed: ' + (e && e.message ? e.message : String(e)).slice(0, 200));
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('suno-connect-result', {
            ok: false, cancelled: false, source: 'login-watch',
            session: '', info: null,
            error: (e && e.message ? e.message : String(e)) + ' — bấm “Tự lấy session từ trình duyệt này” để thử lại.'
          });
        }
      }
    } catch (e) { /* watcher must never crash the app */ }
  }, 8000);
}

// ─── YouTube download (ported as-is from the working reference project at
// "TOOL SUNO Extension/desktop/electron/main.js") ─────────────────────────
// Downloaded audio is handed to the renderer as a plain local file path;
// the renderer feeds it into the exact same Suno Split-Studio "Import"
// pipeline a user-picked file would go through — nothing about the actual
// Suno upload/split logic is touched here.
let ytDownloadCancelled = false;

function youtubeParseVideoId(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  if (/^[\w-]{11}$/.test(text)) return text;
  const m = text.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/);
  return m ? m[1] : null;
}

ipcMain.handle('youtube-resolve', async (_evt, link) => {
  const { Innertube } = await import('youtubei.js');
  const id = youtubeParseVideoId(link);
  if (!id) throw new Error('Link YouTube không hợp lệ.');
  const yt = await Innertube.create({ lang: 'vi', location: 'VN' });
  const info = await yt.getBasicInfo(id);
  if (info.basic_info.is_live) throw new Error('Không tải được video đang phát trực tiếp.');
  return {
    videoId: id,
    title: info.basic_info.title || '',
    author: (info.basic_info.channel && info.basic_info.channel.name) || '',
    durationSec: info.basic_info.duration || null,
    thumbnailUrl: (info.basic_info.thumbnail && info.basic_info.thumbnail[0] && info.basic_info.thumbnail[0].url) || ''
  };
});

// Tried in order until one actually streams bytes successfully. YouTube's
// anti-bot/PO-token enforcement varies per video and changes over time —
// a client that works for one video can get a "non 2xx status code" on
// another, so no single client is reliable for every video. VISIONOS first
// (matches the reference project, usually dodges the PO-token 403), then
// a spread of other known-working clients as fallback.
const YT_DOWNLOAD_CLIENTS = ['VISIONOS', 'IOS', 'ANDROID', 'WEB', 'TV'];

ipcMain.handle('youtube-download', async (event, payload) => {
  const { Innertube, Utils } = await import('youtubei.js');
  const id = youtubeParseVideoId(payload && payload.link);
  if (!id) throw new Error('Link YouTube không hợp lệ.');
  ytDownloadCancelled = false;

  const yt = await Innertube.create({ lang: 'vi', location: 'VN' });

  const dir = path.join(app.getPath('temp'), 'sunopro-youtube', id);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.m4a`);

  let lastErr = null;
  for (const client of YT_DOWNLOAD_CLIENTS) {
    if (ytDownloadCancelled) throw new Error('Đã hủy tải.');
    try {
      const stream = await yt.download(id, { type: 'audio', quality: 'best', format: 'mp4', client });
      const iterator = Utils.streamToIterable(stream)[Symbol.asyncIterator]();
      // Pulling the first chunk is where a bad client's non-2xx actually
      // surfaces (the request to the CDN only happens once consumed) —
      // only open the output file once we know this client works.
      const first = await iterator.next();
      const ws = fs.createWriteStream(file);
      let received = 0;
      const writeChunk = (chunk) => {
        received += chunk.length;
        ws.write(chunk);
        if (event.sender && !event.sender.isDestroyed()) {
          event.sender.send('youtube-download-progress', { videoId: id, receivedBytes: received });
        }
      };
      if (!first.done) writeChunk(first.value);
      while (true) {
        if (ytDownloadCancelled) { ws.close(); throw new Error('Đã hủy tải.'); }
        const { value, done } = await iterator.next();
        if (done) break;
        writeChunk(value);
      }
      await new Promise((resolve) => ws.end(resolve));
      return { videoId: id, path: file, sizeBytes: received, client };
    } catch (e) {
      if (ytDownloadCancelled) throw e; // user cancelled — stop, don't try the next client
      lastErr = e;
      // otherwise fall through and try the next client in the list
    }
  }
  throw new Error(
    'Không tải được audio sau khi thử ' + YT_DOWNLOAD_CLIENTS.length + ' client (' +
    YT_DOWNLOAD_CLIENTS.join(', ') + '). Lỗi cuối: ' +
    (lastErr && lastErr.message ? lastErr.message : String(lastErr))
  );
});

ipcMain.handle('youtube-cancel', () => {
  ytDownloadCancelled = true;
  return { ok: true };
});

app.whenReady().then(() => {
  // Give the window a stable Windows AppUserModelID so the taskbar groups
  // under Chicken Mastering (and shows our icon) instead of Electron's.
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.chicken.mastering');
  }
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  try {
    if (fs.existsSync(previewDir)) {
      fs.rmSync(previewDir, { recursive: true, force: true });
    }
  } catch (e) {
    console.error('Cleanup error:', e);
  }
});
