-- Đơn hàng Stripe Checkout (mua KEY trả phí qua /mua-key) — theo dõi trạng thái thanh toán và
-- chống cấp KEY trùng khi Stripe gọi lại webhook nhiều lần cho cùng 1 giao dịch (Stripe đảm bảo
-- "at-least-once", không phải "exactly-once"). status: pending (vừa tạo, chờ thanh toán) ->
-- processing (webhook đang xử lý, khoá chống trùng) -> paid (đã cấp key) | failed (lỗi cấp key,
-- có thể thử lại) | expired (phiên thanh toán hết hạn, khách không trả tiền).
CREATE TABLE IF NOT EXISTS stripe_orders (
  id            TEXT PRIMARY KEY,   -- Stripe Checkout Session ID (cs_...)
  plan          TEXT NOT NULL,      -- khớp key trong stripePlans() (src/stripe.ts)
  email         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  license_id    TEXT,               -- gắn sau khi issueLicense() thành công
  email_sent    INTEGER,            -- 0/1, NULL = chưa tới bước gửi
  amount_cents  INTEGER,
  currency      TEXT,
  error         TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stripe_orders_status ON stripe_orders (status);
