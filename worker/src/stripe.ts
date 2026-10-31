// © 2026 Vũ Dũng (vudungit92@gmail.com) — Suno Pro, phần mềm độc quyền. Toàn văn tại COPYRIGHT.md.
//
// Mua KEY bằng Stripe Checkout — trang mua hàng ngay trên Worker (/mua-key). Luồng:
//   1. Trang /mua-key gọi POST /stripe/checkout { plan, email } -> Worker tạo Stripe Checkout
//      Session, lưu 1 dòng "pending" vào stripe_orders, trả về url để redirect sang trang Stripe.
//   2. Khách thanh toán xong trên trang Stripe (Stripe tự lo UI/PCI compliance, Worker không bao
//      giờ thấy số thẻ).
//   3. Stripe gọi POST /stripe/webhook (server-to-server, có chữ ký) -> Worker xác minh chữ ký,
//      cấp KEY (issueLicense(), dùng chung với admin tạo tay), gửi email bằng khuôn mẫu chung
//      (email-template.ts) để đồng bộ giao diện với OTP/KEY dùng thử.
//   4. Trang "Thanh toán thành công" (/mua-key/thanh-cong) gọi GET /stripe/orders/:sessionId để
//      hỏi/hiện trạng thái ngay (vì bước 3 có thể tới sau khi khách được Stripe redirect về vài
//      giây).
//
// Giá tiền do CHÍNH Stripe Price ID (tạo sẵn trên Dashboard Stripe) quyết định — Worker chỉ gửi
// priceId, không bao giờ nhận/tin số tiền từ phía khách hàng, nên khách không thể sửa giá khi gọi
// API thẳng (tránh gian lận đổi giá).
import { HttpError, cleanText, json, readJson, sameText } from "./http";
import { issueLicense } from "./auth";
import { sendMail } from "./gmail";
import { codeBox, emailShell } from "./email-template";

const now = () => Date.now();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Mỗi gói: nhãn hiển thị, thời hạn cấp cho license (null = không hết hạn), và Stripe Price ID
 * tương ứng (lấy từ Worker secret). Sửa/thêm gói ở đây, không cần đụng route. */
function stripePlans(env: Env): Record<string, { label: string; days: number | null; priceId?: string }> {
  return {
    "7d": { label: "Gói 7 ngày", days: 7, priceId: env.STRIPE_PRICE_7D },
    "30d": { label: "Gói 30 ngày", days: 30, priceId: env.STRIPE_PRICE_30D },
    "6m": { label: "Gói 6 tháng", days: 180, priceId: env.STRIPE_PRICE_6M },
    "365d": { label: "Gói 1 năm", days: 365, priceId: env.STRIPE_PRICE_365D },
  };
}

function cleanEmail(value: unknown): string | null {
  const email = cleanText(value, 200);
  return email && EMAIL_RE.test(email) ? email.toLowerCase() : null;
}

function requireStripeConfig(env: Env): string {
  if (!env.STRIPE_SECRET_KEY) {
    throw new HttpError(503, "stripe_disabled", "Chưa cấu hình thanh toán Stripe (STRIPE_SECRET_KEY).");
  }
  return env.STRIPE_SECRET_KEY;
}

async function stripeApi(env: Env, path: string, form: Record<string, string>): Promise<any> {
  const secret = requireStripeConfig(env);
  const body = new URLSearchParams(form);
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const data = (await res.json().catch(() => null)) as any;
  if (!res.ok) {
    const message = data?.error?.message || `Stripe trả về lỗi HTTP ${res.status}.`;
    throw new HttpError(502, "stripe_error", message);
  }
  return data;
}

/** Chặn spam tạo phiên thanh toán theo IP — không tốn tiền khách nhưng có thể làm đầy DB/phí gọi
 * API Stripe nếu bị bot dò. Tối đa 8 lần/10 phút/IP — đủ rộng cho người dùng thật bấm thử lại vài
 * lần, đủ chặn script spam. */
const CHECKOUT_RATE_MAX = 8;
const CHECKOUT_RATE_WINDOW_MS = 10 * 60_000;

async function checkRateLimit(env: Env, ip: string): Promise<void> {
  const key = `stripe_checkout_rl:${ip}`;
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key = ?").bind(key).first<{ value: string }>();
  const state = row ? (JSON.parse(row.value) as { count: number; at: number }) : { count: 0, at: 0 };
  const fresh = now() - state.at > CHECKOUT_RATE_WINDOW_MS;
  const count = fresh ? 1 : state.count + 1;
  if (!fresh && count > CHECKOUT_RATE_MAX) {
    throw new HttpError(429, "too_many_requests", "Bạn vừa thử quá nhiều lần. Hãy đợi vài phút rồi thử lại.");
  }
  await env.DB.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, JSON.stringify({ count, at: fresh ? now() : state.at }))
    .run();
}

/** `POST /stripe/checkout { plan, email }` → tạo phiên Stripe Checkout, trả `{ url }` để trang
 * /mua-key redirect khách sang thanh toán. Không cần đăng nhập (đây chính là bước MUA key lần
 * đầu, khách chưa có key nào cả). */
export async function createCheckout(request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  await checkRateLimit(env, ip);

  const body = await readJson<{ plan?: unknown; email?: unknown }>(request);
  const planKey = cleanText(body.plan, 40);
  const email = cleanEmail(body.email);
  if (!email) throw new HttpError(400, "bad_email", "Hãy nhập đúng địa chỉ email để nhận KEY.");
  const plans = stripePlans(env);
  const plan = planKey ? plans[planKey] : null;
  if (!planKey || !plan) throw new HttpError(400, "bad_plan", "Gói không hợp lệ.");
  if (!plan.priceId) {
    throw new HttpError(503, "plan_unavailable", `Gói "${plan.label}" chưa được cấu hình giá (thiếu Price ID Stripe).`);
  }

  const origin = cleanText(request.headers.get("origin"), 200) ?? new URL(request.url).origin;
  // Stripe mặc định giữ phiên "pending" tới 24 giờ nếu khách bỏ ngang không thanh toán — quá lâu
  // cho danh sách Dòng tiền ở admin. 30 phút là mức SỚM NHẤT Stripe cho phép đặt, nên dùng đúng
  // mức này để đơn "bỏ ngang" sớm chuyển sang "Hết hạn".
  const expiresAt = Math.floor(now() / 1000) + 30 * 60;
  const session = await stripeApi(env, "checkout/sessions", {
    mode: "payment",
    "line_items[0][price]": plan.priceId,
    "line_items[0][quantity]": "1",
    customer_email: email,
    "metadata[plan]": planKey,
    "payment_intent_data[description]": `Suno Pro — ${plan.label}`,
    success_url: `${origin}/mua-key/thanh-cong?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/mua-key?huy=1`,
    expires_at: String(expiresAt),
  });

  await env.DB.prepare(
    `INSERT INTO stripe_orders (id, plan, email, status, amount_cents, currency, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)`,
  )
    .bind(session.id, planKey, email, session.amount_total ?? null, session.currency ?? null, now(), now())
    .run();

  return json({ url: session.url });
}

interface StripeOrderRow {
  id: string;
  plan: string;
  email: string;
  status: "pending" | "processing" | "paid" | "failed" | "expired";
  license_id: string | null;
  email_sent: number | null;
  error: string | null;
}

/** `GET /stripe/orders/:sessionId` — trang "Thanh toán thành công" hỏi lại trạng thái (webhook ở
 * bước 3 có thể tới sau khi khách được redirect về vài giây, nên trang này cần tự hỏi lại thay vì
 * giả định đã xong ngay). KHÔNG trả KEY thật qua đây — chủ ý bắt khách kiểm tra email để nhận KEY
 * (tránh lộ KEY ngay trên màn hình, vd. khi share màn hình/trình duyệt dùng chung máy công cộng).
 * Chỉ báo `emailSent` để trang biết có cần nhắc khách kiểm tra Spam / liên hệ hỗ trợ hay không.
 * `sessionId` dài, ngẫu nhiên (Stripe tự sinh) nên tự nó đã là 1 "capability token" đủ an toàn để
 * tra cứu công khai không cần đăng nhập — không đoán được của người khác. */
export async function getOrderStatus(env: Env, sessionId: string): Promise<Response> {
  const order = await env.DB.prepare(
    "SELECT id, plan, email, status, license_id, email_sent, error FROM stripe_orders WHERE id = ?",
  )
    .bind(sessionId)
    .first<StripeOrderRow>();
  if (!order) throw new HttpError(404, "order_not_found", "Không tìm thấy đơn hàng này.");
  return json({
    status: order.status,
    plan: order.plan,
    email: order.email,
    emailSent: order.email_sent === null ? null : order.email_sent === 1,
  });
}

/** Xác minh chữ ký webhook Stripe thủ công (HMAC-SHA256 trên header `Stripe-Signature`) — không
 * cần SDK `stripe` (giảm phụ thuộc, Worker chỉ cần Web Crypto có sẵn). Đúng thuật toán Stripe công
 * bố: ký trên chuỗi `"{timestamp}.{raw body}"`, so khớp hex không lộ thời gian so sánh
 * (timing-safe) để tránh dò chữ ký từng byte. Từ chối nếu timestamp lệch quá 5 phút — chặn replay
 * request cũ bị chặn bắt lại rồi gửi lại sau.
 *
 * ĐÂY LÀ HÀNG RÀO BẢO MẬT QUAN TRỌNG NHẤT CỦA TOÀN BỘ LUỒNG: thiếu bước này thì bất kỳ ai cũng tự
 * POST thẳng vào /stripe/webhook giả vờ "đã thanh toán" để xin KEY miễn phí. */
async function verifyStripeSignature(rawBody: string, signatureHeader: string | null, secret: string): Promise<boolean> {
  if (!signatureHeader) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((pair) => {
      const i = pair.indexOf("=");
      return [pair.slice(0, i), pair.slice(i + 1)];
    }),
  );
  const timestamp = parts["t"];
  const v1 = parts["v1"];
  if (!timestamp || !v1 || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(now() / 1000 - Number(timestamp)) > 300) return false;

  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sigBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
  const expectedHex = [...new Uint8Array(sigBytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return sameText(expectedHex, v1);
}

/** `POST /stripe/webhook` — Stripe gọi trực tiếp (server-to-server), không qua app. Chỉ xử lý 3
 * loại sự kiện cần cho việc cấp KEY, mọi sự kiện khác được xác nhận 200 OK nhưng bỏ qua (Stripe
 * gửi nhiều loại event khác không liên quan, không cần Worker quan tâm). */
export async function stripeWebhook(request: Request, env: Env): Promise<Response> {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new HttpError(503, "stripe_disabled", "Chưa cấu hình STRIPE_WEBHOOK_SECRET.");
  }
  const rawBody = await request.text();
  const valid = await verifyStripeSignature(rawBody, request.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET);
  if (!valid) throw new HttpError(400, "bad_signature", "Chữ ký webhook không hợp lệ.");

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    throw new HttpError(400, "bad_json", "Nội dung webhook không phải JSON hợp lệ.");
  }

  const type = String(event?.type ?? "");
  const session = event?.data?.object;

  if (type === "checkout.session.completed" || type === "checkout.session.async_payment_succeeded") {
    if (session?.payment_status === "paid") await fulfillOrder(env, session.id);
    // payment_status khác "paid" (vd. phương thức thanh toán trả chậm còn đang xử lý) — chờ sự
    // kiện async_payment_succeeded/async_payment_failed tới sau, chưa làm gì ở đây.
  } else if (type === "checkout.session.async_payment_failed") {
    await markOrderFailed(env, session?.id, "Thanh toán không thành công (phương thức trả chậm bị từ chối).");
  } else if (type === "checkout.session.expired") {
    await markOrderFailed(env, session?.id, "Phiên thanh toán đã hết hạn (khách không hoàn tất).", "expired");
  }

  // Luôn trả 200 cho các sự kiện không liên quan/đã bỏ qua — trả lỗi sẽ khiến Stripe hiểu nhầm là
  // Worker lỗi và cứ gọi lại mãi loại event mà Worker chủ động không xử lý.
  return json({ received: true });
}

/** Cấp KEY cho 1 đơn đã xác nhận thanh toán — idempotent: nếu webhook bị Stripe gọi lại (vốn đảm
 * bảo "at-least-once", không phải "exactly-once"), chỉ lần đầu tiên thật sự cấp KEY; các lần gọi
 * lại sau chỉ no-op nhờ UPDATE ... WHERE status = 'pending' không khớp được dòng nào nữa (0 rows
 * affected) — tránh cấp 2 KEY cho 1 lượt thanh toán. */
async function fulfillOrder(env: Env, sessionId: string | undefined): Promise<void> {
  if (!sessionId) return;
  const claim = await env.DB.prepare("UPDATE stripe_orders SET status = 'processing', updated_at = ? WHERE id = ? AND status = 'pending'")
    .bind(now(), sessionId)
    .run();
  if ((claim.meta?.changes ?? 0) === 0) return; // đã xử lý rồi, hoặc đơn không tồn tại — bỏ qua

  const order = await env.DB.prepare("SELECT plan, email FROM stripe_orders WHERE id = ?").bind(sessionId).first<{ plan: string; email: string }>();
  if (!order) return;
  const plan = stripePlans(env)[order.plan];
  try {
    const { id: licenseId, key } = await issueLicense(env, {
      name: order.email,
      email: order.email,
      note: `Mua qua Stripe — gói "${plan?.label ?? order.plan}"`,
      days: plan?.days ?? null,
    });
    let emailOk = false;
    try {
      const daysLabel = plan?.days === null ? "Không giới hạn thời gian" : `${plan?.days ?? "?"} ngày`;
      await sendMail(
        env,
        order.email,
        "KEY Suno Pro của bạn đã sẵn sàng",
        emailShell(
          "Cảm ơn bạn đã mua Suno Pro 🎉",
          `<p style="margin:0 0 4px;font-size:14px;color:#374151;line-height:1.6;">Xin chào,</p>
           <p style="margin:0;font-size:14px;color:#374151;line-height:1.6;">Thanh toán của bạn đã thành công. Đây là KEY kích hoạt:</p>
           ${codeBox(key, "1.5px", "18px")}
           <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 18px;">
             <tr><td style="background:#fafbfc;border:1px solid #edf0f4;border-radius:8px;padding:14px 16px;font-size:13px;color:#6b7280;line-height:1.7;">
               ⏱ Thời hạn <b>${daysLabel}</b><br>
               💻 Chỉ kích hoạt được trên <b>1 thiết bị</b>
             </td></tr>
           </table>
           <p style="margin:0;font-size:14px;color:#374151;line-height:1.6;">Mở ứng dụng <b>Suno Pro</b>, dán KEY này vào màn hình kích hoạt để bắt đầu sử dụng.</p>`,
        ),
      );
      emailOk = true;
    } catch {
      emailOk = false;
    }
    await env.DB.prepare("UPDATE stripe_orders SET status = 'paid', license_id = ?, email_sent = ?, updated_at = ? WHERE id = ?")
      .bind(licenseId, emailOk ? 1 : 0, now(), sessionId)
      .run();
  } catch (err) {
    // Trả lại 'pending' để lần webhook retry tiếp theo (Stripe tự thử lại vài ngày khi nhận lỗi
    // 5xx) có cơ hội cấp KEY lại — không để đơn kẹt mãi ở 'processing' không ai xử lý tiếp.
    const message = err instanceof Error ? err.message : "Lỗi không xác định khi cấp KEY.";
    await env.DB.prepare("UPDATE stripe_orders SET status = 'pending', error = ?, updated_at = ? WHERE id = ?")
      .bind(message, now(), sessionId)
      .run();
    throw err; // Worker trả 500 -> Stripe tự động gọi lại webhook.
  }
}

async function markOrderFailed(env: Env, sessionId: string | undefined, error: string, status: "failed" | "expired" = "failed"): Promise<void> {
  if (!sessionId) return;
  await env.DB.prepare("UPDATE stripe_orders SET status = ?, error = ?, updated_at = ? WHERE id = ? AND status IN ('pending', 'processing')")
    .bind(status, error, now(), sessionId)
    .run();
}

/** `GET /admin/payments` — trang admin "Dòng tiền": toàn bộ đơn Stripe (mọi trạng thái) để vẽ
 * danh sách + thống kê. Danh sách đơn thường không lớn nên trả hết 1 lần, để trang admin tự
 * lọc/tổng hợp phía client — giống cách `/admin/licenses` đang làm. */
export async function adminListPayments(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT id, plan, email, status, amount_cents, currency, license_id, email_sent, error, created_at, updated_at FROM stripe_orders ORDER BY created_at DESC",
  ).all<StripeOrderRow & { amount_cents: number | null; currency: string | null; created_at: number; updated_at: number }>();
  return json({
    orders: results.map((r) => ({
      id: r.id,
      plan: r.plan,
      email: r.email,
      status: r.status,
      amountCents: r.amount_cents,
      currency: r.currency,
      emailSent: r.email_sent === null ? null : r.email_sent === 1,
      error: r.error,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
  });
}
