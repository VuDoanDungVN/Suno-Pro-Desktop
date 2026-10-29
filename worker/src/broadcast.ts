// © 2026 Vũ Dũng (vudungit92@gmail.com) — Suno Pro, phần mềm độc quyền. Toàn văn tại COPYRIGHT.md.
//
// Soạn & gửi mail hàng loạt tới danh sách email đã thu thập (`trial_leads`) — dùng chung khuôn mẫu
// email với OTP/KEY để đồng bộ giao diện.
//
// QUAN TRỌNG: Workers chỉ cho `ctx.waitUntil()` chạy nền tối đa 30 GIÂY sau khi đã trả response —
// không đủ để gửi hàng trăm email có giãn cách vài giây/email. Nên model ở đây là "mỗi lần trang
// admin hỏi tiến độ (`GET .../broadcast/:id`) thì gửi tiếp ĐÚNG 1 email nếu đã đủ giãn cách" — việc
// polling tiến độ chính là động lực đẩy tiến trình gửi đi, không bị giới hạn 30 giây vì mỗi request
// chỉ làm rất ít việc. Hệ quả: phải giữ trang admin đang mở trong lúc gửi; đóng rồi mở lại thì tiếp
// tục đúng chỗ dở dang (trạng thái lưu trong bảng `meta`), không gửi trùng.

import { HttpError, cleanText, json, readJson } from "./http";
import { metaGet, metaSet } from "./auth";
import { sendMail } from "./gmail";
import { bodyTextToHtml, emailShell } from "./email-template";

const MIN_DELAY_S = 0; // 0 = gửi liên tục không nghỉ — Gmail API không đòi hỏi giãn cách, đây chỉ là phòng ngừa tuỳ chọn.
const MAX_DELAY_S = 120;
const DEFAULT_DELAY_S = 2;

interface BroadcastJob {
  id: string;
  subject: string;
  html: string;
  emails: string[];
  index: number;
  sent: number;
  failed: number;
  delayMs: number;
  lastSentAt: number;
  status: "running" | "done";
  createdAt: number;
}

type Target = "all" | "verified" | "unverified";

async function targetEmails(env: Env, target: Target): Promise<string[]> {
  let sql = "SELECT email FROM trial_leads";
  if (target === "verified") sql += " WHERE verified_at IS NOT NULL";
  if (target === "unverified") sql += " WHERE verified_at IS NULL";
  const { results } = await env.DB.prepare(sql).all<{ email: string }>();
  return results.map((r) => r.email);
}

function jobView(job: BroadcastJob) {
  return { id: job.id, subject: job.subject, total: job.emails.length, index: job.index, sent: job.sent, failed: job.failed, status: job.status };
}

/** Gửi tiếp đúng 1 email nếu đã đủ giãn cách kể từ lần gửi trước — gọi lại từ cả bước khởi tạo
 * (gửi email đầu tiên ngay) lẫn mỗi lần `broadcastStatus()` được polling. */
async function advance(env: Env, job: BroadcastJob): Promise<BroadcastJob> {
  if (job.status === "done" || job.index >= job.emails.length) {
    job.status = "done";
    return job;
  }
  const due = job.lastSentAt === 0 || Date.now() - job.lastSentAt >= job.delayMs;
  if (!due) return job;
  const email = job.emails[job.index];
  try {
    await sendMail(env, email, job.subject, job.html);
    job.sent += 1;
  } catch {
    job.failed += 1;
  }
  job.index += 1;
  job.lastSentAt = Date.now();
  if (job.index >= job.emails.length) job.status = "done";
  return job;
}

async function saveJob(env: Env, job: BroadcastJob): Promise<void> {
  await metaSet(env, `broadcast:${job.id}`, JSON.stringify(job));
}

async function loadJob(env: Env, id: string): Promise<BroadcastJob> {
  const raw = await metaGet(env, `broadcast:${id}`);
  if (!raw) throw new HttpError(404, "job_not_found", "Không tìm thấy tiến trình gửi này.");
  return JSON.parse(raw) as BroadcastJob;
}

/** `POST /admin/trial-leads/broadcast/preview { subject, body }` — render thử, không gửi. */
export async function broadcastPreview(request: Request, env: Env): Promise<Response> {
  const data = await readJson<{ subject?: unknown; body?: unknown }>(request);
  const subject = cleanText(data.subject, 150) ?? "(Chưa có tiêu đề)";
  const body = typeof data.body === "string" ? data.body : "";
  return json({ html: emailShell(subject, bodyTextToHtml(body)) });
}

/** `POST /admin/trial-leads/broadcast { subject, body, target, delaySeconds? }` — tạo job, gửi
 * ngay email đầu tiên, trả về `jobId` để trang admin polling đẩy tiếp các email còn lại. */
export async function broadcastStart(request: Request, env: Env): Promise<Response> {
  const data = await readJson<{ subject?: unknown; body?: unknown; target?: unknown; delaySeconds?: unknown }>(request);
  const subject = cleanText(data.subject, 150);
  const bodyText = typeof data.body === "string" ? data.body : "";
  if (!subject || !bodyText.trim()) throw new HttpError(400, "bad_request", "Thiếu tiêu đề hoặc nội dung.");
  const target: Target = data.target === "verified" || data.target === "unverified" ? data.target : "all";
  const delaySeconds = typeof data.delaySeconds === "number" && data.delaySeconds >= MIN_DELAY_S && data.delaySeconds <= MAX_DELAY_S ? data.delaySeconds : DEFAULT_DELAY_S;

  const emails = await targetEmails(env, target);
  if (!emails.length) throw new HttpError(400, "no_recipients", "Không có email nào phù hợp để gửi.");

  const html = emailShell(subject, bodyTextToHtml(bodyText));
  let job: BroadcastJob = {
    id: crypto.randomUUID(),
    subject,
    html,
    emails,
    index: 0,
    sent: 0,
    failed: 0,
    delayMs: delaySeconds * 1000,
    lastSentAt: 0,
    status: "running",
    createdAt: Date.now(),
  };
  job = await advance(env, job); // gửi ngay email đầu tiên, không chờ giãn cách.
  await saveJob(env, job);
  return json(jobView(job));
}

/** `GET /admin/trial-leads/broadcast/:id` — trang admin gọi lặp lại; mỗi lần gọi vừa trả tiến độ
 * vừa tự gửi tiếp 1 email nếu đã đủ giãn cách (xem ghi chú ở đầu file). */
export async function broadcastStatus(env: Env, id: string): Promise<Response> {
  let job = await loadJob(env, id);
  job = await advance(env, job);
  await saveJob(env, job);
  return json(jobView(job));
}
