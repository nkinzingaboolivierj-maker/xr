'use strict';
const { ApiError } = require('./errors');

// Bounded, validated paging. Previously `Number(pageSize)` was passed
// straight to SQL: NaN -> 500, negative page -> negative OFFSET, and an
// unbounded pageSize allowed a single request to read the whole table.
function parsePaging({ page, pageSize } = {}, { defaultSize = 50, maxSize = 200 } = {}) {
  const p = page === undefined || page === '' ? 1 : Number(page);
  const s = pageSize === undefined || pageSize === '' ? defaultSize : Number(pageSize);
  if (!Number.isInteger(p) || p < 1) throw new ApiError('VALIDATION_ERROR', 'page must be an integer >= 1');
  if (!Number.isInteger(s) || s < 1 || s > maxSize) throw new ApiError('VALIDATION_ERROR', `pageSize must be an integer between 1 and ${maxSize}`);
  return { page: p, pageSize: s, offset: (p - 1) * s };
}

module.exports = { parsePaging };
