// © 2026 Vũ Dũng (vudungit92@gmail.com) — Suno Pro, phần mềm độc quyền. Toàn văn tại COPYRIGHT.md.
//
// Sinh QR code dạng SVG ngay trên server từ 1 link (vd. link nhóm Zalo) — không cần chụp màn hình
// rồi nhúng ảnh JPG (nặng, không rõ nét khi phóng to) và không gọi dịch vụ ngoài nào. Thư viện
// "qrcode-generator" chỉ tính toán ma trận ô vuông bằng JS thuần (không đụng canvas/DOM) nên chạy
// được trong Cloudflare Workers.

import qrcode from "qrcode-generator";

/** SVG co giãn (không width/height cố định, chỉ viewBox) để CSS tự định cỡ hiển thị. */
export function svgQrCode(data: string): string {
  const qr = qrcode(0, "M");
  qr.addData(data);
  qr.make();
  return qr.createSvgTag({ cellSize: 8, margin: 4, scalable: true });
}

/** Cùng 1 mã QR ở trên nhưng đóng gói thành data URL — dùng cho nút tải ảnh (download=""). */
export function svgQrDataUrl(data: string): string {
  const qr = qrcode(0, "M");
  qr.addData(data);
  qr.make();
  const svg = qr.createSvgTag({ cellSize: 8, margin: 4 });
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}
