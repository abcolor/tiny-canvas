import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import { createObjectMap, docCanonical, docFromState, extractAssetIds, extractSearchText, getObjects, newId } from '@tinycanvas/shared';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { CONFIG, type AppConfig } from '../src/config';
import { PrismaService } from '../src/prisma.service';
import { RateLimiter } from '../src/common/rate-limit';
import type { MeResponse } from '@tinycanvas/shared';

type TestAgent = ReturnType<typeof request.agent>;

export interface TestApp {
  app: NestExpressApplication;
  prisma: PrismaService;
  config: AppConfig;
  http: () => TestAgent;
  reset: () => Promise<void>;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  configureApp(app);
  await app.init();
  const prisma = app.get(PrismaService);
  const config = app.get<AppConfig>(CONFIG);
  const initial = { ...config };
  return {
    app,
    prisma,
    config,
    http: () => request.agent(app.getHttpServer()),
    reset: async () => {
      Object.assign(config, initial);
      app.get(RateLimiter).reset();
      await truncateAll(prisma);
    },
    close: () => app.close(),
  };
}

export async function truncateAll(prisma: PrismaService) {
  await prisma.$executeRawUnsafe(
    'TRUNCATE users, sessions, folders, files, documents, doc_versions, share_links, assets CASCADE',
  );
}

export interface Client {
  agent: TestAgent;
  me: MeResponse;
  csrf: string;
  userId: string;
}

let counter = 0;
/** 註冊一個新帳號並保持登入（agent 會自動帶 Cookie） */
export async function signup(t: TestApp, email = `user${++counter}@example.com`, password = 'password123'): Promise<Client> {
  const agent = t.http();
  const res = await agent.post('/api/auth/signup').send({ email, password }).expect(201);
  const me = res.body as MeResponse;
  return { agent, me, csrf: me.csrfToken, userId: me.user.id };
}

export const post = (c: Client, url: string, body: object = {}) =>
  c.agent.post(url).set('X-CSRF-Token', c.csrf).send(body);
export const del = (c: Client, url: string) => c.agent.delete(url).set('X-CSRF-Token', c.csrf);

/** 建立一份含文字形狀與圖片的 Yjs 文件，回傳完整狀態 */
export function makeDocState(opts: { texts?: string[]; assetIds?: string[] } = {}): Uint8Array {
  const doc = new Y.Doc();
  const objects = getObjects(doc);
  doc.transact(() => {
    for (const text of opts.texts ?? []) {
      const id = newId();
      const m = createObjectMap({ id, type: 'shape', x: 0, y: 0, w: 100, h: 50, shapeKind: 'rectangle', text });
      objects.set(id, m);
    }
    for (const assetId of opts.assetIds ?? []) {
      const id = newId();
      const m = createObjectMap({ id, type: 'image', x: 0, y: 0, w: 10, h: 10, assetId, naturalWidth: 1, naturalHeight: 1 });
      objects.set(id, m);
    }
  });
  return Y.encodeStateAsUpdate(doc);
}

/** 模擬 sync 寫回文件：documents 資料列與 files 的 search_text / asset_ids */
export async function storeDocument(prisma: PrismaService, fileId: string, state: Uint8Array) {
  const doc = docFromState(state);
  const contentHash = createHash('sha256').update(docCanonical(doc)).digest('hex');
  await prisma.document.upsert({
    where: { fileId },
    create: { fileId, state: new Uint8Array(state), contentHash },
    update: { state: new Uint8Array(state), contentHash },
  });
  await prisma.file.update({
    where: { id: fileId },
    data: { searchText: extractSearchText(doc), assetIds: extractAssetIds(doc), updatedAt: new Date() },
  });
  return contentHash;
}
