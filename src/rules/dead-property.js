import { finding } from '../findings.js';

export const id = 'dead-property';

export function run(events) {
  const findings = [];
  const reported = new Set();
  for (const event of events) {
    const account = event.account;
    if (!account || !account.startsWith('UA-') || reported.has(account)) continue;
    reported.add(account);
    findings.push(finding({
      rule: id,
      message: `${account} is a Universal Analytics property and is still configured`,
      evidence: [event.raw.url ?? '(dataLayer)'],
      suggestion: 'Universal Analytics stopped processing hits in 2023. Remove the configuration so the dead tag stops loading.',
      waiveKey: `${id}:${account}`,
    }));
  }
  return findings;
}
