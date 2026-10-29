// © 2026 Vũ Dũng (vudungit92@gmail.com) — Suno Pro, phần mềm độc quyền. Toàn văn tại COPYRIGHT.md.
//
// Khuôn mẫu email dùng chung (OTP, KEY dùng thử, mail hàng loạt từ trang admin) — để mọi mail Suno
// Pro gửi ra đều cùng 1 giao diện. Bảng + CSS inline vì email client không hỗ trợ tốt CSS hiện đại.

export function emailShell(heading: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="vi">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f2f4f7;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4f7;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border:1px solid #e3e8ee;border-radius:12px;overflow:hidden;">
        <tr>
          <td style="background:#1fb5b5;padding:22px 28px;">
            <span style="font-size:18px;font-weight:bold;color:#ffffff;letter-spacing:.2px;">Suno Pro</span>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 28px 8px;">
            <h1 style="margin:0 0 16px;font-size:19px;color:#111827;">${heading}</h1>
            ${bodyHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:20px 28px 26px;border-top:1px solid #edf0f4;margin-top:20px;">
            <p style="margin:16px 0 0;font-size:12px;color:#9aa4b4;line-height:1.6;">
              Email này được gửi tự động từ hệ thống Suno Pro. Nếu bạn không yêu cầu, vui lòng bỏ qua — không cần phản hồi.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function codeBox(code: string, letterSpacing: string, fontSize: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
    <tr><td align="center" style="background:#f0fbfb;border:1px dashed #1fb5b5;border-radius:10px;padding:18px;">
      <span style="font-family:'Courier New',Courier,monospace;font-size:${fontSize};font-weight:bold;letter-spacing:${letterSpacing};color:#138c8c;">${code}</span>
    </td></tr>
  </table>`;
}

export function paragraph(text: string): string {
  return `<p style="margin:0 0 14px;font-size:14px;color:#374151;line-height:1.6;white-space:pre-line;">${text}</p>`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

/** Nội dung soạn tay (plain text) → các đoạn `<p>` cùng kiểu dáng với mail OTP/KEY. Mỗi dòng trống
 * liền nhau tách thành 1 đoạn mới; escape HTML để admin không vô tình/cố ý chèn mã độc vào mail. */
export function bodyTextToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => paragraph(escapeHtml(para.trim())))
    .join("");
}
