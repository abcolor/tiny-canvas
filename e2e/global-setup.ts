import { execSync } from 'node:child_process';

// 每次執行前清空 E2E 資料庫
export default function globalSetup() {
  execSync(
    `docker compose -f docker-compose.dev.yml exec -T postgres psql -U tinycanvas -d tinycanvas_e2e -c "TRUNCATE users, sessions, folders, files, documents, doc_versions, share_links, assets CASCADE;"`,
    { stdio: 'inherit' },
  );
}
