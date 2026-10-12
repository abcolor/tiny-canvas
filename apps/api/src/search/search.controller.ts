import { Controller, Get, Inject, Query } from '@nestjs/common';
import type { User } from '@tinycanvas/db';
import { searchQuerySchema, type SearchResultDto } from '@tinycanvas/shared';
import { CurrentUser } from '../auth/current-user';
import { parseBody } from '../common/zod';
import { SearchService } from './search.service';

@Controller('api/search')
export class SearchController {
  constructor(@Inject(SearchService) private readonly search: SearchService) {}

  @Get()
  async query(@CurrentUser() user: User, @Query() query: unknown): Promise<SearchResultDto[]> {
    const { q } = parseBody(searchQuerySchema, query);
    return this.search.search(user.id, q);
  }
}
