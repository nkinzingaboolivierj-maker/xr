import { get, getEnvelope, post, newOperationId, errorMessage, fetchBlobUrl } from '../api.js';
import { h, mount, clear, money, num, pageHead, input, field, select, button, modal, load, toast, debounce, spinner, emptyState, pill, statusPill, currencyCode } from '../dom.js';
import { state, can } from '../state.js';

// The server owns price validation, discounts, tax, stock allocation, COGS and
// payment status. Totals shown here are an ESTIMATE for the cashier; the sale
// result and receipt always show the server's figures.
export async function render({ navigate }) {
  const cart = []; // { product, qty, price(override|null), discount }
  const view = { method: 'Cash', cashReceived: '', reference: '', customerId: '', saleDiscount: { type: 'percent', value: '' }, intentId: null };
  let stock = new Map(); let taxRate = 0; let customers = []; let busy = false;
  let lastKey = null; let opId = null;

  const grid = h('div', { class: 'product-grid' });
  const gridState = h('div', {});
  const cartHost = h('div', { class: 'card cart' });
  const search = input({ type: 'search', placeholder: 'Scan barcode or search product…', 'aria-label': 'Scan barcode or search products', autofocus: true });

  async function refreshStock() { try { const env = await getEnvelope('/reports/inventory'); stock = new Map(env.data.map((r) => [r.productId || r.id, r.currentStock])); } catch { /* the server still enforces stock */ } }
  async function loadProducts(q = '') {
    mount(gridState, spinner('Loading products…')); clear(grid);
    try {
      const env = await getEnvelope('/products', { page: 1, pageSize: 60, q });
      mount(gridState, env.data.length === 0 ? emptyState(q ? 'No product matches' : 'No products yet', q ? 'Try the SKU or barcode.' : 'Add products and stock first.') : null);
      env.data.forEach((p) => grid.append(tile(p)));
    } catch (e) { mount(gridState, h('div', { class: 'alert bad', role: 'alert' }, errorMessage(e), ' ', button('Retry', { kind: 'small', onClick: () => loadProducts(q) }))); }
  }
  function tile(p) {
    const s = stock.get(p.id); const priced = !!p.pricing; const out = s !== undefined && s <= 0;
    return h('button', { type: 'button', class: 'product-tile', disabled: !priced || out, onClick: () => add(p), 'aria-label': `Add ${p.name}` },
      h('div', { class: 'name' }, p.name), h('div', { class: 'meta mono' }, p.sku),
      h('div', { class: 'row between' }, priced ? h('strong', { class: 'num' }, money(p.pricing.recommendedPrice)) : pill('No price', 'warn'), s === undefined ? null : out ? pill('Out', 'bad') : pill(`${num(s)} left`, s <= state.business.lowStockThreshold ? 'warn' : 'ok')));
  }
  function add(p) {
    const line = cart.find((l) => l.product.id === p.id);
    if (line) line.qty += 1; else cart.push({ product: p, qty: 1, price: null, discount: null });
    drawCart();
  }
  const onSearch = debounce(() => loadProducts(search.value.trim()), 300);
  search.addEventListener('input', onSearch);
  search.addEventListener('keydown', async (e) => { // hardware scanners type the code then press Enter
    if (e.key !== 'Enter' || !search.value.trim()) return;
    e.preventDefault();
    try { const p = await get('/products/lookup', { code: search.value.trim() }); if (p) { add(p); search.value = ''; loadProducts(''); } else toast('No product with that code', 'bad'); } catch (ex) { toast(errorMessage(ex), 'bad'); }
  });

  function estimate() {
    let gross = 0; let discount = 0;
    for (const l of cart) {
      const unit = l.price !== null ? l.price : (l.product.pricing ? l.product.pricing.recommendedPrice : 0);
      const lineGross = unit * l.qty; gross += lineGross;
      if (l.discount && l.discount.value) discount += l.discount.type === 'percent' ? lineGross * l.discount.value / 100 : Math.min(lineGross, l.discount.value);
    }
    const sd = view.saleDiscount.value ? Number(view.saleDiscount.value) : 0;
    const after = gross - discount;
    if (sd) discount += view.saleDiscount.type === 'percent' ? after * sd / 100 : Math.min(after, sd);
    const taxable = Math.max(0, gross - discount); const tax = Math.round(taxable * taxRate) / 100 * 1; const taxAmt = Math.round(taxable * taxRate / 100 * 100) / 100;
    return { gross, discount, taxable, tax: taxAmt, total: Math.round((taxable + taxAmt) * 100) / 100 };
  }

  function drawCart() {
    const est = estimate(); const canDiscount = can('sale.discount');
    const lines = cart.map((l, i) => {
      const qty = input({ type: 'number', min: 0, step: 'any', value: l.qty, 'aria-label': `Quantity of ${l.product.name}`, onChange: () => { const v = Number(qty.value); if (v > 0) l.qty = v; drawCart(); } });
      const price = input({ type: 'number', min: 0, step: 'any', value: l.price !== null ? l.price : (l.product.pricing ? l.product.pricing.recommendedPrice : ''), 'aria-label': `Unit price of ${l.product.name}`, onChange: () => { const v = Number(price.value); l.price = Number.isFinite(v) && price.value !== '' ? v : null; drawCart(); } });
      const pr = l.product.pricing;
      return h('div', { class: 'cart-line' }, h('div', { class: 'row between' }, h('div', { class: 'semibold' }, l.product.name), button('✕', { kind: 'ghost small', 'aria-label': `Remove ${l.product.name}`, onClick: () => { cart.splice(i, 1); drawCart(); } })),
        h('div', { class: 'row' }, h('div', { class: 'qty' }, button('−', { onClick: () => { l.qty = Math.max(1, l.qty - 1); drawCart(); }, 'aria-label': 'Decrease' }), qty, button('+', { onClick: () => { l.qty += 1; drawCart(); }, 'aria-label': 'Increase' })), h('div', { class: 'grow' }, price)),
        pr ? h('div', { class: 'muted' }, `Allowed ${money(pr.minPrice, false)}–${money(pr.maxPrice, false)} ${currencyCode()}`) : null,
        canDiscount ? h('div', { class: 'row' }, select([['', 'No discount'], ['percent', '% off'], ['amount', 'Amount off']], { value: l.discount ? l.discount.type : '', 'aria-label': 'Line discount type', onChange: (e) => { l.discount = e.target.value ? { type: e.target.value, value: l.discount ? l.discount.value : 0, reason: 'POS line discount' } : null; drawCart(); } }),
          l.discount ? input({ type: 'number', min: 0, step: 'any', value: l.discount.value || '', 'aria-label': 'Line discount value', onChange: (e) => { l.discount.value = Number(e.target.value) || 0; drawCart(); } }) : null) : null);
    });
    const methodBtns = ['Cash', 'MobileMoney', 'Card'].map((m) => h('button', { type: 'button', 'aria-pressed': String(view.method === m), onClick: () => { view.method = m; view.intentId = null; drawCart(); } }, m === 'MobileMoney' ? 'Mobile Money' : m));
    const cash = input({ type: 'number', min: 0, step: 'any', value: view.cashReceived, 'aria-label': 'Cash received', onInput: (e) => { view.cashReceived = e.target.value; updateChange(); } });
    const change = h('div', { class: 'muted', role: 'status' });
    function updateChange() { const c = Number(view.cashReceived) - est.total; mount(change, view.cashReceived === '' ? '' : c >= 0 ? `Change due: ${money(c)}` : `Short by ${money(-c)}`); }
    const ref = input({ placeholder: 'Mobile Money / card transaction ID', value: view.reference, 'aria-label': 'Payment reference', onInput: (e) => { view.reference = e.target.value; } });
    const custSel = select([['', 'Walk-in customer'], ...customers.map((c) => [c.id, `${c.name}${c.phone ? ' · ' + c.phone : ''}`])], { value: view.customerId, 'aria-label': 'Customer', onChange: (e) => { view.customerId = e.target.value; } });
    const sd = canDiscount ? h('div', { class: 'row' }, select([['percent', 'Sale discount %'], ['amount', 'Sale discount amount']], { value: view.saleDiscount.type, onChange: (e) => { view.saleDiscount.type = e.target.value; drawCart(); } }), input({ type: 'number', min: 0, step: 'any', value: view.saleDiscount.value, 'aria-label': 'Sale discount', onChange: (e) => { view.saleDiscount.value = e.target.value; drawCart(); } })) : null;
    const pay = view.method === 'Cash'
      ? h('div', {}, field('Cash received', cash), change)
      : h('div', {}, field('Payment reference', ref, { hint: view.intentId ? 'A provider-verified payment is attached; no reference needed.' : 'Enter the transaction ID from the confirmation message. Leave empty to record the sale as PENDING until confirmed.' }),
        can('payment.write') && !view.intentId ? button('Request provider payment (Airtel / MTN / Card)', { onClick: () => providerPayment(est.total) }) : null,
        view.intentId ? h('div', { class: 'alert ok' }, 'Provider payment attached ✓') : null);
    const checkout = button(busy ? 'Processing…' : `Charge ~${money(est.total)}`, { kind: 'primary block', disabled: busy || cart.length === 0, onClick: submit });
    mount(cartHost, h('h2', {}, 'Cart'), cart.length === 0 ? emptyState('Cart is empty', 'Tap a product or scan a barcode.') : lines, field('Customer', custSel), sd,
      h('div', { class: 'totals' }, h('div', { class: 'line muted' }, h('span', {}, 'Subtotal'), h('span', { class: 'num' }, money(est.gross))), est.discount ? h('div', { class: 'line muted' }, h('span', {}, 'Discount'), h('span', { class: 'num' }, `− ${money(est.discount)}`)) : null,
        taxRate ? h('div', { class: 'line muted' }, h('span', {}, `Tax ${taxRate}%`), h('span', { class: 'num' }, money(est.tax))) : null, h('div', { class: 'line grand' }, h('span', {}, 'Total (est.)'), h('span', { class: 'num' }, money(est.total))), h('div', { class: 'muted' }, 'The server recalculates prices, discounts and tax; the receipt shows the final amounts.')),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Payment method' }, methodBtns), pay, h('div', { class: 'login-gap' }), checkout);
    updateChange();
  }

  async function providerPayment(amount) {
    const net = select([['AIRTEL_MONEY', 'Airtel Money'], ['MTN_MOMO', 'MTN MoMo']]); const phone = input({ type: 'tel', placeholder: '07…' }); const out = h('div', { role: 'status' }); let intent = null; const key = newOperationId('pi');
    const isCard = view.method === 'Card';
    const startBtn = button('Send payment request', { kind: 'primary', onClick: async () => {
      try { intent = await post('/payment-intents', { method: view.method, network: isCard ? undefined : net.value, amount: Math.round(amount * 100) / 100, customerPhone: isCard ? undefined : phone.value.trim() || undefined, idempotencyKey: key }); paint(); }
      catch (e) { mount(out, h('div', { class: 'alert bad' }, e.status === 503 ? 'No payment provider is connected yet. Record the sale with the transaction ID from the customer’s confirmation message instead.' : errorMessage(e))); }
    } });
    const check = button('Check status', { onClick: async () => { try { intent = await get(`/payment-intents/${intent.id}`); paint(); } catch (e) { toast(errorMessage(e), 'bad'); } } });
    const useBtn = button('Use this payment', { kind: 'primary', onClick: () => { view.intentId = intent.id; m.close(); drawCart(); } });
    function paint() { mount(out, h('div', { class: 'row' }, 'Status: ', statusPill(intent.status)), intent.status === 'SUCCESS' ? h('div', { class: 'alert ok' }, 'Payment confirmed by the provider.') : h('div', { class: 'muted' }, 'Waiting for the customer to approve. Check again in a moment.')); mount(actions, intent.status === 'SUCCESS' ? useBtn : check); }
    const actions = h('span', {}, startBtn);
    const m = modal({ title: 'Provider payment', body: h('div', {}, h('p', {}, `Amount: ${money(amount)}`), isCard ? null : field('Network', net), isCard ? null : field('Customer phone', phone), out, h('div', { class: 'row' }, actions)) });
  }

  async function submit() {
    if (busy || cart.length === 0) return; busy = true; drawCart();
    const payload = { customerId: view.customerId || undefined, items: cart.map((l) => ({ productId: l.product.id, quantity: l.qty, ...(l.price !== null ? { unitPrice: l.price } : {}), ...(l.discount && l.discount.value ? { discount: l.discount } : {}) })), paymentMethod: view.method };
    if (view.method === 'Cash') payload.cashReceived = Number(view.cashReceived);
    if (view.method !== 'Cash' && view.intentId) payload.paymentIntentId = view.intentId;
    else if (view.method !== 'Cash' && view.reference.trim()) payload.paymentReference = view.reference.trim();
    if (can('sale.discount') && view.saleDiscount.value && Number(view.saleDiscount.value) > 0) payload.discount = { type: view.saleDiscount.type, value: Number(view.saleDiscount.value), reason: 'POS sale discount' };
    // Same cart + payment => same operationId, so retrying after a dropped connection can never create a second sale.
    const key = JSON.stringify(payload); if (key !== lastKey) { opId = newOperationId('sale'); lastKey = key; }
    try {
      const sale = await post('/sales', { operationId: opId, ...payload });
      cart.length = 0; Object.assign(view, { cashReceived: '', reference: '', intentId: null, saleDiscount: { type: 'percent', value: '' } }); lastKey = null; opId = null;
      toast('Sale completed', 'ok'); busy = false; drawCart(); await refreshStock(); loadProducts(search.value.trim());
      showReceipt(sale.id);
    } catch (e) { busy = false; drawCart(); toast(errorMessage(e), 'bad'); }
  }

  async function showReceipt(saleId) {
    const body = h('div', {}, spinner('Loading receipt…'));
    const m = modal({ title: 'Sale complete', body, actions: [button('New sale', { kind: 'primary', onClick: () => { m.close(); search.focus(); } })] });
    try {
      const r = await get(`/documents/receipt/${saleId}`);
      mount(body, h('dl', { class: 'kv' }, h('dt', {}, 'Receipt'), h('dd', { class: 'mono' }, r.receiptNumber), h('dt', {}, 'Total'), h('dd', { class: 'semibold' }, money(r.total)),
        r.discountAmount ? h('dt', {}, 'Discount') : null, r.discountAmount ? h('dd', {}, money(r.discountAmount)) : null, r.taxRate ? h('dt', {}, `Tax ${r.taxRate}%`) : null, r.taxRate ? h('dd', {}, money(r.taxAmount)) : null,
        h('dt', {}, 'Payment'), h('dd', {}, `${r.paymentMethod} `, statusPill(r.paymentStatus)), r.paymentMethod === 'Cash' ? h('dt', {}, 'Change') : null, r.paymentMethod === 'Cash' ? h('dd', { class: 'semibold' }, money(r.changeDue)) : null),
        h('div', { class: 'row' }, button('PDF receipt', { onClick: async () => { try { window.open(await fetchBlobUrl(`/documents/receipt/${saleId}/pdf`), '_blank', 'noopener'); } catch (e) { toast(errorMessage(e), 'bad'); } } }),
          button('Open sale', { onClick: () => { m.close(); navigate(`sales/${saleId}`); } })));
    } catch (e) { mount(body, h('div', { class: 'alert bad' }, errorMessage(e))); }
  }

  // Camera scanning where the browser supports BarcodeDetector; keyboard scanners work through the search box regardless.
  const scanBtn = ('BarcodeDetector' in window && navigator.mediaDevices) ? button('Scan with camera', { onClick: scan }) : null;
  async function scan() {
    const video = h('video', { autoplay: true, playsinline: true, muted: true, class: 'input' }); let stream; let stopped = false;
    const m = modal({ title: 'Scan barcode', body: video, onClose: () => { stopped = true; if (stream) stream.getTracks().forEach((t) => t.stop()); } });
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); video.srcObject = stream;
      const det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code'] });
      const tick = async () => { if (stopped) return; try { const codes = await det.detect(video); if (codes.length) { const p = await get('/products/lookup', { code: codes[0].rawValue }); if (p) { add(p); m.close(); return; } toast('Unknown code', 'bad'); } } catch { /* keep scanning */ } setTimeout(tick, 400); };
      tick();
    } catch { m.close(); toast('Camera unavailable. Use a barcode scanner or type the code.', 'bad'); }
  }

  const root = h('div', {}, pageHead('Point of sale', 'Prices, tax, stock and payment are validated by the server', scanBtn),
    h('div', { class: 'pos' }, h('div', {}, h('div', { class: 'toolbar' }, search), gridState, grid), cartHost));
  mount(cartHost, spinner());
  const [, tax, cs] = await Promise.all([refreshStock(), get('/tax-configurations').catch(() => []), can('customer.read') ? get('/customers').catch(() => []) : []]);
  const today = new Date().toISOString().slice(0, 10);
  const active = (tax || []).filter((t) => t.effectiveFrom <= today && (!t.effectiveTo || t.effectiveTo >= today)).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0];
  taxRate = active ? Number(active.ratePercent) : 0; customers = cs || [];
  await loadProducts(); drawCart();
  return root;
}
