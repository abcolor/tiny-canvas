import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import 'reflect-metadata';
import { loadTestEnv } from './env';

const env = loadTestEnv();
Object.assign(process.env, env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  ALLOW_SIGNUP: 'true',
  VERSION_RETENTION_DAYS: '0',
  STORAGE_LOCAL_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'tc-api-test-')),
});
