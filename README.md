# Suno Pro

**Suno Pro** là ứng dụng desktop (Mac/Windows, xây bằng Electron) hỗ trợ xử lý và
tải nhạc tạo bởi [Suno](https://suno.com) ở quy mô lớn — ghép/ cắt (split), xuất
hàng loạt, dọn dẹp bản nháp — đi kèm một dịch vụ máy chủ (Cloudflare Worker) đóng
vai trò proxy gọi API nội bộ của Suno và quản lý license (KEY) cho từng khách hàng.

> ⚠️ Đây là phần mềm độc quyền (proprietary), bán theo từng KEY. Xem đầy đủ điều
> khoản tại [COPYRIGHT.md](COPYRIGHT.md) trước khi sử dụng, sao chép hoặc sửa đổi.

## Mục lục

- [Kiến trúc tổng quan](#kiến-trúc-tổng-quan)
- [Ứng dụng desktop (Electron)](#ứng-dụng-desktop-electron)
- [Máy chủ Worker (Cloudflare)](#máy-chủ-worker-cloudflare)
- [Hệ thống license & KEY dùng thử](#hệ-thống-license--key-dùng-thử)
- [Trang quản trị (/admin)](#trang-quản-trị-admin)
- [Cấu trúc thư mục](#cấu-trúc-thư-mục)
- [Phát triển & chạy thử](#phát-triển--chạy-thử)
- [Đóng gói bản phát hành](#đóng-gói-bản-phát-hành)
- [Bản quyền](#bản-quyền)

## Kiến trúc tổng quan

```
┌─────────────────────────┐        HTTPS (Bearer license token)        ┌──────────────────────────────┐
│   Electron app (client)  │ ───────────────────────────────────────▶ │  Cloudflare Worker (backend)  │
│  renderer (dist/) + main │ ◀─────────────────────────────────────── │  suno-pro-worker               │
└─────────────────────────┘                                            └──────────────┬────────────────┘
          │  session Suno (JWT/cookie)                                                 │
          │  do CHÍNH người dùng tự đăng nhập, gửi kèm mỗi request                      │  proxy
          ▼                                                                             ▼
   (không lưu ở app)                                                          studio-api.prod.suno.com
                                                                                         │
                                                                                         ▼
                                                                                 D1 (suno-pro-db)
                                                                         licenses · sessions · meta ·
                                                                              trial_leads
```

Nguyên tắc cốt lõi: **mọi thao tác gọi Suno (`/suno/*`) đều phải qua Worker và
được `authorize()` kiểm tra license hợp lệ + đúng thiết bị trên TỪNG request** —
khác với việc chỉ kiểm tra license một lần ở phía app. Nhờ vậy, thu hồi 1 KEY là
chặn truy cập ngay lập tức, kể cả khi bản app trên máy khách đã bị patch để bỏ
qua phần kiểm tra license ở client.

Các logic "nhạy cảm" của nghiệp vụ Suno (cấu trúc payload Studio, field EQ mặc
định, endpoint chính xác, cách tính browser-token qua WASM...) được port 1:1 từ
`electron/main.js` sang `worker/src/suno-proxy.ts` và chỉ tồn tại ở phía server —
bản app phát hành cho khách không còn chứa các đoạn này.

## Ứng dụng desktop (Electron)

- `electron/main.js` — tiến trình main: tạo cửa sổ (`BrowserWindow` không khung,
  500×560, thu nhỏ/phóng to tùy biến), quản lý license/activation offline cũ,
  license Worker mới (`sunopro-license-*`), chặn phím tắt mở DevTools ở bản
  đóng gói, đọc/ghi file (chọn file, lưu MP3/JSON, đọc audio...), lấy MAC
  address, system info.
- `electron/preload.js` — cầu nối an toàn (`contextBridge`) giữa renderer và
  main process, expose `window.electronAPI` với các API: chọn file/thư mục, lưu
  file, đọc/ghi audio, log debug ra file, kích hoạt/kiểm tra license, lấy trạng
  thái dùng thử (trial) offline cũ.
- `dist/index.html` — giao diện renderer (đã build sẵn, nạp trực tiếp khi đóng
  gói; khi chạy dev không có `dist/` sẽ fallback sang `http://localhost:5173`).
- userData của app được cố định về thư mục cũ (`chicken-remastering`) dù app đã
  đổi tên thành "Suno Pro", để không làm mất `activation.json`/`trial.json`/
  `suno-session.json` của người dùng đang nâng cấp từ bản cũ.

Session Suno (JWT/cookie) do chính người dùng tự đăng nhập Suno rồi dán vào app —
Worker chỉ chuyển tiếp hộ, không lưu trữ hay chia sẻ cho bên thứ ba.

## Máy chủ Worker (Cloudflare)

Thư mục `worker/` — một Cloudflare Worker (`suno-pro-worker`) dùng D1
(`suno-pro-db`, SQLite) làm cơ sở dữ liệu. Các route chính (`worker/src/index.ts`):

| Nhóm | Route | Mô tả |
| --- | --- | --- |
| Kích hoạt | `POST /auth/activate` | Kích hoạt 1 KEY cho thiết bị hiện tại |
| Phiên | `GET /auth/me`, `POST /auth/logout` | Thông tin license hiện tại, đăng xuất |
| Proxy Suno | `POST /suno/*` | Toàn bộ thao tác gọi Suno: `verify`, `upload/*`, `studio/assemble`, `studio/inspect`, `studio/export/*`, `generate`, `generate-status`, `my-songs`, `cleanup`, `trash-clip`, `permanent-delete`, `download/prepare`, `mango-rights` — mỗi request đều qua `authorize()` |
| Dùng thử tự phục vụ | `GET /trial`, `POST /trial/request-otp`, `POST /trial/verify-otp` | Trang công khai để người dùng tự lấy KEY dùng thử 1 ngày (xem mục bên dưới) |
| Quản trị | `GET /admin`, `/admin/*` | Trang và API quản trị, đòi Firebase ID token hợp lệ (`requireAdmin`) |

Các module chính trong `worker/src/`:

- `index.ts` — router chính, điều phối toàn bộ route ở trên.
- `auth.ts` — kích hoạt/License, ràng buộc thiết bị, rate-limit (dựa trên bảng
  `meta`), toàn bộ API quản trị KEY (tạo/sửa/xóa/thu hồi/đổi KEY/reset thiết bị),
  tạo hàng loạt KEY, KEY dùng thử, danh sách email đăng ký dùng thử.
- `suno-proxy.ts` — proxy gọi `studio-api.prod.suno.com` thay cho app, giữ
  nguyên payload/endpoint gốc, dùng WASM (`suno-wasm/`) để tính browser-token.
- `trial.ts` — trang `/trial` tự phục vụ + luồng OTP email 2 bước.
- `broadcast.ts` — soạn & gửi mail hàng loạt tới danh sách email đã thu thập.
- `email-template.ts` — khuôn mẫu email dùng chung (OTP, KEY dùng thử, mail
  hàng loạt) để mọi email gửi ra có cùng 1 giao diện thương hiệu.
- `gmail.ts` — gửi mail qua Gmail API (OAuth2 refresh-token), không dùng
  SMTP/nodemailer (Workers không hỗ trợ tốt TCP/SMTP thực sự).
- `admin-page.ts` — toàn bộ trang quản trị HTML/CSS/JS (single-page, không
  framework), đăng nhập bằng Firebase Auth.
- `http.ts` — tiện ích dùng chung: `HttpError`, `json()`, `readJson()`,
  `cleanText()`, CORS headers.

## Hệ thống license & KEY dùng thử

- **License chính**: mỗi KEY gắn với 1 thiết bị (device-bound), kiểm tra lại
  trên từng request `/suno/*` chứ không chỉ lúc kích hoạt — đảm bảo thu hồi KEY
  có hiệu lực ngay lập tức.
- **Tạo hàng loạt** (`POST /admin/licenses/bulk`): sinh tối đa 1000 KEY/lần
  (chunk insert D1 từng 50), đặt cờ `is_trial` để lọc/thống kê/dọn dẹp riêng.
- **KEY dùng thử tự phục vụ** (trang `/trial`, công khai, không cần đăng nhập):
  1. Người dùng nhập **Tên + Email** + **mã xác nhận nhóm Zalo** (mã này do
     admin đặt/đổi trong trang quản trị, bắt người dùng phải thực sự tham gia
     nhóm mới lấy được mã).
  2. Hệ thống gửi **mã OTP 6 số** về email (hết hạn 10 phút, tối đa 5 lần thử
     sai, rate-limit theo IP) — xác minh email có thật, chặn điền email bừa.
  3. Xác minh OTP đúng → tạo 1 KEY dùng thử 1 ngày (`is_trial = 1`) và **gửi
     KEY về đúng email đó**. Mỗi email chỉ được nhận 1 KEY dùng thử (chống lạm
     dụng).
  4. Mọi lượt đăng ký (kể cả chưa hoàn tất xác minh) đều được ghi vào bảng
     `trial_leads` để admin xem danh sách/khai thác sau này.
  - Gửi mail qua **Gmail API (OAuth2)** — không cần Cloudflare Email Sending
    trả phí, không dùng SMTP.
  - Dọn dẹp KEY dùng thử hết hạn: `DELETE /admin/licenses/trial/expired`.

## Trang quản trị (`/admin`)

Trang HTML tĩnh phục vụ không cần token (chỉ chính trang này mới cần đăng nhập
Firebase; mọi gọi API `/admin/*` bên trong mới đòi Bearer ID token), gồm:

- Danh sách & quản lý KEY: tạo/sửa/xóa, thu hồi, đổi KEY, reset thiết bị, lọc
  theo "chỉ KEY dùng thử".
- **Tạo hàng loạt KEY** — nhập số lượng, ghi chú, tải kết quả dạng CSV.
- **Dọn KEY dùng thử hết hạn** — xóa nhanh các KEY `is_trial` đã quá hạn.
- **Mã xác nhận nhóm Zalo** — xem/đổi mã dùng cho bước 1 của luồng `/trial`.
- **Danh sách email đăng ký dùng thử** (`trial_leads`) — xem tên/email/thời
  gian đăng ký/trạng thái xác minh, xuất CSV.
- **Gửi mail hàng loạt** — soạn tiêu đề + nội dung, chọn đối tượng (tất cả /
  đã xác minh / chưa xác minh), xem trước (dùng đúng khuôn mẫu email thương
  hiệu), gửi với giãn cách tùy chỉnh (0–120 giây, mặc định 2 giây). Gửi theo
  mô hình **polling**: trang quản trị gọi lặp lại API trạng thái, và mỗi lần
  gọi đó vừa trả tiến độ vừa tự gửi tiếp 1 email nếu đã đủ giãn cách — cách
  này né được giới hạn cứng 30 giây của `ctx.waitUntil()` trên Cloudflare
  Workers. Hệ quả: **cần giữ tab quản trị đang mở trong lúc gửi**; đóng rồi mở
  lại sẽ tiếp tục đúng chỗ dở dang (trạng thái lưu ở D1), không gửi trùng.

## Cấu trúc thư mục

```
Suno-Pro/
├── electron/              # main process + preload của ứng dụng Electron
│   ├── main.js
│   └── preload.js
├── dist/                  # renderer đã build (nạp bởi electron/main.js)
├── worker/                # Cloudflare Worker (backend/license/proxy Suno)
│   ├── src/
│   │   ├── index.ts           # router chính
│   │   ├── auth.ts            # license, admin API, KEY dùng thử
│   │   ├── suno-proxy.ts      # proxy gọi Suno
│   │   ├── trial.ts           # trang /trial + OTP email
│   │   ├── broadcast.ts       # gửi mail hàng loạt
│   │   ├── email-template.ts  # khuôn mẫu email dùng chung
│   │   ├── gmail.ts           # gửi mail qua Gmail API (OAuth2)
│   │   ├── admin-page.ts      # trang /admin
│   │   ├── http.ts            # tiện ích dùng chung
│   │   └── suno-wasm/         # module WASM tính browser-token
│   ├── migrations/         # migration D1 (SQL)
│   ├── wrangler.jsonc      # cấu hình Worker (binding D1, tên Worker...)
│   └── worker-env.d.ts     # khai báo kiểu Env (secrets, bindings)
├── scripts/                # script hỗ trợ đóng gói Windows
├── build/                  # icon và tài nguyên đóng gói
├── COPYRIGHT.md            # điều khoản bản quyền / sử dụng
└── package.json            # script đóng gói app desktop
```

## Phát triển & chạy thử

### Ứng dụng desktop

```bash
npm install
npm start            # chạy Electron, nạp dist/ nếu có, fallback localhost:5173 khi dev
```

### Worker

```bash
cd worker
npm install
npm run dev                  # wrangler dev — chạy local
npm run db:migrate:local     # áp dụng migration vào D1 local
npm run db:migrate:remote    # áp dụng migration vào D1 production
npm run deploy                # wrangler deploy — triển khai production
```

Các secret cần thiết lập trước khi deploy (`wrangler secret put <TÊN>`):

| Secret | Dùng cho |
| --- | --- |
| `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_SENDER` | Gửi mail OTP/KEY/broadcast qua Gmail API (OAuth2) |
| (các secret Firebase Admin, nếu có) | Xác thực `requireAdmin()` cho trang `/admin` |

> Không bao giờ đặt secret trực tiếp trong mã nguồn — luôn dùng
> `wrangler secret put` hoặc biến môi trường cục bộ (`worker/.dev.vars`, đã
> được `.gitignore` loại trừ).

## Đóng gói bản phát hành

```bash
npm run package:mac   # đóng gói cho macOS (arm64 + x64)
npm run package:win   # đóng gói cho Windows (kèm set icon)
npm run package:all   # cả hai
```

Quá trình đóng gói loại trừ `worker/`, `docs/`, `scripts/`, `.git/`,
`README.md`... khỏi gói app — mã nguồn Worker (nơi chứa logic nghiệp vụ nhạy
cảm với Suno) không bao giờ được đóng gói kèm theo bản phát hành cho khách.

## Bản quyền

© 2026 Vũ Dũng (vudungit92@gmail.com). Phần mềm độc quyền, bán theo từng KEY
riêng cho mỗi khách hàng. Nghiêm cấm sao chép, phân phối lại, dịch ngược, gỡ bỏ
cơ chế xác thực/cấp phép, hoặc chia sẻ/khai thác KEY ngoài phạm vi đã mua. Xem
đầy đủ tại [COPYRIGHT.md](COPYRIGHT.md).
