// © 2026 Vũ Dũng (vudungit92@gmail.com) — Suno Pro, phần mềm độc quyền. Toàn văn tại COPYRIGHT.md.
//
// Trang hướng dẫn công khai /huong-dan — dành cho bản Desktop (Mac/Windows) của Suno Pro, KHÁC
// với trang mẫu dạng iPhone app + Chrome extension: luồng ở đây chỉ có 3 bước — tải app (Google
// Drive) → tham gia nhóm Zalo lấy mã xác nhận → vào /trial nhận KEY dùng thử 1 ngày. Cùng bảng màu
// với trial.ts/email-template.ts để đồng bộ giao diện toàn hệ thống.

import { svgQrCode, svgQrDataUrl } from "./qr";
import { metaGet } from "./auth";

/** Link mặc định nếu chưa từng đặt qua admin (`POST /admin/download-url { platform, url }`) — sau
 * khi đặt 1 lần, trang này luôn ưu tiên đọc giá trị trong bảng `meta`, đổi link ở admin có hiệu
 * lực ngay, không cần sửa code/deploy lại Worker. */
const DEFAULT_DOWNLOAD_URL_WIN = "https://drive.google.com/file/d/1UqOUVOrJcZkrKbQdI_k3slRQlNm2moTh/view?usp=sharing";
const DEFAULT_DOWNLOAD_URL_MAC = "https://drive.google.com/file/d/1ZAorRANxFT6pZfT99hyKIp_-kuysLSCD/view?usp=sharing";
const ZALO_URL = "https://zalo.me/g/rcgwyddohgnhuhtmhxxk";
const TRIAL_PATH = "/trial";
const BASE_URL = "https://suno-pro-worker.vudungit92.workers.dev";
const PAGE_TITLE = "Suno Pro — Công cụ hỗ trợ Suno AI (Desktop) | Tải app và nhận KEY dùng thử";
const PAGE_DESC = "Suno Pro là công cụ Desktop (Mac/Windows) giúp tự động hoá upload, ghép và xuất nhạc trên Suno AI. Tải ứng dụng, tham gia nhóm Zalo lấy mã xác nhận, nhận KEY dùng thử Suno Pro 1 ngày miễn phí — chỉ 3 bước.";
const PAGE_KEYWORDS =
  "Suno AI, Suno Pro, công cụ Suno AI, phần mềm hỗ trợ Suno AI, tải nhạc Suno, upload nhạc lên Suno AI, " +
  "tự động hoá Suno AI, KEY dùng thử Suno Pro, tải Suno Pro, Suno Pro Desktop, ứng dụng Suno Pro Mac Windows";

/** Ảnh PNG cho thẻ og:image/twitter:image — Facebook/Zalo... không render SVG làm thumbnail, nên
 * endpoint này proxy hộ 1 ảnh QR PNG (cùng nội dung link nhóm Zalo) từ dịch vụ ảnh QR miễn phí
 * api.qrserver.com, trả về qua domain của mình để link ảnh ổn định + cache được. */
export async function guideOgImage(): Promise<Response> {
  const src = `https://api.qrserver.com/v1/create-qr-code/?size=630x630&margin=10&data=${encodeURIComponent(ZALO_URL)}`;
  const res = await fetch(src);
  const body = await res.arrayBuffer();
  return new Response(body, {
    headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" },
  });
}

export async function guidePageHtml(env: Env): Promise<Response> {
  const downloadUrlWin = (await metaGet(env, "app_download_url_win")) ?? (await metaGet(env, "app_download_url")) ?? DEFAULT_DOWNLOAD_URL_WIN;
  const downloadUrlMac = (await metaGet(env, "app_download_url_mac")) ?? DEFAULT_DOWNLOAD_URL_MAC;
  const html = `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${PAGE_TITLE}</title>
<meta name="description" content="${PAGE_DESC}">
<meta name="keywords" content="${PAGE_KEYWORDS}">
<meta name="robots" content="index, follow">
<meta name="author" content="Suno Pro">
<link rel="canonical" href="${BASE_URL}/huong-dan">
<!-- Open Graph (Facebook, Zalo, hầu hết các mạng xã hội) — ảnh thumbnail dùng PNG proxy qua
     guideOgImage() vì các nền tảng này không render SVG làm ảnh preview. -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="Suno Pro">
<meta property="og:title" content="${PAGE_TITLE}">
<meta property="og:description" content="${PAGE_DESC}">
<meta property="og:url" content="${BASE_URL}/huong-dan">
<meta property="og:image" content="${BASE_URL}/huong-dan/og-image.png">
<meta property="og:image:width" content="630">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Mã QR tham gia nhóm Zalo Suno Pro Support">
<meta property="og:locale" content="vi_VN">
<!-- Twitter/X Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${PAGE_TITLE}">
<meta name="twitter:description" content="${PAGE_DESC}">
<meta name="twitter:image" content="${BASE_URL}/huong-dan/og-image.png">
<!-- Dữ liệu có cấu trúc (JSON-LD) cho Google: mô tả Suno Pro là 1 phần mềm hỗ trợ nền tảng Suno AI
     + các bước hướng dẫn (HowTo) — tăng cơ hội hiện rich result, không ảnh hưởng gì tới giao diện. -->
<script type="application/ld+json">
${JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      name: "Suno Pro",
      applicationCategory: "MultimediaApplication",
      operatingSystem: "macOS, Windows",
      description: "Suno Pro là công cụ Desktop giúp tự động hoá upload, ghép và xuất nhạc trên nền tảng Suno AI.",
      offers: { "@type": "Offer", price: "0", priceCurrency: "VND", description: "KEY dùng thử 1 ngày" },
      url: `${BASE_URL}/huong-dan`,
    },
    {
      "@type": "HowTo",
      name: "Cách tải Suno Pro và lấy KEY dùng thử cho Suno AI",
      description: PAGE_DESC,
      step: [
        { "@type": "HowToStep", position: 1, name: "Tải ứng dụng Suno Pro", text: "Tải bản cài đặt Suno Pro cho Windows hoặc macOS qua Google Drive." },
        { "@type": "HowToStep", position: 2, name: "Tham gia nhóm Zalo để lấy mã xác nhận", text: "Quét mã QR hoặc bấm link để vào nhóm Zalo, lấy mã xác nhận được ghim trong nhóm." },
        { "@type": "HowToStep", position: 3, name: "Nhận KEY dùng thử 1 ngày", text: "Nhập tên, email và mã xác nhận để nhận KEY dùng thử Suno Pro qua email." },
        { "@type": "HowToStep", position: 4, name: "Kích hoạt trong ứng dụng", text: "Dán KEY vào ô kích hoạt trong ứng dụng Suno Pro để bắt đầu dùng với Suno AI." },
      ],
    },
  ],
})}
</script>
<style>
:root { --bg:#12151b; --bg-2:#171b22; --card:#1d222b; --line:#2e3542; --line-2:#3a4252; --text:#e9edf3; --muted:#9aa4b4;
  --primary:#1fb5b5; --primary-2:#138c8c; --on-primary:#04211f; color-scheme: dark; }
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body { background: radial-gradient(1200px 600px at 10% -10%, rgb(31 181 181 / 9%), transparent 60%), var(--bg); color: var(--text);
  font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif; padding: 28px 16px 60px; }
.wrap { max-width: 640px; margin: 0 auto; display: grid; gap: 22px; }
.hero { text-align: center; display: grid; gap: 8px; padding: 10px 0 4px; }
.hero .badge { justify-self: center; font-size: 12px; font-weight: 700; color: var(--primary); background: rgb(31 181 181 / 12%);
  border: 1px solid rgb(31 181 181 / 35%); border-radius: 999px; padding: 4px 12px; }
.hero h1 { margin: 0; font-size: 26px; letter-spacing: -.3px; }
.hero p { margin: 0; color: var(--muted); font-size: 14px; }
.step { display: grid; grid-template-columns: 36px 1fr; gap: 16px; padding: 22px; border-radius: 16px; background: rgb(29 34 43 / 92%);
  border: 1px solid var(--line); box-shadow: 0 18px 40px -28px rgb(0 0 0 / 70%); }
.step-num { width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(135deg, var(--primary), var(--primary-2));
  color: var(--on-primary); font-weight: 800; font-size: 15px; display: grid; place-items: center; }
.step h2 { margin: 0 0 6px; font-size: 17px; }
.step p.desc { margin: 0 0 14px; color: var(--muted); font-size: 13.5px; }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 44px; padding: 0 18px; border-radius: 10px; border: none;
  background: linear-gradient(135deg, var(--primary), var(--primary-2)); color: var(--on-primary); font: inherit; font-weight: 700;
  text-decoration: none; cursor: pointer; }
.btn-center { text-align: center; }
.download-row { display: flex; gap: 10px; flex-wrap: wrap; }
.download-row .btn { flex: 1 1 0; min-width: 160px; }
.btn.ghost { background: transparent; border: 1px solid var(--line-2); color: var(--text); font-weight: 600; }
.qr-block { display: grid; justify-items: center; gap: 12px; text-align: center; margin-bottom: 14px; }
.qr-block svg { width: 100%; max-width: 320px; height: auto; border-radius: 14px; border: 1px solid var(--line-2); background: #fff; padding: 8px; }
.qr-hint { color: var(--muted); font-size: 13px; max-width: 340px; }
.qr-actions { display: flex; flex-direction: column; align-items: center; gap: 10px; width: 100%; max-width: 320px; }
.qr-actions .btn { width: 100%; }
.code-note { margin-top: 12px; padding: 10px 12px; border-radius: 10px; background: rgb(31 181 181 / 8%); border: 1px solid rgb(31 181 181 / 25%);
  font-size: 13px; color: var(--text); }
.platform-note { margin-top: 10px; font-size: 12.5px; color: var(--muted); }
footer { text-align: center; color: var(--muted); font-size: 12px; padding-top: 10px; }
a { color: var(--primary); }
</style>
</head>
<body>
<div class="wrap">
  <div class="hero">
    <span class="badge">Suno Pro — Công cụ hỗ trợ Suno AI (Desktop Mac / Windows)</span>
    <h1>Bắt đầu dùng thử Suno Pro</h1>
    <p>Suno Pro giúp tự động hoá việc tải, ghép và xuất nhạc trên <b>Suno AI</b> — 3 bước: tải ứng dụng → tham gia nhóm Zalo lấy mã xác nhận → nhận KEY dùng thử 1 ngày.</p>
    <div class="btn-center"><a class="btn ghost" href="/mua-key">💳 Mua KEY</a></div>
  </div>

  <div class="step">
    <div class="step-num">1</div>
    <div>
      <h2>Tải ứng dụng Suno Pro</h2>
      <p class="desc">Bản cài đặt cho máy tính (Mac hoặc Windows) giúp tự động hoá thao tác với Suno AI — không phải ứng dụng iPhone.</p>
      <div class="download-row">
        <a class="btn" href="${downloadUrlWin}" target="_blank" rel="noopener">⬇ Tải cho Windows</a>
        <a class="btn" href="${downloadUrlMac}" target="_blank" rel="noopener">⬇ Tải cho macOS</a>
      </div>
      <p class="platform-note">Cài xong, mở ứng dụng lên — màn hình đầu tiên sẽ hỏi nhập KEY kích hoạt.</p>
    </div>
  </div>

  <div class="step">
    <div class="step-num">2</div>
    <div>
      <h2>Tham gia nhóm Zalo để lấy mã xác nhận</h2>
      <p class="desc">Mã xác nhận (ghim trong nhóm) dùng để chứng minh bạn đã tham gia cộng đồng hỗ trợ — bắt buộc khi đăng ký nhận KEY dùng thử ở bước 3.</p>
      <div class="qr-block">
        ${svgQrCode(ZALO_URL).replace("<svg ", '<svg role="img" aria-label="Mã QR nhóm Zalo Suno Pro Support" ')}
        <span class="qr-hint">Quét mã QR bằng Zalo, hoặc bấm nút bên dưới để mở trực tiếp nhóm / tải ảnh về.</span>
        <div class="qr-actions">
          <a class="btn ghost" href="${ZALO_URL}" target="_blank" rel="noopener">💬 Tham gia nhóm Zalo</a>
          <a class="btn ghost" href="${svgQrDataUrl(ZALO_URL)}" download="suno-pro-zalo-qr.svg">⬇ Tải ảnh QR</a>
        </div>
      </div>
      <div class="code-note">Vào nhóm xong, tìm <b>tin nhắn ghim</b> (pinned) để lấy mã xác nhận — dùng mã đó ở bước 3.</div>
    </div>
  </div>

  <div class="step">
    <div class="step-num">3</div>
    <div>
      <h2>Nhận KEY dùng thử 1 ngày</h2>
      <p class="desc">Nhập Tên, Email và mã xác nhận ở bước 2 — hệ thống gửi mã xác minh về email, xác minh xong là nhận KEY ngay (hiệu lực 24 giờ, 1 email chỉ nhận 1 lần).</p>
      <div class="btn-center"><a class="btn" href="${TRIAL_PATH}">🔑 Nhận KEY dùng thử →</a></div>
      <p class="platform-note" style="text-align:center">Đã dùng thử rồi, muốn dùng tiếp? <a href="/mua-key">Mua KEY chính thức</a>.</p>
    </div>
  </div>

  <div class="step">
    <div class="step-num">4</div>
    <div>
      <h2>Kích hoạt trong ứng dụng</h2>
      <p class="desc">Mở lại ứng dụng Suno Pro đã tải ở bước 1, dán KEY vừa nhận được vào ô kích hoạt — xong là dùng được ngay với tài khoản Suno AI của bạn.</p>
    </div>
  </div>

  <footer>© 2026 Suno Pro — Mọi vướng mắc, nhắn trong nhóm Zalo hỗ trợ.</footer>
</div>
</body>
</html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
