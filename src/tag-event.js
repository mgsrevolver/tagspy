export function tagEvent(fields) {
  return {
    platform: fields.platform,
    account: fields.account ?? null,
    eventName: fields.eventName ?? null,
    params: fields.params ?? {},
    consent: fields.consent ?? null,
    pageUrl: fields.pageUrl ?? null,
    timestamp: fields.timestamp ?? null,
    order: fields.order ?? 0,
    raw: fields.raw ?? {},
  };
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}
