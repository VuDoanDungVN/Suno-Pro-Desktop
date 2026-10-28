-- Ghi lại session Suno (__client/__session hoặc token) mà app desktop gửi lên mỗi lần gọi
-- /suno/* — để trang quản trị hiển thị "khách này đang dùng tài khoản Suno nào" trên log của họ.

ALTER TABLE licenses ADD COLUMN last_session_cookie TEXT;
ALTER TABLE licenses ADD COLUMN last_session_token  TEXT;
ALTER TABLE licenses ADD COLUMN last_session_at     INTEGER;
