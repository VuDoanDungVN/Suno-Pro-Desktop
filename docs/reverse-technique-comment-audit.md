# Audit: comment lộ kỹ thuật trong dist/index.html (pipeline Reverse)

File `dist/index.html` được đóng gói nguyên văn trong app (không build/minify/obfuscate), nên
bất kỳ ai giải nén `.asar` đều đọc được toàn bộ comment trong đó. Các đoạn dưới đây đã bị XOÁ
hoặc RÚT NGẮN khỏi `dist/index.html` vì giải thích rõ "vì sao làm vậy"/"bug gì"/"né thế nào" —
tức là lộ chất xám kỹ thuật, không chỉ là mô tả UI. Nội dung gốc được lưu lại ở đây để nội bộ
còn tham khảo khi cần (vd. debug lại sau này), vì bản trong code đã không còn chi tiết này nữa.

## 1. Dòng ~5317–5324 — lý do dùng MP3 thay WAV

> Đảo ngược (reverse) audio NGAY TRÊN MÁY, chính xác tuyệt đối theo từng mẫu âm thanh, trước khi
> upload lên Suno — tách biệt hoàn toàn khỏi mọi bước phía sau (không đụng tới logic
> Studio/AI/render/Fade Out hiện có). Chỉ đổi "bytes" + "filename" dùng ở bước Upload khi người
> dùng bật tuỳ chọn này.
> Mã hoá lại thành MP3 (không phải WAV) — đã xác nhận qua test thực tế: upload WAV khiến Suno
> Studio render bị mất ~1 phút đầu (bug phía Suno khi xử lý nguồn WAV), còn MP3 thì không — nên
> dùng lamejs (thư viện JS thuần, không cần mạng, nạp qua assets/lamejs.iife.js) mã hoá PCM đã
> đảo ngược thành MP3 thay vì tự ghi header WAV như trước.

**Lộ gì:** phát hiện riêng về bug của Suno khi nhận file WAV (mất ~1 phút đầu khi render), và
cách né (chuyển hẳn sang MP3 bằng lamejs).

## 2. Dòng ~5332–5333 — chi tiết bước đảo mẫu + encode

> Đảo ngược thứ tự mẫu + chuyển sang Int16 PCM (y hệt logic reverse cũ, chỉ khác định dạng đích:
> Int16Array cho lame thay vì ghi thẳng vào buffer WAV).

**Lộ gì:** xác nhận rõ cơ chế encode cụ thể (Int16 PCM cho lamejs) — không nghiêm trọng bằng (1)
nhưng vẫn là chi tiết "cách làm" không cần thiết phải lộ.

## 3. Dòng ~5433–5438 — bug đọc duration sai với MP3 VBR

> Độ dài đọc từ thẻ `<audio>` trên máy (readDuration ở bước đầu) có thể sai lệch (có khi gần một
> nửa) với vài kiểu MP3 VBR thiếu header seek chuẩn. Nếu dùng số sai này để đặt timeline Studio,
> bài sẽ bị render cụt mất phần sau. Xác nhận lại bằng đúng độ dài Suno tự đo được
> (metadata.duration) trước khi tạo project — best-effort: nếu Suno chưa trả kịp trong thời gian
> chờ, dùng tạm số đọc trên máy, không chặn hẳn pipeline.

**Lộ gì:** 1 gotcha kỹ thuật cụ thể (MP3 VBR + thẻ `<audio>` đọc sai duration) và cách khắc phục
(dùng `metadata.duration` của Suno thay vì tin tưởng client).

## 4. Dòng ~5469–5471 và ~5489–5491 — 2 đoạn "chẩn đoán" bug mất đoạn đầu

> Chẩn đoán (chỉ đọc, không đổi gì): log lại chính xác vị trí clip trên timeline ngay sau khi
> ghép xong — để so với lúc sau render, xác định bug cắt mất đoạn đầu (khi Reverse cục bộ bật)
> xảy ra ở bước nào.
>
> Chẩn đoán lần 2: log lại vị trí clip NGAY TRƯỚC KHI render (sau khi AI/Export đã lưu) — nếu
> khác với lần log ở trên, nghĩa là bước AI/Export đã làm lệch vị trí clip; nếu giống hệt, nghĩa
> là lỗi nằm ở chính bước render/encode phía Suno.

**Lộ gì:** xác nhận công khai rằng pipeline có 1 bug đã biết (mất đoạn đầu khi bật Reverse cục
bộ) + toàn bộ hướng điều tra (so sánh vị trí clip trước/sau AI·Export) để tìm đúng bước gây lỗi.

## 5. Dòng ~5511–5513 và ~5533–5536 — logic "Bỏ qua Fade Out" + dọn dẹp giữ `[Done]`

> Tuỳ chọn "Bỏ qua Fade Out": dừng ngay ở đây, dùng thẳng bản vừa render (đã gồm reverse) làm
> bản cuối cùng — không gọi bước Fade Out nữa. Mặc định (bỏ chọn) vẫn chạy đủ pipeline như
> trước, không đổi hành vi cũ.
>
> Dọn TOÀN BỘ clip liên quan tới bài này (clip gốc upload, bản render/fade qua API, clip lạ
> trùng tên...) — CHỈ GIỮ LẠI bản "[Done] " + tên bài. Best-effort: nếu lỗi hoặc chưa tìm thấy
> bản "[Done]", KHÔNG xoá gì cả và vẫn dùng bản render/fade hiện tại — không được phép làm hỏng
> hay mất kết quả đã có.

**Lộ gì:** giải thích đúng quy ước đặt tên nội bộ (tiền tố `"[Done] "`) và chính xác logic chọn
bản cuối cùng để giữ lại khi dọn dẹp thư viện Suno.

## 6. (Tái kiểm tra sau khi thêm luồng Chọn bài hát/YouTube/Hàng đợi nối vào Reverse) — dòng ~5434–5437

> 8 bước cố định (Đọc file, Reverse cục bộ, Upload, Xác nhận độ dài, Tạo project, Gửi lệnh AI,
> Render, Dọn dẹp) — Reverse giờ luôn chạy (không còn tuỳ chọn), Fade Out luôn bị bỏ qua (hệ
> thống không dùng tới) nên không cộng thêm bước nào cho nó nữa.

**Lộ gì:** liệt kê đích danh toàn bộ 8 bước của pipeline theo đúng thứ tự thực thi — bản đồ luồng
xử lý hoàn chỉnh, mức lộ tương đương (1). Đã xoá khỏi `dist/index.html`, chỉ giữ `var totalSteps = 8;`
(không giải thích vì sao là 8).

Rà soát toàn bộ comment mới thêm từ sau lần audit đầu (tích hợp Chọn bài hát/YouTube/Hàng đợi vào
Reverse, sửa popup đè nhau, reset popup YouTube) — còn lại đều chỉ giải thích kiến trúc/UI (vd.
"đây là lối vào mới, không đụng nút Reverse cũ", "ẩn popup cũ tránh đè lên popup mới") hoặc bug
hiển thị thông thường, không nêu cách Suno/Studio được tự động hoá hay lý do kỹ thuật nào khác —
không cần xoá thêm.

## 7. (Lần rà soát thứ 3 — mở rộng sang `electron/main.js`, trước đó chỉ soát `dist/index.html`)

Cùng 1 bug MP3 VBR duration ở item (3) hoá ra còn lặp lại 1 bản khác trong `electron/main.js`
(hàm `suno-clip-duration`), chưa bị xoá lần trước vì audit cũ chỉ soát `dist/index.html`:

> Lấy ĐÚNG độ dài thật do chính Suno đo được cho 1 clip (metadata.duration) — dùng để thay cho
> cách đọc duration bằng thẻ `<audio>` trên máy (có thể sai gần một nửa với vài kiểu MP3 VBR thiếu
> header seek chuẩn), tránh timeline Studio (suno-split-assemble) bị đặt ngắn hơn thật khiến bài
> render ra bị cụt mất phần sau. Poll `/suno/generate-status` (đã tự chờ đúng status==="complete"
> + metadata.duration mới coi là "ready") tới khi có hoặc hết giờ.

Cùng khu vực `electron/main.js`, phát hiện thêm 4 đoạn mới (chưa từng được audit vì không nằm
trong luồng Reverse, mà ở luồng upload-part gốc + luồng "Tạo nhạc bằng AI"):

- **Device-id lấy từ cookie `ajs_anonymous_id`:** `sunoNormalizeDeviceId()` có comment nói rõ
  cách suy ra device-id Suno yêu cầu là copy đúng theo cách 1 extension tham khảo làm, lấy từ
  cookie `ajs_anonymous_id` của suno.com. **Lộ gì:** cách bịa/suy ra 1 header xác thực Suno yêu
  cầu + tên nguồn tham khảo đã port theo.
- **TTL token Clerk 60s + chi tiết "75 part":** comment cache token nói rõ "JWT Clerk mặc định
  sống 60s" và kể lại trường hợp cụ thể "split-upload 75 part cho 1 bài" từng bị mint lại token
  dư thừa. **Lộ gì:** thời gian sống thật của token xác thực Suno (Clerk JWT) + chi tiết quy mô
  vận hành nội bộ (bao nhiêu part/bài).
- **"_part " prefix né việc Suno cắt đuôi tên dài:** comment ở bước export nói rõ Suno tự cắt bớt
  PHẦN ĐUÔI của tên file quá dài, nên phải chèn "_part" ở ĐẦU để hệ thống dọn dẹp lọc đúng part.
  **Lộ gì:** hành vi cắt tên file của Suno + mẹo đặt tên để lách qua hành vi đó.
- **Đệm lyrics "wv" tới sát 5000 ký tự:** comment ở luồng Tạo nhạc AI (và bản song song trong
  `dist/index.html`) giải thích rõ Suno giới hạn tối đa 5000 ký tự và lý do đệm đúng tới 4999 ký
  tự. **Lộ gì:** giới hạn ký tự thật của Suno + mục đích/cách tính toán phần đệm.
- **Danh sách model lấy từ field `models` trong `/suno/verify`:** comment nói Suno không có
  endpoint liệt kê model riêng, và việc này "port từ cvt3.js của app tham khảo". **Lộ gì:** 1 đặc
  điểm API của Suno (thiếu endpoint) + tên file nguồn đã tham khảo/port theo.

Toàn bộ 5 đoạn trên đã được rút ngắn trong cả `electron/main.js` và `dist/index.html` (chỗ có bản
song song) — chỉ còn mô tả CHỨC NĂNG (gọi API nào, làm gì), không còn giải thích "vì sao"/"Suno có
hành vi gì"/"copy theo nguồn nào". Logic/giá trị hằng số (vd. `SUNO_PROMPT_MAX = 4999`,
`SUNO_TOKEN_CACHE_MS = 45000`) giữ nguyên 100%, chỉ xoá phần giải thích bằng lời.

**Đã xem nhưng CHƯA xử lý — cần bạn quyết định riêng:** cụm comment ở `electron/main.js` (khoảng
dòng 2025–2545) giải thích cách app đọc cookie đăng nhập Suno từ trình duyệt thật của người dùng
qua Chrome DevTools Protocol (CDP) — bao gồm chi tiết: nhân bản (clone) toàn bộ profile trình
duyệt để lách việc Chrome/Edge bản 136+ chặn remote debugging trên profile gốc, mở trình duyệt ở
vị trí ngoài màn hình, dùng cổng debug để đọc cookie rồi tắt tiến trình. Đây LÀ 1 kỹ thuật cụ thể,
nhưng khác loại với các mục trên: cơ chế này đã được giải thích công khai ngay trong hộp thoại xác
nhận hiển thị cho người dùng khi họ bấm dùng tính năng ("mở lại ở cửa sổ tạm thời ở chế độ ẩn để
đọc cookie __client/__session") — nên không hẳn là bí mật bị giấu kín, và đối tượng "bị qua mặt"
là hành vi của Chrome/Edge (công khai, Google tự công bố) chứ không phải Suno. Tôi chưa xoá/rút
gọn cụm này — nếu bạn vẫn muốn ẩn luôn các chi tiết này (vd. số phiên bản Chrome/Edge cụ thể, lý do
phải nhân bản profile), nói tôi biết để xử lý riêng.

**Lưu ý riêng (không phải lộ kỹ thuật, nhưng cần nhớ):** `electron/main.js` hiện đang có:
```
// TẠM trỏ sang worker staging để test — nhớ đổi lại trước khi build bản phát hành cho khách.
const SUNOPRO_WORKER_API = 'https://suno-pro-worker-staging.vudungit92.workers.dev';
```
Đây là thay đổi tạm để test trên nhánh `staging`, lộ domain worker staging trong code (không phải
"cách làm" nhưng vẫn là thông tin hạ tầng). Phải đổi lại về URL production trước khi build bản
phát hành thật cho khách.

---

## Đã xử lý ở đâu khác (không cần sửa)

- `worker/src/suno-studio-automation.ts` (dòng 1–7) đã tự giải thích rõ: toàn bộ phần tự động
  hoá gửi lệnh AI + Export (selector DOM, nội dung 2 câu lệnh, kỹ thuật ẩn cửa sổ) đã được
  chuyển hẳn sang chạy trên Cloudflare Worker — **không đóng gói trong app**, nên không bị lộ
  dù app có bị giải nén. Giữ nguyên, không cần sửa.
- Các dòng `logLine(...)` trong `dist/index.html` (vd. "🔎 Sau ghép — tracks: ...", "projectId:
  ...") in thẳng JSON cấu trúc track/clipId ra Nhật ký tiến trình — đây không phải comment nên
  không thuộc phạm vi xoá lần này, nhưng vẫn là 1 kênh lộ dữ liệu runtime nếu người dùng xem log.
  Có thể cân nhắc rút gọn riêng nếu cần.
