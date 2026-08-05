import { finding } from '../findings.js';

export const id = 'malformed-hit';

export function run(_events, ctx = {}) {
  return (ctx.errors ?? []).map((error) => finding({
    rule: id,
    message: `could not decode a matched hit: ${error.message}`,
    evidence: [error.url],
    suggestion: 'Usually a truncated capture. Re-capture the hit; if it persists the adapter needs to handle this encoding.',
    waiveKey: id,
  }));
}
