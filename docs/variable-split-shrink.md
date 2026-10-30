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

Khi 1 cửa sổ bị Suno từ chối, **đừng vội co nhỏ/bỏ** — với nhạc tempo nhanh
(mật độ nốt dày), dù co tới sàn vẫn có thể còn đủ đặc trưng để bị
fingerprint-match. Nên trước khi co nhỏ, thử thêm 2 bậc **giữ nguyên kích
thước, không mất nội dung gì**:

- **(A) Thử lại nguyên bản sau 1 nhịp nghỉ ngắn (~2.5s)** — một phần
  rejection chỉ là lỗi tạm thời phía Suno (quá tải/timeout xử lý fingerprint
  lúc đó), không phải thật sự trùng nội dung.
- **(C) Thử lại với 1 phép biến đổi "vô thanh"** — điều biên độ cực nhỏ
  (±0.15%, tần số lạ 13.7Hz) + dither dưới ngưỡng 1 bit — không nghe ra
  được, nhưng đủ để phá vỡ khớp fingerprint tuyệt đối theo waveform (nguyên
  nhân chính gây rejection do trùng catalog).

Chỉ khi **cả A và C đều vẫn bị từ chối** mới co nhỏ một nửa (như cũ) và lặp
lại đúng 2 bậc A, C ở kích thước mới — cho tới khi chạm **sàn tối thiểu
0.5 giây** (hạ từ 1 giây xuống, giảm tối đa thiệt hại mỗi lần phải bỏ).
Chỉ khi ngay cả 0.5 giây (đã qua cả A, C) cũng bị từ chối thì mới thật sự bỏ
(skip) đúng 0.5 giây đó.

→ Trường hợp xấu nhất chỉ mất **tối đa 0.5 giây** nội dung (trước đây 1
giây), và phần lớn trường hợp rejection do fingerprint-match có thể được
"cứu" hoàn toàn nhờ (C) mà không mất tí nội dung nào.

## 3. Lưu đồ thuật toán

```
window = [windowStart, windowEnd)     // 1 cửa sổ cố định, vd 4 giây
floor  = 0.5 giây (tính theo số frame = round(sampleRate * 0.5))

cursor = windowStart
attemptLen = windowEnd - windowStart  // độ dài đang thử, bắt đầu = cả cửa sổ

while cursor < windowEnd:
    candidateLen = min(attemptLen, windowEnd - cursor)

    // Bậc 1: nguyên bản, không biến đổi.
    thử upload PCM [cursor, cursor+candidateLen) (gốc)
    NẾU thành công -> ghi nhận "done", cursor += candidateLen, sang vòng kế.

    NẾU bị từ chối do NỘI DUNG (không phải 429/401/mạng):
        // Bậc 2 (A): đợi 2.5s, thử lại NGUYÊN BẢN, cùng kích thước.
        thử lại upload PCM [cursor, cursor+candidateLen) (gốc, sau khi đợi)
        NẾU thành công -> ghi nhận "done" (không mất nội dung), sang vòng kế.

        NẾU vẫn bị từ chối do nội dung:
            // Bậc 3 (C): thử lại với biến đổi vi mô, CÙNG kích thước.
            thử lại upload PCM đã biến đổi vi mô [cursor, cursor+candidateLen)
            NẾU thành công -> ghi nhận "done" (không mất nội dung), sang vòng kế.

    NẾU sau cả A và C vẫn bị từ chối do nội dung VÀ candidateLen > floor:
        attemptLen = max(floor, candidateLen / 2)   // co nhỏ ~một nửa
        KHÔNG đổi cursor — quay lại Bậc 1 ở kích thước nhỏ hơn (lại thử A, C)

    NẾU sau cả A và C vẫn bị từ chối do nội dung VÀ candidateLen <= floor (đã ở sàn 0.5s):
        đánh dấu đoạn [cursor, cursor+candidateLen) là "skipped" (bỏ qua)
        cursor += candidateLen
        attemptLen = windowEnd - cursor
        tiếp tục vòng lặp (thử phần còn lại của cửa sổ)

    NẾU lỗi KHÁC (429/401, mạng, hết hạn phiên, timeout...):
        KHÔNG retry A/C, KHÔNG co nhỏ — ném lỗi thật ra ngoài ngay lập tức
        (A/C/co nhỏ chỉ có ý nghĩa với lỗi do NỘI DUNG bị từ chối)

kết thúc khi cursor >= windowEnd
→ trả về danh sách kết quả: mỗi phần tử là {status:"done", clipId, durationSec}
  hoặc {status:"skipped", durationSec, error}
```

### Phép biến đổi "vô thanh" dùng ở bậc (C)

```js
mod = 1 + 0.0015 * sin(2π * 13.7 * i/sampleRate)   // điều biên ±0.15%, tần số lạ (không phải nhịp nhạc)
sample' = clamp(-1, 1, sample * mod + random_dither/32768)  // + dither dưới 1 LSB (16-bit)
```

Áp dụng **chỉ cho đúng đoạn đang thử lại ở bậc C** (không áp đại trà) — độ
lớn đủ nhỏ để không nghe ra được (cùng cấp độ với dither khi giảm bit-depth
âm thanh thông thường), nhưng đủ để đổi hẳn giá trị từng sample 16-bit,
khiến fingerprint-hash (nếu dựa trên khớp waveform tuyệt đối) không còn
khớp catalog gốc nữa.

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

Hàm chính hiện thực thuật toán ở mục 3 (gồm cả bậc A/C trước khi co nhỏ).
Nhận:

| Tham số | Ý nghĩa |
|---|---|
| `session` | Session Suno (đã resolve) |
| `buffer` | `Te.buffer` — audio gốc còn trong bộ nhớ renderer (object giả lập AudioBuffer: `{numberOfChannels, sampleRate, length, getChannelData}`) |
| `windowStart`, `windowEnd` | Vị trí cửa sổ (tính theo frame) |
| `floorFrames` | Sàn tối thiểu = `Math.round(sampleRate * 0.5)` (0.5 giây — hạ từ 1 giây) |
| `titleBase` | Tên part gốc — mảnh con thứ 2 trở đi được đặt tên `${titleBase}_2`, `${titleBase}_3`... |
| `onUpload(item)` | Callback gọi mỗi khi 1 mảnh upload thành công — dùng để ghi log |
| `onNote(message)` | Callback gọi khi thử lại (A/C), co nhỏ, hoặc bỏ qua 1 đoạn — dùng để ghi log |

Hàm nội bộ `classify(err)` phân loại lỗi thành `rejected` (nội dung bị từ
chối — pattern `/Suno từ chối|suno_rejected|upload_failure/i`, trừ khi là
429/401 — những lỗi đó luôn `nonShrinkable`) hay không, dùng chung cho cả 3
bậc A/C/co nhỏ để tránh lặp logic. Hàm nội bộ `perturbedWav(buf,start,frames)`
thực hiện phép biến đổi vô thanh ở bậc (C) — xem công thức ở mục 2.

Trả về mảng kết quả, mỗi phần tử:
- `{status:"done", clipId, muted, title, durationSec}` — 1 mảnh đã lên Suno thành công (có thể đã qua A hoặc C, nội dung vẫn nguyên vẹn).
- `{status:"skipped", durationSec, error}` — 1 đoạn bị bỏ (tối đa 0.5 giây mỗi lần, sau khi đã thử A, C, và co nhỏ hết mức).

### 4.4. Vòng lặp upload parts (`a.sunoSplitUpload` click handler)

Với mỗi part trong `Te.parts`:

- **Nếu còn `Te.buffer` (cùng phiên vừa split) và part có `startFrame`/`frameCount`** → dùng `sunoUploadWindowWithShrink` (cơ chế co nhỏ đầy đủ). Nếu 1 cửa sổ bị chia thành nhiều mảnh, mỗi mảnh `"done"` trở thành 1 part riêng trong danh sách cuối (`finalParts`), đánh số lại tuần tự (1, 2, 3, …) để bước Ghép Studio xếp đúng thứ tự.
- **Nếu không còn `Te.buffer`** (ví dụ: đã tắt app rồi mở lại, resume từ file đã lưu trên đĩa) → **rơi về hành vi cũ**: upload nguyên part (MP3 đã cắt sẵn), 1 lần duy nhất, không co nhỏ. Log các dòng này được gắn nhãn `(chế độ cũ, không co nhỏ)` để phân biệt.
- Toàn bộ phần xử lý 1 part được bọc trong `try/catch` ở mức ngoài cùng — bất kỳ lỗi bất ngờ nào (kể cả lỗi từ hàm vẽ lại UI `kn()`/`ha()`) cũng chỉ đánh dấu đúng part đó `"failed"` rồi **tiếp tục part kế tiếp**, không bao giờ làm dừng hẳn cả tiến trình.

## 5. Giới hạn đã biết

- **Chỉ hoạt động trong cùng phiên vừa Split** — vì cần `Te.buffer` (PCM gốc) còn trong bộ nhớ renderer để cắt lại. Nếu tắt app/tải lại trang rồi bấm "Upload parts" cho 1 phiên đã lưu từ trước, app tự động dùng lại cách cũ (upload 1 lần, không co nhỏ) vì không còn PCM gốc.
- Việc co nhỏ **giữ nguyên điểm bắt đầu** của cửa sổ, chỉ giảm độ dài — không trượt điểm bắt đầu sang vị trí khác để "né" đoạn bị từ chối (bậc C — biến đổi vi mô — là cách "né" duy nhất hiện có, không cần trượt vị trí).
- A/C/co nhỏ chỉ áp dụng cho lỗi **nội dung bị từ chối** (khớp `/Suno từ chối|suno_rejected|upload_failure/i`, và không phải 429/401); các lỗi khác (mạng, hết phiên, timeout, rate-limit) không được retry/co nhỏ và sẽ dừng ngay với thông báo lỗi thật.
- Bậc (A) cộng thêm ~2.5s chờ cho mỗi đoạn bị từ chối lần đầu — tổng thời gian upload có thể chậm hơn 1 chút với bài hay bị từ chối, đổi lại giữ được nhiều nội dung hơn.
- Phép biến đổi vi mô ở bậc (C) là suy đoán hợp lý dựa trên cách fingerprint-matching hoạt động (nhạy với waveform tuyệt đối), **chưa có cách nào xác nhận 100% hiệu quả** ngoài quan sát tỉ lệ "thiếu part" giảm đi khi dùng thật — nếu Suno đổi sang matching bền với nhiễu nhỏ hơn (robust fingerprinting) thì bậc này sẽ mất tác dụng, lúc đó vẫn rơi về đúng hành vi co nhỏ/bỏ cũ.

## 6. Cách xem log của cơ chế này khi chạy thật

Mở **menu ☰ → 🪵 Nhật ký tiến trình**, hoặc bấm icon 🪵 ngay trên popup
tiến trình (Upload/Ghép/Xuất) để xem mà không ảnh hưởng tới tiến trình
đang chạy. Các dòng log liên quan (đã dịch sang tiếng Việt):

| Dòng log | Ý nghĩa |
|---|---|
| `part N ▶ bắt đầu — cỡ gốc Xs, sàn tối thiểu 0.5s` | Bắt đầu xử lý cửa sổ N |
| `part N ⚠ thử lại nguyên bản sau 2.5s (Suno từ chối đoạn Ys — có thể chỉ là lỗi tạm thời)` | Bậc (A): vừa bị từ chối ở cỡ Ys, đang đợi rồi thử lại y nguyên |
| `part N ⚠ thử lại với biến đổi vi mô không nghe ra được (Suno từ chối đoạn Ys — có thể do trùng dấu vân âm thanh)` | Bậc (C): cả nguyên bản lẫn thử lại (A) đều bị từ chối, đang thử bản đã biến đổi vi mô |
| `part N ⚠ co nhỏ còn Xs rồi thử lại (Suno từ chối đoạn Ys kể cả sau khi thử lại + biến đổi vi mô)` | Cả A lẫn C đều thất bại ở cỡ Ys, đang co nhỏ xuống Xs |
| `part N ⚠ bỏ qua Xs tại Ys — Suno từ chối kể cả ở sàn tối thiểu, đã thử lại + biến đổi vi mô` | Đã co tới sàn 0.5s, thử cả A lẫn C vẫn bị từ chối — mất đúng Xs nội dung tại vị trí Ys |
| `part N ✅ mảnh tải lên OK — clip=... dài=...s` | 1 mảnh (nguyên bản, sau A, sau C, hoặc sau co nhỏ) đã lên Suno |
| `part N ✅ HOÀN TẤT — N clip, tổng Xs, bỏ qua Ys (Z đoạn)` | Tổng kết cửa sổ N: thành công, có thể gồm nhiều clip con |
| `part N ✗ THẤT BẠI HOÀN TOÀN — Suno từ chối toàn bộ Xs kể cả khi co xuống 0.5s` | Toàn bộ cửa sổ không upload được chút nào |
| `... (chế độ cũ, không co nhỏ) ...` | Part này đang chạy theo cách cũ (không còn PCM gốc để co nhỏ) |

## 7. Lịch sử

- Phát hiện vấn đề "thiếu part" khi đối chiếu với extension chính thức
  **Suno Toolkit** (Chrome Web Store) — extension gốc hầu như không mất
  part nhờ đúng cơ chế này.
- Port lại cho Suno-Pro trên nhánh git `feature/suno-real-browser-token`.
- Phát hiện nhạc tempo nhanh (mật độ nốt dày) vẫn hay bị từ chối dù đã co
  nhỏ — co nhỏ đơn thuần không đủ vì ngay cả sàn 1 giây vẫn có thể đủ đặc
  trưng để fingerprint-match. Thêm 2 bậc thử lại **trước khi co nhỏ**
  (bậc A: thử lại nguyên bản sau 1 nhịp nghỉ; bậc C: thử lại với biến đổi
  vi mô "vô thanh") và hạ sàn tối thiểu 1s → 0.5s — nhánh git
  `feature/suno-shrink-retry-abc`.
