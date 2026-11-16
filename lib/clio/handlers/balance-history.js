export default async function handler(req, res) {
  const cookieHeader = req.headers.cookie || "";
  const tokenCookie = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("clio_access_token="));

  if (!tokenCookie) return res.status(401).json({ error: "Not authenticated" });

  const token = tokenCookie.split("=")[1];
  const matterIds = String(req.query.matter_ids || "").split(",").map((id) => id.trim()).filter(Boolean);
  if (!matterIds.length) return res.status(400).json({ error: "No matter_ids provided" });

  const requestedType = String(req.query.account_type || "trust").toLowerCase();
  const fromDay = req.query.from ? String(req.query.from).slice(0, 10) : null;
  const toDay = req.query.to ? String(req.query.to).slice(0, 10) : new Date().toISOString().slice(0, 10);

  let minimumBalances = {};
  try { minimumBalances = JSON.parse(String(req.query.minimum_balances || "{}")) || {}; } catch { minimumBalances = {}; }

  function normalizeDay(value) {
    if (!value) return null;
    const s = String(value).slice(0, 10);
    const d = new Date(`${s}T00:00:00Z`);
    return Number.isFinite(d.getTime()) ? s : null;
  }
  function dayMs(day) { return new Date(`${day}T00:00:00Z`).getTime(); }
  function compareDays(a, b) { return dayMs(a) - dayMs(b); }
  function inRange(day) {
    if (!day) return false;
    if (fromDay && compareDays(day, fromDay) < 0) return false;
    if (toDay && compareDays(day, toDay) > 0) return false;
    return true;
  }
  function numberOrNull(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "string" && value.trim() === "") return null;
    if (value && typeof value === "object") {
      if ("amount" in value) value = value.amount;
      else if ("cents" in value) value = Number(value.cents) / 100;
      else if ("value" in value) value = value.value;
      else return null;
    }
    if (typeof value === "string") {
      const negative = /^\s*\(.*\)\s*$/.test(value) || /^\s*-/.test(value);
      const cleaned = value.replace(/[$,\s()]/g, "");
      if (!cleaned || cleaned === "-") return null;
      value = negative && !cleaned.startsWith("-") ? `-${cleaned}` : cleaned;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  function firstNumber(...values) { for (const v of values) { const n = numberOrNull(v); if (n !== null) return n; } return null; }
  function txFundsIn(tx) { return firstNumber(tx?.funds_in, tx?.fundsIn, tx?.credit, tx?.credit_amount, tx?.deposit, tx?.deposit_amount); }
  function txFundsOut(tx) { return firstNumber(tx?.funds_out, tx?.fundsOut, tx?.debit, tx?.debit_amount, tx?.withdrawal, tx?.withdrawal_amount); }
  function txExplicitBalance(tx) { return firstNumber(tx?.running_balance, tx?.runningBalance, tx?.current_account_balance, tx?.currentAccountBalance); }

  async function clioFetch(url) {
    const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data?.error?.message || data?.message || data?.error || `Clio request failed with ${response.status}`);
      error.status = response.status; error.payload = data; error.url = url.toString(); throw error;
    }
    return data;
  }
  async function fetchPaged(path, params = {}, maxRecords = 1000) {
    let url = new URL(`https://app.clio.com/api/v4/${path}`);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    const all = [];
    while (url) {
      const data = await clioFetch(url);
      all.push(...(Array.isArray(data.data) ? data.data : []));
      const next = data?.meta?.paging?.next;
      url = next ? new URL(next) : null;
      if (all.length >= maxRecords) break;
    }
    return all;
  }
  async function fetchMatterBasic(matterId) {
    const url = new URL(`https://app.clio.com/api/v4/matters/${matterId}`);
    url.searchParams.set("fields", "id,display_number,description,status,client{id,name}");
    try { const data = await clioFetch(url); return data?.data || { id: matterId }; }
    catch { return { id: matterId }; }
  }
  async function fetchTrustRows(matterId) {
    const attempts = [
      "id,date,funds_out,funds_in,running_balance,current_account_balance,matter{id,display_number}",
      "id,date,funds_out,funds_in,matter{id,display_number}",
    ];
    let txs = [], usedFields = "", errors = [];
    for (const fields of attempts) {
      try {
        txs = await fetchPaged("bank_transactions.json", { limit: 200, matter_id: matterId, type: "liability", fields });
        usedFields = fields;
        if (txs.length) break;
      } catch (e) { errors.push({ fields, status: e.status || null, message: e.message || String(e) }); txs = []; }
    }
    const rows = txs.map((tx) => ({
      id: tx.id,
      date: normalizeDay(tx.date || tx.created_at || tx.updated_at),
      explicit: txExplicitBalance(tx),
      fundsIn: Number(txFundsIn(tx) || 0),
      fundsOut: Number(txFundsOut(tx) || 0),
    })).filter((r) => r.date).sort((a,b) => compareDays(a.date,b.date) || String(a.id).localeCompare(String(b.id)));
    return { rows, usedFields, rawCount: txs.length, errors };
  }
  function buildLedgerPoints(rows) {
    let grossIn = 0, grossOut = 0;
    const points = [];
    for (const row of rows || []) {
      grossIn += Number(row.fundsIn || 0);
      grossOut += Number(row.fundsOut || 0);
      let trust;
      if (row.explicit !== null && row.explicit !== undefined) trust = Number(row.explicit || 0);
      else trust = grossIn - (2 * grossOut);
      points.push({
        date: row.date,
        trust: Number(trust || 0),
        source: row.explicit !== null && row.explicit !== undefined ? "clio_explicit_running_balance" : "gross_funds_in_minus_two_times_funds_out",
        transaction_id: row.id,
        gross_funds_in: grossIn,
        gross_funds_out: grossOut,
        funds_in: row.fundsIn,
        funds_out: row.fundsOut,
      });
    }
    return points;
  }
  function uniqueDateLast(points) {
    const map = new Map();
    for (const p of points || []) { const d = normalizeDay(p.date); if (d) map.set(d, { ...p, date: d }); }
    return Array.from(map.values()).sort((a,b) => compareDays(a.date,b.date));
  }
  function ensureRange(points, currentTrust) {
    const sorted = uniqueDateLast(points);
    const start = fromDay || sorted[0]?.date || toDay;
    const end = toDay || sorted[sorted.length - 1]?.date || start;
    let out = [], lastBefore = null;
    for (const p of sorted) {
      if (start && compareDays(p.date, start) < 0) lastBefore = p;
      if (!start || !end || inRange(p.date)) out.push(p);
    }
    if (!out.length) out = [{ date: start || end, trust: Number(currentTrust || 0), source: "current_value_no_transaction_in_range" }];
    else if (start && !out.some((p) => p.date === start)) { const seed = lastBefore || out[0]; out.unshift({ ...seed, date: start, source: `${seed.source}_carried_to_start` }); }
    if (end && !out.some((p) => p.date === end)) { const last = out[out.length - 1]; out.push({ ...last, date: end, source: `${last.source}_carried_to_end` }); }
    return uniqueDateLast(out);
  }
  function valueForType(type, trust, wip, minimum) {
    const t = Number(trust || 0), w = Number(wip || 0), m = Number(minimum || 2000);
    if (type === "wip") return w;
    if (type === "trust_minus_minimum") return t - m;
    if (type === "trust_minus_wip") return t - w;
    if (type === "trust_minus_wip_minus_minimum") return t - w - m;
    return t;
  }
  async function buildSeries(matterId) {
    const [matter, txPayload] = await Promise.all([fetchMatterBasic(matterId), fetchTrustRows(matterId)]);
    const ledgerPoints = buildLedgerPoints(txPayload.rows);
    const currentTrust = ledgerPoints.length ? Number(ledgerPoints[ledgerPoints.length - 1].trust || 0) : 0;
    const minimum = Number(minimumBalances[String(matterId)] ?? 2000) || 2000;
    const wip = 0;
    const ranged = ensureRange(ledgerPoints, currentTrust);
    const points = requestedType === "wip"
      ? ensureRange([], currentTrust).map((p) => ({ date: p.date, balance: wip, source: "wip_not_available_from_balance_history" }))
      : ranged.map((p) => ({ date: p.date, balance: valueForType(requestedType, p.trust, wip, minimum), source: p.source, transaction_id: p.transaction_id }));
    return { matter_id: String(matterId), display_number: matter?.display_number || `Matter ${matterId}`, description: matter?.description || "", client_name: matter?.client?.name || "", account_type: requestedType, current_trust_balance: currentTrust, current_work_in_progress: wip, minimum_balance: minimum, points, debug: { transaction_count: txPayload.rows.length, raw_count: txPayload.rawCount, used_fields: txPayload.usedFields, first_ledger_point: ledgerPoints[0] || null, last_ledger_point: ledgerPoints[ledgerPoints.length - 1] || null, errors: txPayload.errors } };
  }
  async function mapWithConcurrency(items, limit, mapper) {
    const results = []; let index = 0;
    async function worker() { while (index < items.length) { const i = index++; try { results[i] = { status: "fulfilled", value: await mapper(items[i]) }; } catch (e) { results[i] = { status: "rejected", reason: e }; } } }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
  }
  try {
    const settled = await mapWithConcurrency(matterIds, 2, buildSeries);
    const series = settled.filter((r) => r.status === "fulfilled" && r.value).map((r) => r.value);
    const failed = settled.filter((r) => r.status === "rejected").length;
    return res.status(200).json({ series, meta: { requested: matterIds.length, returned: series.length, failed, from: fromDay, to: toDay, version: "v26", mode: "gross_funds_in_minus_2x_funds_out_current_trust" } });
  } catch (error) { return res.status(error.status || 500).json(error.payload || { error: error.message || String(error) }); }
}
