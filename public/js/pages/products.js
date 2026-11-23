import { get, getEnvelope, post } from '../api.js';
import { h, mount, money, num, dateTime, pageHead, input, field, select, textarea, button, formModal, modal, table, pill, load, toast, debounce, emptyState, spinner, errorState } from '../dom.js';
import { can } from '../state.js';

export async function render() {
  let page = 1; let q = '';
  const host = h('div', {});
  const search = input({ type: 'search', placeholder: 'Search name, SKU or barcode…', 'aria-label': 'Search products', onInput: debounce(() => { q = search.value.trim(); page = 1; draw(); }, 300) });
  const draw = () => load(host, async () => {
    const env = await getEnvelope('/products', { page, pageSize: 25, q });
    const { total, pageSize } = env.meta;
    const canPrice = can('price.read');
    return h('div', { class: 'card flush' },
      table([
        { label: 'Product', render: (p) => h('div', {}, h('div', { class: 'semibold' }, p.name), h('div', { class: 'muted mono' }, [p.sku, p.barcode].filter(Boolean).join(' · '))) },
        { label: 'Category', render: (p) => p.category || '—' },
        { label: 'Unit', key: 'unit' },
        canPrice && { label: 'Price', right: true, render: (p) => p.pricing ? h('div', {}, money(p.pricing.recommendedPrice), h('div', { class: 'muted' }, `${money(p.pricing.minPrice, false)}–${money(p.pricing.maxPrice, false)}`)) : pill('No price set', 'warn') },
        { label: 'GS1 GPC', render: (p) => p.gpc.status === 'MAPPED' ? pill(`${p.gpc.brickCode}`, 'ok') : pill('Unmapped') },
      ].filter(Boolean), env.data, { onRowClick: openProduct, empty: q ? `No products match “${q}”.` : 'No products yet. Add your first product to start.', caption: 'Products' }),
      total > pageSize ? h('div', { class: 'pager' }, h('span', { class: 'muted' }, `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`),
        button('Previous', { disabled: page === 1, onClick: () => { page -= 1; draw(); } }), button('Next', { disabled: page * pageSize >= total, onClick: () => { page += 1; draw(); } })) : null);
  });

  function addProduct() {
    formModal({ title: 'Add product', submitLabel: 'Create product',
      build: () => {
        const sku = input({ required: true, maxlength: 60 }); const name = input({ required: true, maxlength: 160 });
        const category = input({ maxlength: 80 }); const unit = input({ value: 'Piece', maxlength: 30 }); const barcode = input({ inputmode: 'numeric', maxlength: 14, placeholder: 'GTIN / EAN (optional)' });
        return { fields: h('div', { class: 'form-grid' }, field('SKU', sku, { hint: 'Your own unique code.' }), field('Name', name), field('Category', category), field('Unit', unit), field('Barcode (GTIN)', barcode)),
          collect: () => { if (!sku.value.trim() || !name.value.trim()) throw new Error('SKU and name are required.'); return { sku: sku.value.trim(), name: name.value.trim(), category: category.value.trim() || undefined, unit: unit.value.trim() || undefined, barcode: barcode.value.trim() || undefined }; } };
      },
      submit: async (body) => { const p = await post('/products', body); toast('Product created', 'ok'); draw(); if (can('price.write')) openProduct(p); },
    });
  }

  async function openProduct(p) {
    const body = h('div', {}, spinner());
    const m = modal({ title: p.name, wide: true, body, onClose: draw });
    const paint = async () => {
      try {
        const fresh = (await get('/products/lookup', { code: p.sku })) || p;
        const stock = can('inventory.read') ? await get(`/inventory/stock/${p.id}`).catch(() => null) : null;
        const hist = can('price.read') ? await get(`/products/${p.id}/price-history`).catch(() => []) : [];
        mount(body,
          h('dl', { class: 'kv' }, h('dt', {}, 'SKU'), h('dd', { class: 'mono' }, fresh.sku), h('dt', {}, 'Barcode'), h('dd', { class: 'mono' }, fresh.barcode || '—'),
            h('dt', {}, 'Category'), h('dd', {}, fresh.category || '—'), h('dt', {}, 'Unit'), h('dd', {}, fresh.unit),
            stock && h('dt', {}, 'In stock'), stock && h('dd', { class: 'semibold' }, num(stock.stock)),
            h('dt', {}, 'GPC'), h('dd', {}, fresh.gpc.status === 'MAPPED' ? `${fresh.gpc.brickCode} · ${fresh.gpc.brickTitle || ''} (${fresh.gpc.versionName})` : 'Not classified')),
          can('price.write') ? priceForm(fresh) : (fresh.pricing && h('p', {}, `Price ${money(fresh.pricing.recommendedPrice)} (allowed ${money(fresh.pricing.minPrice, false)}–${money(fresh.pricing.maxPrice, false)})`)),
          can('product.write') ? gpcForm(fresh) : null,
          can('price.read') && hist.length ? h('div', {}, h('h2', {}, 'Price history'), table([
            { label: 'When', render: (r) => dateTime(r.createdAt) }, { label: 'Type', key: 'priceType' },
            { label: 'From', right: true, render: (r) => (r.oldValue === null ? '—' : money(r.oldValue, false)) }, { label: 'To', right: true, render: (r) => money(r.newValue, false) }, { label: 'Reason', render: (r) => r.reason || '—' }])) : null);
      } catch (e) { mount(body, errorState(e, paint)); }
    };
    function priceForm(fresh) {
      const pr = fresh.pricing || {};
      const min = input({ type: 'number', min: 0, step: 'any', value: pr.minPrice ?? '' }); const rec = input({ type: 'number', min: 0, step: 'any', value: pr.recommendedPrice ?? '' }); const max = input({ type: 'number', min: 0, step: 'any', value: pr.maxPrice ?? '' });
      const reason = input({ placeholder: 'Why is the price changing?' }); const err = h('div', { role: 'alert' });
      return h('form', { class: 'card', onSubmit: async (e) => {
        e.preventDefault(); mount(err);
        try { await post(`/products/${p.id}/price`, { minPrice: Number(min.value), recommendedPrice: Number(rec.value), maxPrice: Number(max.value), reason: reason.value.trim() || undefined }); toast('Price saved', 'ok'); paint(); }
        catch (ex) { mount(err, h('div', { class: 'alert bad' }, ex.detail || ex.message)); }
      } }, h('h2', {}, 'Selling price'), h('p', { class: 'muted' }, 'The server enforces MIN ≤ RECOMMENDED ≤ MAX. The POS may only sell inside this range unless a manager overrides.'), err,
      h('div', { class: 'form-grid' }, field('Minimum', min), field('Recommended', rec), field('Maximum', max)), field('Reason (audited)', reason), button('Save price', { kind: 'primary', type: 'submit' }));
    }
    function gpcForm(fresh) {
      const out = h('div', {}); const q2 = input({ type: 'search', placeholder: 'Search official GS1 GPC bricks by title…' });
      const go = async () => {
        mount(out, spinner('Searching…'));
        try {
          const r = await getEnvelope('/gpc/search', { q: q2.value.trim() || 'a' });
          if (!r.active) { mount(out, h('div', { class: 'alert warn' }, 'No official GS1 GPC dataset has been imported yet, so products cannot be classified. An Owner imports the official file via POST /gpc/import (see docs/operations/GPC_IMPORT.md).')); return; }
          mount(out, r.data.length === 0 ? h('div', { class: 'muted' }, 'No bricks match.') : h('div', { class: 'list-rows' }, r.data.map((b) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'semibold' }, b.title), h('div', { class: 'muted mono' }, b.code)),
            button('Use', { class: '', onClick: async () => { try { await post(`/products/${p.id}/classify`, { brickCode: b.code }); toast('Classified', 'ok'); paint(); } catch (ex) { toast(ex.detail || 'Failed', 'bad'); } } })))));
        } catch (ex) { mount(out, h('div', { class: 'alert bad' }, ex.detail || ex.message)); }
      };
      return h('div', { class: 'card' }, h('h2', {}, 'Official classification (GS1 GPC)'), h('div', { class: 'row' }, q2, button('Search', { onClick: go })), out);
    }
    paint();
  }

  const root = h('div', {}, pageHead('Products', 'Catalogue, prices and classification', can('product.write') && button('Add product', { kind: 'primary', onClick: addProduct })), h('div', { class: 'toolbar' }, search), host);
  draw();
  return root;
}
