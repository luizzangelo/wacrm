import {getCurrentAccount, toErrorResponse} from '@/lib/auth/account';
import {isPrivateBucket, validObjectPath} from '@/lib/storage/private-reference';
type Context = {params: Promise<{bucket: string; path: string[]}>};
async function resolve(context: Context) {
  const ctx = await getCurrentAccount();
  const {bucket, path: parts} = await context.params;
  const path = parts.join('/');
  if (!isPrivateBucket(bucket) || !validObjectPath(path)) return null;
  return {ctx, bucket, path}; // Caller JWT, never service_role.
}
export async function GET(_request: Request, context: Context) {
  try {
    const resolved = await resolve(context);
    if (!resolved) return new Response(null, {status:404});
    const {ctx,bucket,path} = resolved;
    const {data,error} = await ctx.supabase.storage.from(bucket).download(path);
    if (error || !data) return new Response(null, {status:404});
    const inline = /^(image\/(png|jpeg|webp|gif)|audio\/|video\/)/.test(data.type);
    return new Response(data, {headers:{
      'Content-Type': data.type || 'application/octet-stream',
      'Cache-Control': 'private, no-store',
      'Content-Disposition': inline ? 'inline' : 'attachment',
      'X-Content-Type-Options':'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    }});
  } catch(error) { return toErrorResponse(error); }
}
export async function POST(_request: Request, context: Context) {
  try {
    const resolved = await resolve(context);
    if (!resolved) return new Response(null, {status:404});
    const {ctx,bucket,path} = resolved;
    const {data,error} = await ctx.supabase.storage.from(bucket).createSignedUrl(path,60);
    if (error || !data?.signedUrl) return new Response(null, {status:404});
    return Response.json({signedUrl:data.signedUrl}, {headers:{'Cache-Control':'private, no-store'}});
  } catch(error) { return toErrorResponse(error); }
}
