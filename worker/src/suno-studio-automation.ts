// ─── Tự động hoá Suno Studio (gửi lệnh AI Reverse + Export → Full Song) NGAY TRÊN SERVER bằng
// Cloudflare Browser Rendering (@cloudflare/puppeteer) — port 1:1 từ `sunoStudioAutomateChat` cũ
// trong electron/main.js (vốn dùng 1 BrowserWindow ẩn trên máy người dùng). Lý do chuyển sang
// server: đây là phần DUY NHẤT của pipeline Reverse còn lộ hoàn toàn trong app (toàn bộ
// selector DOM, nội dung 2 câu lệnh AI, kỹ thuật ẩn cửa sổ) — ai giải nén app cũng đọc được và
// tự làm lại được 1 công cụ tương tự mà không cần sản phẩm này. Chuyển lên đây thì app chỉ còn
// gọi 1 route duy nhất và nhận kết quả, không còn gì để lộ.
//
// Khác biệt so với bản Electron: dùng cookie thật của người dùng (session.cookieHeader — vốn đã
// được capture từ chính trình duyệt thật của họ qua luồng "Suno Connect" có sẵn) tiêm vào trang
// Puppeteer qua page.setCookie(), thay vì dùng session partition cục bộ. Logic click/gõ/chờ giữ
// nguyên y hệt bản đã test thực tế (chuỗi sự kiện pointerdown/mousedown/pointerup/mouseup/click
// thật, toạ độ tính từ canvas + track-header-row, 2 lệnh AI cách nhau, Export → Full Song, đợi
// toast "Song Saved!").
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

// Nội dung 2 câu lệnh gửi AI Studio — chuyển hẳn vào đây (server) theo đúng mục tiêu: client
// không còn biết/giữ nội dung này nữa, chỉ gọi "làm hộ tôi" và nhận kết quả.
const FIXED_PROMPT =
  'Reverse lại audio này cho tôi. Lưu ý : Không được split cắt đoạn audio, chỉ reverse toàn bộ audio. Đảm bảo audio được reverse đúng và đầy đủ.';
const FOLLOWUP_PROMPT =
  'Đảm bảo audio phải đủ thời lượng không bị cắt (no split), đặc biệt phải so sánh audio upload và audio sau khi xử lý Reverse phải có thời lượng bằng nhau.';

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
  opts: { cookieHeader: string; studioUrl: string },
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

    // Gõ 1 lệnh (qua native setter vì React không nhận .value gán trực tiếp), bấm Send, theo dõi
    // nút Send (bận → rảnh) để biết AI xử lý xong hay chưa, cắt cứng sau `pollMs` nếu chưa rõ.
    const sendAndWait = async (msg: string, pollMs: number, label: string): Promise<boolean> => {
      const sentNow = Boolean(
        await page.evaluate(`
          (function () {
            const ta = document.querySelector('textarea[aria-label="Magic Bar prompt"]');
            if (!ta) return false;
            const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            setter.call(ta, ${JSON.stringify(msg)});
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
          })();
        `),
      );
      if (!sentNow) throw new Error(`Không gõ được lệnh vào ô chat (${label}).`);

      await sleep(400);
      const clickedNow = Boolean(
        await page.evaluate(`
          (function () {
            const btn = document.querySelector('button[aria-label="Send"]');
            if (!btn || btn.disabled) return false;
            btn.click();
            return true;
          })();
        `),
      );
      if (!clickedNow) throw new Error(`Nút Gửi không bật lên được (${label}) — có thể ô chat đang bị khoá/đã có lệnh khác đang chạy.`);

      log(`Đã bấm Gửi (${label}), đang theo dõi trạng thái AI Studio…`);
      let sawBusyNow = false;
      let settledNow = false;
      let nullStreakNow = 0;
      const deadlineNow = Date.now() + pollMs;
      let lastLogAtNow = 0;
      while (Date.now() < deadlineNow) {
        const busyRaw = await page
          .evaluate(`
            (function () {
              const btn = document.querySelector('button[aria-label="Send"]');
              return btn ? !!btn.disabled : null;
            })();
          `)
          .catch(() => null);
        const busy = busyRaw as boolean | null;
        if (busy === true) {
          sawBusyNow = true;
          nullStreakNow = 0;
        } else if (busy === false) {
          nullStreakNow = 0;
          if (sawBusyNow) {
            settledNow = true;
            break;
          }
        } else if (busy === null && sawBusyNow) {
          nullStreakNow++;
          if (nullStreakNow >= 5) {
            settledNow = true;
            break;
          }
        }
        if (Date.now() - lastLogAtNow > 10000) {
          lastLogAtNow = Date.now();
          log(
            `…(${label}) vẫn đang theo dõi AI Studio (đã thấy bận: ${sawBusyNow ? 'có' : 'chưa'}, trạng thái nút hiện tại: ${busy === null ? 'không tìm thấy' : busy ? 'bận' : 'rảnh'})`,
          );
        }
        await sleep(2000);
      }
      if (settledNow) {
        log(`(${label}) Nút Gửi đã bật lại (hoặc mất dấu sau khi bận) — coi như AI Studio đã xử lý xong.`);
      } else {
        log(`(${label}) Hết ${Math.round(pollMs / 1000)}s theo yêu cầu — tiếp tục dù chưa chắc AI đã xử lý xong.`);
      }
      return settledNow;
    };

    const settledByPoll1 = await sendAndWait(FIXED_PROMPT, 25000, 'lệnh 1/2 — reverse');
    const settledByPoll2 = await sendAndWait(FOLLOWUP_PROMPT, 10000, 'lệnh 2/2 — nhắc không cắt');
    const settledByPoll = settledByPoll1 && settledByPoll2;

    // QUAN TRỌNG: thay đổi của AI trong chat chỉ cập nhật trạng thái TẠM THỜI trong trình duyệt —
    // CHƯA lưu xuống server. Render phía sau (Worker) đọc lại state qua GET /api/studio/project,
    // nên nếu chưa lưu thì vẫn đọc phải bản GỐC chưa đảo chiều. Lưu CHỈ xảy ra khi bấm Export →
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

    return { ok: true, settledByPoll };
  } finally {
    await browser.close();
  }
}
