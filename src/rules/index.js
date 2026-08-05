import * as duplicateEvent from './duplicate-event.js';
import * as revenueWithoutCurrency from './revenue-without-currency.js';
import * as deadProperty from './dead-property.js';
import * as malformedHit from './malformed-hit.js';
import * as eventNameLength from './event-name-length.js';
import * as debugModeInProd from './debug-mode-in-prod.js';
import * as placeholderParam from './placeholder-param.js';
import * as consentSuppression from './consent-suppression.js';
import * as namingCollision from './naming-collision.js';
import * as pushBeforeInit from './push-before-init.js';
import * as ecommerceNotCleared from './ecommerce-not-cleared.js';

export const RULES = [
  duplicateEvent, revenueWithoutCurrency, deadProperty, malformedHit,
  eventNameLength, debugModeInProd, placeholderParam, consentSuppression,
  namingCollision, pushBeforeInit, ecommerceNotCleared,
];

export function runRules(events, ctx = {}) {
  return RULES.flatMap((rule) => rule.run(events, ctx));
}
