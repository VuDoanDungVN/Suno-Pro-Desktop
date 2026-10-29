// © 2026 Vũ Dũng (vudungit92@gmail.com) — Suno Pro, phần mềm độc quyền. Toàn văn tại COPYRIGHT.md.
//
// Gửi mail (OTP xác minh + KEY dùng thử) qua Gmail API bằng OAuth2 refresh token của 1 Gmail
// thật — Workers không hỗ trợ tốt TCP/SMTP (nodemailer cần mở socket SMTP, bị giới hạn/chặn),
// nên dùng thẳng Gmail API qua `fetch()` (HTTPS thường), không cần hạ tầng gửi mail nào khác.

import { HttpError } from "./http";

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(env: Env): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 30_000) return cachedToken.token;
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN) {
    throw new HttpError(503, "mail_disabled", "Chưa cấu hình gửi email.");
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new HttpError(502, "mail_token_failed", "Không lấy được quyền gửi email (Gmail).");
  const data = await res.json<{ access_token: string; expires_in: number }>();
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

function toB64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Chủ đề tiếng Việt cần encoded-word (RFC 2047) để không vỡ font trên mail client. */
function encodeHeaderUtf8(text: string): string {
  return `=?UTF-8?B?${btoa(unescape(encodeURIComponent(text)))}?=`;
}

export async function sendMail(env: Env, to: string, subject: string, html: string): Promise<void> {
  const from = env.GMAIL_SENDER || "me";
  const message = [`From: ${from}`, `To: ${to}`, `Subject: ${encodeHeaderUtf8(subject)}`, "MIME-Version: 1.0", `Content-Type: text/html; charset="UTF-8"`, "", html].join(
    "\r\n",
  );
  const raw = toB64Url(new TextEncoder().encode(message));
  const token = await getAccessToken(env);
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new HttpError(502, "mail_send_failed", `Gửi email thất bại: ${text.slice(0, 200)}`);
  }
}
