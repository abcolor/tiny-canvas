import { Inject, Injectable } from '@nestjs/common';
import type { SearchResultDto } from '@tinycanvas/shared';
import { PrismaService } from '../prisma.service';

export const SEARCH_LIMIT = 30;
const SNIPPET_CONTEXT = 30;

/** 跳脫 LIKE 的特殊字元（搭配 ESCAPE '\'） */
export function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => '\\' + c);
}

/** 第一個（不分大小寫）命中位置前後約 30 字的片段；沒有命中時回傳 null */
export function makeSnippet(text: string, q: string): string | null {
  const idx = text.toLocaleLowerCase().indexOf(q.toLocaleLowerCase());
  if (idx < 0 || !q) return null;
  // 以字碼點切割，避免切斷 surrogate pair
  const before = Array.from(text.slice(0, idx));
  const after = Array.from(text.slice(idx + q.length));
  const head = before.slice(-SNIPPET_CONTEXT).join('');
  const tail = after.slice(0, SNIPPET_CONTEXT).join('');
  const snippet =
    (before.length > SNIPPET_CONTEXT ? '…' : '') +
    head +
    text.slice(idx, idx + q.length) +
    tail +
    (after.length > SNIPPET_CONTEXT ? '…' : '');
  return snippet.replace(/\s+/g, ' ').trim();
}

interface Row {
  id: string;
  folder_id: string | null;
  title: string;
  is_favorite: boolean;
  search_text: string;
  created_at: Date;
  updated_at: Date;
  thumbnail_at: Date | null;
  score: number;
}

/**
 * 檔名與內容搜尋（見 SPEC.md 第 5.2、8.1 節）：ILIKE 子字串比對，similarity() 排序。
 * 中文不分詞；1–2 個字的查詢抽不出 trigram 時退回全表掃描。
 */
@Injectable()
export class SearchService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async search(ownerId: string, q: string): Promise<SearchResultDto[]> {
    const pattern = '%' + escapeLike(q) + '%';
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT id, folder_id, title, is_favorite, search_text, created_at, updated_at, thumbnail_at,
             greatest(similarity(title, ${q}), similarity(search_text, ${q}))::float8 AS score
      FROM files
      WHERE owner_id = ${ownerId}::uuid
        AND deleted_at IS NULL
        AND (title ILIKE ${pattern} ESCAPE '\\' OR search_text ILIKE ${pattern} ESCAPE '\\')
      ORDER BY score DESC, updated_at DESC
      LIMIT ${SEARCH_LIMIT}`;
    return rows.map((r) => ({
      file: {
        id: r.id,
        folderId: r.folder_id,
        type: 'board',
        title: r.title,
        isFavorite: r.is_favorite,
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
        deletedAt: null,
        thumbnailAt: r.thumbnail_at ? r.thumbnail_at.toISOString() : null,
      },
      snippet: makeSnippet(r.search_text, q),
      score: Number(r.score),
    }));
  }
}
