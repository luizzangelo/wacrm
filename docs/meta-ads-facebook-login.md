# Meta Ads Facebook Login for Business

The Meta Ads connection under Settings → Meta Conversions uses Facebook Login
for Business to obtain read-only `ads_read` access. The resulting token is
encrypted with the existing AES-256-GCM helper and stored per WACRM account in
`meta_conversion_config`.

## Environment variables

Runtime, server-side:

- `META_APP_ID`: non-secret Meta App ID.
- `META_ADS_LOGIN_CONFIG_ID`: non-secret Facebook Login for Business
  Configuration ID with `ads_read`, `business_management`, and Ad accounts
  enabled.
- `META_GRAPH_VERSION`: Graph API version; defaults to `v21.0`.
- `META_APP_SECRET`: secret mounted only in the server container. Never prefix
  it with `NEXT_PUBLIC_`.

The browser receives only `appId`, `configId`, and `graphVersion` from the
authenticated `GET /api/meta-ads/status` endpoint. These Meta Ads values are
not build arguments. Existing `NEXT_PUBLIC_META_*` variables remain build-time
settings used by WhatsApp Embedded Signup and are independent of this flow.

## Database

Apply `20261023182249_meta_ads_facebook_login.sql`. It adds connection metadata
to `meta_conversion_config` and classifies existing Marketing API tokens as
`manual`; it does not replace or decrypt them.

## Local test

1. Set the four runtime variables above in `.env.local`.
2. Apply the migration to the intended Supabase project.
3. Run `npm test`, `npm run typecheck`, and `npm run dev`.
4. Sign in as an account owner/admin and open Settings → Meta Conversions.
5. Confirm the disconnected action and collapsed manual-token section.
6. Complete Facebook Login. If multiple ad accounts are authorized, select one.
7. Confirm the safe connected label and then test Disconnect.

Tokens are never returned by the status/connect endpoints. Ad hierarchy reads
remain failure-tolerant so a Marketing API outage cannot block WhatsApp inbound
message persistence.

## Meta dashboard requirements

- Add `https://crm.luizangelo.com.br` to the app domains and allowed domains for
  the Facebook JavaScript SDK.
- Configure the Facebook Login for Business configuration for the production
  app with `ads_read` and `business_management`, with **Ad accounts** enabled.
- Keep the production site on HTTPS.
- Ensure the app's Privacy Policy, Terms of Service, and User Data Deletion URLs
  point to the existing WACRM public pages.
- This flow uses the JavaScript SDK authorization code and does not send a
  `redirect_uri` during token exchange.
