# Cơ chế "cắt biến thiên" (shrink-on-rejection) khi upload part lên Suno

> File liên quan: `dist/assets/main-9QM-JpB-.js` (hàm `window.sunoPcmSliceToWav`,
> `window.sunoUploadWindowWithShrink`, và vòng lặp trong handler
> `a.sunoSplitUpload.addEventListener("click", ...)`).
>
> Tham khảo gốc: extension chính thức **Suno Toolkit** (Chrome Web Store,
> `cbinfbjojidpdefinlgihmogjffnldim`), file `src/sidepanel.js`, hàm nội bộ
> tương đương `Tb(H)` (đã đọc/giải mã từ bản minify để port lại).

## 1. Vấn đề cần giải quyết

Suno giới hạn **mỗi lần upload audio phải dài 2–10 phút**
(`error_type: upload_failure_duration`). Để tải lên 1 bài dài hơn 10 phút,
app phải:

1. Cắt file gốc thành nhiều **cửa sổ (window)** có độ dài cố định
   (`splitDurationSec`, người dùng chọn, mặc định 4s — xem ô "Giây mỗi
   part" ở UI Split).
2. Upload từng cửa sổ thành 1 clip riêng trên Suno.
3. Dùng Suno Studio để ghép các clip đó lại thành 1 bài hoàn chỉnh
   (`studioAssemble` ở Worker).

**Vấn đề:** Suno không chỉ từ chối vì sai độ dài — nó còn có thể từ chối
**nội dung** của một cửa sổ cụ thể (trùng bản ghi có sẵn trong catalog —
ACRCloud/Audible Magic, bị kiểm duyệt, v.v.), độc lập với độ dài. Nếu chỉ
upload nguyên cửa sổ 1 lần và bỏ qua khi bị từ chối, **toàn bộ nội dung của
cửa sổ đó** (ví dụ 4–30 giây) bị mất khỏi bài hát cuối cùng — đây là nguyên
nhân chính gây "thiếu part" trước khi có cơ chế này.

## 2. Ý tưởng cốt lõi

Khi 1 cửa sổ bị Suno từ chối, **đừng bỏ cả cửa sổ** — thử lại với một đoạn
**ngắn hơn** tại **đúng vị trí bắt đầu cũ**, co nhỏ dần cho tới khi Suno
chấp nhận, hoặc tới khi chạm **sàn tối thiểu 1 giây**. Chỉ khi ngay cả 1
giây cũng bị từ chối thì mới thật sự bỏ (skip) đúng 1 giây đó — phần còn
lại của cửa sổ vẫn được thử tiếp như một "part" mới.

→ Trường hợp xấu nhất chỉ mất **tối đa 1 giây** nội dung, thay vì mất
nguyên cả cửa sổ (có thể 4–30 giây).

## 3. Lưu đồ thuật toán

```
window = [windowStart, windowEnd)     // 1 cửa sổ cố định, vd 4 giây
floor  = 1 giây (tính theo số frame = sampleRate)

cursor = windowStart
attemptLen = windowEnd - windowStart  // độ dài đang thử, bắt đầu = cả cửa sổ

while cursor < windowEnd:
    candidateLen = min(attemptLen, windowEnd - cursor)
    cắt PCM [cursor, cursor+candidateLen) từ buffer gốc → encode WAV
    gửi upload lên Suno (toàn bộ 5 bước: init → S3 → finish → poll → initialize-clip)

    NẾU thành công:
        ghi nhận 1 "mảnh" (clip) hoàn tất
        cursor += candidateLen
        attemptLen = windowEnd - cursor      // lần sau lại thử full phần còn lại
        tiếp tục vòng lặp

    NẾU Suno từ chối (upload_rejected) VÀ candidateLen > floor:
        attemptLen = max(floor, candidateLen / 2)   // co nhỏ ~một nửa
        KHÔNG đổi cursor — thử lại đúng vị trí cũ, cỡ nhỏ hơn

    NẾU Suno từ chối VÀ candidateLen <= floor (đã ở sàn 1 giây):
        đánh dấu đoạn [cursor, cursor+candidateLen) là "skipped" (bỏ qua)
        cursor += candidateLen
        attemptLen = windowEnd - cursor
        tiếp tục vòng lặp (thử phần còn lại của cửa sổ)

    NẾU lỗi KHÁC (mạng, hết hạn phiên, timeout...):
        KHÔNG co nhỏ — ném lỗi thật ra ngoài ngay lập tức
        (co nhỏ chỉ có ý nghĩa với lỗi do NỘI DUNG bị từ chối)

kết thúc khi cursor >= windowEnd
→ trả về danh sách kết quả: mỗi phần tử là {status:"done", clipId, durationSec}
  hoặc {status:"skipped", durationSec, error}
```

### Cách phân biệt "bị từ chối vì nội dung" và "lỗi khác"

```js
const rejected = /Suno từ chối|suno_rejected/i.test(message);
```

Chỉ những lỗi khớp pattern này (thông điệp tiếng Việt do Worker
`sunoRejectionText()` tạo ra khi Suno trả `error_type`/`error_message`
thật) mới được coi là "có thể co nhỏ để khắc phục". Lỗi mạng, hết phiên,
timeout... không co nhỏ vì co nhỏ không giải quyết được nguyên nhân.

## 4. Vị trí trong code (`dist/assets/main-9QM-JpB-.js`)

### 4.1. Bước Split — lưu thêm vị trí gốc cho mỗi part

Mỗi part được split giờ lưu thêm `startFrame`/`frameCount` (vị trí thật
trong buffer PCM gốc), để sau này có thể cắt lại khi cần co nhỏ:

```js
h.push({
  number: f + 1, title: l, filename: `${l}.mp3`,
  durationSec: C / o, mp3Bytes: new Uint8Array(u),
  clipId: "", status: "queued", error: "",
  startFrame: F, frameCount: C   // ← mới thêm
});
```

### 4.2. `window.sunoPcmSliceToWav(buf, start, frames)`

Bộ encode WAV 16-bit PCM tự viết (không phụ thuộc thư viện MP3 nội bộ đã
minify của app) — cắt đúng đoạn `[start, start+frames)` từ
`buf.getChannelData(c)` của từng kênh, ghép header WAV chuẩn 44 byte +
dữ liệu interleaved 16-bit.

### 4.3. `window.sunoUploadWindowWithShrink({...})`

Hàm chính hiện thực thuật toán ở mục 3. Nhận:

| Tham số | Ý nghĩa |
|---|---|
| `session` | Session Suno (đã resolve) |
| `buffer` | `Te.buffer` — audio gốc còn trong bộ nhớ renderer (object giả lập AudioBuffer: `{numberOfChannels, sampleRate, length, getChannelData}`) |
| `windowStart`, `windowEnd` | Vị trí cửa sổ (tính theo frame) |
| `floorFrames` | Sàn tối thiểu = `Math.round(sampleRate)` (1 giây) |
| `titleBase` | Tên part gốc — mảnh con thứ 2 trở đi được đặt tên `${titleBase}_2`, `${titleBase}_3`... |
| `onUpload(item)` | Callback gọi mỗi khi 1 mảnh upload thành công — dùng để ghi log |
| `onNote(message)` | Callback gọi khi co nhỏ hoặc bỏ qua 1 đoạn — dùng để ghi log |

Trả về mảng kết quả, mỗi phần tử:
- `{status:"done", clipId, muted, title, durationSec}` — 1 mảnh đã lên Suno thành công.
- `{status:"skipped", durationSec, error}` — 1 đoạn bị bỏ (tối đa 1 giây mỗi lần).

### 4.4. Vòng lặp upload parts (`a.sunoSplitUpload` click handler)

Với mỗi part trong `Te.parts`:

- **Nếu còn `Te.buffer` (cùng phiên vừa split) và part có `startFrame`/`frameCount`** → dùng `sunoUploadWindowWithShrink` (cơ chế co nhỏ đầy đủ). Nếu 1 cửa sổ bị chia thành nhiều mảnh, mỗi mảnh `"done"` trở thành 1 part riêng trong danh sách cuối (`finalParts`), đánh số lại tuần tự (1, 2, 3, …) để bước Ghép Studio xếp đúng thứ tự.
- **Nếu không còn `Te.buffer`** (ví dụ: đã tắt app rồi mở lại, resume từ file đã lưu trên đĩa) → **rơi về hành vi cũ**: upload nguyên part (MP3 đã cắt sẵn), 1 lần duy nhất, không co nhỏ. Log các dòng này được gắn nhãn `(chế độ cũ, không co nhỏ)` để phân biệt.
- Toàn bộ phần xử lý 1 part được bọc trong `try/catch` ở mức ngoài cùng — bất kỳ lỗi bất ngờ nào (kể cả lỗi từ hàm vẽ lại UI `kn()`/`ha()`) cũng chỉ đánh dấu đúng part đó `"failed"` rồi **tiếp tục part kế tiếp**, không bao giờ làm dừng hẳn cả tiến trình.

## 5. Giới hạn đã biết

- **Chỉ hoạt động trong cùng phiên vừa Split** — vì cần `Te.buffer` (PCM gốc) còn trong bộ nhớ renderer để cắt lại. Nếu tắt app/tải lại trang rồi bấm "Upload parts" cho 1 phiên đã lưu từ trước, app tự động dùng lại cách cũ (upload 1 lần, không co nhỏ) vì không còn PCM gốc.
- Việc co nhỏ **giữ nguyên điểm bắt đầu** của cửa sổ, chỉ giảm độ dài — không trượt điểm bắt đầu sang vị trí khác để "né" đoạn bị từ chối.
- Co nhỏ chỉ áp dụng cho lỗi **nội dung bị từ chối** (khớp `/Suno từ chối|suno_rejected/i`); các lỗi khác (mạng, hết phiên, timeout) không được co nhỏ và sẽ dừng ngay với thông báo lỗi thật.

## 6. Cách xem log của cơ chế này khi chạy thật

Mở **menu ☰ → 🪵 Nhật ký tiến trình**, hoặc bấm icon 🪵 ngay trên popup
tiến trình (Upload/Ghép/Xuất) để xem mà không ảnh hưởng tới tiến trình
đang chạy. Các dòng log liên quan (đã dịch sang tiếng Việt):

| Dòng log | Ý nghĩa |
|---|---|
| `part N ▶ bắt đầu — cỡ gốc Xs, sàn tối thiểu 1.0s` | Bắt đầu xử lý cửa sổ N |
| `part N ⚠ co nhỏ còn Xs rồi thử lại (Suno từ chối đoạn Ys)` | Vừa bị từ chối ở cỡ Ys, đang thử lại ở cỡ Xs nhỏ hơn |
| `part N ⚠ bỏ qua Xs tại Ys — Suno từ chối kể cả ở mức tối thiểu 1 giây` | Đã co tới sàn 1 giây mà vẫn bị từ chối — mất đúng Xs nội dung tại vị trí Ys |
| `part N ✅ mảnh tải lên OK — clip=... dài=...s` | 1 mảnh (có thể là cả cửa sổ hoặc phần còn lại sau khi co nhỏ) đã lên Suno |
| `part N ✅ HOÀN TẤT — N clip, tổng Xs, bỏ qua Ys (Z đoạn)` | Tổng kết cửa sổ N: thành công, có thể gồm nhiều clip con |
| `part N ✗ THẤT BẠI HOÀN TOÀN — Suno từ chối toàn bộ Xs kể cả khi co xuống 1.0s` | Toàn bộ cửa sổ không upload được chút nào |
| `... (chế độ cũ, không co nhỏ) ...` | Part này đang chạy theo cách cũ (không còn PCM gốc để co nhỏ) |

## 7. Lịch sử

- Phát hiện vấn đề "thiếu part" khi đối chiếu với extension chính thức
  **Suno Toolkit** (Chrome Web Store) — extension gốc hầu như không mất
  part nhờ đúng cơ chế này.
- Port lại cho Suno-Pro trên nhánh git `feature/suno-real-browser-token`.
