import { get, post } from '../api.js';
import { h, pageHead, input, field, select, button, formModal, table, load, toast, pill, debounce, nameAvatar } from '../dom.js';
import { can } from '../state.js';

export async function render() {
  const host = h('div', {}); let q = '';
  const search = input({ type: 'search', placeholder: 'Search customers…', 'aria-label': 'Search customers', onInput: debounce(() => { q = search.value.trim().toLowerCase(); draw(); }, 200) });
  let all = [];
  const draw = () => load(host, async () => {
    if (!all.length || !q) all = await get('/customers');
    const rows = all.filter((c) => !q || [c.name, c.phone, c.email].some((v) => v && v.toLowerCase().includes(q)));
    return h('div', { class: 'card flush' }, table([{ label: 'Customer', render: (c) => nameAvatar(c.name, c.phone || c.email) }, { label: 'Phone', render: (c) => c.phone || '—' }, { label: 'Email', render: (c) => c.email || '—' }, { label: 'Type', render: (c) => pill(c.type || 'walk-in') }], rows, { empty: q ? 'No customers match.' : 'No customers yet.', caption: 'Customers' }));
  });
  function add() { formModal({ title: 'Add customer', build: () => { const name = input({ required: true }); const phone = input({ type: 'tel', placeholder: '07…' }); const email = input({ type: 'email' }); return { fields: h('div', { class: 'form-grid' }, field('Name', name), field('Phone', phone, { hint: 'Used for WhatsApp receipts.' }), field('Email', email)), collect: () => { if (!name.value.trim()) throw new Error('Name is required.'); return { name: name.value.trim(), phone: phone.value.trim() || undefined, email: email.value.trim() || undefined }; } }; }, submit: async (b) => { await post('/customers', b); toast('Customer added', 'ok'); all = []; draw(); } }); }
  const root = h('div', {}, pageHead('Customers', null, can('customer.write') && button('Add customer', { kind: 'primary', onClick: add })), h('div', { class: 'toolbar' }, search), host);
  draw(); return root;
}
