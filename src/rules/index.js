import * as duplicateEvent from './duplicate-event.js';
import * as revenueWithoutCurrency from './revenue-without-currency.js';
import * as deadProperty from './dead-property.js';
import * as malformedHit from './malformed-hit.js';

export const RULES = [duplicateEvent, revenueWithoutCurrency, deadProperty, malformedHit];

export function runRules(events, ctx = {}) {
  return RULES.flatMap((rule) => rule.run(events, ctx));
}
