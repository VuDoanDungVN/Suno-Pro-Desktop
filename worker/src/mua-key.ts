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
    `<div class="card">
  <div><h1>Mua KEY Suno Pro</h1><p class="sub">Chọn gói, thanh toán an toàn qua Stripe — KEY sẽ được gửi về email ngay sau khi thanh toán thành công.</p></div>
  <div id="msg" class="msg bad" hidden></div>
  <form id="form" style="display:grid;gap:14px">
    <div class="plans" id="plans">
      <label class="plan" data-plan="7d"><input type="radio" name="plan" value="7d"><span class="plan-label">Gói 7 ngày</span></label>
      <label class="plan" data-plan="30d"><input type="radio" name="plan" value="30d" checked><span class="plan-label">Gói 30 ngày</span></label>
      <label class="plan" data-plan="6m"><input type="radio" name="plan" value="6m"><span class="plan-label">Gói 6 tháng</span></label>
      <label class="plan" data-plan="365d"><input type="radio" name="plan" value="365d"><span class="plan-label">Gói 1 năm</span></label>
    </div>
    <label class="field"><span>Email nhận KEY</span><input class="input" id="f-email" type="email" required></label>
    <button class="btn" id="btn-pay" type="submit">Thanh toán</button>
  </form>
</div>
<script>
(() => {
  const $ = (s) => document.querySelector(s);
  const msg = $("#msg");
  function showMsg(text) { msg.hidden = !text; msg.textContent = text || ""; }
  document.querySelectorAll(".plan").forEach((el) => {
    el.addEventListener("click", () => {
      document.querySelectorAll(".plan").forEach((p) => p.classList.remove("selected"));
      el.classList.add("selected");
    });
  });
  document.querySelector('.plan input[checked]')?.closest(".plan")?.classList.add("selected");
  $("#form").addEventListener("submit", async (e) => {
    e.preventDefault();
    showMsg("");
    const plan = document.querySelector('input[name="plan"]:checked')?.value;
    const email = $("#f-email").value.trim();
    const btn = $("#btn-pay"); btn.disabled = true; btn.textContent = "Đang chuyển tới Stripe…";
    try {
      const res = await fetch("/stripe/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan, email }) });
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
