'use strict';

// Error code catalog — must match docs/contracts/API_ERROR_MODEL.md exactly.
// Never invent a new code inline; add it here (and to that doc) first.
const CODES = {
  INVALID_CREDENTIALS:        { status: 401, title: 'Invalid credentials' },
  SESSION_EXPIRED:            { status: 401, title: 'Session expired' },
  UNAUTHENTICATED:            { status: 401, title: 'Authentication required' },
  PERMISSION_DENIED:          { status: 403, title: 'Permission denied' },
  CROSS_BUSINESS_ACCESS:      { status: 403, title: 'Cross-business access denied' },
  NOT_FOUND:                  { status: 404, title: 'Resource not found' },
  DUPLICATE_SKU:              { status: 409, title: 'Duplicate SKU' },
  PRICE_BELOW_MINIMUM:        { status: 422, title: 'Price below minimum' },
  PRICE_ABOVE_MAXIMUM:        { status: 422, title: 'Price above maximum' },
  INVALID_PRICE_BAND:         { status: 422, title: 'Invalid price band' },
  PURCHASE_ALREADY_RECEIVED:  { status: 409, title: 'Purchase already received' },
  NEGATIVE_STOCK_BLOCKED:     { status: 422, title: 'Negative stock blocked' },
  INSUFFICIENT_STOCK:         { status: 409, title: 'Insufficient stock' },
  DUPLICATE_OPERATION:        { status: 409, title: 'Duplicate operation' },
  RETURN_EXCEEDS_SOLD:        { status: 422, title: 'Return exceeds sold quantity' },
  REFUND_EXCEEDS_REFUNDABLE:  { status: 422, title: 'Refund exceeds refundable amount' },
  VALIDATION_ERROR:           { status: 400, title: 'Validation error' },
  CASH_RECEIVED_INSUFFICIENT: { status: 422, title: 'Cash received is less than the amount due' },
  RATE_LIMITED:               { status: 429, title: 'Too many attempts' },
  INVALID_WEBHOOK_SIGNATURE:  { status: 401, title: 'Invalid webhook signature' },
  PAYLOAD_TOO_LARGE:          { status: 413, title: 'Request body too large' },
  PASSWORD_CHANGE_REQUIRED:   { status: 403, title: 'Password change required' },
  BUSINESS_SELECTION_REQUIRED:{ status: 409, title: 'Business selection required' },
  PAYMENT_NOT_VERIFIED:       { status: 422, title: 'Payment not verified' },
  PAYMENT_AMOUNT_MISMATCH:    { status: 422, title: 'Payment amount or currency mismatch' },
  PROVIDER_NOT_CONFIGURED:    { status: 503, title: 'Provider not configured' },
  INTERNAL_ERROR:             { status: 500, title: 'Internal server error' },
};

class ApiError extends Error {
  constructor(code, detail, instance, extra) {
    const entry = CODES[code] || { status: 500, title: 'Internal error' };
    super(detail || entry.title);
    this.code = code;
    this.status = entry.status;
    this.title = entry.title;
    this.detail = detail || entry.title;
    this.instance = instance;
    this.extra = extra || null; // optional RFC 9457 extension members (never secrets)
  }

  toProblem() {
    return {
      type: `https://xr.app/errors/${this.code.toLowerCase().replace(/_/g, '-')}`,
      title: this.title,
      status: this.status,
      detail: this.detail,
      instance: this.instance,
      code: this.code,
      ...(this.extra || {}),
    };
  }
}

module.exports = { ApiError, CODES };
