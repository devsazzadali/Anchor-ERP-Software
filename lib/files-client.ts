/**
 * Client-side upload helper for the app's file storage
 *. Replaces the legacy storage client's upload call
 * + getPublicUrl(...): uploads go to /api/files (session cookie is
 * sent automatically) and the returned URL is the canonical file
 * URL to store in the database.
 */
export async function uploadFile(
  bucket: string,
  file: File,
  path?: string
): Promise<{ url: string; path: string }> {
  const form = new FormData()
  form.append('bucket', bucket)
  form.append('file', file)
  if (path) form.append('path', path)
  const res = await fetch('/api/files/upload', { method: 'POST', body: form })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || 'Upload failed')
  }
  const data = await res.json()
  return { url: data.url, path: data.path }
}
