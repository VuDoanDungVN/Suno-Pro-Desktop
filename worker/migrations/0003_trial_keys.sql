-- Cờ đánh dấu key dùng thử (tạo hàng loạt qua /admin/licenses/bulk) — để lọc riêng trong danh
-- sách khách và dọn dẹp hàng loạt khi đã hết hạn, không đụng tới key khách hàng trả phí.

ALTER TABLE licenses ADD COLUMN is_trial INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_licenses_trial ON licenses (is_trial, expires_at);
