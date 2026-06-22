export default async function handler(req, res) {
  const cookieHeader = req.headers.cookie || "";
  const tokenCookie = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("clio_access_token="));

  if (!tokenCookie) return res.status(401).json({ error: "Not authenticated" });

  const token = tokenCookie.split("=")[1];
  const matterIds = String(req.query.matter_ids || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

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
      else if ("balance" in value) value = value.balance;
      else if ("total" in value) value = value.total;
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

  function firstNumber(...values) {
    for (const value of values) {
      const n = numberOrNull(value);
      if (n !== null) return n;
    }
    return null;
  }

  function txFundsIn(tx) {
    return firstNumber(tx?.funds_in, tx?.fundsIn, tx?.FundsIn, tx?.credit, tx?.credit_amount, tx?.deposit, tx?.deposit_amount);
  }
  function txFundsOut(tx) {
    return firstNumber(tx?.funds_out, tx?.fundsOut, tx?.FundsOut, tx?.debit, tx?.debit_amount, tx?.withdrawal, tx?.withdrawal_amount);
  }
  function txExplicitBalance(tx) {
    return firstNumber(
      tx?.running_balance,
      tx?.runningBalance,
      tx?.current_account_balance,
      tx?.currentAccountBalance
    );
  }

  async function clioFetch(url) {
    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data?.error?.message || data?.message || data?.error || `Clio request failed with ${response.status}`);
      error.status = response.status;
      error.payload = data;
      error.url = url.toString();
      throw error;
    }
    return data;
  }

  async function fetchPaged(path, params = {}, maxRecords = 1000) {
    let url = new URL(`https://app.clio.com/api/v4/${path}`);
    for (const [key, value] of Object.entries(params || {})) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
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
    // Only ask for fields the debug output proved are valid. Invalid financial fields make Clio reject the whole request.
    url.searchParams.set("fields", "id,display_number,description,status,client{id,name}");
    try {
      const data = await clioFetch(url);
      return data?.data || { id: matterId };
    } catch {
      return { id: matterId };
    }
  }

  async function fetchTrustTransactions(matterId) {
    // v23: never refetch default fields after a successful fielded request; null balance fields are not zero. Default rows may contain only id/etag.
    const attempts = [
      "id,date,funds_out,funds_in,running_balance,current_account_balance,matter{id,display_number}",
      "id,date,funds_out,funds_in,matter{id,display_number}",
      "id,date,amount,matter{id,display_number}",
    ];

    let txs = [];
    let usedFields = "";
    let errors = [];

    for (const fields of attempts) {
      try {
        txs = await fetchPaged("bank_transactions.json", { limit: 200, matter_id: matterId, type: "liability", fields });
        usedFields = fields;
        if (txs.length) break;
      } catch (error) {
        errors.push({ fields, status: error.status || null, message: error.message || String(error) });
        txs = [];
      }
    }

    const rows = txs
      .map((tx) => {
        const date = normalizeDay(tx.date || tx.created_at || tx.updated_at);
        const fundsIn = txFundsIn(tx);
        const fundsOut = txFundsOut(tx);
        const amount = firstNumber(tx?.amount);
        const explicit = txExplicitBalance(tx);
        let delta = null;
        if (fundsIn !== null || fundsOut !== null) delta = Number(fundsIn || 0) - Number(fundsOut || 0);
        else if (amount !== null) delta = Number(amount || 0);
        return { id: tx.id, date, explicit, fundsIn, fundsOut, amount, delta };
      })
      .filter((row) => row.date)
      .sort((a, b) => compareDays(a.date, b.date) || String(a.id).localeCompare(String(b.id)));

    return { rows, usedFields, rawCount: txs.length, errors };
  }

  function buildLedgerPoints(rows) {
    let running = null;
    const points = [];

    for (const row of rows) {
      if (row.explicit !== null) {
        running = Number(row.explicit);
      } else {
        if (running === null) running = 0;
        if (row.delta !== null) running += Number(row.delta || 0);
        else continue;
      }
      points.push({
        date: row.date,
        trust: Number(running || 0),
        source: row.explicit !== null ? "clio_explicit_running_balance" : "net_funds_in_minus_out",
        transaction_id: row.id,
        funds_in: row.fundsIn,
        funds_out: row.fundsOut,
      });
    }
    return points;
  }

  function uniqueDateLast(points) {
    const map = new Map();
    for (const point of points || []) {
      const date = normalizeDay(point.date);
      if (date) map.set(date, { ...point, date });
    }
    return Array.from(map.values()).sort((a, b) => compareDays(a.date, b.date));
  }

  function ensureRange(points, currentTrust) {
    const sorted = uniqueDateLast(points);
    const start = fromDay || sorted[0]?.date || toDay;
    const end = toDay || sorted[sorted.length - 1]?.date || start;

    let out = [];
    let lastBefore = null;
    for (const point of sorted) {
      if (start && compareDays(point.date, start) < 0) lastBefore = point;
      if (!start || !end || inRange(point.date)) out.push(point);
    }

    if (!out.length) {
      out = [{ date: start || end, trust: Number(currentTrust || 0), source: "current_value_no_transaction_in_range" }];
    } else if (start && !out.some((p) => p.date === start)) {
      const seed = lastBefore || out[0];
      out.unshift({ ...seed, date: start, source: `${seed.source}_carried_to_start` });
    }

    if (end && !out.some((p) => p.date === end)) {
      const last = out[out.length - 1];
      out.push({ ...last, date: end, source: `${last.source}_carried_to_end` });
    }
    return uniqueDateLast(out);
  }

  function valueForType(type, trust, wip, minimum) {
    const t = Number(trust || 0);
    const w = Number(wip || 0);
    const m = Number(minimum || 2000);
    if (type === "wip") return w;
    if (type === "trust_minus_minimum") return t - m;
    if (type === "trust_minus_wip") return t - w;
    if (type === "trust_minus_wip_minus_minimum") return t - w - m;
    return t;
  }

  async function buildSeries(matterId) {
    const [matter, txPayload] = await Promise.all([
      fetchMatterBasic(matterId),
      fetchTrustTransactions(matterId),
    ]);

    const ledgerPoints = buildLedgerPoints(txPayload.rows);
    const currentTrust = ledgerPoints.length ? Number(ledgerPoints[ledgerPoints.length - 1].trust || 0) : 0;
    const minimum = Number(minimumBalances[String(matterId)] ?? 2000) || 2000;
    const wip = 0; // WIP requires a different source/report and is not used to compute current trust.
    const ranged = ensureRange(ledgerPoints, currentTrust);
    const points = requestedType === "wip"
      ? ensureRange([], currentTrust).map((p) => ({ date: p.date, balance: wip, source: "wip_not_available_from_balance_history" }))
      : ranged.map((p) => ({ date: p.date, balance: valueForType(requestedType, p.trust, wip, minimum), source: p.source, transaction_id: p.transaction_id }));

    return {
      matter_id: String(matterId),
      display_number: matter?.display_number || `Matter ${matterId}`,
      description: matter?.description || "",
      client_name: matter?.client?.name || "",
      account_type: requestedType,
      current_trust_balance: currentTrust,
      current_work_in_progress: wip,
      minimum_balance: minimum,
      points,
      debug: {
        transaction_count: txPayload.rows.length,
        raw_count: txPayload.rawCount,
        used_fields: txPayload.usedFields,
        first_ledger_point: ledgerPoints[0] || null,
        last_ledger_point: ledgerPoints[ledgerPoints.length - 1] || null,
        errors: txPayload.errors,
      },
    };
  }

  async function mapWithConcurrency(items, limit, mapper) {
    const results = [];
    let index = 0;
    async function worker() {
      while (index < items.length) {
        const currentIndex = index++;
        try { results[currentIndex] = { status: "fulfilled", value: await mapper(items[currentIndex]) }; }
        catch (error) { results[currentIndex] = { status: "rejected", reason: error }; }
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
  }

  try {
    const settled = await mapWithConcurrency(matterIds, 3, buildSeries);
    const series = settled.filter((r) => r.status === "fulfilled" && r.value).map((r) => r.value);
    const failed = settled.filter((r) => r.status === "rejected").length;
    return res.status(200).json({
      series,
      meta: { requested: matterIds.length, returned: series.length, failed, from: fromDay, to: toDay, version: "v23", mode: "v23_net_funds_in_minus_funds_out_null_safe" },
    });
  } catch (error) {
    return res.status(error.status || 500).json(error.payload || { error: error.message || String(error) });
  }
}
