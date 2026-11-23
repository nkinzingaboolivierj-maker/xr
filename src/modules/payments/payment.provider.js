'use strict';
const crypto = require('node:crypto');
const { ApiError } = require('../../lib/errors');

// -----------------------------------------------------------------------
// PaymentProvider — the adapter boundary, same pattern as
// notifications/whatsapp.provider.js. Whichever concrete provider is
// selected (per-business, via businesses.payment_provider), the rest of
// the system (payment.service.js) calls ONLY this shape:
//
//   initiatePayment({method, network, amount, currency, phone}) -> {providerReference, status}
//   getPaymentStatus(providerReference) -> {status}   (polling fallback)
//   verifyWebhookSignature({rawBody, signature, secret}) -> boolean
//
// Rails this system targets (user-specified): Airtel Money, MTN Mobile
// Money, and Card. Airtel Money and MTN Mobile Money are DIFFERENT
// networks with separate real APIs — never treated as interchangeable,
// which is why payment_intents.network distinguishes them even though
// both share method='MobileMoney'. Card is a third, separate rail (which
// real processor/gateway to use is still an open decision).
//
// Swapping MOCK for a real provider later means writing new classes that
// implement this same shape (realistically one per rail — a real Airtel
// Money integration is not the same API call as a real MTN MoMo one) and
// changing businesses.payment_provider from 'MOCK' to 'REAL' — nothing in
// payment.service.js changes.
// -----------------------------------------------------------------------

// DEVELOPMENT/TEST ONLY. This constant is published in the source, so it must
// never be accepted as a webhook secret in production: payment.service.js
// refuses to use it unless mock providers are explicitly allowed AND the
// process is not running with NODE_ENV=production. A real deployment sets
// PAYMENT_WEBHOOK_SECRET (>= 32 chars) or, better, the provider's own secret.
const MOCK_WEBHOOK_SECRET = 'mock-webhook-secret-placeholder';

class MockPaymentProvider {
  // No network call is made — this NEVER reaches a real Airtel Money,
  // MTN MoMo, or card-processor endpoint.
  //
  // Deterministic test hook: a phone number containing "FAIL" simulates
  // an immediate provider-side rejection (e.g. invalid MSISDN / card
  // declined at authorization). Otherwise the intent comes back PENDING —
  // matching how a real Airtel Money / MTN MoMo USSD push AND a real
  // card 3-D Secure flow both actually work: confirmation arrives later,
  // asynchronously, via a webhook. A synchronous SUCCESS here would be
  // dishonest about how these rails behave.
  async initiatePayment({ method, network, amount, currency, phone }) {
    if (!(Number(amount) > 0)) {
      throw new ApiError('VALIDATION_ERROR', 'amount must be > 0 to initiate a payment');
    }
    const railTag = method === 'MobileMoney' ? network : 'CARD';
    const providerReference = `MOCK-${railTag}-${crypto.randomBytes(8).toString('hex')}`;
    if (typeof phone === 'string' && phone.includes('FAIL')) {
      return { providerReference, status: 'FAILED' };
    }
    return { providerReference, status: 'PENDING' };
  }

  // Not called by any flow in this codebase today (webhooks are the
  // confirmation path) but part of the adapter contract a real
  // integration needs: every one of these providers also exposes a
  // polling endpoint for when a webhook is missed or delayed.
  async getPaymentStatus(providerReference) {
    return { providerReference, status: 'PENDING' };
  }

  // HMAC-SHA256 over the raw request body, matching how real providers in
  // this space (and payment platforms generally — e.g. Flutterwave,
  // Stripe) sign webhook payloads.
  verifyWebhookSignature({ rawBody, signature, secret }) {
    if (!signature || typeof signature !== 'string') return false;
    const expected = crypto.createHmac('sha256', secret || MOCK_WEBHOOK_SECRET).update(rawBody || '').digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }
}

// Placeholder for real Airtel Money / MTN MoMo / Card integrations.
// Selected only when a business's payment_provider = 'REAL', which
// nothing in this codebase sets today — so this class exists but is never
// actually reachable until real provider credentials are chosen and
// supplied, and each rail's real API is implemented here.
class RealPaymentProvider {
  async initiatePayment() {
    throw new ApiError('PROVIDER_NOT_CONFIGURED', "BLOCKED_PENDING_PROVIDER: no real payment provider is configured. Supply Airtel Money / MTN MoMo / Card processor API docs and credentials, then implement this class against each provider's actual API.");
  }
  async getPaymentStatus() {
    throw new ApiError('PROVIDER_NOT_CONFIGURED', 'BLOCKED_PENDING_PROVIDER: no real payment provider is configured.');
  }
  verifyWebhookSignature() {
    throw new ApiError('PROVIDER_NOT_CONFIGURED', 'BLOCKED_PENDING_PROVIDER: no real payment provider is configured.');
  }
}

function getProvider(providerName) {
  if (providerName === 'REAL') return new RealPaymentProvider();
  return new MockPaymentProvider();
}

module.exports = { getProvider, MockPaymentProvider, RealPaymentProvider, MOCK_WEBHOOK_SECRET };
