-- Trước migration này, issueLicense() chỉ map plan='d30'/'d365' — KEY mua gói "6 tháng" (stripe
-- plan key '6m', 180 ngày) bị lưu plan=NULL, coi như không giới hạn quota và không phân biệt được
-- với KEY vĩnh viễn/KEY admin không gán plan. Giờ auth.ts đã map đúng thành 'd180' cho license MỚI;
-- câu lệnh này backfill lại các KEY 6 tháng đã bán trước đó, dựa vào stripe_orders (plan='6m',
-- status='paid', đã có license_id) — không đụng tới license nào khác.
UPDATE licenses
SET plan = 'd180'
WHERE id IN (
  SELECT license_id FROM stripe_orders WHERE plan = '6m' AND status = 'paid' AND license_id IS NOT NULL
);
