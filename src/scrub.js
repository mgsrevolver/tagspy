const SENSITIVE_PARAMS = new Set([
  'cid', 'sid', 'uid', '_p', '_fid',
  'gclid', 'dclid', 'wbraid', 'gbraid',
  'fbp', 'fbc', 'external_id', 'em', 'ph',
  // observed in live Google Ads / GA4 traffic on shop.merch.google 2026-08-05
  'auid', 'ecid', '_gid', 'jid', 'gjid',
]);

export function scrubUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  for (const key of [...parsed.searchParams.keys()]) {
    if (SENSITIVE_PARAMS.has(key)) parsed.searchParams.set(key, 'REDACTED');
  }
  return parsed.toString();
}
