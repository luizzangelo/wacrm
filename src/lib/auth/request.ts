/** These cookie-setting endpoints accept only same-origin JSON browser requests.
 * Never derive the trusted origin from arbitrary forwarded client headers. */
export function authRequestAllowed(request: Request): boolean {
  try {
    const trusted = new URL(
      process.env.NEXT_PUBLIC_SITE_URL?.trim() || request.url
    ).origin;
    return (
      request.headers.get('origin') === trusted &&
      request.headers.get('content-type')?.split(';')[0].trim() ===
        'application/json'
    );
  } catch {
    return false;
  }
}
