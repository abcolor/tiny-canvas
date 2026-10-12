import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  AuthConfigResponse,
  FileDto,
  FolderDto,
  MeResponse,
  SearchResultDto,
  ShareLinkDto,
  VersionListResponse,
} from '@tinycanvas/shared';
import { api, ApiError, setCsrfToken } from './client';

export const keys = {
  me: ['me'] as const,
  authConfig: ['auth-config'] as const,
  folders: ['folders'] as const,
  files: (mode: string) => ['files', mode] as const,
  file: (id: string) => ['file', id] as const,
  trash: ['trash'] as const,
  search: (q: string) => ['search', q] as const,
  versions: (fileId: string) => ['versions', fileId] as const,
  shareLinks: (fileId: string) => ['share-links', fileId] as const,
};

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      try {
        const me = await api<MeResponse>('/api/me');
        setCsrfToken(me.csrfToken);
        return me;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          setCsrfToken(null);
          return null;
        }
        throw e;
      }
    },
    staleTime: Infinity,
    retry: (count, e) => !(e instanceof ApiError && e.status < 500) && count < 2,
  });
}

export function useAuthConfig() {
  return useQuery({ queryKey: keys.authConfig, queryFn: () => api<AuthConfigResponse>('/api/auth/config'), staleTime: Infinity });
}

export function useFolders(enabled = true) {
  return useQuery({ queryKey: keys.folders, queryFn: () => api<FolderDto[]>('/api/folders'), enabled });
}

/** mode：'recent' | 'favorite' | 'root' | 資料夾 id */
export function useFiles(mode: string, enabled = true) {
  return useQuery({
    queryKey: keys.files(mode),
    enabled,
    queryFn: () => {
      if (mode === 'recent') return api<FileDto[]>('/api/files', { query: { recent: true } });
      if (mode === 'favorite') return api<FileDto[]>('/api/files', { query: { favorite: true } });
      return api<FileDto[]>('/api/files', { query: { folderId: mode } });
    },
  });
}

export function useFile(id: string | undefined) {
  return useQuery({
    queryKey: keys.file(id ?? ''),
    enabled: Boolean(id),
    queryFn: () => api<FileDto>(`/api/files/${id}`),
    retry: (count, e) => !(e instanceof ApiError && e.status === 404) && count < 2,
  });
}

export function useTrash() {
  return useQuery({
    queryKey: keys.trash,
    queryFn: () => api<{ files: FileDto[]; folders: FolderDto[] }>('/api/files', { query: { trash: true } }),
  });
}

export function useSearch(q: string) {
  return useQuery({
    queryKey: keys.search(q),
    enabled: q.trim().length > 0,
    queryFn: ({ signal }) => api<SearchResultDto[]>('/api/search', { query: { q }, signal }),
    staleTime: 5_000,
  });
}

export function useShareLinks(fileId: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.shareLinks(fileId),
    enabled,
    queryFn: () => api<ShareLinkDto[]>(`/api/files/${fileId}/share-links`),
  });
}

export function versionsPage(fileId: string, cursor?: string | null) {
  return api<VersionListResponse>(`/api/files/${fileId}/versions`, { query: { cursor: cursor ?? undefined } });
}

/** 檔案或資料夾變動後，重新取得側邊欄與清單 */
export function invalidateTree(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: keys.folders });
  void qc.invalidateQueries({ queryKey: ['files'] });
  void qc.invalidateQueries({ queryKey: ['file'] });
  void qc.invalidateQueries({ queryKey: keys.trash });
}

export function useTreeMutation<TVars, TResult = unknown>(fn: (v: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => invalidateTree(qc) });
}

export const fileApi = {
  create: (title: string, folderId: string | null) => api<FileDto>('/api/files', { method: 'POST', body: { title, folderId } }),
  update: (id: string, patch: Partial<Pick<FileDto, 'title' | 'folderId' | 'isFavorite'>>) =>
    api<FileDto>(`/api/files/${id}`, { method: 'PATCH', body: patch }),
  trash: (id: string) => api(`/api/files/${id}`, { method: 'DELETE' }),
  restore: (id: string) => api(`/api/files/${id}/restore`, { method: 'POST' }),
  destroy: (id: string) => api(`/api/files/${id}`, { method: 'DELETE', query: { permanent: true } }),
};

export const folderApi = {
  create: (name: string, parentId: string | null) => api<FolderDto>('/api/folders', { method: 'POST', body: { name, parentId } }),
  update: (id: string, patch: Partial<Pick<FolderDto, 'name' | 'parentId' | 'isTabbed' | 'sortKey'>>) =>
    api<FolderDto>(`/api/folders/${id}`, { method: 'PATCH', body: patch }),
  trash: (id: string) => api(`/api/folders/${id}`, { method: 'DELETE' }),
  restore: (id: string) => api(`/api/folders/${id}/restore`, { method: 'POST' }),
  destroy: (id: string) => api(`/api/folders/${id}`, { method: 'DELETE', query: { permanent: true } }),
};
