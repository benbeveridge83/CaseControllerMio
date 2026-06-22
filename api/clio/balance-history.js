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

  const DAY = 24 * 60 * 60 * 1000;

  function asDate(day) {
    const d = new Date(day);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  function compareDays(a, b) {
    return new Date(a).getTime() - new Date(b).getTime();
  }

  function normalizeDay(value) {
    if (!value) return null;
    const s = String(value).slice(0, 10);
    return asDate(s) ? s : null;
  }

  function inRange(day) {
    const d = asDate(day);
    const from = fromDay ? asDate(fromDay) : null;
    const to = toDay ? asDate(toDay) : null;
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  }

  function numberOrNull(value) {
    if (value && typeof value === "object") {
      if ("amount" in value) value = value.amount;
      else if ("cents" in value) value = Number(value.cents) / 100;
      else if ("value" in value) value = value.value;
      else if ("balance" in value) value = value.balance;
      else if ("total" in value) value = value.total;
      else return null;
    }
    if (typeof value === "string") {
      const cleaned = value.replace(/[$,\s]/g, "").replace(/[()]/g, "");
      if (!cleaned || cleaned === "-") return null;
      const negative = /\(.*\)/.test(value) || /^-/.test(cleaned);
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

  function flattenNumbers(obj, path = "", out = []) {
    if (obj === null || obj === undefined) return out;
    const n = numberOrNull(obj);
    if (n !== null && typeof obj !== "object") {
      out.push({ path, value: n });
      return out;
    }
    if (Array.isArray(obj)) {
      obj.forEach((item, index) => flattenNumbers(item, `${path} ${index}`, out));
      return out;
    }
    if (typeof obj === "object") {
      const labels = [obj.name, obj.label, obj.type, obj.account_type, obj.category, obj.key, obj.description].filter(Boolean).join(" ");
      for (const [key, value] of Object.entries(obj)) flattenNumbers(value, `${path} ${key} ${labels}`, out);
    }
    return out;
  }

  function directFieldNumber(obj, names) {
    for (const name of names) {
      if (obj && Object.prototype.hasOwnProperty.call(obj, name)) {
        const n = numberOrNull(obj[name]);
        if (n !== null) return n;
      }
    }
    return null;
  }

  function txExplicitBalance(tx) {
    // Only use fields that mean balance-after/running/current balance. Never use amount, total, funds_in, or funds_out.
    const direct = directFieldNumber(tx, [
      "running_balance",
      "runningBalance",
      "RunningBalance",
      "current_account_balance",
      "currentAccountBalance",
      "CurrentAccountBalance",
      "account_balance",
      "accountBalance",
      "AccountBalance",
      "balance_after",
      "balanceAfter",
      "BalanceAfter",
      "ending_balance",
      "endingBalance",
      "current_balance",
      "currentBalance",
    ]);
    if (direct !== null) return direct;

    // Some Clio payloads nest custom balance fields. Search cautiously and exclude global bank account balances.
    const rows = flattenNumbers(tx);
    for (const row of rows) {
      const p = String(row.path || "").toLowerCase();
      if (/bank_account|bankaccount|account\s+id|funds_in|fundsin|funds_out|fundsout|amount|total|credit|debit/.test(p)) continue;
      if (/(running|current|ending|after).*balance|balance.*(running|current|ending|after)/.test(p)) return row.value;
    }
    return null;
  }

  function txFundsIn(tx) {
    return firstNumber(tx?.funds_in, tx?.fundsIn, tx?.FundsIn, tx?.funds_in_amount, tx?.credit, tx?.credit_amount, tx?.deposit, tx?.deposits);
  }

  function txFundsOut(tx) {
    return firstNumber(tx?.funds_out, tx?.fundsOut, tx?.FundsOut, tx?.funds_out_amount, tx?.debit, tx?.debit_amount, tx?.withdrawal, tx?.withdrawals);
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
      throw error;
    }
    return data;
  }

  async function fetchPaged(path, params = {}, options = {}) {
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
      if (options.maxRecords && all.length >= options.maxRecords) break;
    }
    return all;
  }

  async function fetchMatter(matterId) {
    const attempts = [
      "id,display_number,description,status,client{id,name},trust_balance,trust_account_balance,matter_trust_funds,funds_in_trust,work_in_progress,work_in_progress_balance,wip,unbilled_balance",
      "id,display_number,description,status,client{id,name},account_balances",
      "id,display_number,description,status,client{id,name}",
    ];
    let merged = null;
    for (const fields of attempts) {
      const url = new URL(`https://app.clio.com/api/v4/matters/${matterId}`);
      url.searchParams.set("fields", fields);
      try {
        const data = await clioFetch(url);
        merged = { ...(merged || {}), ...(data?.data || {}) };
      } catch {
        // Ignore rejected optional field requests.
      }
    }
    return merged || { id: matterId };
  }

  function matterTrust(matter) {
    // Use only exact matter-level fields. Do not scrape account_balances because it can be the whole firm trust account.
    return firstNumber(matter?.trust_balance, matter?.trust_account_balance, matter?.matter_trust_funds, matter?.funds_in_trust);
  }

  function matterWip(matter) {
    return firstNumber(matter?.work_in_progress, matter?.work_in_progress_balance, matter?.wip, matter?.unbilled_balance);
  }

  async function fetchTrustTransactions(matterId) {
    const attempts = [
      { fields: "id,date,funds_out,funds_in,running_balance,current_account_balance,account_balance,balance_after,ending_balance,current_balance,matter{id,display_number}" },
      { fields: "id,date,funds_out,funds_in,running_balance,current_account_balance,matter{id,display_number}" },
      { fields: "id,date,funds_out,funds_in,matter{id,display_number}" },
      { fields: "id,date,amount,matter{id,display_number}" },
      { fields: null },
    ];

    let txs = [];
    let usedFields = "";
    for (const attempt of attempts) {
      try {
        const params = { limit: 200, matter_id: matterId, type: "liability" };
        if (attempt.fields) params.fields = attempt.fields;
        txs = await fetchPaged("bank_transactions.json", params, { maxRecords: 500 });
        usedFields = attempt.fields || "default_fields";
        if (txs.length || !attempt.fields) break;
      } catch {
        txs = [];
      }
    }

    const rows = txs
      .map((tx) => {
        const date = normalizeDay(tx.date || tx.created_at || tx.updated_at);
        const explicit = txExplicitBalance(tx);
        const fundsIn = txFundsIn(tx);
        const fundsOut = txFundsOut(tx);
        const amount = firstNumber(tx?.amount);
        let delta = null;
        if (fundsIn !== null || fundsOut !== null) delta = Number(fundsIn || 0) - Number(fundsOut || 0);
        else if (amount !== null) delta = Number(amount || 0);
        return { id: tx.id, date, explicit, fundsIn, fundsOut, amount, delta, raw: tx };
      })
      .filter((row) => row.date)
      .sort((a, b) => compareDays(a.date, b.date));

    return { rows, usedFields, raw_count: txs.length };
  }

  function buildLedgerPoints(rows) {
    if (!rows.length) return [];

    const explicitRows = rows.filter((row) => row.explicit !== null);
    if (explicitRows.length) {
      let lastExplicit = null;
      const points = [];
      for (const row of rows) {
        if (row.explicit !== null) lastExplicit = Number(row.explicit);
        if (lastExplicit !== null) {
          points.push({ date: row.date, trust: lastExplicit, source: "clio_running_or_current_balance", transaction_id: row.id });
        }
      }
      return points;
    }

    // Fallback: current trust balance is simply the net of all trust movements for the matter.
    // This is not gross cumulative funds-in; it subtracts funds out and should match the transaction page running balance.
    let running = 0;
    const points = [];
    for (const row of rows) {
      if (row.delta === null) continue;
      running += Number(row.delta || 0);
      points.push({ date: row.date, trust: running, source: "net_trust_ledger_from_funds_in_minus_out", transaction_id: row.id });
    }
    return points;
  }

  function uniqueDateLast(points) {
    const map = new Map();
    for (const point of points || []) {
      if (point?.date) map.set(normalizeDay(point.date), { ...point, date: normalizeDay(point.date) });
    }
    return Array.from(map.values()).filter((p) => p.date).sort((a, b) => compareDays(a.date, b.date));
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
      out = [{ date: start || end, trust: Number(currentTrust || 0), source: "current_value_no_history" }];
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

  async function fetchCurrentWip(_matterId, matter) {
    return matterWip(matter) ?? 0;
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
    const matter = await fetchMatter(matterId);
    const [txPayload, wip] = await Promise.all([
      fetchTrustTransactions(matterId),
      fetchCurrentWip(matterId, matter),
    ]);

    let trustPoints = buildLedgerPoints(txPayload.rows);
    const directTrust = matterTrust(matter);
    let currentTrust = trustPoints.length ? Number(trustPoints[trustPoints.length - 1].trust || 0) : (directTrust ?? 0);

    // If Clio exposes the matter dashboard trust value and it differs from a net ledger only by pennies, use it at the end.
    if (directTrust !== null && Math.abs(Number(directTrust) - currentTrust) < 0.02) currentTrust = Number(directTrust);

    const ranged = ensureRange(trustPoints, currentTrust);
    const minimum = Number(minimumBalances[String(matterId)] ?? 2000) || 2000;
    const points = requestedType === "wip"
      ? ensureRange([], currentTrust).map((p) => ({ date: p.date, balance: Number(wip || 0), source: "current_wip_flat_line" }))
      : ranged.map((p) => ({ date: p.date, balance: valueForType(requestedType, p.trust, wip, minimum), source: p.source, transaction_id: p.transaction_id }));

    return {
      matter_id: String(matterId),
      display_number: matter?.display_number || `Matter ${matterId}`,
      description: matter?.description || "",
      client_name: matter?.client?.name || "",
      account_type: requestedType,
      current_trust_balance: Number(currentTrust || 0),
      current_work_in_progress: Number(wip || 0),
      minimum_balance: minimum,
      points,
      debug: {
        transaction_count: txPayload.rows.length,
        used_fields: txPayload.usedFields,
        raw_count: txPayload.raw_count,
        first_point: trustPoints[0] || null,
        last_point: trustPoints[trustPoints.length - 1] || null,
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
      meta: { requested: matterIds.length, returned: series.length, failed, from: fromDay, to: toDay, version: "v20", mode: "net_trust_ledger_or_explicit_running_balance_no_gross_deposits" },
    });
  } catch (error) {
    return res.status(error.status || 500).json(error.payload || { error: error.message || String(error) });
  }
}
