import { get, post, newOperationId } from '../api.js';
import { h, mount, money, num, dateTime, dateOnly, pageHead, tabs, input, field, select, button, formModal, table, pill, statusPill, load, toast, confirmDialog, emptyState, errorState } from '../dom.js';
import { state, can } from '../state.js';
import { loadAllProducts, productMap, productLabel } from '../util.js';
import { errorMessage } from '../api.js';

export async function render({ params, navigate }) {
  if (params[0]) return purchaseDocument(params[0], navigate);
  const host = h('div', {}); let tab = 'orders';
  const views = {
    orders: () => load(host, async () => {
      const [rows, sups] = await Promise.all([get('/purchases'), can('supplier.read') ? get('/suppliers') : []]);
      const sm = new Map(sups.map((s) => [s.id, s.name]));
      return h('div', { class: 'card flush' }, table([
        { label: 'Order', render: (p) => h('div', {}, h('div', { class: 'semibold mono' }, p.purchaseNumber), h('div', { class: 'muted' }, dateTime(p.createdAt))) },
        { label: 'Supplier', render: (p) => sm.get(p.supplierId) || p.supplierId },
        { label: 'Items', right: true, render: (p) => p.items.length }, { label: 'Total', right: true, render: (p) => money(p.total) },
        { label: 'Status', render: (p) => statusPill(p.status) },
      ], rows, { onRowClick: (p) => navigate(`purchases/${p.id}`), empty: 'No purchase orders yet.', caption: 'Purchase orders' }));
    }),
    suppliers: () => load(host, async () => {
      const rows = await get('/suppliers');
      return h('div', { class: 'card flush' }, table([{ label: 'Supplier', render: (s) => h('span', { class: 'semibold' }, s.name) }, { label: 'Phone', render: (s) => s.phone || '—' }, { label: 'Email', render: (s) => s.email || '—' }, { label: 'Status', render: (s) => statusPill(s.status) }], rows, { empty: 'No suppliers yet.', caption: 'Suppliers' }));
    }),
  };
  function addSupplier() {
    formModal({ title: 'Add supplier', build: () => {
      const name = input({ required: true }); const phone = input({ type: 'tel' }); const email = input({ type: 'email' }); const address = input(); const tax = input();
      return { fields: h('div', { class: 'form-grid' }, field('Name', name), field('Phone', phone), field('Email', email), field('Address', address), field('Tax number', tax)), collect: () => { if (!name.value.trim()) throw new Error('Supplier name is required.'); return { name: name.value.trim(), phone: phone.value.trim() || undefined, email: email.value.trim() || undefined, address: address.value.trim() || undefined, taxNumber: tax.value.trim() || undefined }; } };
    }, submit: async (b) => { await post('/suppliers', b); toast('Supplier added', 'ok'); tab = 'suppliers'; views.suppliers(); } });
  }
  function newOrder() {
    formModal({ title: 'New purchase order', wide: true, submitLabel: 'Save as draft', build: () => {
      const supplier = select([['', 'Loading suppliers…']]); const linesHost = h('div', {}); const lines = []; let products = [];
      Promise.all([get('/suppliers'), loadAllProducts()]).then(([s, ps]) => { products = ps; mount(supplier, s.map((x) => h('option', { value: x.id }, x.name))); addLine(); }).catch(() => {});
      function addLine() {
        const prod = select(products.map((p) => [p.id, `${p.name} (${p.sku})`])); const qty = input({ type: 'number', min: 0, step: 'any', value: 1, 'aria-label': 'Quantity' }); const cost = input({ type: 'number', min: 0, step: 'any', placeholder: 'Unit cost', 'aria-label': 'Unit cost' });
        const row = h('div', { class: 'form-grid' }, field('Product', prod), field('Quantity', qty), field('Unit cost', cost), button('Remove', { kind: 'ghost small', onClick: () => { lines.splice(lines.indexOf(entry), 1); row.remove(); } }));
        const entry = { prod, qty, cost }; lines.push(entry); linesHost.append(row);
      }
      return { fields: h('div', {}, field('Supplier', supplier), h('h2', {}, 'Items'), linesHost, button('+ Add item', { onClick: addLine })),
        collect: () => { if (!supplier.value) throw new Error('Choose a supplier.'); const items = lines.map((l) => ({ productId: l.prod.value, quantity: Number(l.qty.value), unitCost: Number(l.cost.value) })); if (!items.length || items.some((i) => !i.productId || !(i.quantity > 0) || !(i.unitCost >= 0) || Number.isNaN(i.unitCost))) throw new Error('Every item needs a product, a quantity above zero and a unit cost.'); return { supplierId: supplier.value, items }; } };
    }, submit: async (b) => { const p = await post('/purchases', b); toast('Draft purchase order saved', 'ok'); navigate(`purchases/${p.id}`); } });
  }
  const root = h('div', {}, pageHead('Purchases', 'Order stock from suppliers and receive it into batches', can('supplier.write') && button('Add supplier', { onClick: addSupplier }), can('purchase.write') && button('New purchase order', { kind: 'primary', onClick: newOrder })),
    tabs([['orders', 'Purchase orders'], ['suppliers', 'Suppliers']], tab, (t) => { tab = t; views[t](); }), host);
  views.orders(); return root;
}

// Purchase order as a printable document (layout after the supplied reference).
async function purchaseDocument(id, navigate) {
  const root = h('div', {});
  await load(root, async () => {
    const [orders, sups, products] = await Promise.all([get('/purchases'), can('supplier.read') ? get('/suppliers') : [], loadAllProducts()]);
    const po = orders.find((x) => x.id === id); if (!po) throw Object.assign(new Error('not found'), { status: 404, detail: 'That purchase order was not found.' });
    const sup = sups.find((s) => s.id === po.supplierId) || { name: po.supplierId }; const pm = productMap(products); const b = state.business;
    let operationId = newOperationId('recv'); // reused on retry so a double click / retry can never receive twice
    const receive = async () => {
      if (!(await confirmDialog({ title: 'Receive stock', message: `Receive all items of ${po.purchaseNumber}? This creates stock batches and cannot be undone.`, confirmLabel: 'Receive stock' }))) return;
      try { await post(`/purchases/${po.id}/receive`, { operationId }); toast('Stock received', 'ok'); navigate('purchases'); setTimeout(() => navigate(`purchases/${po.id}`), 0); }
      catch (e) { toast(errorMessage(e), 'bad'); }
    };
    return h('div', {}, pageHead(po.purchaseNumber, `Created ${dateTime(po.createdAt)}`, button('← Back', { onClick: () => navigate('purchases') }), button('Print / Save as PDF', { onClick: () => window.print() }),
      po.status === 'draft' && can('purchase.receive') && button('Receive stock', { kind: 'primary', onClick: receive })),
    h('div', { class: 'doc' }, h('h2', {}, 'Purchase Order'),
      h('div', { class: 'meta' }, h('div', {}, h('div', { class: 'semibold' }, b.name), b.address && h('div', {}, b.address), b.phone && h('div', {}, `Tel: ${b.phone}`), b.taxId && h('div', {}, `TIN: ${b.taxId}`)),
        h('dl', { class: 'kv' }, h('dt', {}, 'PO number'), h('dd', { class: 'mono' }, po.purchaseNumber), h('dt', {}, 'Date'), h('dd', {}, dateOnly(po.createdAt)), h('dt', {}, 'Status'), h('dd', {}, statusPill(po.status)), po.receivedAt && h('dt', {}, 'Received'), po.receivedAt && h('dd', {}, dateTime(po.receivedAt)))),
      h('div', { class: 'meta' }, h('div', { class: 'box' }, h('h3', {}, 'Supplier'), h('div', { class: 'semibold' }, sup.name), sup.phone && h('div', {}, sup.phone), sup.email && h('div', {}, sup.email)), h('div', { class: 'box' }, h('h3', {}, 'Ship to'), h('div', { class: 'semibold' }, b.name), b.address && h('div', {}, b.address))),
      h('table', {}, h('thead', {}, h('tr', {}, ['Item', 'Description', 'Qty', 'Rate', 'Amount'].map((t, i) => h('th', { class: i > 1 ? 'right' : '' }, t)))),
        h('tbody', {}, po.items.map((it) => { const p = pm.get(it.productId); return h('tr', {}, h('td', { class: 'mono' }, p ? p.sku : '—'), h('td', {}, productLabel(pm, it.productId)), h('td', { class: 'right num' }, num(it.quantity)), h('td', { class: 'right num' }, money(it.unitCost, false)), h('td', { class: 'right num' }, money(it.quantity * it.unitCost, false))); }))),
      h('div', { class: 'sum' }, h('div', { class: 'total' }, h('span', {}, `Total (${b.currency})`), h('span', { class: 'num' }, money(po.total, false)))),
      h('div', { class: 'sign' }, h('div', { class: 'box' }, h('h3', {}, 'Prepared by')), h('div', { class: 'box' }, h('h3', {}, 'Approved by')))));
  });
  return root;
}
