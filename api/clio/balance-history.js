export default async function handler(req, res) {
  const cookieHeader = req.headers.cookie || "";
  const tokenCookie = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("clio_access_token="));

  if (!tokenCookie) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const token = tokenCookie.split("=")[1];
  const matterIds = String(req.query.matter_ids || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (!matterIds.length) {
    return res.status(400).json({ error: "No matter_ids provided" });
  }

  const requestedType = String(req.query.account_type || "trust").toLowerCase();
  let minimumBalances = {};
  try {
    minimumBalances = JSON.parse(String(req.query.minimum_balances || "{}")) || {};
  } catch {
    minimumBalances = {};
  }

  const fromDate = req.query.from ? new Date(String(req.query.from)) : null;
  const toDate = req.query.to ? new Date(String(req.query.to)) : null;
  if (toDate) toDate.setHours(23, 59, 59, 999);

  function isoDay(dateValue) {
    const d = new Date(dateValue);
    if (!Number.isFinite(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }

  function numberOrNull(value) {
    if (value && typeof value === "object" && "amount" in value) value = value.amount;
    if (typeof value === "string") value = value.replace(/[$,]/g, "");
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function inRange(dateValue) {
    const d = new Date(dateValue);
    if (!Number.isFinite(d.getTime())) return false;
    if (fromDate && d < fromDate) return false;
    if (toDate && d > toDate) return false;
    return true;
  }

  async function clioFetch(url) {
    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        data?.error?.message ||
        data?.message ||
        data?.error ||
        `Clio request failed with ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.payload = data;
      throw error;
    }
    return data;
  }

  async function fetchMatterBasic(matterId) {
    const url = new URL(`https://app.clio.com/api/v4/matters/${matterId}`);
    url.searchParams.set("fields", "id,display_number,description,status,client{id,name}");
    try {
      const data = await clioFetch(url);
      return data?.data || null;
    } catch {
      return null;
    }
  }

  async function fetchTrustTransactions(matterId) {
    let url = new URL("https://app.clio.com/api/v4/bank_transactions.json");
    url.searchParams.set("limit", "200");
    url.searchParams.set("matter_id", matterId);
    url.searchParams.set("type", "liability");
    url.searchParams.set("fields", "id,date,amount,funds_in,funds_out,current_account_balance,matter{id,display_number}");

    const txs = [];
    while (url) {
      const data = await clioFetch(url);
      txs.push(...(Array.isArray(data.data) ? data.data : []));
      const next = data?.meta?.paging?.next;
      url = next ? new URL(next) : null;
    }

    txs.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
    return txs;
  }

  async function fetchWipFromActivities(matterId) {
    let url = new URL("https://app.clio.com/api/v4/activities.json");
    url.searchParams.set("limit", "200");
    url.searchParams.set("matter_id", matterId);
    url.searchParams.set("fields", "id,date,total,price,quantity,non_billable,billable");

    let total = 0;
    let found = false;
    try {
      while (url) {
        const data = await clioFetch(url);
        for (const activity of Array.isArray(data.data) ? data.data : []) {
          const isNonBillable = activity.non_billable === true || activity.billable === false;
          if (isNonBillable) continue;
          const amount = numberOrNull(activity.total ?? activity.price);
          if (amount !== null) {
            total += amount;
            found = true;
          }
        }
        const next = data?.meta?.paging?.next;
        url = next ? new URL(next) : null;
      }
    } catch {
      return 0;
    }
    return found ? total : 0;
  }

  function outputValue({ requestedType, trust, wip, minimum }) {
    if (requestedType === "wip") return wip;
    if (requestedType === "trust_minus_minimum") return trust - minimum;
    if (requestedType === "trust_minus_wip") return trust - wip;
    if (requestedType === "trust_minus_wip_minus_minimum") return trust - wip - minimum;
    return trust;
  }

  function buildTrustHistoryPoints(txs) {
    const points = [];
    let running = 0;
    let lastBeforeRange = null;

    for (const tx of txs) {
      const txDay = isoDay(tx.date);
      if (!txDay) continue;

      const explicit = numberOrNull(tx.current_account_balance ?? tx.currentAccountBalance);
      if (explicit !== null) {
        running = explicit;
      } else {
        running += Number(tx.funds_in || 0) - Number(tx.funds_out || 0);
      }

      const point = {
        date: txDay,
        trust: Number(running || 0),
        transaction_id: tx.id,
        source: explicit !== null ? "clio_current_account_balance" : "computed_from_transactions",
      };

      if (inRange(txDay)) {
        points.push(point);
      } else if (fromDate && new Date(txDay) < fromDate) {
        lastBeforeRange = point;
      }
    }

    if (fromDate && lastBeforeRange && !points.some((p) => p.date === isoDay(fromDate))) {
      points.unshift({
        ...lastBeforeRange,
        date: isoDay(fromDate),
        source: `${lastBeforeRange.source}_carried_forward_to_range_start`,
      });
    }

    return points;
  }

  async function buildSeries(matterId) {
    const [matter, txs, wip] = await Promise.all([
      fetchMatterBasic(matterId),
      fetchTrustTransactions(matterId).catch(() => []),
      ["wip", "trust_minus_wip", "trust_minus_wip_minus_minimum"].includes(requestedType)
        ? fetchWipFromActivities(matterId).catch(() => 0)
        : Promise.resolve(0),
    ]);

    const minimum = Number(minimumBalances[String(matterId)] ?? 2000) || 2000;
    const today = new Date().toISOString().slice(0, 10);

    let trustHistory = buildTrustHistoryPoints(txs);

    // If the selected date range has no transactions, carry the last known balance into the range
    // so the graph still shows the selected X-axis range instead of collapsing to one day.
    if (!trustHistory.length && txs.length) {
      const allHistory = buildTrustHistoryPoints(txs.map((tx) => ({ ...tx })));
      const lastTx = txs[txs.length - 1];
      let running = 0;
      for (const tx of txs) {
        const explicit = numberOrNull(tx.current_account_balance ?? tx.currentAccountBalance);
        if (explicit !== null) running = explicit;
        else running += Number(tx.funds_in || 0) - Number(tx.funds_out || 0);
      }
      const carryDate = fromDate ? isoDay(fromDate) : (isoDay(lastTx.date) || today);
      trustHistory = [{
        date: carryDate,
        trust: Number(running || 0),
        transaction_id: lastTx.id,
        source: "last_known_balance_carried_forward",
      }];
    }

    if (!trustHistory.length) {
      const fallbackDate = fromDate ? isoDay(fromDate) : today;
      trustHistory = [{
        date: fallbackDate,
        trust: 0,
        source: "fallback_zero_no_clio_transactions",
      }];
    }

    // Put an endpoint at the end date/today so each matter draws as a horizontal line across the chosen range.
    const endDay = toDate ? isoDay(toDate) : today;
    if (endDay && trustHistory.length) {
      const last = trustHistory[trustHistory.length - 1];
      if (last.date !== endDay) {
        trustHistory.push({
          ...last,
          date: endDay,
          source: `${last.source}_carried_forward_to_range_end`,
        });
      }
    }

    const points = trustHistory.map((p) => ({
      date: p.date,
      balance: outputValue({
        requestedType,
        trust: Number(p.trust || 0),
        wip: Number(wip || 0),
        minimum,
      }),
      transaction_id: p.transaction_id,
      source: p.source,
    }));

    return {
      matter_id: String(matterId),
      display_number: matter?.display_number || `Matter ${matterId}`,
      description: matter?.description || "",
      client_name: matter?.client?.name || "",
      account_type: requestedType,
      current_trust_balance: Number(trustHistory[trustHistory.length - 1]?.trust || 0),
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
    // Keep concurrency modest to avoid Clio rate limits while still preventing Vercel stalls.
    const settled = await mapWithConcurrency(matterIds, 5, buildSeries);
    const series = settled
      .filter((result) => result.status === "fulfilled" && result.value)
      .map((result) => result.value);

    const rejected = settled.filter((result) => result.status === "rejected");
    return res.status(200).json({
      series,
      meta: {
        requested: matterIds.length,
        returned: series.length,
        failed: rejected.length,
        from: req.query.from || null,
        to: req.query.to || null,
      },
    });
  } catch (error) {
    return res.status(error.status || 500).json(error.payload || {
      error: error.message || String(error),
    });
  }
}
