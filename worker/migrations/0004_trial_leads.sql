-- Danh sách email đã từng đăng ký nhận key dùng thử tại /trial (kể cả người bỏ dở, chưa xác
-- minh OTP xong) — phục vụ mục đích thu thập email/marketing, tách biệt với bảng `licenses`
-- (chỉ có email của người đã hoàn tất và thực sự nhận được key).

CREATE TABLE IF NOT EXISTS trial_leads (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT,
  requested_at  INTEGER NOT NULL,
  verified_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_trial_leads_requested ON trial_leads (requested_at);
