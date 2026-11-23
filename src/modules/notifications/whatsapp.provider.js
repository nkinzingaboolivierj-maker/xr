'use strict';
const crypto = require('node:crypto');
const { ApiError } = require('../../lib/errors');

// -----------------------------------------------------------------------
// WhatsAppProvider — the adapter boundary. Whichever concrete provider is
// selected (per-business, via businesses.whatsapp_provider), the rest of
// the system (notification.service.js) calls ONLY this shape:
//
//   send({ to, from, type, body }) -> { providerMessageId, status }
//
// Swapping MOCK for a real provider later means writing ONE new class
// that implements this same shape and changing businesses.whatsapp_provider
// from 'MOCK' to 'REAL' — nothing in notification.service.js changes.
// -----------------------------------------------------------------------

class MockWhatsAppProvider {
  // Deterministic-ish simulated behavior so tests are reliable: fails only
  // when the recipient number literally contains "FAIL" (a test hook),
  // succeeds otherwise. No network call is made — this NEVER reaches a
  // real WhatsApp number.
  async send({ to, from, type, body }) {
    if (typeof to !== 'string' || !to.trim()) {
      throw new ApiError('VALIDATION_ERROR', 'Recipient phone number is required to send a WhatsApp message');
    }
    if (to.includes('FAIL')) {
      const err = new Error('Simulated provider failure');
      err.providerFailure = true;
      throw err;
    }
    return {
      providerMessageId: `MOCK-${crypto.randomBytes(8).toString('hex')}`,
      status: 'SENT',
    };
  }
}

// Placeholder for a real provider (Meta Cloud API, Twilio, etc.). Selected
// only when a business's whatsapp_provider = 'REAL', which nothing in this
// codebase sets today — so this class exists but is never actually
// reachable until a real provider is chosen and its credentials supplied.
class RealWhatsAppProvider {
  async send() {
    throw new ApiError('PROVIDER_NOT_CONFIGURED', 'BLOCKED_PENDING_PROVIDER: no real WhatsApp provider is configured. Supply provider choice + credentials, then implement this class against that provider\'s actual API.');
  }
}

function getProvider(providerName) {
  if (providerName === 'REAL') return new RealWhatsAppProvider();
  return new MockWhatsAppProvider();
}

module.exports = { getProvider, MockWhatsAppProvider, RealWhatsAppProvider };
