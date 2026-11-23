import { get, post, patch, errorMessage } from '../api.js';
import { h, mount, dateTime, pageHead, input, field, select, button, formModal, table, pill, statusPill, load, toast, setFormat, emptyState } from '../dom.js';
import { state, can } from '../state.js';

export async function render() {
  const host = h('div', {});
  const draw = async () => {
    const b = await get('/business'); state.business = { ...state.business, ...b }; setFormat({ currency: b.currency, timezone: b.timezone });
    const owner = can('business.profile.write');
    const edit = () => formModal({ title: 'Business profile', submitLabel: 'Save changes', build: () => {
      const name = input({ value: b.name }); const phone = input({ value: b.phone || '', type: 'tel' }); const address = input({ value: b.address || '' }); const taxId = input({ value: b.taxId || '' }); const low = input({ type: 'number', min: 0, value: b.lowStockThreshold }); const tz = input({ value: b.timezone }); const cur = input({ value: b.currency, maxlength: 3 });
      const verified = select([['false', 'Allow staff to confirm Mobile Money / card payments manually'], ['true', 'Require a provider-verified payment for non-cash sales']], { value: String(b.requireVerifiedPayments) });
      return { fields: h('div', { class: 'form-grid' }, field('Business name', name), field('Phone', phone, { hint: 'Printed on receipts.' }), field('Address', address), field('Tax ID (TIN)', taxId, { hint: 'Printed on receipts.' }), field('Low-stock threshold', low), field('Timezone', tz, { hint: 'IANA name, e.g. Africa/Kigali' }), field('Currency (ISO 4217)', cur, { hint: 'Cannot change once sales or purchases exist.' }), field('Non-cash payments', verified)),
        collect: () => ({ name: name.value.trim(), phone: phone.value.trim() || null, address: address.value.trim() || null, taxId: taxId.value.trim() || null, lowStockThreshold: Number(low.value), timezone: tz.value.trim(), currency: cur.value.trim().toUpperCase(), requireVerifiedPayments: verified.value === 'true' }) };
    }, submit: async (body) => { await patch('/business', body); toast('Saved', 'ok'); const me = await get('/me'); state.business = me.business; load(host, draw); } });
    return h('div', {}, pageHead('Business', 'Profile, tax and integrations', owner && button('Edit profile', { kind: 'primary', onClick: edit })),
      h('div', { class: 'grid two' },
        h('div', { class: 'card' }, h('h2', {}, 'Profile'), h('dl', { class: 'kv' }, h('dt', {}, 'Name'), h('dd', {}, b.name), h('dt', {}, 'Currency'), h('dd', {}, b.currency), h('dt', {}, 'Country'), h('dd', {}, b.country), h('dt', {}, 'Timezone'), h('dd', {}, b.timezone), h('dt', {}, 'Phone'), h('dd', {}, b.phone || '—'), h('dt', {}, 'Address'), h('dd', {}, b.address || '—'), h('dt', {}, 'Tax ID'), h('dd', {}, b.taxId || '—'), h('dt', {}, 'Low stock at'), h('dd', {}, `${b.lowStockThreshold} units`), h('dt', {}, 'Non-cash payments'), h('dd', {}, b.requireVerifiedPayments ? 'Provider-verified only' : 'Manual confirmation allowed'))),
        h('div', { class: 'card' }, h('h2', {}, 'Integrations'), h('dl', { class: 'kv' }, h('dt', {}, 'Payments'), h('dd', {}, pill(b.paymentProvider, b.paymentProvider === 'REAL' ? 'info' : 'warn'), ' ', h('span', { class: 'muted' }, b.paymentProvider === 'MOCK' ? 'Simulated: disabled in production until a real provider is connected.' : 'Real provider adapter (credentials required).')), h('dt', {}, 'WhatsApp'), h('dd', {}, pill(b.whatsappProvider, b.whatsappProvider === 'REAL' ? 'info' : 'warn'), ' ', h('span', { class: 'muted' }, b.whatsappProvider === 'MOCK' ? 'Simulated: no message is sent in production.' : 'Real provider (credentials required).')))),
        can('tax.read') ? taxCard() : null, can('sale.read') ? deliveryLog() : null));
  };
  function taxCard() {
    const box = h('div', { class: 'card' });
    const paint = () => load(box, async () => { const rows = await get('/tax-configurations');
      const add = () => formModal({ title: 'Add tax rate', build: () => { const name = input({ value: 'VAT' }); const rate = input({ type: 'number', min: 0, max: 100, step: 'any', required: true }); const from = input({ type: 'date', required: true });
        return { fields: h('div', { class: 'form-grid' }, field('Name', name), field('Rate %', rate), field('Effective from', from)), collect: () => { if (!from.value || rate.value === '') throw new Error('Rate and start date are required.'); return { name: name.value.trim() || 'VAT', ratePercent: Number(rate.value), effectiveFrom: from.value }; } }; }, submit: async (b) => { await post('/tax-configurations', b); toast('Tax rate added', 'ok'); paint(); } });
      return h('div', {}, h('div', { class: 'row between' }, h('h2', {}, 'Tax rates'), can('tax.write') && button('Add rate', { kind: 'small', onClick: add })), table([{ label: 'Name', key: 'name' }, { label: 'Rate', right: true, render: (t) => `${t.ratePercent}%` }, { label: 'From', render: (t) => t.effectiveFrom }, { label: 'To', render: (t) => t.effectiveTo || 'open' }], rows, { empty: 'No tax configured: sales are untaxed.', caption: 'Tax rates' }), h('div', { class: 'muted' }, 'Each sale keeps the rate that applied when it was made.')); });
    paint(); return box;
  }
  function deliveryLog() {
    const box = h('div', { class: 'card' });
    load(box, async () => { const rows = await get('/notifications');
      return h('div', {}, h('h2', {}, 'WhatsApp receipt deliveries'), table([{ label: 'Queued', render: (n) => dateTime(n.createdAt) }, { label: 'To', render: (n) => n.recipientPhone }, { label: 'Status', render: (n) => statusPill(n.status) }, { label: 'Attempts', right: true, render: (n) => n.attempts }, { label: 'Detail', render: (n) => (n.failureReason ? h('span', { class: 'muted' }, n.failureReason.slice(0, 80)) : '—') }], rows.slice(0, 10), { empty: 'No messages queued yet.', caption: 'Deliveries' })); });
    return box;
  }
  load(host, draw); return host;
}
