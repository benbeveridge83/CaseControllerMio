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

  function asDate(day) {
    const d = new Date(day);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  function compareDays(a, b) { return new Date(a) - new Date(b); }

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
      const cleaned = value.replace(/[$,\s]/g, "");
      if (!cleaned) return null;
      value = cleaned;
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

  function amountField(obj, snake, camel) {
    return firstNumber(obj?.[snake], obj?.[camel], obj?.[snake?.replace(/_/g, "")]);
  }

  function txFundsIn(tx) {
    return firstNumber(tx?.funds_in, tx?.fundsIn, tx?.FundsIn, tx?.funds_in_amount, tx?.credit, tx?.credit_amount);
  }

  function txFundsOut(tx) {
    return firstNumber(tx?.funds_out, tx?.fundsOut, tx?.FundsOut, tx?.funds_out_amount, tx?.debit, tx?.debit_amount);
  }

  function txExplicitBalance(tx) {
    return firstNumber(
      tx?.running_balance,
      tx?.runningBalance,
      tx?.RunningBalance,
      tx?.current_account_balance,
      tx?.currentAccountBalance,
      tx?.CurrentAccountBalance,
      tx?.account_balance,
      tx?.accountBalance,
      tx?.AccountBalance,
      tx?.balance_after,
      tx?.balanceAfter,
      tx?.BalanceAfter,
      tx?.balance,
      tx?.Balance
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
      throw error;
    }
    return data;
  }

  async function fetchPaged(path, params, fallbackPaths = []) {
    const paths = [path, ...fallbackPaths];
    let lastError = null;
    for (const p of paths) {
      try {
        let url = new URL(`https://app.clio.com/api/v4/${p}`);
        for (const [key, value] of Object.entries(params || {})) {
          if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
        }
        const all = [];
        while (url) {
          const data = await clioFetch(url);
          all.push(...(Array.isArray(data.data) ? data.data : []));
          const next = data?.meta?.paging?.next;
          url = next ? new URL(next) : null;
        }
        return all;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error(`Could not fetch ${path}`);
  }

  async function fetchMatter(matterId) {
    const fieldSets = [
      "id,display_number,description,status,client{id,name},account_balances",
      "id,display_number,description,status,client{id,name},trust_balance,trust_account_balance,matter_trust_funds,funds_in_trust",
      "id,display_number,description,status,client{id,name},work_in_progress,work_in_progress_balance,wip,unbilled_balance",
      "id,display_number,description,status,client{id,name}",
    ];
    let merged = null;
    for (const fields of fieldSets) {
      const url = new URL(`https://app.clio.com/api/v4/matters/${matterId}`);
      url.searchParams.set("fields", fields);
      try {
        const data = await clioFetch(url);
        merged = { ...(merged || {}), ...(data?.data || {}) };
      } catch {}
    }
    return merged || { id: matterId };
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

  function numericByKeyword(obj, positiveRegex, negativeRegex = null) {
    for (const row of flattenNumbers(obj)) {
      const p = String(row.path || "").toLowerCase();
      if (positiveRegex.test(p) && !(negativeRegex && negativeRegex.test(p))) return row.value;
    }
    return null;
  }

  function matterTrust(matter) {
    const value = firstNumber(
      matter?.trust_balance,
      matter?.trust_account_balance,
      matter?.matter_trust_funds,
      matter?.funds_in_trust,
      numericByKeyword(matter?.account_balances, /(trust|liability|client)/i, /(work|progress|wip|unbilled|receivable|outstanding)/i)
    );
    // Treat a missing/blank/zero matter value as unknown so it does not override real transaction data.
    return value && Math.abs(value) > 0.00001 ? value : null;
  }

  function matterWip(matter) {
    return firstNumber(
      matter?.work_in_progress,
      matter?.work_in_progress_balance,
      matter?.wip,
      matter?.unbilled_balance,
      numericByKeyword(matter?.account_balances, /(work|progress|wip|unbilled)/i)
    );
  }

  async function fetchTrustTransactions(matterId) {
    const fieldAttempts = [
      // These are the real target fields. Do not use gross amount as a balance.
      "id,date,funds_out,funds_in,current_account_balance,running_balance,account_balance,balance_after,balance,matter{id,display_number}",
      "id,date,funds_out,funds_in,current_account_balance,running_balance,matter{id,display_number}",
      "id,date,funds_out,funds_in,current_account_balance",
      "id,date,funds_out,funds_in",
      "id,date,amount,current_account_balance,running_balance",
      "id,date,amount",
    ];

    let txs = [];
    let usedFields = "";
    for (const fields of fieldAttempts) {
      try {
        txs = await fetchPaged("bank_transactions.json", { limit: 200, matter_id: matterId, type: "liability", fields }, ["bank_transactions"]);
        usedFields = fields;
        if (txs.length || fields === fieldAttempts[fieldAttempts.length - 1]) break;
      } catch {
        txs = [];
      }
    }

    const rows = txs
      .map((tx) => {
        const date = tx.date ? String(tx.date).slice(0, 10) : null;
        const explicit = txExplicitBalance(tx);
        const fundsIn = txFundsIn(tx);
        const fundsOut = txFundsOut(tx);
        const hasDelta = fundsIn !== null || fundsOut !== null;
        const delta = hasDelta ? (Number(fundsIn || 0) - Number(fundsOut || 0)) : null;
        return { id: tx.id, date, explicit, fundsIn, fundsOut, delta, raw: tx };
      })
      .filter((row) => row.date)
      .sort((a, b) => compareDays(a.date, b.date));

    return { rows, usedFields };
  }

  async function fetchCurrentWip(matterId, matter) {
    const direct = matterWip(matter);
    if (direct !== null) return direct;
    return 0;
  }

  function buildTrustPointsFromTransactions(rows, currentTrust) {
    if (!rows.length) return [];

    const explicitRows = rows.filter((row) => row.explicit !== null);
    if (explicitRows.length) {
      return rows.map((row) => {
        if (row.explicit !== null) return { date: row.date, trust: Number(row.explicit), source: "clio_explicit_running_balance", transaction_id: row.id };
        return null;
      }).filter(Boolean);
    }

    const deltaRows = rows.filter((row) => row.delta !== null);
    if (!deltaRows.length) return [];

    const totalDelta = deltaRows.reduce((sum, row) => sum + Number(row.delta || 0), 0);
    // Anchor to current Clio trust when available. This avoids the old bug where deposits were
    // graphed as cumulative gross trust. If currentTrust is unavailable, this is still a net ledger,
    // not gross funds-in.
    let running = currentTrust !== null ? Number(currentTrust) - totalDelta : 0;
    const points = [];
    for (const row of rows) {
      if (row.delta === null) continue;
      running += Number(row.delta || 0);
      points.push({ date: row.date, trust: Number(running || 0), source: currentTrust !== null ? "net_transactions_anchored_to_current_trust" : "net_transactions_unanchored", transaction_id: row.id });
    }
    return points;
  }

  function uniqueDateLast(points) {
    const map = new Map();
    for (const point of points || []) {
      if (point?.date) map.set(String(point.date).slice(0, 10), { ...point, date: String(point.date).slice(0, 10) });
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

    const explicitLast = txPayload.rows.filter((row) => row.explicit !== null).at(-1)?.explicit ?? null;
    const directTrust = matterTrust(matter);
    let currentTrust = directTrust !== null ? directTrust : (explicitLast !== null ? Number(explicitLast) : null);

    let trustPoints = buildTrustPointsFromTransactions(txPayload.rows, currentTrust);
    if (currentTrust === null && trustPoints.length) currentTrust = Number(trustPoints[trustPoints.length - 1].trust || 0);
    if (currentTrust === null) currentTrust = 0;

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
      debug: { transaction_count: txPayload.rows.length, used_fields: txPayload.usedFields },
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
      meta: { requested: matterIds.length, returned: series.length, failed, from: fromDay, to: toDay, version: "v19", mode: "anchored_net_or_explicit_running_balance_no_gross_cumulative" },
    });
  } catch (error) {
    return res.status(error.status || 500).json(error.payload || { error: error.message || String(error) });
  }
}
