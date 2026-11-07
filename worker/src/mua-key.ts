// © 2026 Vũ Dũng (vudungit92@gmail.com) — Suno Pro, phần mềm độc quyền. Toàn văn tại COPYRIGHT.md.
//
// Trang mua KEY công khai — /mua-key (chọn gói, trả qua Stripe Checkout) và /mua-key/thanh-cong
// (sau khi Stripe redirect về, tự hỏi lại trạng thái vì webhook có thể tới sau vài giây). Cùng
// bảng màu với trial.ts/guide.ts để đồng bộ giao diện toàn hệ thống.

const PLAN_LABELS: Record<string, string> = {
  "7d": "7 ngày",
  "30d": "30 ngày",
  "6m": "6 tháng",
  "365d": "1 năm",
};

function shell(title: string, bodyHtml: string, extraStyle = ""): string {
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
:root { --bg:#12151b; --bg-2:#171b22; --card:#1d222b; --line:#2e3542; --line-2:#3a4252; --text:#e9edf3; --muted:#9aa4b4;
  --primary:#1fb5b5; --primary-2:#138c8c; --on-primary:#04211f; --bad:#ff8a8a; --ok:#2dd4bf; color-scheme: dark; }
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body { background: radial-gradient(1200px 600px at 10% -10%, rgb(31 181 181 / 9%), transparent 60%), var(--bg); color: var(--text);
  font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif; display: grid; place-items: center; padding: 24px; }
[hidden] { display: none !important; }
.card { width: min(440px, 100%); padding: 28px 26px; border-radius: 18px; background: rgb(29 34 43 / 92%); border: 1px solid var(--line); box-shadow: 0 18px 40px -24px rgb(0 0 0 / 70%); display: grid; gap: 16px; }
h1 { margin: 0; font-size: 20px; letter-spacing: -.3px; }
p.sub { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.6; }
.field { display: grid; gap: 6px; }
.field > span { color: var(--muted); font-size: 12px; font-weight: 600; }
.input { width: 100%; height: 42px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--line-2); background: var(--bg-2); color: var(--text); font: inherit; }
.input:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px rgb(31 181 181 / 18%); }
.btn { width: 100%; height: 44px; border-radius: 10px; border: none; background: linear-gradient(135deg, var(--primary), var(--primary-2)); color: var(--on-primary);
  font: inherit; font-weight: 700; cursor: pointer; }
.btn:disabled { opacity: .55; cursor: default; }
.msg { padding: 10px 12px; border-radius: 10px; font-size: 13px; }
.msg.bad { background: rgb(255 138 138 / 9%); border: 1px solid rgb(255 138 138 / 35%); color: #ffc2c2; }
.msg.ok { background: rgb(45 212 191 / 10%); border: 1px solid rgb(45 212 191 / 30%); color: #bdf5ec; }
a { color: var(--primary); }
.plans { display: grid; gap: 10px; }
.plan { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: 10px; border: 1px solid var(--line-2); background: var(--bg-2); cursor: pointer; }
.plan.selected { border-color: var(--primary); box-shadow: 0 0 0 2px rgb(31 181 181 / 25%); }
.plan input { accent-color: var(--primary); }
.plan .plan-label { font-weight: 700; flex: 1; }
${extraStyle}
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

/** `GET /mua-key` — chọn gói, nhập email, tạo Stripe Checkout Session rồi redirect. */
export function muaKeyPageHtml(): Response {
  const html = shell(
    "Mua KEY Suno Pro",
    `<div class="card plans-card">
  <div class="pricing-head"><h1>Bảng giá rõ ràng, minh bạch</h1><p class="sub">Không ràng buộc hợp đồng · không phí ẩn — KEY được gửi về email ngay sau khi thanh toán thành công.</p></div>
  <div class="plans" id="plans">
    <div class="plan" data-plan="30d">
      <span class="plan-badge-float">Dành cho người mới</span>
      <div class="plan-price-row"><span class="plan-price">300.000</span><small>đ /30 ngày</small></div>
      <div class="plan-name">Gói 30 ngày</div>
      <p class="plan-desc">~10.000đ / ngày — phù hợp để dùng thử ngắn hạn.</p>
      <ul class="plan-feats">
        <li><span class="tick">✓</span>60 lượt upload / ngày</li>
        <li><span class="tick">✓</span>60 lượt tạo nhạc / ngày</li>
        <li><span class="tick">✓</span>Dùng trên 1 thiết bị</li>
        <li><span class="tick">✓</span>Hỗ trợ qua Zalo</li>
      </ul>
      <button type="button" class="plan-cta" data-plan="30d" data-label="Gói 30 ngày — 300.000đ">Chọn gói này</button>
    </div>
    <div class="plan" data-plan="6m">
      <span class="plan-badge-float">Phổ biến nhất</span>
      <div class="plan-price-row"><span class="plan-price">900.000</span><small>đ /6 tháng</small></div>
      <div class="plan-name">Gói 6 tháng</div>
      <p class="plan-desc">~5.000đ / ngày · tiết kiệm 50% so với gói 30 ngày.</p>
      <ul class="plan-feats">
        <li><span class="tick">✓</span>Không giới hạn lượt upload / ngày</li>
        <li><span class="tick">✓</span>Không giới hạn lượt tạo nhạc / ngày</li>
        <li><span class="tick">✓</span>Dùng trên 1 thiết bị</li>
        <li><span class="tick">✓</span>Hỗ trợ qua Zalo</li>
      </ul>
      <button type="button" class="plan-cta" data-plan="6m" data-label="Gói 6 tháng — 900.000đ">Chọn gói này</button>
    </div>
    <div class="plan" data-plan="365d">
      <span class="plan-badge-float">Tiết kiệm nhất</span>
      <div class="plan-price-row"><span class="plan-price">1.500.000</span><small>đ /năm</small></div>
      <div class="plan-name">Gói 1 năm</div>
      <p class="plan-desc">~4.110đ / ngày · tiết kiệm 59% so với gói 30 ngày.</p>
      <ul class="plan-feats">
        <li><span class="tick">✓</span>Không giới hạn lượt upload / ngày</li>
        <li><span class="tick">✓</span>Không giới hạn lượt tạo nhạc / ngày</li>
        <li><span class="tick">✓</span>Dùng trên 1 thiết bị</li>
        <li><span class="tick">✓</span>Hỗ trợ qua Zalo</li>
      </ul>
      <button type="button" class="plan-cta" data-plan="365d" data-label="Gói 1 năm — 1.500.000đ">Chọn gói này</button>
    </div>
  </div>
</div>

<dialog id="checkout-dialog">
  <div class="d-head"><h2 id="checkout-plan-label">Gói 6 tháng</h2><p>Nhập thông tin để nhận KEY qua email sau khi thanh toán.</p></div>
  <form id="checkout-form">
    <div id="msg" class="msg bad" hidden></div>
    <label class="field"><span>Tên của bạn</span><input class="input" id="f-name" maxlength="80" placeholder="Ví dụ: Nguyễn Văn A" required></label>
    <label class="field"><span>Email nhận KEY</span><input class="input" id="f-email" type="email" required></label>
    <div class="d-actions"><button class="btn ghost" id="checkout-cancel" type="button">Hủy</button><button class="btn" id="btn-pay" type="submit">Thanh toán</button></div>
  </form>
</dialog>
<script>
(() => {
  const $ = (s) => document.querySelector(s);
  const dialog = $("#checkout-dialog");
  const msg = $("#msg");
  function showMsg(text) { msg.hidden = !text; msg.textContent = text || ""; }
  let selectedPlan = null;

  document.querySelectorAll(".plan-cta").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedPlan = btn.dataset.plan;
      $("#checkout-plan-label").textContent = btn.dataset.label;
      showMsg("");
      $("#f-name").value = "";
      $("#f-email").value = "";
      dialog.showModal();
      $("#f-name").focus();
    });
  });
  $("#checkout-cancel").addEventListener("click", () => dialog.close());

  $("#checkout-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    showMsg("");
    const name = $("#f-name").value.trim();
    const email = $("#f-email").value.trim();
    const btn = $("#btn-pay"); btn.disabled = true; btn.textContent = "Đang chuyển tới Stripe…";
    try {
      const res = await fetch("/stripe/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan: selectedPlan, email, name }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || ("HTTP " + res.status));
      window.location.href = data.url;
    } catch (err) {
      showMsg(err.message);
      btn.disabled = false; btn.textContent = "Thanh toán";
    }
  });
})();
</script>`,
    `.plans-card { width: min(1040px, 100%); padding: 44px 36px 40px; }
.pricing-head { text-align: center; display: grid; gap: 8px; margin-bottom: 4px; }
.pricing-head h1 { font-size: 30px; letter-spacing: -.6px; }
.pricing-head p.sub { font-size: 14px; }
.plans { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; align-items: center; padding-top: 16px; }
.plan { position: relative; display: flex; flex-direction: column; gap: 10px; padding: 28px 24px 24px;
  border-radius: 20px; border: 1px solid var(--line-2); background: var(--bg-2);
  transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease; }

/* Gói giữa (phổ biến nhất) — nổi bật hơn hẳn, tô nền bằng đúng gradient primary hiện có */
.plan[data-plan="6m"] { transform: translateY(-14px); z-index: 2; background: linear-gradient(160deg, var(--primary), var(--primary-2));
  color: var(--on-primary); border-color: transparent; box-shadow: 0 26px 50px -22px rgb(31 181 181 / 55%); }

/* Badge luôn nền đặc (không trong suốt) để không bị chìm vào nền tối phía sau khi tràn lên trên card. */
.plan-badge-float { position: absolute; top: -13px; left: 50%; transform: translateX(-50%); white-space: nowrap;
  font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px; padding: 5px 14px; border-radius: 999px;
  background: var(--card-2); border: 1px solid var(--line-2); color: var(--text); box-shadow: 0 6px 14px -6px rgb(0 0 0 / 50%); }
.plan[data-plan="6m"] .plan-badge-float { background: var(--on-primary); border-color: transparent; color: var(--primary); }

.plan-price-row { display: flex; align-items: baseline; gap: 4px; margin-top: 6px; }
.plan-price { font-size: 30px; font-weight: 800; letter-spacing: -.5px; }
.plan-price-row small { font-size: 12.5px; font-weight: 600; opacity: .7; }
.plan-name { font-weight: 700; font-size: 16px; }
.plan-desc { margin: 0; font-size: 12.5px; opacity: .75; line-height: 1.5; }

.plan-feats { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 10px; font-size: 13px; flex: 1; }
.plan-feats li { display: flex; gap: 9px; align-items: center; line-height: 1.3; }
.plan-feats li .tick { width: 19px; height: 19px; border-radius: 50%; flex: none; display: grid; place-items: center;
  font-size: 10.5px; font-weight: 700; background: rgb(31 181 181 / 14%); color: var(--primary); }
.plan[data-plan="6m"] .plan-feats li .tick { background: rgb(4 33 31 / 14%); color: var(--on-primary); }

.plan-cta { margin-top: 18px; width: 100%; height: 42px; border-radius: 999px; display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 13.5px; background: var(--card-2); border: 1px solid var(--line-2); color: var(--text); font: inherit; cursor: pointer; }
.plan-cta:hover { border-color: var(--primary); color: var(--primary); }
.plan[data-plan="6m"] .plan-cta { background: var(--on-primary); color: var(--primary); border-color: transparent; }
.plan[data-plan="6m"] .plan-cta:hover { filter: brightness(1.1); color: var(--primary); }

dialog { width: min(420px, calc(100vw - 32px)); padding: 0; border: 1px solid var(--line-2); border-radius: 18px; background: var(--card); color: var(--text); box-shadow: 0 18px 40px -24px rgb(0 0 0 / 70%); }
dialog::backdrop { background: rgb(0 0 0 / 55%); backdrop-filter: blur(2px); }
dialog .d-head { padding: 20px 22px 6px; }
dialog .d-head h2 { margin: 0; font-size: 18px; }
dialog .d-head p { margin: 4px 0 0; color: var(--muted); font-size: 13px; }
dialog form { padding: 14px 22px 22px; display: grid; gap: 14px; }
dialog .d-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
dialog .btn { width: auto; padding: 0 16px; }
dialog .btn.ghost { background: transparent; color: var(--muted); }

@media (max-width: 760px) {
  .plans-card { padding: 30px 18px; }
  .plans { grid-template-columns: 1fr; gap: 28px; }
  .plan[data-plan="6m"] { transform: none; }
}`,
  );
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

/** `GET /mua-key/thanh-cong?session_id=...` — tự hỏi lại trạng thái đơn qua /stripe/orders/:id,
 * vì webhook có thể tới sau khi Stripe redirect về vài giây. */
export function muaKeySuccessPageHtml(): Response {
  const html = shell(
    "Thanh toán thành công — Suno Pro",
    `<div class="card">
  <div><h1>Đang kiểm tra thanh toán…</h1><p class="sub" id="sub">Vui lòng đợi trong giây lát.</p></div>
  <div id="msg" class="msg ok" hidden></div>
</div>
<script>
(() => {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get("session_id");
  const sub = document.getElementById("sub");
  const msg = document.getElementById("msg");
  const h1 = document.querySelector("h1");
  if (!sessionId) { h1.textContent = "Thiếu thông tin đơn hàng"; sub.textContent = "Link này không hợp lệ."; return; }

  const PLAN_LABELS = ${JSON.stringify(PLAN_LABELS)};
  let tries = 0;
  async function poll() {
    tries += 1;
    try {
      const res = await fetch("/stripe/orders/" + encodeURIComponent(sessionId));
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Không tra cứu được đơn hàng.");
      if (data.status === "paid") {
        h1.textContent = "Thanh toán thành công 🎉";
        msg.hidden = false;
        msg.className = "msg ok";
        msg.textContent = data.emailSent
          ? "KEY (" + (PLAN_LABELS[data.plan] || data.plan) + ") đã được gửi tới " + data.email + ". Kiểm tra hộp thư (và mục Spam) nhé!"
          : "Thanh toán đã thành công nhưng gửi email bị lỗi — liên hệ hỗ trợ kèm email " + data.email + " để nhận KEY.";
        return;
      }
      if (data.status === "failed" || data.status === "expired") {
        h1.textContent = "Thanh toán chưa hoàn tất";
        msg.hidden = false;
        msg.className = "msg bad";
        msg.textContent = data.error || "Đơn hàng không thành công.";
        return;
      }
      if (tries > 20) {
        sub.textContent = "Đang xử lý hơi lâu — nếu đã trừ tiền, hãy liên hệ hỗ trợ kèm email đã dùng.";
        return;
      }
      setTimeout(poll, 1500);
    } catch (err) {
      sub.textContent = err.message;
    }
  }
  poll();
})();
</script>`,
  );
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
