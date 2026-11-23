import { get, post } from '../api.js';
import { h, mount, money, dateOnly, pageHead, input, field, select, textarea, button, formModal, table, load, toast, todayIso, tabs, pill } from '../dom.js';
import { can } from '../state.js';
import { rangeFor, PERIODS } from '../util.js';

export async function render() {
  const host = h('div', {}); let period = 'month';
  const draw = () => load(host, async () => {
    const rows = await get('/expenses', rangeFor(period));
    const total = rows.reduce((s, r) => s + r.amount, 0);
    return h('div', {}, h('div', { class: 'grid stats' }, h('div', { class: 'card stat' }, h('div', { class: 'label' }, 'Total expenses'), h('div', { class: 'value' }, money(total)), h('div', { class: 'hint' }, `${rows.length} record(s)`))), h('div', { class: 'login-gap' }),
      h('div', { class: 'card flush' }, table([{ label: 'Date', render: (r) => dateOnly(r.expenseDate) }, { label: 'Category', render: (r) => pill(r.category) }, { label: 'Description', render: (r) => r.description || '—' }, { label: 'Paid by', render: (r) => r.paymentMethod || '—' }, { label: 'Amount', right: true, render: (r) => money(r.amount) }], rows, { empty: 'No expenses in this period.', caption: 'Expenses' })));
  });
  function add() { formModal({ title: 'Record expense', build: () => {
    const cat = input({ list: 'exp-cats', required: true, placeholder: 'Rent, Transport, Salaries…' }); const dl = h('datalist', { id: 'exp-cats' }, ['Rent', 'Utilities', 'Salaries', 'Transport', 'Marketing', 'Maintenance', 'Taxes & fees', 'Other'].map((c) => h('option', { value: c })));
    const amount = input({ type: 'number', min: 0, step: 'any', required: true }); const date = input({ type: 'date', value: todayIso() }); const desc = input({ placeholder: 'Optional' }); const pm = select([['Cash', 'Cash'], ['MobileMoney', 'Mobile Money'], ['Card', 'Card'], ['Bank', 'Bank transfer']]);
    return { fields: h('div', { class: 'form-grid' }, dl, field('Category', cat), field('Amount', amount), field('Date', date), field('Paid by', pm), field('Description', desc)),
      collect: () => { if (!cat.value.trim() || !(Number(amount.value) > 0)) throw new Error('Category and an amount above zero are required.'); return { category: cat.value.trim(), amount: Number(amount.value), expenseDate: date.value || undefined, description: desc.value.trim() || undefined, paymentMethod: pm.value }; } };
  }, submit: async (b) => { await post('/expenses', b); toast('Expense recorded', 'ok'); draw(); } }); }
  const root = h('div', {}, pageHead('Expenses', 'Operating costs that reduce net profit', can('expense.write') && button('Record expense', { kind: 'primary', onClick: add })), tabs(PERIODS, period, (p) => { period = p; draw(); }), host);
  draw(); return root;
}
