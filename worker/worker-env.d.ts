interface Env {
  DB: D1Database;
  // Key "chủ" dự phòng (bypass toàn bộ license), tuỳ chọn — để trống nếu không cần.
  API_TOKEN?: string;
  // Khoá dùng mã hoá KEY gốc lưu trong D1 (key_enc) — chỉ Worker đọc lại được.
  KEY_SECRET?: string;
  // Đăng nhập trang quản trị bằng Firebase Auth (email/mật khẩu) — Worker chỉ
  // xác minh chữ ký ID token + đối chiếu email, không có mật khẩu nào do
  // Worker tự quản lý. Project Firebase dùng để đăng nhập trang admin.
  FIREBASE_PROJECT_ID?: string;
  // Danh sách email được cấp quyền quản trị, cách nhau bằng dấu phẩy.
  ADMIN_EMAILS?: string;
}
