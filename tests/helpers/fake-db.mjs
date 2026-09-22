/**
 * Minimal in-memory stand-in for the supabase-js query builder used by the
 * Edge Functions: select/insert/upsert/update/delete with eq/neq/gt/gte/lt/lte/in,
 * order, limit, maybeSingle/single, count/head and rpc hooks.
 */
/** Column defaults of the real schema that the code relies on. */
const DEFAULTS = {
  saeed_ai_shopping: { done: false },
  saeed_ai_tasks: { done: false, priority: 2 },
  saeed_ai_reminders: { sent: false, canceled: false, status: 'pending', attempt_count: 0, repeat_rule: 'none' },
  saeed_ai_watchers: { active: true, recurring: false },
  saeed_ai_briefing_preferences: { enabled: false, send_hour: 7, timezone: 'Asia/Tehran', weekly_enabled: false, voice: false },
};

export function fakeDb(seed = {}, { rpc = {} } = {}) {
  const tables = new Map(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const ids = new Map();
  const log = [];
  const rows = (t) => {
    if (!tables.has(t)) tables.set(t, []);
    return tables.get(t);
  };
  const nextId = (t) => {
    const cur = ids.get(t) ?? Math.max(0, ...rows(t).map((r) => Number(r.id) || 0));
    ids.set(t, cur + 1);
    return cur + 1;
  };
  const cmp = (a, b) => (a === b ? 0 : a === null || a === undefined ? -1 : b === null || b === undefined ? 1 : a < b ? -1 : 1);

  class Query {
    constructor(table) {
      Object.assign(this, { table, op: 'select', filters: [], orders: [], max: Infinity, returning: false, countMode: null, head: false });
    }
    select(_cols, opts = {}) {
      if (this.op === 'select') {
        this.countMode = opts.count || null;
        this.head = !!opts.head;
      } else this.returning = true;
      return this;
    }
    insert(values) { this.op = 'insert'; this.values = [].concat(values); return this; }
    upsert(values, opts = {}) { this.op = 'upsert'; this.values = [].concat(values); this.opts = opts; return this; }
    update(patch) { this.op = 'update'; this.patch = patch; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(k, v) { this.filters.push((r) => r[k] === v || (r[k] != null && v != null && String(r[k]) === String(v) && typeof r[k] !== 'boolean')); return this; }
    neq(k, v) { this.filters.push((r) => r[k] !== v); return this; }
    gt(k, v) { this.filters.push((r) => r[k] != null && r[k] > v); return this; }
    gte(k, v) { this.filters.push((r) => r[k] != null && r[k] >= v); return this; }
    lt(k, v) { this.filters.push((r) => r[k] != null && r[k] < v); return this; }
    lte(k, v) { this.filters.push((r) => r[k] != null && r[k] <= v); return this; }
    in(k, vs) { this.filters.push((r) => vs.includes(r[k])); return this; }
    is(k, v) { this.filters.push((r) => (r[k] ?? null) === v); return this; }
    order(k, opts = {}) { this.orders.push([k, opts.ascending !== false]); return this; }
    limit(n) { this.max = n; return this; }
    maybeSingle() { this.single_ = 'maybe'; return this; }
    single() { this.single_ = 'one'; return this; }
    match(r) { return this.filters.every((f) => f(r)); }
    run() {
      const all = rows(this.table);
      let data = [];
      if (this.op === 'select') {
        data = all.filter((r) => this.match(r));
        for (const [k, asc] of [...this.orders].reverse()) data = [...data].sort((a, b) => (asc ? 1 : -1) * cmp(a[k], b[k]));
        const count = data.length;
        data = data.slice(0, this.max).map((r) => ({ ...r }));
        if (this.countMode) return { data: this.head ? null : data, count, error: null };
      } else if (this.op === 'insert') {
        data = this.values.map((v) => {
          const row = { id: v.id ?? nextId(this.table), created_at: new Date().toISOString(), ...DEFAULTS[this.table], ...v };
          all.push(row);
          return { ...row };
        });
      } else if (this.op === 'upsert') {
        const keys = String(this.opts?.onConflict || 'id').split(',').map((s) => s.trim());
        for (const v of this.values) {
          const hit = all.find((r) => keys.every((k) => v[k] !== undefined && v[k] !== null && r[k] === v[k]));
          if (hit) {
            if (!this.opts?.ignoreDuplicates) { Object.assign(hit, v); data.push({ ...hit }); }
          } else {
            const row = { id: v.id ?? nextId(this.table), created_at: new Date().toISOString(), ...DEFAULTS[this.table], ...v };
            all.push(row);
            data.push({ ...row });
          }
        }
      } else if (this.op === 'update') {
        for (const r of all) if (this.match(r)) { Object.assign(r, this.patch); data.push({ ...r }); }
      } else if (this.op === 'delete') {
        const keep = [];
        for (const r of all) (this.match(r) ? data : keep).push(r.id !== undefined ? { ...r } : r);
        tables.set(this.table, keep);
      }
      log.push({ table: this.table, op: this.op, patch: this.patch, values: this.values, rows: data.length });
      if (this.single_ === 'maybe') return { data: data[0] ?? null, error: null };
      if (this.single_ === 'one') return data.length ? { data: data[0], error: null } : { data: null, error: { code: 'PGRST116' } };
      return { data: this.op === 'select' || this.returning ? data : null, error: null };
    }
    then(res, rej) { return Promise.resolve().then(() => this.run()).then(res, rej); }
  }
  return {
    from: (t) => new Query(t),
    rpc: async (name, args) => (rpc[name] ? rpc[name](args, { rows }) : { data: null, error: { code: 'NO_RPC' } }),
    rows,
    log,
  };
}

/** Telegram/LifeContext recorder. */
export function fakeCtx(db, extra = {}) {
  const telegram = [], sent = [];
  return {
    telegram,
    sent,
    c: {
      db,
      tg: async (method, payload) => { telegram.push({ method, payload }); return { message_id: telegram.length }; },
      send: async (chat, text) => { sent.push({ chat, text }); },
      ...extra,
    },
  };
}
