export const PRIVATE_BUCKETS = ['avatars', 'chat-media', 'flow-media'] as const;
export function isPrivateBucket(bucket: string): boolean {
  return (PRIVATE_BUCKETS as readonly string[]).includes(bucket);
}
export function validObjectPath(path: string): boolean {
  return !!path && !path.includes('\\') && !/[\u0000-\u001f]/.test(path) &&
    path.split('/').every(part => !!part && part !== '.' && part !== '..');
}
/** Durable reference, not a bearer credential or an expiring/public URL. */
export function privateObjectUrl(bucket: string, path: string): string {
  if (!isPrivateBucket(bucket) || !validObjectPath(path)) throw new Error('Invalid private object');
  return `/api/storage/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
}
export function parsePrivateObjectUrl(input: string): {bucket: string; path: string} | null {
  let url: URL;
  try { url = new URL(input, 'https://private-reference.invalid'); } catch { return null; }
  let suffix: string;
  if (url.pathname.startsWith('/api/storage/')) suffix = url.pathname.slice('/api/storage/'.length);
  else {
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!base || url.origin !== new URL(base).origin) return null;
    const match = url.pathname.match(/^\/storage\/v1\/object\/(?:public|sign|authenticated)\/(.+)$/);
    if (!match) return null;
    suffix = match[1];
  }
  const [bucket, ...parts] = suffix.split('/');
  let path: string;
  try { path = parts.map(decodeURIComponent).join('/'); } catch { return null; }
  if (!isPrivateBucket(bucket) || !validObjectPath(path)) throw new Error('Invalid private object');
  return {bucket, path};
}
