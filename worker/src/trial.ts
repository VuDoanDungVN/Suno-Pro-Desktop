// © 2026 Vũ Dũng (vudungit92@gmail.com) — Suno Pro, phần mềm độc quyền. Toàn văn tại COPYRIGHT.md.
//
// Trang tự phục vụ /trial — người dùng tự nhập Tên/Email + mã xác nhận lấy trong nhóm Zalo, xác
// minh email thật qua OTP (chống điền mail bừa), rồi nhận 1 KEY dùng thử 1 ngày — không cần admin
// ngồi duyệt tay. Mỗi email chỉ nhận được 1 key trial (is_trial=1), 1 key chỉ kích hoạt được trên
// 1 thiết bị như mọi key khác (xem auth.ts).

import { HttpError, cleanText, json, readJson } from "./http";
import {
  assertNotRateLimited,
  clearRateLimit,
  createTrialLicense,
  hasClaimedTrial,
  markTrialLeadVerified,
  metaDelete,
  metaGet,
  metaSet,
  recordRateLimitFail,
  recordTrialLead,
} from "./auth";
import { sendMail } from "./gmail";
import { codeBox, emailShell } from "./email-template";

const OTP_TTL_MS = 10 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const REQUEST_MAX_FAILS = 5;
const REQUEST_LOCK_MS = 60 * 60_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface OtpState {
  otp: string;
  name: string;
  attempts: number;
  expiresAt: number;
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function randomOtp(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
}


/** `POST /trial/request-otp { name, email, zaloCode }` */
export async function requestOtp(request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  const body = await readJson<{ name?: unknown; email?: unknown; zaloCode?: unknown }>(request);
  const name = cleanText(body.name, 80) ?? "Khách dùng thử";
  const email = normalizeEmail(body.email);
  const zaloCode = cleanText(body.zaloCode, 40) ?? "";
  if (!EMAIL_RE.test(email)) throw new HttpError(400, "bad_email", "Email không hợp lệ.");

  const rateKey = `trial_req:${ip}`;
  await assertNotRateLimited(env, rateKey, REQUEST_MAX_FAILS, REQUEST_LOCK_MS);

  const currentCode = (await metaGet(env, "trial_zalo_code")) ?? "";
  if (!currentCode || zaloCode.toUpperCase() !== currentCode.toUpperCase()) {
    await recordRateLimitFail(env, rateKey, REQUEST_LOCK_MS);
    throw new HttpError(403, "bad_zalo_code", "Mã xác nhận không đúng. Hãy lấy mã mới nhất đang ghim trong nhóm Zalo.");
  }
  if (await hasClaimedTrial(env, email)) {
    throw new HttpError(409, "already_claimed", "Email này đã nhận key dùng thử trước đó.");
  }
  await clearRateLimit(env, rateKey);
  await recordTrialLead(env, email, name);

  const otp = randomOtp();
  const state: OtpState = { otp, name, attempts: 0, expiresAt: Date.now() + OTP_TTL_MS };
  await metaSet(env, `trial_otp:${email}`, JSON.stringify(state));

  await sendMail(
    env,
    email,
    "Mã xác minh Suno Pro",
    emailShell(
      "Xác minh email để nhận key dùng thử",
      `<p style="margin:0 0 4px;font-size:14px;color:#374151;line-height:1.6;">Xin chào <b>${name}</b>,</p>
       <p style="margin:0;font-size:14px;color:#374151;line-height:1.6;">Nhập mã bên dưới vào trang đăng ký để xác minh email và nhận key dùng thử Suno Pro.</p>
       ${codeBox(otp, "6px", "30px")}
       <p style="margin:0;font-size:13px;color:#9aa4b4;line-height:1.6;">Mã có hiệu lực trong <b>10 phút</b>. Nếu bạn không yêu cầu, hãy bỏ qua email này.</p>`,
    ),
  );

  return json({ ok: true });
}

/** `POST /trial/verify-otp { email, otp }` */
export async function verifyOtp(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ email?: unknown; otp?: unknown }>(request);
  const email = normalizeEmail(body.email);
  const otp = cleanText(body.otp, 10) ?? "";
  if (!EMAIL_RE.test(email) || !otp) throw new HttpError(400, "bad_request", "Thiếu thông tin.");

  const metaKey = `trial_otp:${email}`;
  const raw = await metaGet(env, metaKey);
  if (!raw) throw new HttpError(404, "otp_not_found", "Chưa yêu cầu mã hoặc mã đã hết hạn. Hãy thử lại từ đầu.");
  const state = JSON.parse(raw) as OtpState;
  if (Date.now() > state.expiresAt) {
    await metaDelete(env, metaKey);
    throw new HttpError(410, "otp_expired", "Mã đã hết hạn. Hãy thử lại từ đầu.");
  }
  if (state.otp !== otp) {
    state.attempts += 1;
    if (state.attempts >= OTP_MAX_ATTEMPTS) {
      await metaDelete(env, metaKey);
      throw new HttpError(429, "too_many_attempts", "Sai mã quá nhiều lần. Hãy thử lại từ đầu.");
    }
    await metaSet(env, metaKey, JSON.stringify(state));
    throw new HttpError(401, "bad_otp", "Mã xác minh không đúng.");
  }
  await metaDelete(env, metaKey);
  await markTrialLeadVerified(env, email);

  if (await hasClaimedTrial(env, email)) {
    throw new HttpError(409, "already_claimed", "Email này đã nhận key dùng thử trước đó.");
  }

  const { key, license } = await createTrialLicense(env, state.name, email, 1);
  await sendMail(
    env,
    email,
    "KEY dùng thử Suno Pro (1 ngày)",
    emailShell(
      "Key dùng thử của bạn đã sẵn sàng 🎉",
      `<p style="margin:0 0 4px;font-size:14px;color:#374151;line-height:1.6;">Xin chào <b>${state.name}</b>,</p>
       <p style="margin:0;font-size:14px;color:#374151;line-height:1.6;">Cảm ơn bạn đã dùng thử Suno Pro. Đây là key của bạn:</p>
       ${codeBox(key, "1.5px", "18px")}
       <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 18px;">
         <tr><td style="background:#fafbfc;border:1px solid #edf0f4;border-radius:8px;padding:14px 16px;font-size:13px;color:#6b7280;line-height:1.7;">
           ⏱ Hiệu lực <b>24 giờ</b> kể từ bây giờ<br>
           💻 Chỉ kích hoạt được trên <b>1 thiết bị</b>
         </td></tr>
       </table>
       <p style="margin:0;font-size:14px;color:#374151;line-height:1.6;">Mở ứng dụng <b>Suno Pro</b>, dán key này vào màn hình kích hoạt để bắt đầu sử dụng.</p>`,
    ),
  );

  return json({ ok: true, email, expiresAt: license.expiresAt });
}

/** `GET /trial` — trang công khai, không cần đăng nhập. */
export function trialPageHtml(): Response {
  const html = `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Suno Pro — Nhận key dùng thử</title>
<style>
:root { --bg:#12151b; --bg-2:#171b22; --card:#1d222b; --line:#2e3542; --line-2:#3a4252; --text:#e9edf3; --muted:#9aa4b4;
  --primary:#1fb5b5; --primary-2:#138c8c; --on-primary:#04211f; --bad:#ff8a8a; --ok:#2dd4bf; color-scheme: dark; }
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body { background: radial-gradient(1200px 600px at 10% -10%, rgb(31 181 181 / 9%), transparent 60%), var(--bg); color: var(--text);
  font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif; display: grid; place-items: center; padding: 24px; }
[hidden] { display: none !important; }
.card { width: min(420px, 100%); padding: 28px 26px; border-radius: 18px; background: rgb(29 34 43 / 92%); border: 1px solid var(--line); box-shadow: 0 18px 40px -24px rgb(0 0 0 / 70%); display: grid; gap: 16px; }
h1 { margin: 0; font-size: 20px; letter-spacing: -.3px; }
p.sub { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.6; }
.field { display: grid; gap: 6px; }
.field > span { color: var(--muted); font-size: 12px; font-weight: 600; }
.input { width: 100%; height: 42px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--line-2); background: var(--bg-2); color: var(--text); font: inherit; }
.input:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px rgb(31 181 181 / 18%); }
.btn { width: 100%; height: 44px; border-radius: 10px; border: none; background: linear-gradient(135deg, var(--primary), var(--primary-2)); color: var(--on-primary);
  font: inherit; font-weight: 700; cursor: pointer; }
.btn:disabled { opacity: .55; cursor: default; }
.btn.ghost { background: transparent; border: 1px solid var(--line-2); color: var(--text); font-weight: 600; }
.msg { padding: 10px 12px; border-radius: 10px; font-size: 13px; }
.msg.bad { background: rgb(255 138 138 / 9%); border: 1px solid rgb(255 138 138 / 35%); color: #ffc2c2; }
.msg.ok { background: rgb(45 212 191 / 10%); border: 1px solid rgb(45 212 191 / 30%); color: #bdf5ec; }
a { color: var(--primary); }
</style>
</head>
<body>
<div class="card">
  <div><h1>Nhận key dùng thử Suno Pro</h1><p class="sub">Key có hiệu lực 24 giờ, chỉ dùng được trên 1 thiết bị. Mỗi email chỉ nhận được 1 lần.</p></div>
  <div id="msg" class="msg" hidden></div>

  <form id="step1" style="display:grid;gap:14px">
    <label class="field"><span>Tên của bạn</span><input class="input" id="f-name" maxlength="80" required></label>
    <label class="field"><span>Email</span><input class="input" id="f-email" type="email" required></label>
    <label class="field"><span>Mã xác nhận (lấy trong nhóm Zalo)</span><input class="input" id="f-code" maxlength="40" required></label>
    <button class="btn" id="btn-request" type="submit">Gửi mã xác minh về email</button>
  </form>

  <form id="step2" hidden style="display:grid;gap:14px">
    <p class="sub">Đã gửi mã xác minh tới <b id="sent-to"></b>. Mở hộp thư và nhập mã 6 số bên dưới.</p>
    <label class="field"><span>Mã xác minh</span><input class="input" id="f-otp" inputmode="numeric" maxlength="6" required></label>
    <button class="btn" id="btn-verify" type="submit">Xác nhận & nhận key</button>
    <button class="btn ghost" id="btn-back" type="button">Nhập lại email</button>
  </form>
</div>
<script>
(() => {
  const $ = (s) => document.querySelector(s);
  const msg = $("#msg");
  function showMsg(text, tone) { msg.hidden = !text; msg.className = "msg " + (tone || "bad"); msg.textContent = text || ""; }
  async function post(path, body) {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || ("HTTP " + res.status));
    return data;
  }
  let email = "";
  $("#step1").addEventListener("submit", async (e) => {
    e.preventDefault();
    showMsg("");
    const btn = $("#btn-request"); btn.disabled = true; btn.textContent = "Đang gửi…";
    try {
      email = $("#f-email").value.trim();
      await post("/trial/request-otp", { name: $("#f-name").value.trim(), email, zaloCode: $("#f-code").value.trim() });
      $("#sent-to").textContent = email;
      $("#step1").hidden = true;
      $("#step2").hidden = false;
      showMsg("Đã gửi mã xác minh. Kiểm tra hộp thư (và mục spam nếu chưa thấy).", "ok");
    } catch (err) { showMsg(err.message, "bad"); }
    finally { btn.disabled = false; btn.textContent = "Gửi mã xác minh về email"; }
  });
  $("#btn-back").addEventListener("click", () => { $("#step2").hidden = true; $("#step1").hidden = false; showMsg(""); });
  $("#step2").addEventListener("submit", async (e) => {
    e.preventDefault();
    showMsg("");
    const btn = $("#btn-verify"); btn.disabled = true; btn.textContent = "Đang xác nhận…";
    try {
      await post("/trial/verify-otp", { email, otp: $("#f-otp").value.trim() });
      $("#step2").hidden = true;
      showMsg("Đã gửi KEY dùng thử tới " + email + ". Kiểm tra hộp thư nhé!", "ok");
    } catch (err) { showMsg(err.message, "bad"); }
    finally { btn.disabled = false; btn.textContent = "Xác nhận & nhận key"; }
  });
})();
</script>
</body>
</html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
