import { pino } from 'pino';
import { createPrisma } from '@tinycanvas/db';
import { createSyncServer } from './server';

const logger = pino({ name: 'sync' });

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    logger.fatal({ name }, 'missing environment variable');
    process.exit(1);
  }
  return v;
}

const prisma = createPrisma(requireEnv('DATABASE_URL'));
const server = createSyncServer({
  prisma,
  sessionSecret: requireEnv('SESSION_SECRET'),
  publicUrl: requireEnv('PUBLIC_URL'),
  port: Number(process.env.PORT ?? 4000),
  logger,
});

process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down; flushing pending stores');
  // 最多等 10 秒，避免卡住容器停止
  const timer = setTimeout(() => {
    logger.error('shutdown timed out');
    process.exit(1);
  }, 10_000);
  timer.unref();
  try {
    await server.destroy();
    await prisma.$disconnect();
  } catch (err) {
    logger.error({ err }, 'error during shutdown');
  }
  process.exit(0);
}
for (const sig of ['SIGTERM', 'SIGINT', 'SIGQUIT'] as const) process.on(sig, () => void shutdown(sig));

server
  .listen()
  .then((port) => logger.info({ port }, 'sync listening'))
  .catch((err) => {
    logger.fatal({ err }, 'failed to start');
    process.exit(1);
  });
