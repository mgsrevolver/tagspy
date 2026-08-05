export class CaptureError extends Error {}

export function loadCapture(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new CaptureError('capture must be a JSON object');
  }
  if (raw.version !== 1) {
    throw new CaptureError(`unsupported capture version: ${JSON.stringify(raw.version)}`);
  }
  const requests = raw.requests ?? [];
  const dataLayer = raw.dataLayer ?? [];
  if (!Array.isArray(requests)) throw new CaptureError('requests must be an array');
  if (!Array.isArray(dataLayer)) throw new CaptureError('dataLayer must be an array');

  return {
    version: 1,
    capturedAt: raw.capturedAt ?? null,
    requests: requests
      .filter((r) => r && typeof r.url === 'string')
      .map((r, i) => ({
        url: r.url,
        method: typeof r.method === 'string' ? r.method : 'GET',
        body: typeof r.body === 'string' ? r.body : null,
        timestamp: Number.isFinite(r.timestamp) ? r.timestamp : i,
        pageUrl: typeof r.pageUrl === 'string' ? r.pageUrl : null,
      })),
    dataLayer,
  };
}
