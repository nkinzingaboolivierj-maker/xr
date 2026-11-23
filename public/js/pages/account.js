import { get, post, errorMessage } from '../api.js';
import { h, mount, dateTime, pageHead, input, field, button, table, pill, load, toast } from '../dom.js';
import { state } from '../state.js';

export async function render() {
  const err = h('div', { role: 'alert' });
  const cur = input({ type: 'password', autocomplete: 'current-password' }); const next = input({ type: 'password', autocomplete: 'new-password', minlength: 8 }); const again = input({ type: 'password', autocomplete: 'new-password' });
  const others = input({ type: 'checkbox', id: 'rev-others', checked: true });
  const form = h('form', { class: 'card', onSubmit: async (e) => {
    e.preventDefault(); mount(err);
    if (next.value !== again.value) { mount(err, h('div', { class: 'alert bad' }, 'The new passwords do not match.')); return; }
    try { const r = await post('/auth/change-password', { currentPassword: cur.value, newPassword: next.value, revokeOtherSessions: others.checked }); toast(r.otherSessionsRevoked ? 'Password changed; other devices were signed out' : 'Password changed', 'ok'); form.reset(); drawSessions(); }
    catch (ex) { mount(err, h('div', { class: 'alert bad' }, errorMessage(ex))); }
  } }, h('h2', {}, 'Change password'), err, field('Current password', cur), field('New password', next, { hint: 'At least 8 characters. Longer is better.' }), field('Repeat new password', again), h('div', { class: 'row' }, others, h('label', { for: 'rev-others' }, 'Sign out my other devices')), h('div', { class: 'login-gap' }), button('Change password', { kind: 'primary', type: 'submit' }));
  const sessionsHost = h('div', { class: 'card flush' });
  const drawSessions = () => load(sessionsHost, async () => { const rows = (await get('/auth/sessions')).filter((s) => !s.revoked && !s.expired);
    return h('div', {}, h('h2', { class: 'card-title' }, 'Where you are signed in'), table([{ label: 'Device', render: (s) => h('div', {}, (s.userAgent || 'Unknown device').slice(0, 60), s.current ? pill('This device', 'ok') : null) }, { label: 'IP', render: (s) => s.ipAddress || '—' }, { label: 'Last active', render: (s) => dateTime(s.lastSeenAt) }, { label: '', render: (s) => (s.current ? null : button('Sign out', { kind: 'small', onClick: async () => { try { await post(`/auth/sessions/${encodeURIComponent(s.id)}/revoke`); toast('Device signed out', 'ok'); drawSessions(); } catch (ex) { toast(errorMessage(ex), 'bad'); } } })) }], rows, { empty: 'No active sessions.', caption: 'Sessions' })); });
  drawSessions();
  return h('div', {}, pageHead('My account', `${state.user.email} · ${state.user.role}`), h('div', { class: 'grid two' }, form, sessionsHost));
}
