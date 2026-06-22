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

  async function clioFetch(url, options = {}) {
    const response = await fetch(url.toString(), {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(options.headers || {}),
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

  async function fetchPaged(path, params) {
    let url = new URL(`https://app.clio.com/api/v4/${path}`);
    for (const [key, value] of Object.entries(params || {})) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
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
    url.searchParams.set("fields", "id,display_number,description,status,client{id,name}");
    try {
      const data = await clioFetch(url);
      return data?.data || null;
    } catch {
      return null;
    }
  }

  async function fetchMatterFinancialFields(matterId) {
    // Clio accounts differ on which financial fields are available.
    // Try small field groups. Unknown fields cause Clio to reject the request, so do not ask for all at once.
    const groups = [
      ["account_balances"],
      ["trust_balance", "trust_account_balance", "matter_trust_funds", "funds_in_trust"],
      ["work_in_progress", "work_in_progress_balance", "wip", "unbilled_balance", "unbilled_amount", "unbilled_time_balance"],
    ];

    const out = {};
    for (const fields of groups) {
      const url = new URL(`https://app.clio.com/api/v4/matters/${matterId}`);
      url.searchParams.set("fields", ["id", ...fields].join(","));
      try {
        const data = await clioFetch(url);
        Object.assign(out, data?.data || {});
      } catch {
        // Ignore unknown field groups.
      }
    }
    return out;
  }

  function numericFromAccountBalances(matter, wantedType) {
    const accountBalances = matter?.account_balances || matter?.accountBalances || [];
    const rows = Array.isArray(accountBalances)
      ? accountBalances
      : Object.entries(accountBalances || {}).map(([key, value]) => ({ key, ...(typeof value === "object" ? value : { value }) }));

    for (const row of rows) {
      const label = String(
        row?.type ||
        row?.account_type ||
        row?.category ||
        row?.name ||
        row?.key ||
        ""
      ).toLowerCase();

      const looksLikeTrust = /trust|liability|client/.test(label);
      const looksLikeWip = /work|progress|wip|unbilled/.test(label);

      if (wantedType === "trust" && !looksLikeTrust) continue;
      if (wantedType === "wip" && !looksLikeWip) continue;

      const n = firstNumber(row?.balance, row?.amount, row?.value, row?.total, row?.current_balance, row?.currentBalance);
      if (n !== null) return n;
    }

    return null;
  }

  function trustFromMatterFields(matter) {
    const fromAccountBalances = numericFromAccountBalances(matter, "trust");
    if (fromAccountBalances !== null) return fromAccountBalances;
    return firstNumber(
      matter?.trust_balance,
      matter?.trust_account_balance,
      matter?.matter_trust_funds,
      matter?.funds_in_trust
    );
  }

  function wipFromMatterFields(matter) {
    const fromAccountBalances = numericFromAccountBalances(matter, "wip");
    if (fromAccountBalances !== null) return fromAccountBalances;
    return firstNumber(
      matter?.work_in_progress,
      matter?.work_in_progress_balance,
      matter?.wip,
      matter?.unbilled_balance,
      matter?.unbilled_amount,
      matter?.unbilled_time_balance
    );
  }

  async function fetchTrustBalancePointsFromTransactions(matterId) {
    // IMPORTANT: never add deposits/funds_in/funds_out to guess the balance.
    // That was the bug that showed cumulative money paid in instead of current trust.
    // Only use Clio-provided balance-after/current balance fields.
    const txs = await fetchPaged("bank_transactions.json", {
      limit: 200,
      matter_id: matterId,
      type: "liability",
      fields: "id,date,current_account_balance,currentAccountBalance,account_balance,balance,balance_after,running_balance,runningBalance,matter{id,display_number}",
    }).catch(() => []);

    const points = [];
    let latestBeforeRange = null;

    for (const tx of txs.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0))) {
      const day = tx.date ? String(tx.date).slice(0, 10) : null;
      if (!day) continue;

      const balance = firstNumber(
        tx.running_balance,
        tx.runningBalance,
        tx.current_account_balance,
        tx.currentAccountBalance,
        tx.account_balance,
        tx.balance,
        tx.balance_after
      );

      if (balance === null) continue;

      const point = {
        date: day,
        trust: balance,
        source: "clio_transaction_balance_field",
        transaction_id: tx.id,
      };

      if (fromDay && asDate(day) < asDate(fromDay)) latestBeforeRange = point;
      if (inRange(day)) points.push(point);
    }

    if (fromDay && latestBeforeRange) {
      points.unshift({ ...latestBeforeRange, date: fromDay, source: `${latestBeforeRange.source}_carried_forward_to_start` });
    }

    return uniqByDateKeepLast(points);
  }

  async function fetchTrustFromTrustLineItems(matterId) {
    // Trust line items usually include both credits and debits against trust. This is a better
    // fallback than summing deposits from bank_transactions, because it can reflect applications/withdrawals.
    const rows = await fetchPaged("trust_line_items.json", {
      limit: 200,
      matter_id: matterId,
      fields: "id,date,total,amount,balance,kind,type,matter{id,display_number}",
    }).catch(async () => {
      return fetchPaged("trust_line_items", {
        limit: 200,
        matter_id: matterId,
        fields: "id,date,total,amount,balance,kind,type,matter{id,display_number}",
      }).catch(() => []);
    });

    const points = [];
    let running = 0;
    let latestBeforeRange = null;

    for (const row of rows.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0))) {
      const day = row.date ? String(row.date).slice(0, 10) : null;
      if (!day) continue;

      const explicitBalance = firstNumber(row.balance);
      if (explicitBalance === null) continue;
      running = explicitBalance;

      const point = {
        date: day,
        trust: running,
        source: "clio_trust_line_item_balance",
        transaction_id: row.id,
      };

      if (fromDay && asDate(day) < asDate(fromDay)) latestBeforeRange = point;
      if (inRange(day)) points.push(point);
    }

    if (fromDay && latestBeforeRange) {
      points.unshift({ ...latestBeforeRange, date: fromDay, source: `${latestBeforeRange.source}_carried_forward_to_start` });
    }

    return uniqByDateKeepLast(points);
  }

  async function fetchWipFromActivities(matterId) {
    // Rebuild the visible matter WIP from billable, unbilled activity records.
    // This uses official activity totals rather than returning zero when matter fields are unavailable.
    const fieldSets = [
      "id,date,total,non_billable,non_billable_total,billed,bill{id,state,status}",
      "id,date,total,non_billable,non_billable_total",
      "id,date,total",
    ];

    let activities = [];
    for (const fields of fieldSets) {
      try {
        activities = await fetchPaged("activities.json", {
          limit: 200,
          matter_id: matterId,
          type: "TimeEntry",
          fields,
        });
        if (activities.length || fields === fieldSets[fieldSets.length - 1]) break;
      } catch {
        // try the next smaller field set
      }
    }

    let total = 0;
    let found = false;

    for (const a of activities) {
      const nonBillable = a.non_billable === true;
      const billState = String(a.bill?.state || a.bill?.status || a.bill_state || a.bill_status || "").toLowerCase();
      const clearlyBilled = Boolean(a.bill?.id) || ["draft", "awaiting_payment", "paid", "approved", "sent"].includes(billState);

      if (nonBillable || clearlyBilled) continue;

      const amount = numberOrNull(a.total);
      if (amount !== null) {
        total += amount;
        found = true;
      }
    }

    return found ? total : null;
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

    if (!normalized.length) {
      normalized = [{ date: start, trust: Number(currentTrust || 0), source: "current_value_no_history" }];
    }

    if (start && !normalized.some((p) => p.date === start)) {
      const first = normalized[0];
      normalized.unshift({ ...first, date: start, source: `${first.source}_carried_to_start` });
    }

    if (end && !normalized.some((p) => p.date === end)) {
      const last = normalized[normalized.length - 1];
      normalized.push({ ...last, date: end, source: `${last.source}_carried_to_end` });
    }

    return uniqByDateKeepLast(normalized);
  }

  async function buildSeries(matterId) {
    const [matter, matterFinancials] = await Promise.all([
      fetchMatterBasic(matterId),
      fetchMatterFinancialFields(matterId),
    ]);

    let trustPoints = await fetchTrustBalancePointsFromTransactions(matterId);
    let currentTrust = trustPoints.length ? trustPoints[trustPoints.length - 1].trust : null;

    if (currentTrust === null) {
      const matterTrust = trustFromMatterFields(matterFinancials);
      if (matterTrust !== null) currentTrust = matterTrust;
    }

    if (currentTrust === null) {
      const lineItemPoints = await fetchTrustFromTrustLineItems(matterId);
      if (lineItemPoints.length) {
        trustPoints = lineItemPoints;
        currentTrust = lineItemPoints[lineItemPoints.length - 1].trust;
      }
    }

    if (currentTrust === null) currentTrust = 0;

    let wip = wipFromMatterFields(matterFinancials);
    if (wip === null && ["wip", "trust_minus_wip", "trust_minus_wip_minus_minimum"].includes(requestedType)) {
      wip = await fetchWipFromActivities(matterId).catch(() => null);
    }
    if (wip === null) wip = 0;

    const minimum = Number(minimumBalances[String(matterId)] ?? 2000) || 2000;
    const rangedTrustPoints = ensureRange(trustPoints, currentTrust);

    const points = rangedTrustPoints.map((p) => ({
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
        from: fromDay,
        to: toDay,
        mode: "current_only_running_balance_no_cumulative_deposits",
      },
    });
  } catch (error) {
    return res.status(error.status || 500).json(error.payload || {
      error: error.message || String(error),
    });
  }
}
