import path from 'node:path';

/** 由環境變數讀取的設定（見 SPEC.md 第 11.5 節） */
export interface AppConfig {
  databaseUrl: string | undefined;
  publicUrl: string;
  /** PUBLIC_URL 為 https 時 Cookie 加上 Secure */
  secureCookies: boolean;
  sessionSecret: string;
  allowSignup: boolean;
  /** 0 代表永久保留自動版本 */
  versionRetentionDays: number;
  /** 上傳圖片的存放目錄（絕對路徑） */
  storageDir: string;
  logLevel: string;
  port: number;
}

export const CONFIG = Symbol('CONFIG');

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const publicUrl = (env.PUBLIC_URL ?? '').trim();
  if (!publicUrl) throw new ConfigError('缺少環境變數 PUBLIC_URL');
  const sessionSecret = env.SESSION_SECRET ?? '';
  if (sessionSecret.length < 32) throw new ConfigError('SESSION_SECRET 至少需要 32 個字元');
  const retention = Number(env.VERSION_RETENTION_DAYS ?? '0');
  if (!Number.isFinite(retention) || retention < 0) {
    throw new ConfigError('VERSION_RETENTION_DAYS 必須是 0 或正數');
  }
  return {
    databaseUrl: env.DATABASE_URL,
    publicUrl,
    secureCookies: publicUrl.toLowerCase().startsWith('https'),
    sessionSecret,
    allowSignup: (env.ALLOW_SIGNUP ?? 'false').trim().toLowerCase() === 'true',
    versionRetentionDays: retention,
    storageDir: path.resolve(env.STORAGE_LOCAL_DIR ?? '.data/files'),
    logLevel: env.LOG_LEVEL ?? 'info',
    port: Number(env.PORT ?? 3000),
  };
}
