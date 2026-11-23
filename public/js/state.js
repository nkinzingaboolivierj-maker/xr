// Who is signed in and what the server says they may do. The permission list
// only decides which controls to SHOW; every action is re-authorised by the
// server, so hiding a button is a convenience, never a control.
export const state = { user: null, business: null, permissions: new Set(), pendingReceipts: 0 };
export const can = (p) => state.permissions.has(p);
export const canAny = (...ps) => ps.some((p) => state.permissions.has(p));
export function setMe(me) {
  state.user = me.user; state.business = me.business; state.permissions = new Set(me.permissions || []);
}
