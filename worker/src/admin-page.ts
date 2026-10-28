// Trang quản trị (phát hành/thu hồi KEY) — 1 file HTML tự chứa, Worker tự phục vụ tại GET /admin.
// Giao diện/CSS/JS phỏng theo đúng bộ "TOOL SUNO Extension/admin" (login.html/index.html/admin.css
// /admin.js) mà người dùng đã có sẵn — giữ nguyên bố cục, màu sắc, biểu tượng, luồng thao tác
// (tạo key theo mốc thời gian, xem/sao chép key bất cứ lúc nào, cấp key mới, gia hạn, reset thiết
// bị, thu hồi/kích hoạt lại, xóa) — chỉ lược bỏ phần không áp dụng cho Suno Pro (ghép đôi iPhone +
// máy tính riêng biệt, thiết bị iOS Ad-Hoc, dòng tiền Stripe, log/thống kê bài hát) và đổi đăng
// nhập username/password tự chế sang Firebase Auth (email/mật khẩu).
const FIREBASE_WEB_CONFIG = {
  apiKey: "AIzaSyCjd9zrgGOowMkhI_2EnzFTkEfp_HT1-Jo",
  authDomain: "loginapp-6447a.firebaseapp.com",
  projectId: "loginapp-6447a",
  appId: "1:849150971302:web:7d1508eedf55f16dee9367",
};

export function adminPageHtml(_env: Env): Response {
  const html = `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Suno Pro — Quản trị key</title>
<style>
:root {
  --bg: #12151b; --bg-2: #171b22; --card: #1d222b; --card-2: #232934; --line: #2e3542; --line-2: #3a4252;
  --text: #e9edf3; --muted: #9aa4b4; --faint: #6c7686; --primary: #1fb5b5; --primary-2: #138c8c; --on-primary: #04211f;
  --ok: #2dd4bf; --warn: #f2c46d; --bad: #ff8a8a; --radius: 14px; --radius-sm: 10px; --shadow: 0 18px 40px -24px rgb(0 0 0 / 70%);
  color-scheme: dark;
}
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body { background: radial-gradient(1200px 600px at 10% -10%, rgb(31 181 181 / 9%), transparent 60%), var(--bg); color: var(--text);
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
a { color: var(--primary); }
svg.i { width: 18px; height: 18px; flex: none; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
[hidden] { display: none !important; }
.brand { display: flex; align-items: center; gap: 10px; font-weight: 700; letter-spacing: -.2px; }
.brand .mark { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; flex: none;
  background: linear-gradient(135deg, var(--primary), var(--primary-2)); color: var(--on-primary); box-shadow: 0 8px 20px -10px rgb(31 181 181 / 70%); }
.brand .mark svg { width: 18px; height: 18px; fill: currentColor; stroke: none; }
.brand > div { white-space: nowrap; }
.brand small { display: block; font-weight: 500; color: var(--muted); font-size: 12px; letter-spacing: 0; }
.field { display: grid; gap: 6px; }
.field > span { color: var(--muted); font-size: 12px; font-weight: 600; }
.input { width: 100%; height: 42px; padding: 0 12px; border-radius: var(--radius-sm); border: 1px solid var(--line-2);
  background: var(--bg-2); color: var(--text); font: inherit; transition: border-color .15s, box-shadow .15s; }
textarea.input { height: auto; padding: 10px 12px; resize: vertical; }
.input:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px rgb(31 181 181 / 18%); }
.input-wrap { position: relative; }
.input-wrap .input { padding-left: 38px; }
.input-wrap > svg { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--faint); pointer-events: none; }
.input-wrap > button { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 38px; padding: 0 14px;
  border-radius: var(--radius-sm); border: 1px solid var(--line-2); background: var(--card-2); color: var(--text);
  font: inherit; font-weight: 600; cursor: pointer; white-space: nowrap; transition: background .15s, border-color .15s, transform .05s; }
.btn:hover { border-color: var(--faint); background: #283040; }
.btn:active { transform: translateY(1px); }
.btn:disabled { opacity: .5; cursor: default; }
.btn.primary { background: linear-gradient(135deg, var(--primary), var(--primary-2)); border-color: transparent; color: var(--on-primary); }
.btn.primary:hover { filter: brightness(1.07); }
.btn.ghost { background: transparent; border-color: transparent; color: var(--muted); }
.btn.ghost:hover { color: var(--text); background: var(--card-2); }
.btn.danger { color: var(--bad); }
.btn.danger:hover { border-color: rgb(255 138 138 / 50%); background: rgb(255 138 138 / 8%); }
.btn.sm { height: 32px; padding: 0 10px; font-size: 13px; }
.btn.icon { width: 34px; padding: 0; }
.btn.block { width: 100%; height: 44px; }
.toasts { position: fixed; right: 20px; bottom: 20px; display: grid; gap: 10px; z-index: 100; }
.toast { display: flex; align-items: center; gap: 10px; min-width: 260px; max-width: 380px; padding: 12px 14px;
  border-radius: var(--radius-sm); background: var(--card-2); border: 1px solid var(--line-2); box-shadow: var(--shadow); animation: toast-in .2s ease-out; }
.toast.ok svg { color: var(--ok); }
.toast.bad svg { color: var(--bad); }
@keyframes toast-in { from { opacity: 0; transform: translateY(8px); } }
.login-page { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
.login-card { width: min(400px, 100%); padding: 30px 28px 24px; border-radius: 20px; background: rgb(29 34 43 / 92%);
  border: 1px solid var(--line); box-shadow: var(--shadow); display: grid; gap: 16px; }
.login-card .brand { justify-content: center; flex-direction: column; text-align: center; gap: 12px; font-size: 20px; }
.login-card .brand .mark { width: 54px; height: 54px; border-radius: 16px; }
.login-card .brand .mark svg { width: 26px; height: 26px; }
.login-error { display: flex; gap: 8px; align-items: flex-start; padding: 10px 12px; border-radius: var(--radius-sm);
  background: rgb(255 138 138 / 9%); border: 1px solid rgb(255 138 138 / 35%); color: #ffc2c2; font-size: 13px; }
.login-foot { text-align: center; color: var(--faint); font-size: 12px; }
.topbar { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; gap: 14px; padding: 12px 28px;
  background: rgb(18 21 27 / 82%); backdrop-filter: blur(10px); border-bottom: 1px solid var(--line); }
.topbar .spacer { flex: 1; }
.who-pill { display: inline-flex; align-items: center; gap: 7px; max-width: 280px; height: 30px; padding: 0 12px; border-radius: 999px;
  border: 1px solid var(--line); color: var(--muted); font-size: 12px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.who-pill .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 3px rgb(45 212 191 / 18%); flex: none; }
.page { max-width: 1280px; margin: 0 auto; padding: 26px 28px 60px; }
.page-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
.page-head h1 { margin: 0; font-size: 24px; letter-spacing: -.4px; }
.page-head p { margin: 4px 0 0; color: var(--muted); }
.kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 22px; }
.kpi { padding: 14px 16px; border-radius: var(--radius); background: var(--card); border: 1px solid var(--line); display: grid; gap: 6px; }
.kpi .k-top { display: flex; align-items: center; justify-content: space-between; color: var(--muted); font-size: 12px; font-weight: 600; }
.kpi .k-icon { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; }
.kpi .k-icon svg { width: 16px; height: 16px; }
.kpi b { font-size: 26px; letter-spacing: -.5px; line-height: 1.1; }
.kpi.t-primary .k-icon { background: rgb(31 181 181 / 14%); color: var(--primary); }
.kpi.t-ok .k-icon { background: rgb(45 212 191 / 14%); color: var(--ok); }
.kpi.t-warn .k-icon { background: rgb(242 196 109 / 14%); color: var(--warn); }
.kpi.t-bad .k-icon { background: rgb(255 138 138 / 14%); color: var(--bad); }
.toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 14px; }
.tabs { display: inline-flex; padding: 3px; border-radius: 12px; background: var(--card); border: 1px solid var(--line); flex-wrap: wrap; }
.tab { height: 32px; padding: 0 12px; border: 0; border-radius: 9px; background: transparent; color: var(--muted); font: inherit; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.tab:hover { color: var(--text); }
.tab[aria-selected="true"] { background: var(--card-2); color: var(--text); box-shadow: 0 1px 0 rgb(255 255 255 / 4%) inset; }
.tab .count { min-width: 20px; height: 18px; padding: 0 6px; border-radius: 999px; background: var(--bg-2); font-size: 11px; display: inline-grid; place-items: center; }
.toolbar .search { flex: 1 1 240px; }
.toolbar select.input { width: auto; height: 38px; }
.panel { border-radius: var(--radius); background: var(--card); border: 1px solid var(--line); overflow: hidden; }
table { width: 100%; border-collapse: collapse; }
thead th { text-align: left; padding: 11px 16px; font-size: 11px; font-weight: 700; color: var(--faint); text-transform: uppercase;
  letter-spacing: .6px; background: var(--bg-2); border-bottom: 1px solid var(--line); white-space: nowrap; }
tbody td { padding: 14px 16px; border-bottom: 1px solid var(--line); vertical-align: middle; }
tbody tr { cursor: pointer; transition: background .12s; }
tbody tr:hover { background: rgb(255 255 255 / 2.5%); }
tbody tr:last-child td { border-bottom: 0; }
tbody tr.selected { background: rgb(31 181 181 / 6%); }
.who { display: flex; align-items: center; gap: 12px; min-width: 0; }
.avatar { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center; flex: none; font-weight: 700; font-size: 14px; color: #0b1416; }
.who b { display: block; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 240px; }
.sub { color: var(--muted); font-size: 12px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.pill { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px; border-radius: 999px; font-size: 12px; font-weight: 700; white-space: nowrap; }
.pill::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.pill.ok { color: var(--ok); background: rgb(45 212 191 / 11%); }
.pill.warn { color: var(--warn); background: rgb(242 196 109 / 12%); }
.pill.bad { color: var(--bad); background: rgb(255 138 138 / 11%); }
.pill.muted { color: var(--muted); background: rgb(154 164 180 / 12%); }
.term { min-width: 150px; }
.term .bar { height: 6px; border-radius: 999px; background: var(--bg-2); overflow: hidden; margin: 6px 0 4px; }
.term .bar i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--primary), var(--ok)); }
.term.warn .bar i { background: var(--warn); }
.term.bad .bar i { background: var(--bad); }
.term.off { color: var(--muted); }
.devices { display: grid; gap: 5px; font-size: 13px; }
.devices span { display: flex; align-items: center; gap: 7px; white-space: nowrap; }
.devices svg { width: 15px; height: 15px; color: var(--faint); }
.devices .off { color: var(--faint); }
.row-actions { display: flex; justify-content: flex-end; gap: 6px; }
.empty { padding: 56px 20px; text-align: center; color: var(--muted); display: grid; justify-items: center; gap: 10px; }
.empty .e-icon { width: 54px; height: 54px; border-radius: 16px; background: var(--card-2); display: grid; place-items: center; color: var(--faint); }
.empty .e-icon svg { width: 24px; height: 24px; }
.pagination { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 18px; border-top: 1px solid var(--line); flex-wrap: wrap; }
.pg-info { font-size: 12.5px; color: var(--muted); }
.pg-controls { display: flex; align-items: center; gap: 4px; }
.pg-num { min-width: 32px; padding: 0 8px; }
.pg-ellipsis { color: var(--faint); padding: 0 4px; font-size: 13px; }
.updated { margin-top: 12px; color: var(--faint); font-size: 12px; text-align: right; }
.skeleton td div { height: 14px; border-radius: 6px; background: linear-gradient(90deg, var(--card-2), #2a3140, var(--card-2)); background-size: 200% 100%; animation: shimmer 1.2s infinite; }
@keyframes shimmer { to { background-position: -200% 0; } }
.scrim { position: fixed; inset: 0; background: rgb(0 0 0 / 45%); z-index: 40; opacity: 0; pointer-events: none; transition: opacity .2s; }
.scrim.open { opacity: 1; pointer-events: auto; }
.drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(440px, 100%); z-index: 50; background: var(--bg-2);
  border-left: 1px solid var(--line); box-shadow: var(--shadow); transform: translateX(100%); transition: transform .22s ease; display: flex; flex-direction: column; }
.drawer.open { transform: none; }
.drawer header { display: flex; align-items: center; gap: 12px; padding: 18px 20px; border-bottom: 1px solid var(--line); }
.drawer header .who { flex: 1; }
.drawer .body { flex: 1; overflow-y: auto; padding: 18px 20px 28px; display: grid; gap: 18px; align-content: start; }
.section h3 { margin: 0 0 10px; font-size: 12px; text-transform: uppercase; letter-spacing: .6px; color: var(--faint); }
.facts { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.fact { padding: 12px; border-radius: var(--radius-sm); background: var(--card); border: 1px solid var(--line); min-width: 0; }
.fact span { display: block; color: var(--muted); font-size: 12px; }
.fact b { display: block; margin-top: 2px; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.danger-zone { padding: 14px; border-radius: var(--radius-sm); border: 1px solid rgb(255 138 138 / 28%); background: rgb(255 138 138 / 4%); display: grid; gap: 10px; }
.danger-zone p { margin: 0; color: var(--muted); font-size: 13px; }
.danger-zone .row { display: flex; gap: 8px; flex-wrap: wrap; }
dialog { width: min(460px, calc(100vw - 32px)); padding: 0; border: 1px solid var(--line-2); border-radius: 18px; background: var(--card); color: var(--text); box-shadow: var(--shadow); }
dialog::backdrop { background: rgb(0 0 0 / 55%); backdrop-filter: blur(2px); }
dialog .d-head { padding: 20px 22px 6px; }
dialog .d-head h2 { margin: 0; font-size: 18px; }
dialog .d-head p { margin: 4px 0 0; color: var(--muted); font-size: 13px; }
dialog form, dialog .d-body { padding: 14px 22px 22px; display: grid; gap: 14px; }
dialog .d-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
.plans { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.plans label { position: relative; }
.plans input { position: absolute; opacity: 0; }
.plans span { display: grid; gap: 1px; padding: 10px; border-radius: var(--radius-sm); border: 1px solid var(--line-2); background: var(--bg-2); text-align: center; cursor: pointer; font-weight: 650; }
.plans span small { color: var(--muted); font-weight: 500; font-size: 11px; }
.plans input:checked + span { border-color: var(--primary); background: rgb(31 181 181 / 10%); box-shadow: 0 0 0 3px rgb(31 181 181 / 14%); }
.keybox { padding: 18px; border-radius: 14px; border: 1px dashed rgb(31 181 181 / 60%); background: rgb(31 181 181 / 7%);
  text-align: center; font: 700 21px/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: 1.5px; color: var(--primary); user-select: all; word-break: break-all; }
.keybox.small { padding: 12px; font-size: 16px; }
.notice { display: flex; gap: 8px; padding: 10px 12px; border-radius: var(--radius-sm); background: rgb(242 196 109 / 9%); border: 1px solid rgb(242 196 109 / 30%); color: #f5d797; font-size: 13px; }
.notice svg { color: var(--warn); margin-top: 1px; }
@media (max-width: 1100px) { .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 760px) {
  .topbar, .page { padding-left: 16px; padding-right: 16px; }
  .who-pill { display: none; }
  thead { display: none; }
  table, tbody, tr, td { display: block; width: 100%; }
  tbody tr { padding: 12px 14px; border-bottom: 1px solid var(--line); display: grid; gap: 10px; }
  tbody td { padding: 0; border: 0; }
  .row-actions { justify-content: flex-start; }
  .facts { grid-template-columns: 1fr; }
}
</style>
</head>
<body>

<main class="login-page" id="loginView">
  <form class="login-card" id="login-form" novalidate>
    <div class="brand"><span class="mark" id="mark1"></span><div>Suno Pro Admin<small>Quản lý key và khách hàng</small></div></div>
    <div class="login-error" id="login-error" role="alert" hidden></div>
    <label class="field"><span>Email</span>
      <div class="input-wrap" data-icon="user"><input class="input" id="login-email" type="email" autocomplete="username" required autofocus></div>
    </label>
    <label class="field"><span>Mật khẩu</span>
      <div class="input-wrap" data-icon="lock"><input class="input" id="login-password" type="password" autocomplete="current-password" required></div>
    </label>
    <button class="btn primary block" id="login-submit" type="submit">Đăng nhập</button>
    <p class="login-foot">Suno Pro — quản trị key khách hàng</p>
  </form>
</main>

<div id="appView" hidden>
  <header class="topbar">
    <div class="brand"><span class="mark" id="mark2"></span><div>Suno Pro<small>Quản trị</small></div></div>
    <span class="spacer"></span>
    <span class="who-pill" id="whoami"></span>
    <button class="btn ghost sm" id="refresh" type="button"></button>
    <button class="btn sm" id="logout" type="button"></button>
  </header>

  <main class="page">
    <div class="page-head">
      <div><h1>Khách hàng & key</h1><p>Tạo key, gia hạn, thu hồi và theo dõi thiết bị của từng khách.</p></div>
      <button class="btn primary" id="new-key" type="button"></button>
    </div>

    <section class="kpis" id="kpis" aria-label="Tổng quan"></section>

    <div class="toolbar">
      <div class="tabs" role="tablist" id="tabs"></div>
      <div class="input-wrap search" data-icon="search"><input class="input" id="search" placeholder="Tìm tên khách, ghi chú, 4 ký tự cuối của key…"></div>
      <select class="input" id="sort" aria-label="Sắp xếp">
        <option value="created">Mới tạo trước</option>
        <option value="expiry">Sắp hết hạn trước</option>
        <option value="active">Hoạt động gần đây</option>
        <option value="name">Tên A → Z</option>
      </select>
    </div>

    <section class="panel">
      <table>
        <thead><tr><th>Khách</th><th>Email</th><th>Trạng thái</th><th>Thời hạn</th><th>Thiết bị</th><th></th></tr></thead>
        <tbody id="rows"></tbody>
      </table>
      <div class="empty" id="empty" hidden></div>
      <div class="pagination" id="pagination" hidden></div>
    </section>
    <p class="updated" id="updated"></p>
  </main>
</div>

<div class="scrim" id="scrim"></div>
<aside class="drawer" id="drawer" aria-label="Chi tiết khách"></aside>

<dialog id="create">
  <div class="d-head"><h2>Tạo key mới</h2><p>Sau khi tạo, key hiện trong danh sách khách để bạn sao chép bất cứ lúc nào.</p></div>
  <form method="dialog" id="create-form">
    <label class="field"><span>Tên khách</span><input class="input" name="name" required maxlength="80" placeholder="Ví dụ: Anh Nam · Zalo 09xx"></label>
    <label class="field"><span>Email khách (tùy chọn)</span><input class="input" name="email" type="email" maxlength="200"></label>
    <div class="field"><span>Thời hạn</span>
      <div class="plans">
        <label><input type="radio" name="term" value="h1"><span>1 giờ<small>dùng thử nhanh</small></span></label>
        <label><input type="radio" name="term" value="h24"><span>24 giờ<small>dùng thử</small></span></label>
        <label><input type="radio" name="term" value="d7"><span>7 ngày<small>dùng thử</small></span></label>
        <label><input type="radio" name="term" value="d30" checked><span>30 ngày<small>1 tháng</small></span></label>
        <label><input type="radio" name="term" value="d90"><span>90 ngày<small>3 tháng</small></span></label>
        <label><input type="radio" name="term" value="d365"><span>365 ngày<small>1 năm</small></span></label>
        <label><input type="radio" name="term" value="forever"><span>Vĩnh viễn<small>không hết hạn</small></span></label>
        <label><input type="radio" name="term" value="custom"><span>Tùy chỉnh<small>theo giờ</small></span></label>
      </div>
      <label class="field" id="term-custom-hours-field" hidden style="margin-top:8px"><span>Số giờ</span>
        <input class="input" name="customHours" type="number" min="1" max="8760" step="1" placeholder="Tối thiểu 1 giờ"></label>
    </div>
    <label class="field"><span>Ghi chú (chỉ bạn thấy)</span><textarea class="input" name="note" rows="2" maxlength="300" placeholder="Đã thanh toán, kênh liên hệ…"></textarea></label>
    <div class="d-actions"><button class="btn ghost" value="cancel" formnovalidate>Hủy</button><button class="btn primary" value="ok">Tạo key</button></div>
  </form>
</dialog>

<dialog id="reveal">
  <div class="d-head"><h2 id="reveal-title">Key mới</h2><p id="reveal-sub"></p></div>
  <div class="d-body">
    <div class="keybox" id="reveal-key"></div>
    <div class="notice" id="reveal-notice"></div>
    <div class="d-actions"><button class="btn" id="copy" type="button"></button><button class="btn primary" id="reveal-done" type="button">Xong</button></div>
  </div>
</dialog>

<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js"></script>
<script>
(() => {
  firebase.initializeApp(${JSON.stringify(FIREBASE_WEB_CONFIG)});
  const auth = firebase.auth();
  const $ = (s, root = document) => root.querySelector(s);
  const DAY = 86_400_000, HOUR = 3_600_000;

  // ---------- Biểu tượng (nét, kiểu Lucide) ----------
  const P = {
    key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M8 16H3v5"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    laptop: '<rect width="18" height="12" x="3" y="4" rx="2"/><path d="M2 20h20"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    alert: '<path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z"/><path d="M12 9v4M12 17h.01"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
    reset: '<path d="M3 12a9 9 0 1 0 9-9 9.8 9.8 0 0 0-6.7 2.7L3 8"/><path d="M3 3v5h5"/>',
    more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    chevronLeft: '<path d="m15 18-6-6 6-6"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  };
  const icon = (name, cls = "i") => \`<svg class="\${cls}" viewBox="0 0 24 24" aria-hidden="true">\${P[name] ?? ""}</svg>\`;
  const markSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v8.55c-.94-.54-2.1-.75-3.33-.32-1.34.48-2.37 1.67-2.61 3.07-.46 2.74 1.86 5.08 4.59 4.65 1.96-.31 3.35-2.11 3.35-4.1V7h2c1.1 0 2-.9 2-2s-.9-2-2-2h-2c-1.1 0-2 .9-2 2z"/></svg>';
  $("#mark1").innerHTML = markSvg;
  $("#mark2").innerHTML = markSvg;
  document.querySelectorAll("[data-icon]").forEach((w) => w.insertAdjacentHTML("afterbegin", icon(w.dataset.icon)));

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").toLowerCase();
  const date = (ms) => (ms ? new Date(ms).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—");
  const dateTime = (ms) => ms ? new Date(ms).toLocaleString("vi-VN", { hour12: false, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
  function ago(ms) {
    if (!ms) return "chưa có";
    const s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 60) return "vừa xong";
    if (s < 3600) return Math.floor(s / 60) + " phút trước";
    if (s < 86400) return Math.floor(s / 3600) + " giờ trước";
    return Math.floor(s / 86400) + " ngày trước";
  }
  function initials(name) {
    const words = String(name || "?").trim().split(/\\s+/).filter((w) => /\\p{L}|\\d/u.test(w));
    const pick = words.length > 1 ? [words[0], words[words.length - 1]] : words;
    return pick.map((w) => [...w][0]).join("").toUpperCase() || "?";
  }
  function hue(name) {
    let h = 0;
    for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return "hsl(" + h + " 62% 68%)";
  }
  function toast(message, tone = "ok") {
    const openDialog = document.querySelector("dialog[open]");
    const host = openDialog ?? document.body;
    let box = host.querySelector(":scope > .toasts");
    if (!box) { box = document.createElement("div"); box.className = "toasts"; host.append(box); }
    const el = document.createElement("div");
    el.className = "toast " + tone;
    el.innerHTML = icon(tone === "ok" ? "check" : "alert") + "<span>" + esc(message) + "</span>";
    box.append(el);
    setTimeout(() => el.remove(), 3800);
  }

  function apiFetch(path, options) {
    return auth.currentUser.getIdToken().then((token) => {
      options = options || {};
      options.headers = Object.assign({ Authorization: "Bearer " + token, "Content-Type": "application/json" }, options.headers || {});
      return fetch(path, options).then((res) => res.json().then((data) => {
        if (!res.ok) throw new Error(data.message || ("HTTP " + res.status));
        return data;
      }));
    });
  }

  // ---------- Đăng nhập ----------
  const loginView = $("#loginView"), appView = $("#appView");
  $("#login-submit").parentElement.addEventListener("submit", (e) => {
    e.preventDefault();
    $("#login-error").hidden = true;
    const btn = $("#login-submit");
    btn.disabled = true;
    btn.textContent = "Đang đăng nhập…";
    auth.signInWithEmailAndPassword($("#login-email").value.trim(), $("#login-password").value)
      .catch((err) => { $("#login-error").innerHTML = icon("alert") + "<span>" + esc(err.message || "Đăng nhập thất bại.") + "</span>"; $("#login-error").hidden = false; })
      .finally(() => { btn.disabled = false; btn.textContent = "Đăng nhập"; });
  });
  $("#logout").addEventListener("click", () => auth.signOut());
  auth.onAuthStateChanged((user) => {
    if (user) {
      $("#whoami").innerHTML = '<span class="dot"></span>' + esc(user.email);
      loginView.hidden = true;
      appView.hidden = false;
      load();
    } else {
      loginView.hidden = false;
      appView.hidden = true;
    }
  });

  // ---------- Trạng thái ----------
  let licenses = [], filter = "all", selectedId = null, currentPage = 1;
  const PAGE_SIZE = 10;

  function status(l) {
    if (l.status === "revoked") return { key: "revoked", tone: "bad", label: "Đã thu hồi" };
    const expired = l.expiresAt && l.expiresAt <= Date.now();
    if (expired) return { key: "expired", tone: "bad", label: "Hết hạn" };
    if (l.expiresAt && l.expiresAt - Date.now() < 7 * DAY) return { key: "expiring", tone: "warn", label: "Sắp hết hạn" };
    if (!l.deviceBound) return { key: "active", tone: "muted", label: "Chưa kích hoạt" };
    return { key: "active", tone: "ok", label: "Đang dùng" };
  }
  function term(l) {
    if (l.status === "revoked") return { cls: "off", pct: 0, text: l.expiresAt ? date(l.expiresAt) : "—", sub: "đã thu hồi" };
    if (!l.expiresAt) return { cls: "", pct: 100, text: "Không hết hạn", sub: "Vĩnh viễn" };
    const msLeft = l.expiresAt - Date.now();
    const left = Math.ceil(msLeft / DAY);
    const total = Math.max(1, Math.round((l.expiresAt - l.createdAt) / DAY));
    const pct = Math.max(0, Math.min(100, (left / total) * 100));
    const cls = left <= 0 ? "bad" : left <= 7 ? "warn" : "";
    const sub = msLeft <= 0 ? "đã quá " + (-left + 1) + " ngày" : msLeft < DAY ? "còn " + Math.max(1, Math.ceil(msLeft / HOUR)) + " giờ" : "còn " + left + " ngày";
    return { cls, pct, text: msLeft > 0 && msLeft < DAY ? dateTime(l.expiresAt) : date(l.expiresAt), sub };
  }

  function renderKpis() {
    const by = (k) => licenses.filter((l) => status(l).key === k).length;
    const cards = [
      ["t-primary", "users", "Tổng key", licenses.length],
      ["t-ok", "check", "Đang dùng", by("active")],
      ["t-warn", "clock", "Sắp hết hạn", by("expiring")],
      ["t-bad", "ban", "Hết hạn / thu hồi", by("expired") + by("revoked")],
    ];
    $("#kpis").innerHTML = cards.map(([tone, ic, label, value]) =>
      '<div class="kpi ' + tone + '"><div class="k-top">' + label + '<span class="k-icon">' + icon(ic) + '</span></div><b>' + value + '</b></div>').join("");
  }
  function renderTabs() {
    const count = (k) => (k === "all" ? licenses.length : licenses.filter((l) => status(l).key === k).length);
    const tabs = [["all", "Tất cả"], ["active", "Đang dùng"], ["expiring", "Sắp hết hạn"], ["expired", "Hết hạn"], ["revoked", "Thu hồi"]];
    $("#tabs").innerHTML = tabs.map(([k, label]) =>
      '<button class="tab" role="tab" data-tab="' + k + '" aria-selected="' + (filter === k) + '">' + label + '<span class="count">' + count(k) + '</span></button>').join("");
  }
  function visible() {
    const q = fold($("#search").value.trim());
    const list = licenses.filter((l) => {
      if (filter !== "all" && status(l).key !== filter) return false;
      return !q || fold(l.name + " " + (l.note ?? "") + " " + l.keyHint + " " + (l.key ?? "") + " " + (l.deviceName ?? "")).includes(q);
    });
    const sorters = {
      created: (a, b) => b.createdAt - a.createdAt,
      expiry: (a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity),
      active: (a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0),
      name: (a, b) => a.name.localeCompare(b.name, "vi"),
    };
    return list.slice().sort(sorters[$("#sort").value]);
  }
  async function copyKey(key, button) {
    await navigator.clipboard.writeText(key);
    toast("Đã sao chép " + key);
    if (button) { const old = button.innerHTML; button.innerHTML = icon("check"); setTimeout(() => (button.innerHTML = old), 1200); }
  }
  async function rotate(l) {
    if (!confirm('Cấp key mới cho "' + l.name + '"?\\nKey cũ ngừng dùng để kích hoạt. Máy đang dùng KHÔNG bị đăng xuất.')) return;
    try {
      const res = await apiFetch("/admin/licenses/" + l.id + "/rotate-key", { method: "POST" });
      showKey('Key mới cho "' + res.license.name + '"', res.license, res.key);
      await load({ quiet: true });
    } catch (error) { toast(error.message, "bad"); }
  }
  function showKey(title, license, key) {
    $("#reveal-title").textContent = title;
    $("#reveal-sub").textContent = license.expiresAt ? "Hết hạn " + date(license.expiresAt) : "Không hết hạn";
    $("#reveal-key").textContent = key;
    $("#reveal-notice").innerHTML = icon("alert") + "<span>Gửi key này cho khách. Bạn có thể <b>xem lại và sao chép</b> bất cứ lúc nào trong danh sách khách.</span>";
    $("#copy").innerHTML = icon("copy") + "Sao chép key";
    $("#reveal").showModal();
  }

  function row(l) {
    const s = status(l), t = term(l);
    const device = l.deviceBound
      ? '<span>' + icon("laptop") + esc(l.deviceName || "Máy tính") + '</span>'
      : '<span class="off">' + icon("laptop") + 'Chưa kích hoạt</span>';
    return '<tr data-id="' + esc(l.id) + '" class="' + (selectedId === l.id ? "selected" : "") + '">' +
      '<td><div class="who"><span class="avatar" style="background:' + hue(l.name) + '">' + esc(initials(l.name)) + '</span>' +
        '<div style="min-width:0"><b>' + esc(l.name) + '</b>' + (l.note ? '<span class="sub" style="display:block;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(l.note) + '</span>' : '') + '</div></div></td>' +
      '<td>' + (l.email ? '<span class="mono" style="font-size:12.5px">' + esc(l.email) + '</span>' : '<span class="sub">—</span>') + '</td>' +
      '<td><span class="pill ' + s.tone + '">' + s.label + '</span></td>' +
      '<td><div class="term ' + t.cls + '">' + t.text + '<div class="bar"><i style="width:' + t.pct + '%"></i></div><span class="sub">' + t.sub + '</span></div></td>' +
      '<td><div class="devices">' + device + '</div></td>' +
      '<td><div class="row-actions"><button class="btn ghost icon sm" data-act="open" aria-label="Chi tiết">' + icon("more") + '</button></div></td></tr>';
  }
  function render() {
    renderKpis(); renderTabs();
    const list = visible();
    const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;
    const pageItems = list.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
    $("#rows").innerHTML = pageItems.map(row).join("");
    renderPagination(list.length, totalPages);
    const empty = $("#empty");
    empty.hidden = list.length > 0;
    if (!list.length) {
      const none = licenses.length === 0;
      empty.innerHTML = '<span class="e-icon">' + icon(none ? "key" : "search") + '</span><b>' + (none ? "Chưa có key nào" : "Không có khách phù hợp") + '</b>' +
        '<span>' + (none ? 'Bấm "Tạo key" để bán key đầu tiên.' : "Thử đổi bộ lọc hoặc từ khóa tìm kiếm.") + '</span>' +
        (none ? '<button class="btn primary" data-act="new">' + icon("plus") + 'Tạo key</button>' : '');
    }
    if (selectedId) renderDrawer();
  }
  function renderPagination(total, totalPages) {
    const el = $("#pagination");
    if (total === 0) { el.hidden = true; return; }
    el.hidden = false;
    const from = (currentPage - 1) * PAGE_SIZE + 1, to = Math.min(currentPage * PAGE_SIZE, total);
    const span = 2;
    let start = Math.max(1, currentPage - span), end = Math.min(totalPages, start + span * 2);
    start = Math.max(1, end - span * 2);
    const pages = [];
    for (let p = start; p <= end; p += 1) pages.push(p);
    el.innerHTML = '<span class="pg-info">' + from + '–' + to + ' / ' + total + ' khách</span><div class="pg-controls">' +
      '<button class="btn ghost icon sm" data-page="prev" ' + (currentPage <= 1 ? "disabled" : "") + ' aria-label="Trang trước">' + icon("chevronLeft") + '</button>' +
      (start > 1 ? '<button class="btn ghost sm pg-num" data-page="1">1</button>' + (start > 2 ? '<span class="pg-ellipsis">…</span>' : '') : '') +
      pages.map((p) => '<button class="btn ' + (p === currentPage ? "primary" : "ghost") + ' sm pg-num" data-page="' + p + '">' + p + '</button>').join("") +
      (end < totalPages ? (end < totalPages - 1 ? '<span class="pg-ellipsis">…</span>' : '') + '<button class="btn ghost sm pg-num" data-page="' + totalPages + '">' + totalPages + '</button>' : '') +
      '<button class="btn ghost icon sm" data-page="next" ' + (currentPage >= totalPages ? "disabled" : "") + ' aria-label="Trang sau">' + icon("chevronRight") + '</button></div>';
  }
  function skeleton() { $("#rows").innerHTML = Array.from({ length: 4 }, () => '<tr class="skeleton">' + "<td><div></div></td>".repeat(6) + "</tr>").join(""); }

  async function load(opts) {
    opts = opts || {};
    if (!opts.quiet && !licenses.length) skeleton();
    try {
      licenses = (await apiFetch("/admin/licenses")).licenses;
      $("#updated").textContent = "Cập nhật lúc " + new Date().toLocaleTimeString("vi-VN", { hour12: false }) + " · tự làm mới mỗi 30 giây";
      render();
    } catch (error) { if (!opts.quiet) toast(error.message, "bad"); }
  }

  // ---------- Ngăn chi tiết ----------
  const find = (id) => licenses.find((l) => l.id === id);
  function openDrawer(id) { selectedId = id; renderDrawer(); $("#drawer").classList.add("open"); $("#scrim").classList.add("open"); render(); }
  function closeDrawer() { selectedId = null; $("#drawer").classList.remove("open"); $("#scrim").classList.remove("open"); render(); }
  function renderDrawer() {
    const l = find(selectedId);
    if (!l) return closeDrawer();
    const s = status(l), t = term(l);
    $("#drawer").innerHTML =
      '<header><div class="who"><span class="avatar" style="background:' + hue(l.name) + '">' + esc(initials(l.name)) + '</span>' +
        '<div style="min-width:0"><b>' + esc(l.name) + '</b><span class="sub mono">SP-…' + esc(l.keyHint) + '</span>' + (l.email ? '<span class="sub">' + esc(l.email) + '</span>' : '') + '</div></div>' +
        '<span class="pill ' + s.tone + '">' + s.label + '</span><button class="btn ghost icon sm" data-act="close" aria-label="Đóng">' + icon("x") + '</button></header>' +
      '<div class="body">' +
        '<div class="section"><h3>Key</h3>' +
          (l.key ? '<div class="keybox small">' + esc(l.key) + '</div>' : '<div class="notice">' + icon("alert") + '<span>Key này không xem lại được (chỉ biết 4 ký tự cuối: <b class="mono">' + esc(l.keyHint) + '</b>). Bấm "Cấp key mới" để có key xem lại được.</span></div>') +
          '<div class="chips" style="margin-top:10px">' + (l.key ? '<button class="btn sm" data-act="copy" data-key="' + esc(l.key) + '">' + icon("copy") + 'Sao chép key</button>' : '') +
          '<button class="btn sm" data-act="rotate">' + icon("refresh") + 'Cấp key mới</button></div></div>' +
        '<div class="section"><h3>Thời hạn</h3><div class="term ' + t.cls + '" style="padding:12px;border-radius:10px;background:var(--card);border:1px solid var(--line)">' +
          '<b>' + t.text + '</b> <span class="sub">· ' + t.sub + '</span><div class="bar"><i style="width:' + t.pct + '%"></i></div>' +
          '<span class="sub">Tạo ' + dateTime(l.createdAt) + (l.activatedAt ? ' · kích hoạt ' + dateTime(l.activatedAt) : '') + '</span></div>' +
          '<div class="chips" style="margin-top:10px">' + [7, 30, 90, 365].map((d) => '<button class="btn sm" data-extend="' + d + '">' + icon("plus") + d + ' ngày</button>').join("") + '</div></div>' +
        '<div class="section"><h3>Thiết bị</h3><div class="facts"><div class="fact"><span>Máy tính</span><b>' + (l.deviceBound ? esc(l.deviceName || "Máy tính") : "Chưa kích hoạt") + '</b>' +
          '<span>' + (l.lastSeenAt ? 'hoạt động ' + ago(l.lastSeenAt) : '—') + '</span></div></div></div>' +
        '<div class="section"><h3>Session Suno (client/session)</h3>' +
          (l.lastSessionAt
            ? '<div class="facts"><div class="fact"><span>Cập nhật lần cuối</span><b>' + dateTime(l.lastSessionAt) + '</b><span>' + ago(l.lastSessionAt) + '</span></div></div>' +
              (l.lastSessionCookie ? '<div class="keybox small mono" style="word-break:break-all;margin-top:8px;white-space:normal">' + esc(l.lastSessionCookie.length > 220 ? l.lastSessionCookie.slice(0, 220) + "…" : l.lastSessionCookie) + '</div>' : '') +
              (!l.lastSessionCookie && l.lastSessionToken ? '<div class="keybox small mono" style="word-break:break-all;margin-top:8px;white-space:normal">' + esc(l.lastSessionToken.slice(0, 220)) + '…</div>' : '') +
              '<div class="chips" style="margin-top:10px"><button class="btn sm" data-act="copy-session">' + icon("copy") + 'Sao chép session đầy đủ</button></div>'
            : '<p class="sub">Chưa ghi nhận session nào từ app.</p>') +
          '</div>' +
        '<form class="section" id="edit-form"><h3>Thông tin</h3><div style="display:grid;gap:10px">' +
          '<label class="field"><span>Tên khách</span><input class="input" name="name" maxlength="80" value="' + esc(l.name) + '"></label>' +
          '<label class="field"><span>Ghi chú</span><textarea class="input" name="note" rows="2" maxlength="300">' + esc(l.note ?? '') + '</textarea></label>' +
          '<div><button class="btn sm" type="submit">' + icon("check") + 'Lưu thông tin</button></div></div></form>' +
        '<div class="section"><h3>Thiết bị & quyền dùng</h3><div class="danger-zone">' +
          '<p><b>Reset thiết bị</b> — cho phép khách kích hoạt key trên máy khác; thiết bị hiện tại bị đăng xuất.</p><div class="row"><button class="btn sm" data-act="reset">' + icon("reset") + 'Reset thiết bị</button></div>' +
          '<p><b>' + (l.status === "revoked" ? "Kích hoạt lại" : "Thu hồi key") + '</b> — ' + (l.status === "revoked" ? "khách dùng lại được (cần nhập lại key)." : "khóa key ngay lập tức, đăng xuất thiết bị.") + '</p>' +
          '<div class="row">' + (l.status === "revoked" ? '<button class="btn sm" data-act="activate">' + icon("check") + 'Kích hoạt lại</button>' : '<button class="btn sm danger" data-act="revoke">' + icon("ban") + 'Thu hồi key</button>') + '</div>' +
          '<p><b>Xóa tài khoản</b> — xóa hẳn khách này khỏi danh sách, key ngừng hoạt động vĩnh viễn (không thể hoàn tác).</p><div class="row"><button class="btn sm danger" data-act="delete">' + icon("trash") + 'Xóa tài khoản</button></div>' +
        '</div></div></div>';
  }
  async function update(id, body, done) {
    try { await apiFetch("/admin/licenses/" + id, { method: "PATCH", body: JSON.stringify(body) }); toast(done); await load({ quiet: true }); }
    catch (error) { toast(error.message, "bad"); }
  }

  // ---------- Khung trang ----------
  $("#refresh").innerHTML = icon("refresh") + '<span class="lbl">Làm mới</span>';
  $("#logout").innerHTML = icon("logout") + "Đăng xuất";
  $("#new-key").innerHTML = icon("plus") + "Tạo key";
  $("#copy").innerHTML = icon("copy") + "Sao chép key";

  $("#tabs").addEventListener("click", (e) => { const tab = e.target.closest("[data-tab]"); if (!tab) return; filter = tab.dataset.tab; currentPage = 1; render(); });
  $("#search").addEventListener("input", () => { currentPage = 1; render(); });
  $("#sort").addEventListener("change", () => { currentPage = 1; render(); });
  $("#pagination").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-page]");
    if (!btn || btn.disabled) return;
    const p = btn.dataset.page;
    currentPage = p === "prev" ? currentPage - 1 : p === "next" ? currentPage + 1 : Number(p);
    render();
    $("#rows").scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  $("#refresh").addEventListener("click", () => load());
  $("#scrim").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => e.key === "Escape" && selectedId && closeDrawer());

  const TERM_HOURS = { h1: 1, h24: 24 };
  const TERM_DAYS = { d7: 7, d30: 30, d90: 90, d365: 365 };
  function termDuration(f) {
    const t = f.get("term");
    if (t in TERM_HOURS) return { hours: TERM_HOURS[t], days: null };
    if (t in TERM_DAYS) return { hours: null, days: TERM_DAYS[t] };
    if (t === "custom") {
      const hours = Number(f.get("customHours"));
      if (!Number.isInteger(hours) || hours < 1) throw new Error("Nhập số giờ hợp lệ (tối thiểu 1 giờ).");
      return { hours, days: null };
    }
    return { hours: null, days: null };
  }
  $("#create-form").addEventListener("change", (e) => { if (e.target.name !== "term") return; $("#term-custom-hours-field").hidden = e.target.value !== "custom"; });
  const openCreate = () => { $("#create-form").reset(); $("#term-custom-hours-field").hidden = true; $("#create").showModal(); };
  $("#new-key").addEventListener("click", openCreate);
  $("#empty").addEventListener("click", (e) => e.target.closest('[data-act="new"]') && openCreate());

  $("#rows").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    const l = find(tr.dataset.id);
    const copy = e.target.closest('[data-act="copy"]');
    if (copy) return copyKey(copy.dataset.key, copy);
    if (e.target.closest('[data-act="rotate"]')) return rotate(l);
    openDrawer(l.id);
  });
  $("#drawer").addEventListener("click", async (e) => {
    const l = find(selectedId);
    if (!l) return;
    const ext = e.target.closest("[data-extend]");
    if (ext) return update(l.id, { extendDays: Number(ext.dataset.extend) }, 'Đã gia hạn "' + l.name + '" thêm ' + ext.dataset.extend + ' ngày');
    const actEl = e.target.closest("[data-act]");
    const act = actEl && actEl.dataset.act;
    if (act === "close") return closeDrawer();
    if (act === "copy") return copyKey(actEl.dataset.key, null);
    if (act === "copy-session") {
      const value = l.lastSessionCookie || l.lastSessionToken || "";
      if (!value) return toast("Chưa có session để sao chép", "bad");
      await navigator.clipboard.writeText(value);
      toast("Đã sao chép session Suno");
      return;
    }
    if (act === "rotate") return rotate(l);
    if (act === "revoke" && confirm('Thu hồi key của "' + l.name + '"? Thiết bị của khách bị đăng xuất ngay.')) return update(l.id, { status: "revoked" }, 'Đã thu hồi key của "' + l.name + '"');
    if (act === "activate") return update(l.id, { status: "active" }, 'Đã kích hoạt lại key của "' + l.name + '"');
    if (act === "delete" && confirm('Xóa hẳn tài khoản của "' + l.name + '"?\\nKhông thể hoàn tác.')) {
      try { await apiFetch("/admin/licenses/" + l.id, { method: "DELETE" }); toast('Đã xóa tài khoản của "' + l.name + '"'); closeDrawer(); await load({ quiet: true }); }
      catch (error) { toast(error.message, "bad"); }
    }
    if (act === "reset" && confirm('Reset thiết bị của "' + l.name + '"? Khách phải nhập lại key.')) {
      try { await apiFetch("/admin/licenses/" + l.id + "/reset-device", { method: "POST" }); toast('Đã reset thiết bị của "' + l.name + '"'); await load({ quiet: true }); }
      catch (error) { toast(error.message, "bad"); }
    }
  });
  $("#drawer").addEventListener("submit", (e) => {
    if (e.target.id !== "edit-form") return;
    e.preventDefault();
    const f = new FormData(e.target);
    update(selectedId, { name: f.get("name"), note: f.get("note") }, "Đã lưu thông tin khách");
  });

  $("#create").addEventListener("close", async () => {
    if ($("#create").returnValue !== "ok") return;
    const f = new FormData($("#create-form"));
    try {
      const { hours, days } = termDuration(f);
      const res = await apiFetch("/admin/licenses", { method: "POST", body: JSON.stringify({ name: f.get("name"), email: f.get("email") || undefined, hours: hours ?? undefined, days: days ?? undefined, note: f.get("note") }) });
      showKey('Key cho "' + res.license.name + '"', res.license, res.key);
      await load({ quiet: true });
    } catch (error) { toast(error.message, "bad"); }
  });
  $("#copy").addEventListener("click", async () => {
    await navigator.clipboard.writeText($("#reveal-key").textContent);
    $("#copy").innerHTML = icon("check") + "Đã sao chép";
    setTimeout(() => ($("#copy").innerHTML = icon("copy") + "Sao chép key"), 1600);
  });
  $("#reveal-done").addEventListener("click", () => $("#reveal").close());

  setInterval(() => document.visibilityState === "visible" && auth.currentUser && load({ quiet: true }), 30_000);
})();
</script>
</body>
</html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
