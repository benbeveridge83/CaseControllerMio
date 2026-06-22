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
  let minimumBalances = {};
  try { minimumBalances = JSON.parse(String(req.query.minimum_balances || "{}")) || {}; } catch { minimumBalances = {}; }

  const today = new Date().toISOString().slice(0, 10);
  const fromDay = req.query.from ? String(req.query.from).slice(0, 10) : null;
  const toDay = req.query.to ? String(req.query.to).slice(0, 10) : today;

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
      else return null;
    }
    if (typeof value === "string") value = value.replace(/[$,]/g, "");
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

  function uniqByDateKeepLast(points) {
    const map = new Map();
    for (const p of points) {
      if (p && p.date) map.set(String(p.date).slice(0, 10), p);
    }
    return Array.from(map.values()).sort((a, b) => new Date(a.date) - new Date(b.date));
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

  async function fetchPaged(path, params) {
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
    }
    return all;
  }

  async function fetchMatterBasic(matterId) {
    const url = new URL(`https://app.clio.com/api/v4/matters/${matterId}`);
    url.searchParams.set("fields", "id,display_number,description,status,client{id,name},account_balances");
    try {
      const data = await clioFetch(url);
      return data?.data || null;
    } catch {
      const fallbackUrl = new URL(`https://app.clio.com/api/v4/matters/${matterId}`);
      fallbackUrl.searchParams.set("fields", "id,display_number,description,status,client{id,name}");
      try {
        const data = await clioFetch(fallbackUrl);
        return data?.data || null;
      } catch {
        return null;
      }
    }
  }

  function numericFromAccountBalances(matter, wantedType) {
    const accountBalances = matter?.account_balances || matter?.accountBalances || [];
    const rows = Array.isArray(accountBalances)
      ? accountBalances
      : Object.entries(accountBalances || {}).map(([key, value]) => ({ key, ...(typeof value === "object" ? value : { value }) }));

    for (const row of rows) {
      const label = String(row?.type || row?.account_type || row?.category || row?.name || row?.key || "").toLowerCase();
      const looksLikeTrust = /trust|liability|client/.test(label);
      const looksLikeWip = /work|progress|wip|unbilled/.test(label);
      if (wantedType === "trust" && !looksLikeTrust) continue;
      if (wantedType === "wip" && !looksLikeWip) continue;
      const n = firstNumber(row?.balance, row?.amount, row?.value, row?.total, row?.current_balance, row?.currentBalance);
      if (n !== null) return n;
    }
    return null;
  }

  function trustFromMatter(matter) {
    return firstNumber(
      numericFromAccountBalances(matter, "trust"),
      matter?.trust_balance,
      matter?.trust_account_balance,
      matter?.matter_trust_funds,
      matter?.funds_in_trust
    );
  }

  function wipFromMatter(matter) {
    return firstNumber(
      numericFromAccountBalances(matter, "wip"),
      matter?.work_in_progress,
      matter?.work_in_progress_balance,
      matter?.wip,
      matter?.unbilled_balance,
      matter?.unbilled_amount,
      matter?.unbilled_time_balance
    );
  }

  async function fetchTrustTransactions(matterId) {
    // This is the transaction source that matches Clio's Transactions tab: date, funds out, funds in, and running balance.
    // We use running_balance when Clio provides it. Only if it is missing do we calculate net trust from funds in minus funds out.
    const txs = await fetchPaged("bank_transactions.json", {
      limit: 200,
      matter_id: matterId,
      type: "liability",
      fields: "id,date,funds_out,funds_in,amount,running_balance,current_account_balance,matter{id,display_number}",
    }).catch(() => []);

    txs.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));

    const points = [];
    let computedRunning = 0;
    let lastBeforeRange = null;

    for (const tx of txs) {
      const day = tx.date ? String(tx.date).slice(0, 10) : null;
      if (!day) continue;

      const explicitRunning = firstNumber(tx.running_balance, tx.current_account_balance);
      const fundsIn = numberOrNull(tx.funds_in) || 0;
      const fundsOut = numberOrNull(tx.funds_out) || 0;
      const amount = numberOrNull(tx.amount);

      if (explicitRunning !== null) {
        computedRunning = explicitRunning;
      } else if (fundsIn || fundsOut) {
        computedRunning += fundsIn - fundsOut;
      } else if (amount !== null) {
        computedRunning += amount;
      } else {
        continue;
      }

      const point = { date: day, trust: Number(computedRunning || 0), source: explicitRunning !== null ? "clio_running_balance" : "computed_net_trust", transaction_id: tx.id };
      if (fromDay && asDate(day) < asDate(fromDay)) lastBeforeRange = point;
      if (inRange(day)) points.push(point);
    }

    if (fromDay && lastBeforeRange) {
      points.unshift({ ...lastBeforeRange, date: fromDay, source: `${lastBeforeRange.source}_carried_to_start` });
    }

    return uniqByDateKeepLast(points);
  }

  async function fetchWipFromMatterOrActivities(matterId, matter) {
    const matterWip = wipFromMatter(matter);
    if (matterWip !== null) return matterWip;

    // Only include activities if Clio returns a clear billed flag/status. This avoids summing every historic time entry.
    const activities = await fetchPaged("activities.json", {
      limit: 200,
      matter_id: matterId,
      type: "TimeEntry",
      fields: "id,date,total,non_billable,billed,bill{id,state,status}",
    }).catch(() => []);

    let total = 0;
    let found = false;
    for (const a of activities) {
      const nonBillable = a.non_billable === true;
      const hasBilledFlag = Object.prototype.hasOwnProperty.call(a, "billed");
      const billState = String(a.bill?.state || a.bill?.status || "").toLowerCase();
      const clearlyBilled = a.billed === true || Boolean(a.bill?.id) || ["draft", "awaiting_payment", "paid", "approved", "sent"].includes(billState);
      if (nonBillable || clearlyBilled) continue;
      if (!hasBilledFlag && !("bill" in a)) continue;
      const amount = numberOrNull(a.total);
      if (amount !== null) {
        total += amount;
        found = true;
      }
    }
    return found ? total : 0;
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

  function ensureRange(points, currentTrust) {
    const start = fromDay || (points[0]?.date || today);
    const end = toDay || today;
    let normalized = uniqByDateKeepLast(points);

    if (!normalized.length) normalized = [{ date: start, trust: Number(currentTrust || 0), source: "current_value_no_history" }];
    if (start && !normalized.some((p) => p.date === start)) normalized.unshift({ ...normalized[0], date: start, source: `${normalized[0].source}_carried_to_start` });
    if (end && !normalized.some((p) => p.date === end)) normalized.push({ ...normalized[normalized.length - 1], date: end, source: `${normalized[normalized.length - 1].source}_carried_to_end` });
    return uniqByDateKeepLast(normalized);
  }

  async function buildSeries(matterId) {
    const matter = await fetchMatterBasic(matterId);
    const [trustPoints, wip] = await Promise.all([
      fetchTrustTransactions(matterId),
      ["wip", "trust_minus_wip", "trust_minus_wip_minus_minimum"].includes(requestedType)
        ? fetchWipFromMatterOrActivities(matterId, matter)
        : Promise.resolve(wipFromMatter(matter) || 0),
    ]);

    let currentTrust = trustPoints.length ? trustPoints[trustPoints.length - 1].trust : null;
    const matterTrust = trustFromMatter(matter);
    if (matterTrust !== null) currentTrust = matterTrust;
    if (currentTrust === null) currentTrust = 0;

    const minimum = Number(minimumBalances[String(matterId)] ?? 2000) || 2000;
    const rangedTrustPoints = ensureRange(trustPoints, currentTrust);
    const points = requestedType === "wip"
      ? ensureRange([], currentTrust).map((p) => ({ date: p.date, balance: Number(wip || 0), source: "current_wip_flat_line" }))
      : rangedTrustPoints.map((p) => ({
          date: p.date,
          balance: valueForType(requestedType, p.trust, wip, minimum),
          source: p.source,
          transaction_id: p.transaction_id,
        }));

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
        try {
          results[currentIndex] = { status: "fulfilled", value: await mapper(items[currentIndex]) };
        } catch (error) {
          results[currentIndex] = { status: "rejected", reason: error };
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
  }

  try {
    const settled = await mapWithConcurrency(matterIds, 4, buildSeries);
    const series = settled.filter((r) => r.status === "fulfilled" && r.value).map((r) => r.value);
    const rejected = settled.filter((r) => r.status === "rejected");
    return res.status(200).json({ series, meta: { requested: matterIds.length, returned: series.length, failed: rejected.length, from: fromDay, to: toDay, mode: "trust_running_balance_points_and_current_wip" } });
  } catch (error) {
    return res.status(error.status || 500).json(error.payload || { error: error.message || String(error) });
  }
}