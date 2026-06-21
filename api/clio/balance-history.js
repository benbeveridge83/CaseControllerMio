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

  function numberOrNull(value) {
    if (value && typeof value === "object" && "amount" in value) value = value.amount;
    if (typeof value === "string") value = value.replace(/[$,]/g, "");
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
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

  async function fetchLatestTrustFromTransactions(matterId) {
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
    let running = 0;
    let latestExplicit = null;
    let latestRunning = null;

    for (const tx of txs) {
      const explicit = numberOrNull(tx.current_account_balance ?? tx.currentAccountBalance);
      if (explicit !== null) {
        latestExplicit = { date: tx.date || new Date().toISOString().slice(0, 10), balance: explicit, transaction_id: tx.id };
        running = explicit;
      } else {
        running += Number(tx.funds_in || 0) - Number(tx.funds_out || 0);
      }
      if (tx.date) latestRunning = { date: tx.date, balance: running, transaction_id: tx.id };
    }

    return latestExplicit || latestRunning || null;
  }

  async function fetchWipFromActivities(matterId) {
    // Fast, forgiving WIP fallback. If Clio does not return activity totals, use zero so the graph still renders.
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

  async function buildSeries(matterId) {
    const today = new Date().toISOString().slice(0, 10);
    const matter = await fetchMatterBasic(matterId);

    const [trustInfo, wip] = await Promise.all([
      fetchLatestTrustFromTransactions(matterId).catch(() => null),
      ["wip", "trust_minus_wip", "trust_minus_wip_minus_minimum"].includes(requestedType)
        ? fetchWipFromActivities(matterId).catch(() => 0)
        : Promise.resolve(0),
    ]);

    const trust = numberOrNull(trustInfo?.balance) ?? 0;
    const minimum = Number(minimumBalances[String(matterId)] ?? 2000) || 2000;
    const value = outputValue({ requestedType, trust, wip: Number(wip || 0), minimum });

    return {
      matter_id: String(matterId),
      display_number: matter?.display_number || trustInfo?.display_number || `Matter ${matterId}`,
      description: matter?.description || "",
      client_name: matter?.client?.name || "",
      account_type: requestedType,
      current_trust_balance: trust,
      current_work_in_progress: Number(wip || 0),
      minimum_balance: minimum,
      points: [{
        date: today,
        balance: Number(value || 0),
        source: trustInfo ? "latest_clio_trust_balance" : "fallback_zero_so_graph_renders",
      }],
    };
  }

  try {
    // Parallel loading prevents Vercel/API timeouts when 15+ matters are selected.
    const settled = await Promise.allSettled(matterIds.map((id) => buildSeries(id)));
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
      },
    });
  } catch (error) {
    return res.status(error.status || 500).json(error.payload || {
      error: error.message || String(error),
    });
  }
}
