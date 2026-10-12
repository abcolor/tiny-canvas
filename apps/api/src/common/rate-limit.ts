import { Injectable } from '@nestjs/common';
import { LOGIN_RATE_LIMIT_PER_MINUTE } from '@tinycanvas/shared';
import { ApiException } from './errors';

const WINDOW_MS = 60_000;

/** 以 IP 計數的固定視窗限制器，存在記憶體中（見 SPEC.md 第 9 節） */
@Injectable()
export class RateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  /** 預設每分鐘 10 次；僅供 E2E 測試以 LOGIN_RATE_LIMIT 環境變數調高（正式環境不要設定） */
  limit = Number(process.env.LOGIN_RATE_LIMIT) > 0 ? Number(process.env.LOGIN_RATE_LIMIT) : LOGIN_RATE_LIMIT_PER_MINUTE;

  /** 記錄一次嘗試；超過上限時丟出 429 rate_limited */
  hit(key: string, now = Date.now()): void {
    if (this.buckets.size > 10_000) this.prune(now);
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + WINDOW_MS };
      this.buckets.set(key, b);
    }
    b.count += 1;
    if (b.count > this.limit) throw new ApiException(429, 'rate_limited');
  }

  reset(): void {
    this.buckets.clear();
  }

  private prune(now: number) {
    for (const [k, b] of this.buckets) if (b.resetAt <= now) this.buckets.delete(k);
  }
}
