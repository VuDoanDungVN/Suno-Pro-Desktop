-- Giới hạn lượt upload/tạo nhạc theo ngày, tuỳ loại KEY (xem src/quota.ts) — kiểm soát hoàn
-- toàn trên Worker (D1), không phụ thuộc client/giờ máy khách nên không thể crack bằng cách
-- sửa app hay chỉnh giờ máy.

-- 'time' (1-12 giờ) | 'trial' (dùng thử) | 'd30' (30 ngày) | 'd365' (1 năm) | 'forever' (vĩnh
-- viễn). NULL = không xác định được loại (KEY tạo trước khi có cột này, hoặc trường hợp đặc
-- biệt) → coi như KHÔNG GIỚI HẠN (xem getPlanLimit trong src/quota.ts), để không làm gãy trải
-- nghiệm khách đã mua trước đây.
ALTER TABLE licenses ADD COLUMN plan TEXT;

-- Gán lại cho KEY đã có từ trước, suy luận được bao nhiêu thì gán, phần còn lại giữ NULL (không
-- giới hạn) — không đụng tới KEY nào đang hoạt động theo cách bất ngờ.
UPDATE licenses SET plan = 'trial' WHERE is_trial = 1 AND plan IS NULL;
UPDATE licenses SET plan = 'forever' WHERE expires_at IS NULL AND plan IS NULL;

CREATE TABLE IF NOT EXISTS usage_counters (
  license_id  TEXT NOT NULL,
  action      TEXT NOT NULL,   -- 'upload' | 'generate'
  day         TEXT NOT NULL,   -- 'YYYY-MM-DD' theo giờ Việt Nam (UTC+7), tính bằng giờ Worker
  count       INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (license_id, action, day)
);
