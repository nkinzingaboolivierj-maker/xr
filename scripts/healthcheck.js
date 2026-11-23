#!/usr/bin/env node
'use strict';
// Used by the container HEALTHCHECK: exits 0 only if /ready answers 200.
const http = require('node:http');
const port = process.env.PORT || 3000;
const req = http.get({ host: '127.0.0.1', port, path: '/ready', timeout: 3000 }, (res) => process.exit(res.statusCode === 200 ? 0 : 1));
req.on('error', () => process.exit(1));
req.on('timeout', () => { req.destroy(); process.exit(1); });
