# Gửi mail Suno Pro (Gmail API) — hướng dẫn lấy lại `GMAIL_REFRESH_TOKEN`

Worker dùng Gmail API (OAuth2) để gửi mail OTP + KEY dùng thử qua `/trial/*` (xem
`worker/src/gmail.ts`, `worker/src/trial.ts`). Nếu OAuth Client đang dùng ở chế độ
**Testing** (chưa Publish), Google tự **hết hạn refresh token sau 7 ngày** — lúc đó
toàn bộ luồng `/trial` (xin OTP + nhận KEY) sẽ hỏng, Worker trả lỗi:

```
502 { "error": "mail_token_failed", "message": "Không lấy được quyền gửi email (Gmail)." }
```

Làm theo các bước dưới đây để cấp lại `GMAIL_REFRESH_TOKEN` mới. Mất khoảng 5-10 phút.

---

## 0. Triệu chứng nhận biết lỗi này

- Khách báo không nhận được mã OTP/KEY dùng thử qua email.
- Gọi thử API trực tiếp để xác nhận (thay `SURONRO3979` bằng mã Zalo đang ghim hiện tại,
  xem trong Admin → "Cài đặt & cấu hình" → "Mã xác nhận nhóm Zalo"):

  ```bash
  curl -sS -X POST "https://suno-pro-worker.vudungit92.workers.dev/trial/request-otp" \
    -H "Content-Type: application/json" \
    -d '{"name":"Test","email":"ban-tu-chon@gmail.com","zaloCode":"MA_ZALO_HIEN_TAI"}' \
    -w "\nHTTP_STATUS:%{http_code}\n"
  ```

  - `{"ok":true}` → mail vẫn gửi được, không phải lỗi này.
  - `mail_token_failed` → đúng lỗi này, refresh token đã hỏng, làm theo Bước 1-5.
  - `mail_send_failed` kèm `"Gmail API has not been used in project ... or it is disabled"`
    → refresh token vẫn sống, chỉ cần bật lại Gmail API cho project đó (xem Bước 4).

- Cũng có thể kiểm tra gián tiếp bằng D1: xem các lượt đăng ký `/trial` gần nhất có
  `verified_at` toàn NULL hay không (không ai xác minh được OTP = không nhận được mail):

  ```bash
  cd worker
  npx wrangler d1 execute suno-pro-db --remote --command \
    "SELECT datetime(requested_at/1000,'unixepoch','+7 hours') as requested_vn, email, verified_at FROM trial_leads ORDER BY requested_at DESC LIMIT 15;"
  ```

---

## 1. Lấy lại Client ID / Client Secret đang dùng

Vào **Google Cloud Console → APIs & Services → Credentials**:
https://console.cloud.google.com/apis/credentials

(Giao diện mới gọi là **"Google Auth Platform"** — menu bên trái mục **"Clients"** chính
là trang Credentials cũ.)

- Chọn đúng project đang dùng cho Gmail (xem lại trong lịch sử cấu hình hoặc tạo project
  mới nếu cần — xem Bước 1b).
- Bấm vào OAuth 2.0 Client ID đang dùng → copy **Client ID** và **Client secret**.

### 1b. Nếu phải tạo OAuth Client mới từ đầu

Nếu không tìm lại được client cũ, tạo mới:

1. **Credentials → + CREATE CREDENTIALS → OAuth client ID**.
2. Application type: **Web application** (để có thể khai Redirect URI, dễ dùng OAuth
   Playground hơn loại Desktop).
3. Đặt tên tuỳ ý (vd "Suno Pro Gmail").
4. Phần **Authorized redirect URIs** → **+ ADD URI** → dán:
   ```
   https://developers.google.com/oauthplayground
   ```
5. **Create** → Google hiện popup Client ID + Client Secret, copy lại cả 2.

> ⚠️ Nếu tạo Client **mới**, phải cập nhật **cả 3 secret** ở Bước 5 (`GMAIL_CLIENT_ID`,
> `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`) vì client_id/secret thay đổi. Nếu chỉ
> lấy lại token cho **client cũ, không đổi** thì chỉ cần cập nhật `GMAIL_REFRESH_TOKEN`.

### 1c. Nếu Client cũ là loại "Web application" nhưng thiếu Redirect URI

Lỗi gặp phải: `400: redirect_uri_mismatch`.

Sửa: bấm vào Client đó → mục **Authorized redirect URIs** → **+ ADD URI** → dán
`https://developers.google.com/oauthplayground` → **Save** → đợi 1-2 phút.

---

## 2. Thêm tài khoản Gmail vào danh sách Test users

Nếu app đang ở chế độ **Testing** (chưa Publish — gần như chắc chắn là vậy, vì đây
chính là lý do token hết hạn sau 7 ngày), chỉ tài khoản nằm trong **Test users** mới
đăng nhập/cấp quyền được. Thiếu bước này sẽ gặp lỗi:

```
403: access_denied — "ứng dụng này đang trong giai đoạn kiểm thử..."
```

Cách thêm:

1. **Google Auth Platform → Audience** (menu bên trái).
   (https://console.cloud.google.com/auth/audience)
2. Kéo xuống mục **"Test users"** → **"+ Add users"**.
3. Nhập đúng email Gmail dùng để gửi mail (vd `vudungit92@gmail.com`) → **Save**.
4. Xác nhận thấy số lượng tăng lên, vd "1 user (1 test, 0 other) / 100 user cap".

---

## 3. Lấy Authorization Code + đổi lấy Refresh Token (OAuth Playground)

1. Mở **https://developers.google.com/oauthplayground**
2. Bấm biểu tượng ⚙️ (Settings, góc trên bên phải).
3. **Tick vào "Use your own OAuth credentials"**.
4. Dán **Client ID** và **Client secret** đã lấy ở Bước 1. Đóng Settings lại.

   > Nếu bỏ qua bước này, Playground sẽ dùng client công khai mặc định của Google
   > (`client_id=407408718192.apps.googleusercontent.com`) — refresh token lấy được
   > sẽ **không khớp** với `GMAIL_CLIENT_ID`/`GMAIL_CLIENT_SECRET` của Worker, không
   > dùng được. Luôn kiểm tra `client_id` trong request ở Step 1/2 đúng là client của
   > bạn trước khi dùng kết quả.

5. Ở khung bên trái **"Step 1 — Select & authorize APIs"**: tìm **Gmail API v1**, tick
   scope: `https://www.googleapis.com/auth/gmail.send`
6. Bấm **"Authorize APIs"**.
7. Đăng nhập đúng tài khoản Gmail dùng để gửi mail (tài khoản đã thêm làm Test user ở
   Bước 2).
8. Nếu Google cảnh báo "Google hasn't verified this app" → bấm **Advanced** →
   **Go to [tên app] (unsafe)** → **Allow**. (App là của chính bạn nên an toàn.)
9. Quay lại Playground, vào **"Step 2 — Exchange authorization code for tokens"** →
   bấm **"Exchange authorization code for tokens"**.
10. Copy giá trị ở ô **"Refresh token"**.

---

## 4. Đảm bảo Gmail API đã được bật (Enable) cho đúng project

Nếu dùng project/Client mới tạo, Gmail API có thể chưa bật, Worker sẽ báo:

```
502 { "error": "mail_send_failed", "message": "...Gmail API has not been used in
project ... before or it is disabled..." }
```

Cách bật: vào link y hệt trong thông báo lỗi (dạng
`https://console.developers.google.com/apis/api/gmail.googleapis.com/overview?project=<id>`),
hoặc **APIs & Services → Library → tìm "Gmail API" → Enable**. Đợi khoảng 1 phút.

---

## 5. Cập nhật secret lên Cloudflare Worker

Chạy trong thư mục `worker/` (luôn target **production** — không truyền `--env`;
nếu muốn set cho staging thêm `--env staging`):

```bash
cd worker

# Nếu KHÔNG đổi Client (chỉ refresh token hết hạn) — chỉ cần lệnh này:
npx wrangler secret put GMAIL_REFRESH_TOKEN

# Nếu dùng Client ID/Secret MỚI (tạo lại từ Bước 1b) — chạy cả 3 lệnh:
npx wrangler secret put GMAIL_CLIENT_ID
npx wrangler secret put GMAIL_CLIENT_SECRET
npx wrangler secret put GMAIL_REFRESH_TOKEN
```

Mỗi lệnh sẽ hỏi nhập giá trị — dán đúng giá trị tương ứng rồi Enter. Không cần deploy
lại worker, secret áp dụng ngay.

---

## 6. Kiểm tra lại

```bash
curl -sS -X POST "https://suno-pro-worker.vudungit92.workers.dev/trial/request-otp" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","email":"ban-tu-chon@gmail.com","zaloCode":"MA_ZALO_HIEN_TAI"}' \
  -w "\nHTTP_STATUS:%{http_code}\n"
```

Thành công khi thấy `{"ok":true}` + HTTP 200. Nhớ kiểm tra luôn hộp thư
`ban-tu-chon@gmail.com` có nhận được mail OTP thật không.

Dọn lại dữ liệu test: lệnh trên sẽ tạo 1 dòng trong bảng `trial_leads` (không tạo KEY
thật, không ảnh hưởng gì) — có thể xoá nếu muốn cho sạch:

```bash
npx wrangler d1 execute suno-pro-db --remote --command \
  "DELETE FROM trial_leads WHERE email = 'ban-tu-chon@gmail.com';"
```

---

## 7. Giải pháp lâu dài — tránh lặp lại mỗi 7 ngày

Nguyên nhân gốc: OAuth Client đang ở chế độ **Testing**. Ở chế độ này Google giới hạn
refresh token sống tối đa 7 ngày. Cách tránh vĩnh viễn:

1. **Google Auth Platform → Branding** — điền đầy đủ thông tin bắt buộc (tên app, logo,
   email support, v.v. — Google yêu cầu hoàn thiện mục này trước khi cho Publish).
2. **Google Auth Platform → Audience → "Publish app"**.
3. Google sẽ cảnh báo cần "verification" vì scope `gmail.send` là scope nhạy cảm —
   nhưng vì app chỉ 1 người dùng nội bộ (chính bạn), **vẫn Publish được mà không bắt
   buộc verify ngay**. Người đăng nhập (chính bạn, lúc cấp refresh token) sẽ chỉ thấy
   màn hình cảnh báo "Google chưa xác minh ứng dụng này" — bấm qua như Bước 3.8 ở trên
   là được.
4. Sau khi Publish, refresh token **không còn tự hết hạn sau 7 ngày** nữa — chỉ hỏng
   khi bạn chủ động thu hồi quyền truy cập hoặc đổi mật khẩu Google.

---

## Tham khảo nhanh — các secret liên quan

| Secret | Vai trò |
| --- | --- |
| `GMAIL_CLIENT_ID` | Client ID của OAuth Client (Google Cloud Console → Credentials) |
| `GMAIL_CLIENT_SECRET` | Client secret tương ứng |
| `GMAIL_REFRESH_TOKEN` | Token dài hạn, Worker dùng để tự xin access token mới mỗi lần gửi mail |
| `GMAIL_SENDER` | Địa chỉ Gmail hiển thị ở "From" (tuỳ chọn, mặc định `"me"` = chính tài khoản đã cấp quyền) |

Code liên quan: `worker/src/gmail.ts` (hàm `sendMail`/`getAccessToken`),
`worker/src/trial.ts` (nơi gọi `sendMail` cho OTP + KEY dùng thử).
