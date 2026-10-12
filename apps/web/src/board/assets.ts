import { IMAGE_MIME_TYPES, MAX_UPLOAD_BYTES, type AssetDto } from '@tinycanvas/shared';
import { strings } from '@tinycanvas/ui';
import { api, ApiError } from '../api/client';

export class UploadError extends Error {}

/** 上傳圖片（見 SPEC.md 第 4.4 節）；失敗時丟出含有中文訊息的 UploadError */
export async function uploadImage(file: Blob): Promise<{ assetId: string; width: number; height: number }> {
  if (file.size > MAX_UPLOAD_BYTES) throw new UploadError(strings.errors.uploadTooLarge);
  if (!(IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) throw new UploadError(strings.errors.uploadUnsupported);
  const form = new FormData();
  form.append('file', file, (file as File).name ?? 'image');
  try {
    const a = await api<AssetDto>('/api/assets', { method: 'POST', body: form });
    let { width, height } = a;
    if (!width || !height) {
      const img = await decodeBlob(file);
      width = (img as { width: number }).width;
      height = (img as { height: number }).height;
    }
    return { assetId: a.id, width: width || 200, height: height || 150 };
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.code === 'too_large' || e.status === 413) throw new UploadError(strings.errors.uploadTooLarge);
      if (e.code === 'unsupported_type' || e.status === 415) throw new UploadError(strings.errors.uploadUnsupported);
    }
    throw new UploadError(strings.errors.uploadFailed);
  }
}

async function decodeBlob(blob: Blob): Promise<CanvasImageSource> {
  if (blob.type !== 'image/svg+xml' && typeof createImageBitmap === 'function') {
    return createImageBitmap(blob);
  }
  // SVG 無法直接用 createImageBitmap，改用 <img> 解碼
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // 已解碼的 <img> 仍可繪製；延後釋放避免 Safari 清掉內容
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

/** 建立畫布用的圖片載入器。分享頁面以檢視 token（Authorization: Bearer）讀取 */
export function createImageLoader(viewToken?: string) {
  const cache = new Map<string, Promise<CanvasImageSource>>();
  return (assetId: string): Promise<CanvasImageSource> => {
    let p = cache.get(assetId);
    if (!p) {
      p = (async () => {
        const res = await fetch(`/api/assets/${assetId}`, {
          credentials: 'same-origin',
          headers: viewToken ? { authorization: `Bearer ${viewToken}` } : undefined,
        });
        if (!res.ok) throw new Error(`asset ${res.status}`);
        return decodeBlob(await res.blob());
      })();
      p.catch(() => cache.delete(assetId));
      cache.set(assetId, p);
    }
    return p;
  };
}
