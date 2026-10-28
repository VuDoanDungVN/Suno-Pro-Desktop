-- Suno Pro — Worker license + session store.
-- Thiết kế rút gọn từ dự án tham khảo "TOOL SUNO Extension/cloudflare" (bỏ jobs/albums/pair_codes
-- /agents — Suno Pro là 1 app desktop đơn lẻ, không cần hàng đợi hay ghép đôi đa thiết bị).

CREATE TABLE IF NOT EXISTS licenses (
  id                TEXT PRIMARY KEY,
  key_hash          TEXT NOT NULL UNIQUE,   -- sha256(KEY đã chuẩn hoá) — không bao giờ lưu KEY gốc dạng rõ
  key_hint          TEXT NOT NULL,          -- 4 ký tự cuối, chỉ để hiển thị
  key_enc           TEXT,                   -- KEY gốc mã hoá AES-GCM bằng KEY_SECRET — chỉ Worker giải mã được
  name              TEXT NOT NULL,
  email             TEXT,
  note              TEXT,
  status            TEXT NOT NULL DEFAULT 'active',   -- 'active' | 'revoked'
  expires_at        INTEGER,
  device_id         TEXT,
  device_name       TEXT,
  activated_at      INTEGER,
  last_seen_at      INTEGER,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses (status);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash    TEXT PRIMARY KEY,   -- sha256(token phiên) — token thật không bao giờ lưu
  license_id    TEXT NOT NULL,
  role          TEXT NOT NULL,      -- 'desktop' | 'owner'
  device_name   TEXT,
  device_id     TEXT,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_license ON sessions (license_id);

-- Bộ đếm rate-limit (chống dò KEY / đăng nhập admin) + trạng thái vặt dùng chung.
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
