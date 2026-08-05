import { finding } from '../findings.js';

export const id = 'utm-loss';

const CAMPAIGN = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'];

function hasCampaign(url) {
  if (!url) return false;
  try {
    const params = new URL(url).searchParams;
    return CAMPAIGN.some((key) => params.has(key));
  } catch {
    return false;
  }
}

export function run(events) {
  const tagged = events.filter((e) => hasCampaign(e.pageUrl));
  if (!tagged.length) return [];
  const pageViews = events.filter((e) => e.platform !== 'datalayer' && e.eventName === 'page_view');
  if (!pageViews.length || pageViews.some((e) => hasCampaign(e.pageUrl))) return [];
  return [finding({
    rule: id,
    message: 'campaign parameters were present during the session but never on a page_view hit — attribution is lost before the tag fires',
    evidence: [tagged[0].pageUrl, pageViews[0].pageUrl ?? '(no url)'],
    suggestion: 'A redirect (auth, consent, locale) is probably stripping the query string before the first page_view. Fire the tag before the redirect or carry the params through it.',
    waiveKey: id,
  })];
}
