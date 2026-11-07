-- Khách nhập tên của mình ngay trong popup thanh toán ở /mua-key (trước đây chỉ có email, nên
-- license được cấp tạm lấy email làm "tên khách" trên Admin). Lưu tên thật để fulfillOrder()
-- dùng khi issueLicense(), và Admin hiển thị đúng tên khách thay vì email.
ALTER TABLE stripe_orders ADD COLUMN name TEXT;
