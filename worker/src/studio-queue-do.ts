// © 2026 Vũ Dũng (vudungit92@gmail.com) — Suno Pro, phần mềm độc quyền. Toàn văn tại COPYRIGHT.md.
//
// Durable Object: hàng đợi công bằng + giới hạn số phiên Browser Rendering chạy ĐỒNG THỜI cho
// toàn bộ automate-reverse (mọi người dùng dùng CHUNG 1 instance DO này — xem idFromName("global")
// ở suno-proxy.ts). Lý do thêm lớp này: khi nhiều người cùng bấm Reverse 1 lúc, trước đây ai cũng
// giành mở trình duyệt ngay lập tức (dễ dồn 429 ở launchBrowserWithRetry dù tổng tải thực tế có
// khi chưa vượt hạn mức — chỉ là thiếu điều phối). Giờ job được xếp hàng FIFO, chỉ MAX_CONCURRENT
// job chạy automation thật cùng lúc; client (electron/main.js) tự poll /status mỗi vài giây để
// biết "đang xếp hàng (còn N người)" hay "đang xử lý: <bước>", hiện trực tiếp cho người dùng thay
// vì treo im lặng.
//
// LƯU Ý VẬN HÀNH: MAX_CONCURRENT là số phỏng đoán ban đầu — chỉnh lại cho khớp hạn mức Browser
// Rendering THẬT của tài khoản (xem Cloudflare dashboard → Workers & Pages → gói Workers Paid →
// Browser Rendering limits). Đặt thấp hơn hạn mức thật 1-2 đơn vị để chừa chỗ cho các lần gọi
// Browser Rendering khác (nếu có) ngoài luồng automate-reverse.
import { runStudioReverseAutomation } from "./suno-studio-automation";

const MAX_CONCURRENT = 3;
// Dọn job đã xong (done/error) khỏi storage sau ngần này — job đang queued/running KHÔNG bao giờ
// bị dọn dù quá hạn, để tránh xoá nhầm job thật đang chạy chỉ vì chạy lâu hơn dự kiến.
const JOB_TTL_MS = 20 * 60 * 1000;

type JobStatus = "queued" | "running" | "done" | "error";

interface Job {
  id: string;
  licenseId: string;
  opts: { cookieHeader: string; studioUrl: string; pitchSemitones: number };
  status: JobStatus;
  currentStep: string;
  logs: Array<{ ts: number; line: string }>;
  result?: { ok: boolean; settledByPoll: boolean };
  error?: string;
  enqueuedAt: number;
  startedAt?: number;
  finishedAt?: number;
}

interface PersistedState {
  jobs: Array<[string, Job]>;
  queue: string[];
  activeCount: number;
}

export class StudioQueueDO {
  private state: DurableObjectState;
  private env: Env;
  private jobs: Map<string, Job> = new Map();
  private queue: string[] = [];
  private activeCount = 0;
  private loaded = false;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    const stored = await this.state.storage.get<PersistedState>("state");
    if (stored) {
      this.jobs = new Map(stored.jobs);
      this.queue = stored.queue;
      this.activeCount = stored.activeCount;
    }
  }

  private async persist(): Promise<void> {
    const snapshot: PersistedState = {
      jobs: Array.from(this.jobs.entries()),
      queue: this.queue,
      activeCount: this.activeCount,
    };
    await this.state.storage.put("state", snapshot);
  }

  private queuePositionOf(jobId: string): number {
    const idx = this.queue.indexOf(jobId);
    return idx === -1 ? 0 : idx + 1;
  }

  private cleanupOldJobs(): void {
    const cutoff = Date.now() - JOB_TTL_MS;
    for (const [id, job] of this.jobs) {
      const settledAt = job.finishedAt;
      if (settledAt && settledAt < cutoff && (job.status === "done" || job.status === "error")) {
        this.jobs.delete(id);
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    await this.ensureLoaded();
    const url = new URL(request.url);

    if (url.pathname === "/enqueue" && request.method === "POST") {
      const body = (await request.json()) as { licenseId: string; opts: Job["opts"] };
      const id = crypto.randomUUID();
      const job: Job = {
        id,
        licenseId: body.licenseId,
        opts: body.opts,
        status: "queued",
        currentStep: "Đang xếp hàng…",
        logs: [],
        enqueuedAt: Date.now(),
      };
      this.jobs.set(id, job);
      this.queue.push(id);
      this.cleanupOldJobs();
      await this.persist();
      this.kickQueue();
      return new Response(JSON.stringify({ jobId: id, queuePosition: this.queuePositionOf(id) }), {
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname === "/status" && request.method === "GET") {
      const jobId = url.searchParams.get("jobId") || "";
      const job = this.jobs.get(jobId);
      if (!job) {
        return new Response(JSON.stringify({ error: "not_found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          status: job.status,
          queuePosition: job.status === "queued" ? this.queuePositionOf(job.id) : 0,
          currentStep: job.currentStep,
          logs: job.logs,
          result: job.result || null,
          error: job.error || null,
        }),
        { headers: { "content-type": "application/json" } },
      );
    }

    return new Response("not found", { status: 404 });
  }

  // Fire-and-forget có chủ đích: DO giữ instance sống nhờ chính promise nền này còn đang chạy +
  // nhờ các request /status tới đều đặn (poll mỗi vài giây từ client) làm mới thời gian idle.
  // Rủi ro CHẤP NHẬN: nếu client ngừng poll hẳn (app crash/mất mạng kéo dài) giữa lúc job đang
  // "running", DO có thể bị Cloudflare thu hồi trước khi job tự kết thúc — khi đó phiên trình
  // duyệt phụ thuộc vào OVERALL_DEADLINE_MS (7 phút) + browser.close() trong finally của chính
  // runStudioReverseAutomation để tự dọn, không có gì đảm bảo tuyệt đối ở tầng DO này.
  private kickQueue(): void {
    (async () => {
      while (this.activeCount < MAX_CONCURRENT && this.queue.length > 0) {
        const jobId = this.queue.shift();
        if (!jobId) break;
        const job = this.jobs.get(jobId);
        if (!job) continue;
        this.activeCount++;
        job.status = "running";
        job.startedAt = Date.now();
        job.currentStep = "Đang bắt đầu xử lý…";
        await this.persist();
        this.runJob(job).catch((e) => console.error("StudioQueueDO.runJob lỗi ngoài ý muốn", e));
      }
    })().catch((e) => console.error("StudioQueueDO.kickQueue lỗi", e));
  }

  private async runJob(job: Job): Promise<void> {
    try {
      const result = await runStudioReverseAutomation(this.env, job.opts, (line) => {
        job.logs.push({ ts: Date.now(), line });
        job.currentStep = line;
        // Ghi lại ngay mỗi dòng log để /status luôn đọc được tiến độ mới nhất — không await ở
        // đây (callback đồng bộ từ automation) để không làm chậm automation vì chờ storage I/O.
        this.persist().catch(() => {});
      });
      job.status = "done";
      job.result = result;
    } catch (e: unknown) {
      job.status = "error";
      job.error = e instanceof Error ? e.message : String(e);
    } finally {
      job.finishedAt = Date.now();
      this.activeCount = Math.max(0, this.activeCount - 1);
      await this.persist();
      this.kickQueue();
    }
  }
}
