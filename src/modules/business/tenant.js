'use strict';
const { ApiError } = require('../../lib/errors');

// Every fetched resource must be checked against the caller's session
// business — never trust a business_id supplied by the client.
function assertOwnedByBusiness(resource, session, resourceName = 'Resource') {
  if (!resource) throw new ApiError('NOT_FOUND', `${resourceName} not found`);
  if (resource.business_id !== session.businessId) {
    throw new ApiError('CROSS_BUSINESS_ACCESS', `${resourceName} does not belong to your business`);
  }
  return resource;
}

module.exports = { assertOwnedByBusiness };
