// Khai báo kiểu cho import file .wasm trực tiếp — Wrangler (Worker dạng ES Module) tự biên dịch
// file .wasm thành WebAssembly.Module lúc deploy, không cần cấu hình thêm trong wrangler.jsonc.
declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}
