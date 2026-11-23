'use strict';
const authService = require('../auth/auth.service');
const { requirePermission } = require('../rbac/rbac');
const productService = require('./product.service');

function list(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'product.read');
    const result = productService.listProducts(db, session, ctx.query);
    return { status: 200, body: { success: true, data: result.data, meta: { page: result.page, pageSize: result.pageSize, total: result.total } } };
  };
}

function create(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'product.write');
    const product = productService.createProduct(db, session, ctx.body || {});
    return { status: 201, body: { success: true, data: product } };
  };
}

function setPrice(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'price.write');
    const product = productService.setPricing(db, session, ctx.params.id, ctx.body || {});
    return { status: 200, body: { success: true, data: product } };
  };
}

function priceHistory(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'price.read');
    const history = productService.getPriceHistory(db, session, ctx.params.id);
    return { status: 200, body: { success: true, data: history } };
  };
}

function classify(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'product.write');
    const product = productService.classifyProduct(db, session, ctx.params.id, ctx.body || {});
    return { status: 200, body: { success: true, data: product } };
  };
}

function lookup(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'product.read');
    const product = productService.lookupByCode(db, session, ctx.query.code);
    return { status: 200, body: { success: true, data: product } };
  };
}

module.exports = { list, create, setPrice, priceHistory, classify, lookup };
