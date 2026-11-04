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
