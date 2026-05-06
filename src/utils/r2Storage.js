import { getFunctions, httpsCallable } from 'firebase/functions';

const getUploadUrl = () => httpsCallable(getFunctions(undefined, 'europe-west1'), 'getR2UploadUrl');

/**
 * Upload a file to R2 via presigned URL.
 * @param {File|Blob} file
 * @param {'avatar'|'banner'|'post'|'short'|'clip'|'article'|'squad'|'tournament'} kind
 * @returns {Promise<{ url: string, key: string }>}
 */
export async function uploadToR2(file, kind) {
  const contentType = file.type || 'application/octet-stream';
  const sizeBytes = file.size;

  const { data } = await getUploadUrl()({ contentType, sizeBytes, kind });
  const { uploadUrl, publicUrl, key } = data;

  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: file,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`R2 upload failed (${res.status}): ${text}`);
  }

  return { url: publicUrl, key };
}
