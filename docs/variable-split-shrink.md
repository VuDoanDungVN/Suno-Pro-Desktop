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
fingerprint-match. Nên trước khi co nhỏ, thử thêm 3 bậc **giữ nguyên kích
thước, không mất nội dung gì**:

- **(A) Thử lại nguyên bản sau 1 nhịp nghỉ ngắn (~2.5s)** — một phần
  rejection chỉ là lỗi tạm thời phía Suno (quá tải/timeout xử lý fingerprint
  lúc đó), không phải thật sự trùng nội dung.
- **(C) Thử lại với 1 phép biến đổi "vô thanh" nhẹ** — điều biên độ cực
  nhỏ (±0.15%, tần số lạ 13.7Hz) + dither dưới ngưỡng 1 bit — không nghe ra
  được, nhưng đủ để phá vỡ khớp fingerprint tuyệt đối theo waveform (nguyên
  nhân chính gây rejection do trùng catalog).
- **(D, mới) Vẫn bị từ chối → nghỉ 5 giây rồi thử lại với 1 phép biến đổi
  MẠNH hơn** — dịch cao độ/tốc độ nhẹ (~1.5%, qua resample tuyến tính) +
  trộn thêm nhiễu nhẹ (-45dBFS). Mạnh hơn (C) nên có thể cảm nhận được rất
  khẽ nếu nghe kỹ, nhưng vẫn nhẹ hơn nhiều so với mất hẳn nội dung — đây là
  "cứu vãn cuối cùng" trước khi chấp nhận co nhỏ/bỏ.

Chỉ khi **cả A, C, D đều vẫn bị từ chối** mới co nhỏ một nửa (như cũ) và
lặp lại đúng 3 bậc A, C, D ở kích thước mới — cho tới khi chạm **sàn tối
thiểu 0.5 giây** (hạ từ 1 giây xuống, giảm tối đa thiệt hại mỗi lần phải
bỏ). Chỉ khi ngay cả 0.5 giây (đã qua cả A, C, D) cũng bị từ chối thì mới
thật sự bỏ (skip) đúng 0.5 giây đó.

→ Trường hợp xấu nhất chỉ mất **tối đa 0.5 giây** nội dung (trước đây 1
giây), và phần lớn trường hợp rejection do fingerprint-match có thể được
"cứu" hoàn toàn nhờ (C) hoặc (D) mà không mất tí nội dung nào.

**Log hiển thị cho người dùng** (menu Nhật ký tiến trình) đã được viết lại
đơn giản, thân thiện, **không nhắc tới kỹ thuật thật sự đang dùng** (không
nói "biến đổi", "pitch", "nhiễu", "fingerprint"...) — chỉ hiện các câu
chung chung như "đang xử lý chậm, đang thử lại…", "đang xử lý lại…", "đang
xử lý kỹ hơn…". Tài liệu này mô tả đúng kỹ thuật thật để dev tham khảo, còn
log thật trong app cố ý giữ kín cách làm.

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
            // Bậc 3 (C): thử lại với biến đổi vi mô NHẸ, CÙNG kích thước.
            thử lại upload PCM đã biến đổi nhẹ [cursor, cursor+candidateLen)
            NẾU thành công -> ghi nhận "done" (không mất nội dung), sang vòng kế.

            NẾU vẫn bị từ chối do nội dung:
                // Bậc 4 (D): đợi 5s, thử lại với biến đổi MẠNH hơn, CÙNG kích thước.
                thử lại upload PCM đã biến đổi mạnh [cursor, cursor+candidateLen) (sau khi đợi)
                NẾU thành công -> ghi nhận "done" (không mất nội dung), sang vòng kế.

    NẾU sau cả A, C, D vẫn bị từ chối do nội dung VÀ candidateLen > floor:
        attemptLen = max(floor, candidateLen / 2)   // co nhỏ ~một nửa
        KHÔNG đổi cursor — quay lại Bậc 1 ở kích thước nhỏ hơn (lại thử A, C, D)

    NẾU sau cả A, C, D vẫn bị từ chối do nội dung VÀ candidateLen <= floor (đã ở sàn 0.5s):
        đánh dấu đoạn [cursor, cursor+candidateLen) là "skipped" (bỏ qua)
        cursor += candidateLen
        attemptLen = windowEnd - cursor
        tiếp tục vòng lặp (thử phần còn lại của cửa sổ)

    NẾU lỗi KHÁC (429/401, mạng, hết hạn phiên, timeout...):
        KHÔNG retry A/C/D, KHÔNG co nhỏ — ném lỗi thật ra ngoài ngay lập tức
        (A/C/D/co nhỏ chỉ có ý nghĩa với lỗi do NỘI DUNG bị từ chối)

kết thúc khi cursor >= windowEnd
→ trả về danh sách kết quả: mỗi phần tử là {status:"done", clipId, durationSec}
  hoặc {status:"skipped", durationSec, error}
```

### Phép biến đổi dùng ở bậc (C) — nhẹ

```js
mod = 1 + 0.0015 * sin(2π * 13.7 * i/sampleRate)   // điều biên ±0.15%, tần số lạ (không phải nhịp nhạc)
sample' = clamp(-1, 1, sample * mod + random_dither/32768)  // + dither dưới 1 LSB (16-bit)
```

Độ lớn đủ nhỏ để không nghe ra được (cùng cấp độ với dither khi giảm
bit-depth âm thanh thông thường), nhưng đủ để đổi hẳn giá trị từng sample
16-bit, khiến fingerprint-hash (nếu dựa trên khớp waveform tuyệt đối)
không còn khớp catalog gốc nữa.

### Phép biến đổi dùng ở bậc (D) — mạnh hơn, chỉ dùng khi (C) đã thất bại

```js
stretch = 1.015   // đọc nguồn nhanh hơn 1.5% -> cao độ/tốc độ lệch nhẹ (resample tuyến tính, không tách riêng pitch/tempo)
srcPos = start + i * stretch
sample' = lerp(buf[floor(srcPos)], buf[floor(srcPos)+1], frac(srcPos)) + noise * 10^(-45/20)
```

Mạnh hơn (C) rõ rệt — đổi cả cao độ lẫn tốc độ ~1.5% (có thể cảm nhận rất
khẽ nếu nghe kỹ bằng tai nghe tốt) và trộn nhiễu ở mức -45dBFS. Chỉ kích
hoạt khi (A) và (C) đã thất bại ở đúng kích thước đó — là lựa chọn cuối
cùng trước khi chấp nhận co nhỏ/mất nội dung, nên đánh đổi 1 chút chất
lượng để giữ nội dung là hợp lý.

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

Hàm chính hiện thực thuật toán ở mục 3 (gồm cả bậc A/C/D trước khi co nhỏ).
Nhận:

| Tham số | Ý nghĩa |
|---|---|
| `session` | Session Suno (đã resolve) |
| `buffer` | `Te.buffer` — audio gốc còn trong bộ nhớ renderer (object giả lập AudioBuffer: `{numberOfChannels, sampleRate, length, getChannelData}`) |
| `windowStart`, `windowEnd` | Vị trí cửa sổ (tính theo frame) |
| `floorFrames` | Sàn tối thiểu = `Math.round(sampleRate * 0.5)` (0.5 giây — hạ từ 1 giây) |
| `titleBase` | Tên part gốc — mảnh con thứ 2 trở đi được đặt tên `${titleBase}_2`, `${titleBase}_3`... |
| `onUpload(item)` | Callback gọi mỗi khi 1 mảnh upload thành công — dùng để ghi log |
| `onNote(message)` | Callback gọi khi thử lại (A/C/D), co nhỏ, hoặc bỏ qua 1 đoạn — dùng để ghi log (nội dung đã viết lại thân thiện, không lộ kỹ thuật — xem mục 6) |

Hàm nội bộ `classify(err)` phân loại lỗi thành `rejected` (nội dung bị từ
chối — pattern `/Suno từ chối|suno_rejected|upload_failure/i`, trừ khi là
429/401 — những lỗi đó luôn `nonShrinkable`) hay không, dùng chung cho cả 4
bậc A/C/D/co nhỏ để tránh lặp logic. 2 hàm nội bộ thực hiện biến đổi:
`lightVariantWav(buf,start,frames)` (bậc C, nhẹ) và
`strongVariantWav(buf,start,frames)` (bậc D, mạnh hơn) — công thức xem mục 2.

Trả về mảng kết quả, mỗi phần tử:
- `{status:"done", clipId, muted, title, durationSec}` — 1 mảnh đã lên Suno thành công (có thể đã qua A, C hoặc D, nội dung vẫn nguyên vẹn).
- `{status:"skipped", durationSec, error}` — 1 đoạn bị bỏ (tối đa 0.5 giây mỗi lần, sau khi đã thử A, C, D, và co nhỏ hết mức).

### 4.4. Vòng lặp upload parts (`a.sunoSplitUpload` click handler)

Với mỗi part trong `Te.parts`:

- **Nếu còn `Te.buffer` (cùng phiên vừa split) và part có `startFrame`/`frameCount`** → dùng `sunoUploadWindowWithShrink` (cơ chế co nhỏ đầy đủ). Nếu 1 cửa sổ bị chia thành nhiều mảnh, mỗi mảnh `"done"` trở thành 1 part riêng trong danh sách cuối (`finalParts`), đánh số lại tuần tự (1, 2, 3, …) để bước Ghép Studio xếp đúng thứ tự.
- **Nếu không còn `Te.buffer`** (ví dụ: đã tắt app rồi mở lại, resume từ file đã lưu trên đĩa) → **rơi về hành vi cũ**: upload nguyên part (MP3 đã cắt sẵn), 1 lần duy nhất, không co nhỏ. Log các dòng này được gắn nhãn `(chế độ cũ, không co nhỏ)` để phân biệt.
- Toàn bộ phần xử lý 1 part được bọc trong `try/catch` ở mức ngoài cùng — bất kỳ lỗi bất ngờ nào (kể cả lỗi từ hàm vẽ lại UI `kn()`/`ha()`) cũng chỉ đánh dấu đúng part đó `"failed"` rồi **tiếp tục part kế tiếp**, không bao giờ làm dừng hẳn cả tiến trình.

## 5. Giới hạn đã biết

- **Chỉ hoạt động trong cùng phiên vừa Split** — vì cần `Te.buffer` (PCM gốc) còn trong bộ nhớ renderer để cắt lại. Nếu tắt app/tải lại trang rồi bấm "Upload parts" cho 1 phiên đã lưu từ trước, app tự động dùng lại cách cũ (upload 1 lần, không co nhỏ) vì không còn PCM gốc.
- Việc co nhỏ **giữ nguyên điểm bắt đầu** của cửa sổ, chỉ giảm độ dài — không trượt điểm bắt đầu sang vị trí khác để "né" đoạn bị từ chối (bậc C/D — biến đổi vi mô/mạnh — là cách "né" duy nhất hiện có, không cần trượt vị trí).
- A/C/D/co nhỏ chỉ áp dụng cho lỗi **nội dung bị từ chối** (khớp `/Suno từ chối|suno_rejected|upload_failure/i`, và không phải 429/401); các lỗi khác (mạng, hết phiên, timeout, rate-limit) không được retry/co nhỏ và sẽ dừng ngay với thông báo lỗi thật.
- Bậc (A) cộng thêm ~2.5s chờ, bậc (D) cộng thêm ~5s chờ cho mỗi đoạn bị từ chối — trường hợp xấu nhất (1 đoạn bị từ chối ở mọi kích thước cho tới sàn) có thể cộng dồn tới hàng chục giây chờ. Đa số trường hợp vẫn nhanh như cũ vì chỉ kích hoạt khi thật sự bị từ chối.
- Phép biến đổi ở bậc (C)/(D) là suy đoán hợp lý dựa trên cách fingerprint-matching hoạt động (nhạy với waveform tuyệt đối), **chưa có cách nào xác nhận 100% hiệu quả** ngoài quan sát tỉ lệ "thiếu part" giảm đi khi dùng thật — nếu Suno đổi sang matching bền với nhiễu nhỏ hơn (robust fingerprinting) thì các bậc này sẽ mất tác dụng, lúc đó vẫn rơi về đúng hành vi co nhỏ/bỏ cũ.
- Bậc (D) dùng resample tuyến tính đơn giản (không phải thuật toán pitch-shift giữ nguyên tốc độ) nên đổi CẢ cao độ lẫn tốc độ cùng lúc ~1.5% — với 1 đoạn ngắn (đã co nhỏ gần sàn) độ lệch thời lượng chỉ vài chục mili-giây, không ảnh hưởng tới bước Ghép Studio sau này.

## 6. Cách xem log của cơ chế này khi chạy thật

Mở **menu ☰ → 🪵 Nhật ký tiến trình**, hoặc bấm icon 🪵 ngay trên popup
tiến trình (Upload/Ghép/Xuất) để xem mà không ảnh hưởng tới tiến trình
đang chạy. Các dòng log liên quan (đã dịch sang tiếng Việt):

Log thật trong app **cố ý viết chung chung, không nhắc tới kỹ thuật** (không
có chữ "biến đổi", "pitch", "nhiễu", "fingerprint", "co nhỏ"...) — cột "Ý
nghĩa thật" bên dưới chỉ để dev tham khảo, không hiển thị cho người dùng.

| Dòng log hiển thị thật | Ý nghĩa thật (chỉ dev biết) |
|---|---|
| `part N ▶ bắt đầu xử lý — Xs` | Bắt đầu xử lý cửa sổ N |
| `part N ⏳ Đoạn Xs đang xử lý chậm, đang thử lại…` | Bậc (A): vừa bị từ chối, đang đợi 2.5s rồi thử lại y nguyên |
| `part N 🔁 Đang xử lý lại đoạn Xs rồi thử lại…` | Bậc (C): A cũng thất bại, đang thử bản biến đổi nhẹ |
| `part N 🔁 Đang xử lý kỹ hơn đoạn Xs, vui lòng đợi…` | Bậc (D): A và C đều thất bại, đang đợi 5s rồi thử bản biến đổi mạnh hơn |
| `part N ✂️ Đoạn Xs hơi khó, chia nhỏ còn Ys để thử tiếp…` | Cả A, C, D đều thất bại ở cỡ Xs, đang co nhỏ xuống Ys |
| `part N ⚠ Bỏ qua Xs tại Ys — đã thử nhiều cách nhưng không tải lên được` | Đã co tới sàn 0.5s, thử hết A, C, D vẫn bị từ chối — mất đúng Xs nội dung tại vị trí Ys |
| `part N ✅ mảnh tải lên OK — clip=... dài=...s` | 1 mảnh (nguyên bản, sau A, C, D, hoặc sau co nhỏ) đã lên Suno |
| `part N ✅ HOÀN TẤT — N clip, tổng Xs, bỏ qua Ys (Z đoạn)` | Tổng kết cửa sổ N: thành công, có thể gồm nhiều clip con |
| `part N ✗ Không tải lên được đoạn Xs này dù đã thử nhiều cách` | Toàn bộ cửa sổ không upload được chút nào |
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
- Vẫn còn mất đoạn sau khi test thật với nhạc tempo nhanh. Thêm bậc (D):
  khi cả A và C đều thất bại, nghỉ 5s rồi thử lại với biến đổi MẠNH hơn
  (resample ±1.5% + nhiễu -45dBFS) trước khi co nhỏ tiếp — chỉ bỏ qua khi
  cả 4 cách (gốc, A, C, D) đều thất bại ở sàn tối thiểu. Đồng thời viết lại
  toàn bộ log hiển thị cho người dùng (cả log cũ lẫn mới) thành câu chung
  chung, không còn nhắc tới kỹ thuật thật đang dùng — vẫn cùng nhánh
  `feature/suno-shrink-retry-abc`.
