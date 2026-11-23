import { get, getEnvelope, post } from '../api.js';
import { h, mount, money, num, dateTime, pageHead, tabs, input, field, select, textarea, button, formModal, table, pill, load, toast, emptyState } from '../dom.js';
import { state, can } from '../state.js';
import { loadAllProducts, productMap, productLabel } from '../util.js';

export async function render() {
  const host = h('div', {});
  const costs = can('finance.read'); // cost-based figures are only displayed to roles that may see finance
  let tab = 'stock';
  const views = {
    stock: () => load(host, async () => {
      const env = await getEnvelope('/reports/inventory');
      const low = state.business.lowStockThreshold;
      return h('div', { class: 'card flush' }, table([
        { label: 'Product', render: (r) => h('div', {}, h('div', { class: 'semibold' }, r.name), h('div', { class: 'muted mono' }, r.sku)) },
        { label: 'In stock', right: true, render: (r) => h('span', { class: r.currentStock <= 0 ? 'danger-text semibold' : '' }, num(r.currentStock)) },
        { label: 'Status', render: (r) => (r.currentStock <= 0 ? pill('Out of stock', 'bad') : r.currentStock <= low ? pill('Low', 'warn') : pill('OK', 'ok')) },
        { label: 'Oldest batch', right: true, render: (r) => (r.oldestBatchAgeDays === null || r.oldestBatchAgeDays === undefined ? '—' : `${r.oldestBatchAgeDays} d`) },
        costs && { label: 'Stock value (cost)', right: true, render: (r) => money(r.stockValue) },
      ].filter(Boolean), env.data, { empty: 'No products yet.', caption: 'Stock levels' }),
      costs ? h('div', { class: 'pager' }, h('span', { class: 'muted' }, `Total stock value at cost: `), h('strong', {}, money(env.summary.totalStockValue))) : null);
    }),
    aging: () => load(host, async () => {
      const [rows, products] = await Promise.all([get('/inventory/aging'), loadAllProducts()]);
      const pm = productMap(products);
      const bucket = (d) => (d <= 30 ? '0–30 days' : d <= 60 ? '31–60 days' : d <= 90 ? '61–90 days' : '90+ days');
      const sorted = rows.slice().sort((a, b) => b.ageDays - a.ageDays);
      return h('div', {}, h('div', { class: 'alert info' }, 'Stock age shows how long units have been on the shelf. It is not a profit measure: profit is always revenue − COGS − expenses.'),
        h('div', { class: 'card flush' }, table([
          { label: 'Product', render: (r) => productLabel(pm, r.productId) }, { label: 'Received', render: (r) => dateTime(r.receivedAt) },
          { label: 'Age', right: true, render: (r) => `${r.ageDays} d` }, { label: 'Bucket', render: (r) => pill(bucket(r.ageDays), r.ageDays > 90 ? 'bad' : r.ageDays > 60 ? 'warn' : '') },
          { label: 'Remaining', right: true, render: (r) => num(r.quantityRemaining) }, costs && { label: 'Unit cost', right: true, render: (r) => money(r.unitCost) },
        ].filter(Boolean), sorted, { empty: 'No stock on hand.', caption: 'Stock aging by batch' })));
    }),
    movements: () => load(host, async () => {
      const [rows, products] = await Promise.all([get('/inventory/movements', { limit: 300 }), loadAllProducts()]);
      const pm = productMap(products);
      return h('div', {}, h('p', { class: 'muted' }, 'Every stock change is a ledger entry. Entries cannot be edited or deleted. Showing the latest 300.'),
        h('div', { class: 'card flush' }, table([
          { label: 'When', render: (r) => dateTime(r.createdAt) }, { label: 'Product', render: (r) => productLabel(pm, r.productId) },
          { label: 'Type', render: (r) => pill(r.type.replace(/_/g, ' '), ['SALE', 'DAMAGE', 'LOSS', 'ADJUSTMENT_OUT', 'SUPPLIER_RETURN'].includes(r.type) ? 'warn' : 'ok') },
          { label: 'Qty', right: true, render: (r) => num(r.quantity) }, { label: 'Reference', render: (r) => h('span', { class: 'mono' }, `${r.referenceType || ''} ${r.referenceId ? r.referenceId.slice(-8) : ''}`) },
        ], rows, { empty: 'No stock movements yet.', caption: 'Inventory ledger' })));
    }),
  };

  function adjust() {
    formModal({ title: 'Stock adjustment', submitLabel: 'Record adjustment',
      build: () => {
        const prod = select([['', 'Loading products…']]); const type = select([['DAMAGE', 'Damaged'], ['LOSS', 'Lost / stolen'], ['ADJUSTMENT_OUT', 'Count correction (remove)'], ['ADJUSTMENT_IN', 'Count correction (add)']]);
        const qty = input({ type: 'number', min: 0, step: 'any', required: true }); const cost = input({ type: 'number', min: 0, step: 'any' }); const reason = textarea({ required: true, placeholder: 'What happened? (required, audited)' });
        loadAllProducts().then((ps) => { mount(prod, ps.map((p) => h('option', { value: p.id }, `${p.name} (${p.sku})`))); }).catch(() => {});
        const costField = field('Unit cost', cost, { hint: 'Only needed when adding stock.' });
        const sync = () => { costField.hidden = type.value !== 'ADJUSTMENT_IN'; }; type.addEventListener('change', sync); sync();
        return { fields: h('div', {}, field('Product', prod), field('Reason type', type), field('Quantity', qty), costField, field('Reason', reason)),
          collect: () => { if (!prod.value || !(Number(qty.value) > 0) || !reason.value.trim()) throw new Error('Choose a product, a quantity above zero and give a reason.'); const b = { productId: prod.value, type: type.value, quantity: Number(qty.value), reason: reason.value.trim() }; if (type.value === 'ADJUSTMENT_IN') b.unitCost = Number(cost.value); return b; } };
      },
      submit: async (b) => { await post('/inventory/adjustments', b); toast('Adjustment recorded', 'ok'); views[tab](); },
    });
  }
  function supplierReturn() {
    formModal({ title: 'Return stock to supplier', submitLabel: 'Record return',
      build: () => {
        const purchase = select([['', 'Loading purchases…']]); const prod = select([['', 'Loading products…']]); const qty = input({ type: 'number', min: 0, step: 'any', required: true }); const reason = input({ placeholder: 'Why is it going back?' });
        Promise.all([get('/purchases'), loadAllProducts()]).then(([pur, ps]) => { mount(purchase, pur.filter((x) => x.status === 'received').map((x) => h('option', { value: x.id }, `${x.purchaseNumber} · ${dateTime(x.receivedAt)}`))); mount(prod, ps.map((p) => h('option', { value: p.id }, `${p.name} (${p.sku})`))); }).catch(() => {});
        return { fields: h('div', {}, field('Original purchase', purchase), field('Product', prod), field('Quantity', qty), field('Reason', reason)),
          collect: () => { if (!purchase.value || !prod.value || !(Number(qty.value) > 0)) throw new Error('Choose the purchase, product and a quantity above zero.'); return { purchaseId: purchase.value, productId: prod.value, quantity: Number(qty.value), reason: reason.value.trim() || undefined }; } };
      },
      submit: async (b) => { await post('/inventory/supplier-returns', b); toast('Supplier return recorded', 'ok'); views[tab](); },
    });
  }

  const root = h('div', {}, pageHead('Inventory', 'Stock is always derived from batches and the ledger — never typed in',
    can('inventory.adjust') && button('Adjust stock', { onClick: adjust }), can('inventory.adjust') && button('Return to supplier', { onClick: supplierReturn })),
  tabs([['stock', 'Stock levels'], ['aging', 'Aging'], ['movements', 'Ledger']], tab, (t) => { tab = t; views[t](); }), host);
  views.stock();
  return root;
}
