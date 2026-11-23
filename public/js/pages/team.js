import { get, post, patch } from '../api.js';
import { h, mount, dateTime, pageHead, input, field, select, button, formModal, table, pill, statusPill, load, toast, confirmDialog, nameAvatar } from '../dom.js';
import { state, can } from '../state.js';

const ROLES = ['Owner', 'Manager', 'Cashier', 'InventoryStaff'];
const ROLE_HELP = { Owner: 'Everything, including users and settings', Manager: 'Prices, purchasing, discounts, reports', Cashier: 'Runs the POS, takes payments, handles returns', InventoryStaff: 'Receives stock and does counts' };

export async function render() {
  const host = h('div', {});
  const draw = () => load(host, async () => {
    const rows = await get('/users'); const manage = can('user.write');
    return h('div', { class: 'card flush' }, table([
      { label: 'User', render: (u) => h('div', { class: 'row' }, nameAvatar(u.email, u.lastLoginAt ? `Last sign-in ${dateTime(u.lastLoginAt)}` : 'Never signed in'), u.id === state.user.id ? pill('You', 'info') : null) },
      { label: 'Role', render: (u) => pill(u.role) }, { label: 'Status', render: (u) => statusPill(u.status) }, { label: 'Password', render: (u) => (u.mustChangePassword ? pill('Temporary', 'warn') : '—') },
      manage && { label: '', render: (u) => (u.id === state.user.id ? null : h('div', { class: 'row' }, button('Edit', { kind: 'small', onClick: () => edit(u) }), button('Reset password', { kind: 'small', onClick: () => reset(u) }))) },
    ].filter(Boolean), rows, { caption: 'Team members' }));
  });
  function add() { formModal({ title: 'Add team member', submitLabel: 'Create user', build: () => {
    const email = input({ type: 'email', required: true }); const role = select(ROLES.map((r) => [r, r]), { value: 'Cashier' }); const pw = input({ type: 'text', required: true, minlength: 8, autocomplete: 'off' }); const help = h('div', { class: 'hint' }, ROLE_HELP.Cashier); role.addEventListener('change', () => mount(help, ROLE_HELP[role.value]));
    return { fields: h('div', {}, field('Email', email), h('div', { class: 'field' }, h('label', { for: 'role-sel' }, 'Role'), role, help), field('Temporary password', pw, { hint: 'Share it privately. They must change it at first sign-in.' })), collect: () => { if (!email.value.trim() || pw.value.length < 8) throw new Error('Enter an email and a temporary password of at least 8 characters.'); return { email: email.value.trim(), role: role.value, temporaryPassword: pw.value }; } };
  }, submit: async (b) => { await post('/users', b); toast('User created', 'ok'); draw(); } }); }
  function edit(u) { formModal({ title: `Edit ${u.email}`, build: () => { const role = select(ROLES.map((r) => [r, r]), { value: u.role }); const status = select([['active', 'Active'], ['inactive', 'Inactive (cannot sign in)']], { value: u.status });
    return { fields: h('div', {}, field('Role', role), field('Status', status), h('div', { class: 'hint' }, 'Changes end this person’s current sessions immediately.')), collect: () => ({ role: role.value, status: status.value }) }; }, submit: async (b) => { await patch(`/users/${u.id}`, b); toast('User updated', 'ok'); draw(); } }); }
  function reset(u) { formModal({ title: `Reset password for ${u.email}`, submitLabel: 'Reset password', build: () => { const pw = input({ type: 'text', required: true, minlength: 8, autocomplete: 'off' }); return { fields: field('New temporary password', pw, { hint: 'Their current sessions end now and they must choose a new password at next sign-in.' }), collect: () => { if (pw.value.length < 8) throw new Error('At least 8 characters.'); return { temporaryPassword: pw.value }; } }; }, submit: async (b) => { await post(`/users/${u.id}/reset-password`, b); toast('Password reset', 'ok'); draw(); } }); }
  const root = h('div', {}, pageHead('Team', 'Who can sign in and what they can do', can('user.write') && button('Add team member', { kind: 'primary', onClick: add })), host);
  draw(); return root;
}
