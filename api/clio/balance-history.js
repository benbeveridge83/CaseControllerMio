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
      else return null;
    }
    if (typeof value === "string") value = value.replace(/[$,\s]/g, "");
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
      "id,display_number,description,status,client{id,name},trust_balance,trust_account_balance",
      "id,display_number,description,status,client{id,name},work_in_progress",
      "id,display_number,description,status,client{id,name},wip",
      "id,display_number,description,status,client{id,name},unbilled_balance",
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
    return firstNumber(
      matter?.trust_balance,
      matter?.trust_account_balance,
      numericByKeyword(matter?.account_balances, /(trust|liability|client)/i, /(work|progress|wip|unbilled|receivable|outstanding)/i)
    );
  }

  function matterWip(matter) {
    return firstNumber(
      matter?.work_in_progress,
      matter?.wip,
      matter?.unbilled_balance,
      numericByKeyword(matter?.account_balances, /(work|progress|wip|unbilled)/i)
    );
  }

  async function fetchTrustTransactions(matterId) {
    const attempts = [
      "id,date,funds_out,funds_in,amount,running_balance,current_account_balance,matter{id,display_number}",
      "id,date,funds_out,funds_in,amount,current_account_balance",
      "id,date,funds_out,funds_in,amount",
      "id,date,amount",
    ];
    let txs = [];
    for (const fields of attempts) {
      try {
        txs = await fetchPaged("bank_transactions.json", { limit: 200, matter_id: matterId, type: "liability", fields }, ["bank_transactions"]);
        if (txs.length || fields === attempts[attempts.length - 1]) break;
      } catch {
        txs = [];
      }
    }

    txs.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
    const allPoints = [];
    let running = null;

    for (const tx of txs) {
      const day = tx.date ? String(tx.date).slice(0, 10) : null;
      if (!day) continue;
      const explicit = firstNumber(tx.running_balance, tx.runningBalance, tx.current_account_balance, tx.currentAccountBalance);
      const fundsIn = numberOrNull(tx.funds_in) || 0;
      const fundsOut = numberOrNull(tx.funds_out) || 0;
      const amount = numberOrNull(tx.amount);

      if (explicit !== null) running = explicit;
      else if (running === null) running = 0;
      if (explicit === null) {
        if (fundsIn || fundsOut) running += fundsIn - fundsOut;
        else if (amount !== null) running += amount;
        else continue;
      }
      allPoints.push({ date: day, trust: Number(running || 0), source: explicit !== null ? "clio_running_balance" : "net_from_transactions", transaction_id: tx.id });
    }

    const byDate = new Map();
    for (const p of allPoints) byDate.set(p.date, p);
    const sorted = Array.from(byDate.values()).sort((a, b) => new Date(a.date) - new Date(b.date));

    const ranged = [];
    let lastBefore = null;
    for (const p of sorted) {
      if (fromDay && asDate(p.date) < asDate(fromDay)) lastBefore = p;
      if (inRange(p.date)) ranged.push(p);
    }
    if (fromDay && lastBefore) ranged.unshift({ ...lastBefore, date: fromDay, source: `${lastBefore.source}_carried_to_start` });
    return ranged;
  }

  async function fetchCurrentWip(matterId, matter) {
    const direct = matterWip(matter);
    if (direct !== null) return direct;
    // Conservative fallback. This can undercount if Clio does not expose billed state, but avoids historical cumulative WIP.
    const activities = await fetchPaged("activities.json", {
      limit: 200,
      matter_id: matterId,
      fields: "id,date,total,non_billable,billed,bill{id,state,status},type",
    }, ["activities"]).catch(() => []);
    let total = 0;
    let found = false;
    for (const a of activities) {
      const typeText = String(a.type || a.activity_type || "").toLowerCase();
      if (/expense/.test(typeText)) continue;
      if (a.non_billable === true) continue;
      const billState = String(a.bill?.state || a.bill?.status || "").toLowerCase();
      const billed = a.billed === true || Boolean(a.bill?.id) || ["draft", "awaiting_payment", "paid", "approved", "sent"].includes(billState);
      if (billed) continue;
      if (!(Object.prototype.hasOwnProperty.call(a, "billed") || "bill" in a)) continue;
      const n = numberOrNull(a.total);
      if (n !== null) { total += n; found = true; }
    }
    return found ? total : 0;
  }

  function ensureRange(points, currentTrust) {
    const start = fromDay || points[0]?.date || toDay;
    const end = toDay || points[points.length - 1]?.date || start;
    let out = points.slice();
    if (!out.length) out = [{ date: start, trust: Number(currentTrust || 0), source: "current_value_no_history" }];
    if (start && !out.some((p) => p.date === start)) out.unshift({ ...out[0], date: start, source: `${out[0].source}_carried_to_start` });
    if (end && !out.some((p) => p.date === end)) out.push({ ...out[out.length - 1], date: end, source: `${out[out.length - 1].source}_carried_to_end` });
    const map = new Map();
    for (const p of out) map.set(p.date, p);
    return Array.from(map.values()).sort((a, b) => new Date(a.date) - new Date(b.date));
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
    const [transactionPoints, wip] = await Promise.all([
      fetchTrustTransactions(matterId),
      fetchCurrentWip(matterId, matter),
    ]);
    const directTrust = matterTrust(matter);
    let currentTrust = directTrust !== null ? directTrust : (transactionPoints.length ? transactionPoints[transactionPoints.length - 1].trust : 0);
    const ranged = ensureRange(transactionPoints, currentTrust);
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
      meta: { requested: matterIds.length, returned: series.length, failed, from: fromDay, to: toDay, version: "v14" },
    });
  } catch (error) {
    return res.status(error.status || 500).json(error.payload || { error: error.message || String(error) });
  }
}
