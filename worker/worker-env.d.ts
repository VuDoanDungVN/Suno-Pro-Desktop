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
  // Gửi mail (OTP xác minh + KEY dùng thử) qua Gmail API bằng OAuth2 refresh token của 1 Gmail
  // thật — không cần SMTP/nodemailer (Workers không hỗ trợ tốt TCP/SMTP), chỉ gọi HTTPS thường.
  GMAIL_CLIENT_ID?: string;
  GMAIL_CLIENT_SECRET?: string;
  GMAIL_REFRESH_TOKEN?: string;
  // Địa chỉ Gmail dùng để gửi (phải trùng tài khoản đã cấp refresh token ở trên).
  GMAIL_SENDER?: string;
}
