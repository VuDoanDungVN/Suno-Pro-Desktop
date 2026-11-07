// ─── Tự động hoá Suno Studio (đảo audio qua nút "Clip editor" + Export → Full Song) NGAY TRÊN
// SERVER bằng Cloudflare Browser Rendering (@cloudflare/puppeteer). Lý do chạy trên server: đây
// là phần DUY NHẤT của pipeline Reverse còn lộ hoàn toàn trong app (toàn bộ selector DOM, kỹ
// thuật ẩn cửa sổ) — ai giải nén app cũng đọc được và tự làm lại được 1 công cụ tương tự mà
// không cần sản phẩm này. Chuyển lên đây thì app chỉ còn gọi 1 route duy nhất và nhận kết quả,
// không còn gì để lộ.
//
// Khác biệt so với bản Electron cũ: dùng cookie thật của người dùng (session.cookieHeader — vốn
// đã được capture từ chính trình duyệt thật của họ qua luồng "Suno Connect" có sẵn) tiêm vào
// trang Puppeteer qua page.setCookie(), thay vì dùng session partition cục bộ. Logic click/chờ
// giữ nguyên y hệt bản đã test thực tế (chuỗi sự kiện pointerdown/mousedown/pointerup/mouseup/
// click thật, toạ độ tính từ canvas + track-header-row, Export → Full Song, đợi toast "Song
// Saved!").
import puppeteer from "@cloudflare/puppeteer";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** "name1=val1; name2=val2" → [{name, value}] — bỏ qua phần tử rỗng/sai định dạng. */
function parseCookieHeader(cookieHeader: string): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = [];
  for (const part of cookieHeader.split(";")) {
    const pair = part.trim();
    if (!pair) continue;
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (!name) continue;
    out.push({ name, value });
  }
  return out;
}

const CLICK_HELPER = `
  function __spClick(el, atX, atY) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const x = (typeof atX === 'number') ? atX : r.left + r.width / 2;
    const y = (typeof atY === 'number') ? atY : r.top + r.height / 2;
    const base = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mousedown', base));
    el.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mouseup', base));
    el.dispatchEvent(new MouseEvent('click', base));
    return true;
  }
`;

export interface StudioAutomationResult {
  ok: true;
  settledByPoll: boolean;
}

export interface StudioAutomationLogger {
  (line: string): void;
}

/** Chạy toàn bộ bước 8 (gửi lệnh AI Studio + Export → Full Song) trên 1 trình duyệt headless của
 * Cloudflare Browser Rendering. Ném lỗi nếu bất kỳ bước bắt buộc nào thất bại — giống hệt hành vi
 * cũ (không có bước nào được phép "best-effort" ngầm ngoài những chỗ bản gốc đã cho phép). */
// Cloudflare Browser Rendering tự giới hạn số browser tạo mới trong 1 khoảng thời gian (429
// "Rate limit exceeded") — xảy ra khi test liên tục nhiều lần sát nhau. Thử lại tối đa 5 lần,
// chờ tăng dần (3s/6s/9s/12s), chỉ với đúng lỗi 429 này (lỗi khác ném ra ngay, thử lại vô ích).
async function launchBrowserWithRetry(env: Env, log: StudioAutomationLogger) {
  const MAX_ATTEMPTS = 5;
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await puppeteer.launch(env.BROWSER);
    } catch (e: any) {
      lastErr = e;
      const msg = (e && e.message) || String(e);
      const isRateLimited = /429/.test(msg) || /rate limit/i.test(msg);
      if (!isRateLimited || attempt === MAX_ATTEMPTS - 1) throw e;
      log(`Cloudflare đang giới hạn tốc độ tạo trình duyệt — thử lại lần ${attempt + 2}/${MAX_ATTEMPTS}…`);
      await sleep(3000 * (attempt + 1));
    }
  }
  throw lastErr;
}

export async function runStudioReverseAutomation(
  env: Env,
  opts: { cookieHeader: string; studioUrl: string; pitchSemitones?: number },
  log: StudioAutomationLogger = () => {},
): Promise<StudioAutomationResult> {
  const browser = await launchBrowserWithRetry(env, log);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    const pairs = parseCookieHeader(opts.cookieHeader || "");
    if (pairs.length) {
      const cookies = pairs.flatMap(({ name, value }) => [
        { name, value, domain: ".suno.com", path: "/" },
        { name, value, domain: ".clerk.suno.com", path: "/" },
      ]);
      await page.setCookie(...(cookies as any));
    }

    await page.goto(opts.studioUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

    // Ô chat chỉ xuất hiện SAU KHI app Studio (React) tải/khởi tạo xong — poll tới khi thấy, tối
    // đa 90s. Project tạo từ Studio bản cũ sẽ hiện hộp thoại chặn giữa màn hình, bắt bấm "Open in
    // Studio 2.0" mới vào được — tự bấm hộ mỗi vòng poll.
    const chatDeadline = Date.now() + 90000;
    let foundChat = false;
    while (Date.now() < chatDeadline) {
      await page
        .evaluate(`
          (function () {
            const btns = Array.from(document.querySelectorAll('button'));
            const btn = btns.find((b) => (b.textContent || '').trim() === 'Open in Studio 2.0');
            if (btn) btn.click();
            return !!btn;
          })();
        `)
        .catch(() => false);
      foundChat = Boolean(
        await page.evaluate(`!!document.querySelector('textarea[aria-label="Magic Bar prompt"]')`),
      );
      if (foundChat) break;
      await sleep(1000);
    }
    if (!foundChat) throw new Error('Không thấy ô chat của Suno Studio (giao diện có thể đã đổi).');

    // Audio được vẽ bằng <canvas> (Three.js) — chọn track qua ".track-header-row" ở panel trái
    // rồi bấm "Add to prompt". Panel track hydrate chậm hơn ô chat — đợi riêng tối đa 30s.
    log('Đã thấy ô chat, đang đợi panel track xuất hiện…');
    const trackDeadline = Date.now() + 30000;
    let hasTrackHeader = false;
    while (Date.now() < trackDeadline) {
      hasTrackHeader = Boolean(
        await page.evaluate(`!!document.querySelector('.track-header-row')`).catch(() => false),
      );
      if (hasTrackHeader) break;
      await sleep(1000);
    }
    log(`Panel track ${hasTrackHeader ? 'đã xuất hiện' : 'KHÔNG xuất hiện sau 30s'}.`);

    // Chọn track + đính kèm vào chat — xác minh bằng "chip" (nút "Remove <tên track>"), thử lại
    // tối đa 8 lần vì .click() tổng hợp thường không đủ để component chọn track ghi nhận.
    let addedToPrompt = false;
    for (let attempt = 0; attempt < 8 && !addedToPrompt; attempt++) {
      const canvasClicked = Boolean(
        await page
          .evaluate(`
            (function () {
              ${CLICK_HELPER}
              const canvas = document.querySelector('[data-studio-main-canvas="true"] canvas');
              const header = document.querySelector('.track-header-row');
              if (!canvas || !header) return false;
              const cRect = canvas.getBoundingClientRect();
              const hRect = header.getBoundingClientRect();
              const x = cRect.left + cRect.width * 0.3;
              const y = hRect.top + hRect.height / 2;
              return __spClick(canvas, x, y);
            })();
          `)
          .catch(() => false),
      );
      await sleep(400);
      const addBtnClicked = Boolean(
        await page
          .evaluate(`
            (function () {
              ${CLICK_HELPER}
              const btn = document.querySelector('button[aria-label="Add to prompt"]');
              if (!btn || btn.disabled) return false;
              return __spClick(btn);
            })();
          `)
          .catch(() => false),
      );
      await sleep(800);
      addedToPrompt = Boolean(
        await page.evaluate(`!!document.querySelector('button[aria-label^="Remove "]')`).catch(() => false),
      );
      log(
        `…lần thử đính kèm ${attempt + 1}/8: click canvas=${canvasClicked ? 'có' : 'không'}, bấm Add to prompt=${addBtnClicked ? 'có' : 'không'}, đã thấy chip=${addedToPrompt ? 'có' : 'không'}`,
      );
    }
    if (!addedToPrompt) {
      throw new Error('Không đính kèm được audio vào khung chat (không thấy "chip" audio sau khi chọn track + bấm Add to prompt).');
    }
    await sleep(500);

    // Đảo audio qua 2 bước trong panel "Clip editor" (icon nằm trong track header, cạnh Add to
    // prompt) — KHÔNG dùng id/class của nút (do thư viện Base UI sinh ngẫu nhiên mỗi lần render,
    // không ổn định), chọn bằng aria-label/data-info-target. Thay thế hoàn toàn 2 lệnh chat AI cũ.
    const clipEditorClicked = Boolean(
      await page
        .evaluate(`
          (function () {
            ${CLICK_HELPER}
            const btn = document.querySelector('button[aria-label="Clip editor"][data-info-target="clip-editor"]');
            if (!btn || btn.disabled) return false;
            return __spClick(btn);
          })();
        `)
        .catch(() => false),
    );
    if (!clipEditorClicked) {
      throw new Error('Không bấm được nút "Clip editor" để mở panel đảo audio (giao diện có thể đã đổi).');
    }
    log('Đã bấm "Clip editor", đợi 10 giây cho panel mở ra rồi bấm "Reverse"…');
    await sleep(10000);

    const reverseClicked = Boolean(
      await page
        .evaluate(`
          (function () {
            ${CLICK_HELPER}
            const btn = document.querySelector('button[data-info-target="clip-reverse"]');
            if (!btn || btn.disabled) return false;
            return __spClick(btn);
          })();
        `)
        .catch(() => false),
    );
    if (!reverseClicked) {
      throw new Error('Không bấm được nút "Reverse" để đảo audio (giao diện có thể đã đổi).');
    }
    log('Đã bấm "Reverse", đợi 5 giây…');
    await sleep(5000);

    // Điền Pitch vào ô "Semitones" của panel Clip editor — chỉ khi khác 0 (giữ hành vi cũ khi
    // Pitch = 0, không đụng gì tới ô này). ĐẢO DẤU so với giá trị người dùng chọn ở app (client
    // đã áp dụng pitchShiftAudioLocally() cục bộ với NGUYÊN giá trị gốc trước khi upload — ví dụ
    // chọn −2 nửa cung thì audio cục bộ đã bị hạ 2 nửa cung; ô Semitones ở đây theo đúng yêu cầu
    // phải nhận +2, ngược dấu). App cho chọn tới ±40 nửa cung (±20 cung) nhưng ô "Semitones" THẬT
    // của Suno Studio chỉ nhận −24..+24 — clamp riêng CHỈ cho giá trị điền vào ô này, không đụng
    // gì tới giá trị đã áp dụng cục bộ (pitchRawFromClient giữ nguyên để pitch-shift cục bộ không
    // bị cắt). Input React-controlled nên phải gán qua native setter + bắn 'input' rồi 'change'
    // mới được component ghi nhận (giống cách gõ lệnh chat cũ), blur để component commit giá trị
    // cuối cùng.
    const pitchRawFromClient = Math.round(Number(opts.pitchSemitones) || 0);
    const pitchClampedForSuno = Math.max(-24, Math.min(24, pitchRawFromClient));
    const semitonesInputValue = -pitchClampedForSuno;
    if (pitchRawFromClient !== 0) {
      const pitchSet = Boolean(
        await page
          .evaluate(`
            (function () {
              const input = document.querySelector('input[aria-label="Semitones"]');
              if (!input) return false;
              const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
              setter.call(input, ${JSON.stringify(String(semitonesInputValue))});
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
              input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', code: 'Enter' }));
              input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', code: 'Enter' }));
              input.blur();
              return true;
            })();
          `)
          .catch(() => false),
      );
      if (!pitchSet) {
        throw new Error('Không nhập được giá trị Pitch vào ô "Semitones" (giao diện có thể đã đổi).');
      }
      await sleep(500);
      const committedValue = await page
        .evaluate(`
          (function () {
            const input = document.querySelector('input[aria-label="Semitones"]');
            return input ? input.getAttribute('aria-valuenow') : null;
          })();
        `)
        .catch(() => null);
      const clampNote = pitchClampedForSuno !== pitchRawFromClient ? ` (đã giới hạn từ ${pitchRawFromClient} vì ô Semitones chỉ nhận −24..+24)` : '';
      log(`Pitch người dùng chọn = ${pitchRawFromClient} nửa cung — đã nhập ${semitonesInputValue} (đảo dấu${clampNote}) vào ô "Semitones" (giá trị hiện tại đọc lại từ Suno Studio: ${committedValue === null ? 'không đọc được' : committedValue}).`);
    } else {
      log('Pitch = 0 — không cần nhập ô "Semitones".');
    }

    // QUAN TRỌNG: thay đổi vừa làm chỉ cập nhật trạng thái TẠM THỜI trong trình duyệt — CHƯA lưu
    // xuống server. Render phía sau (Worker) đọc lại state qua GET /api/studio/project, nên nếu
    // chưa lưu thì vẫn đọc phải bản GỐC chưa đảo chiều. Lưu CHỈ xảy ra khi bấm Export →
    // "Full Song" (lúc đó mới hiện toast "Song Saved!") — bước bắt buộc, không phải chờ cho có.
    log('Đang lưu project (bấm Export → Full Song) — bước bắt buộc để Render lấy đúng bản đã đảo chiều…');
    const exportMenuOpened = Boolean(
      await page
        .evaluate(`
          (function () {
            ${CLICK_HELPER}
            const btn = document.querySelector('button[aria-label="Export menu"]');
            return __spClick(btn);
          })();
        `)
        .catch(() => false),
    );
    await sleep(500);
    const fullSongClicked = Boolean(
      await page
        .evaluate(`
          (function () {
            ${CLICK_HELPER}
            const items = Array.from(document.querySelectorAll('.context-menu-item button'));
            const btn = items.find((b) => (b.textContent || '').trim() === 'Full Song');
            return __spClick(btn);
          })();
        `)
        .catch(() => false),
    );
    log(`…mở menu Export=${exportMenuOpened ? 'có' : 'không'}, bấm "Full Song"=${fullSongClicked ? 'có' : 'không'}`);
    if (!exportMenuOpened || !fullSongClicked) {
      throw new Error('Không bấm được Export → Full Song để lưu project (giao diện có thể đã đổi).');
    }

    const saveDeadline = Date.now() + 90000;
    let savedToastSeen = false;
    while (Date.now() < saveDeadline) {
      savedToastSeen = Boolean(
        await page.evaluate(`document.body.innerText.includes('Song Saved!')`).catch(() => false),
      );
      if (savedToastSeen) break;
      await sleep(1000);
    }
    if (!savedToastSeen) {
      throw new Error('Đã bấm Export → Full Song nhưng không thấy toast "Song Saved!" xác nhận đã lưu (quá 90s).');
    }
    log('Đã thấy toast "Song Saved!" — project đã lưu xong, đợi thêm 2s cho chắc…');
    await sleep(2000);

    return { ok: true, settledByPoll: true };
  } finally {
    await browser.close();
  }
}
