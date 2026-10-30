// Resolves the batch ON THE SERVER: the student flows always use the single active batch; admin pages validate the requested batch against the table.
let cache = null; const UUID = /^[0-9a-f-]{36}$/i;
export const bustBatchCache = () => { cache = null; };
export function batchTools(db, fail) {
  async function activeBatch(soft) {
    if (!cache || cache.exp < Date.now()) { const { data } = await db.from('batches').select('*').eq('status', 'active').limit(1).maybeSingle(); cache = { b: data, exp: Date.now() + 15000 }; }
    if (!cache.b && !soft) throw fail(409, 'Registrations are not open right now.');
    return cache.b;
  }
  async function resolveBatch(p) { // 'all' => null (combined, only when explicitly asked); missing => active batch; otherwise id or slug must exist
    if (p === 'all') return null;
    if (!p) { const b = await activeBatch(true); if (!b) throw fail(400, 'Select a batch'); return b; }
    p = String(p).slice(0, 80); const { data } = await db.from('batches').select('*').eq(UUID.test(p) ? 'id' : 'slug', p).maybeSingle();
    if (!data) throw fail(404, 'Batch not found'); return data;
  }
  return { activeBatch, resolveBatch };
}
