'use strict';
const crypto = require('node:crypto');

let counter = 0;
function nextId(prefix) {
  counter += 1;
  const rand = crypto.randomBytes(4).toString('hex');
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}

function now() {
  return new Date().toISOString();
}

module.exports = { nextId, now };
