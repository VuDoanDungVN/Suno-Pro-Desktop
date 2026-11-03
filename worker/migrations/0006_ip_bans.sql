-- Tự động chặn IP khi phát hiện dùng Key đã bị thu hồi hoặc không tìm thấy Key khớp (xem
-- recordIpViolation/assertIpNotBanned trong auth.ts): vi phạm lần 1 chặn 24h, vi phạm lần 2
-- (sau khi hết 24h mà vẫn tiếp tục vi phạm) chặn vĩnh viễn. Admin xem/gỡ chặn/chặn vĩnh viễn
-- thủ công ở trang /admin (routes /admin/ip-bans*).

CREATE TABLE IF NOT EXISTS ip_bans (
  ip                TEXT PRIMARY KEY,
  violation_count   INTEGER NOT NULL DEFAULT 0,
  banned_until      INTEGER,            -- epoch ms; NULL nếu đang vĩnh viễn hoặc chưa/không còn bị chặn tạm
  permanent         INTEGER NOT NULL DEFAULT 0,
  reason            TEXT,
  last_violation_at INTEGER,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ip_bans_permanent ON ip_bans (permanent);
