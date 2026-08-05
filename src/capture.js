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
      .filter((r) => r && typeof r.url === 'string' && r.url !== '')
      .map((r) => ({
        url: r.url,
        method: typeof r.method === 'string' ? r.method : 'GET',
        body: typeof r.body === 'string' ? r.body : null,
        // null, never an index: a position is not a millisecond. Windowed
        // rules must skip events whose timestamp is unknowable rather than
        // compare array offsets as if they were elapsed time.
        timestamp: Number.isFinite(r.timestamp) ? r.timestamp : null,
        pageUrl: typeof r.pageUrl === 'string' ? r.pageUrl : null,
      })),
    dataLayer,
  };
}
