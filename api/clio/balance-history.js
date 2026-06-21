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
  const defaultMinimumBalance = 2000;
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
    const data = await clioFetch(url);
    return data?.data || null;
  }

  async function fetchMatterFields(matterId, fields) {
    const url = new URL(`https://app.clio.com/api/v4/matters/${matterId}`);
    url.searchParams.set("fields", ["id", "display_number", "description", "status", "client{id,name}", ...fields].join(","));
    const data = await clioFetch(url);
    return data?.data || null;
  }

  async function fetchMatterSummary(matterId) {
    let merged = null;
    const groups = [
      ["trust_balance", "trust_account_balance", "matter_trust_funds", "funds_in_trust"],
      ["work_in_progress", "wip", "unbilled_balance", "unbilled_amount", "unbilled_time_balance"],
      [],
    ];
    for (const fields of groups) {
      try {
        const data = fields.length ? await fetchMatterFields(matterId, fields) : await fetchMatterBasic(matterId);
        merged = { ...(merged || {}), ...(data || {}) };
      } catch {
        // Clio rejects unknown fields on some accounts. Continue with the fields that work.
      }
    }
    return merged;
  }

  async function fetchLatestTrustBalanceFromTransactions(matterId) {
    let url = new URL("https://app.clio.com/api/v4/bank_transactions.json");
    url.searchParams.set("limit", "200");
    url.searchParams.set("matter_id", matterId);
    url.searchParams.set("type", "liability");
    url.searchParams.set("fields", "id,date,current_account_balance,matter{id,display_number}");

    let best = null;
    while (url) {
      const data = await clioFetch(url);
      for (const tx of Array.isArray(data.data) ? data.data : []) {
        const bal = numberOrNull(tx.current_account_balance ?? tx.currentAccountBalance);
        if (bal === null || !tx.date) continue;
        if (!best || new Date(tx.date) > new Date(best.date)) {
          best = { date: tx.date, balance: bal, transaction_id: tx.id };
        }
      }
      const next = data?.meta?.paging?.next;
      url = next ? new URL(next) : null;
    }
    return best;
  }

  async function fetchWipFromActivities(matterId) {
    // WIP equals unbilled activity value when the direct Matter financial fields are unavailable.
    const statusesToTry = ["unbilled", "draft", "pending"];
    let total = 0;
    let foundAny = false;

    for (const status of statusesToTry) {
      let url = new URL("https://app.clio.com/api/v4/activities.json");
      url.searchParams.set("limit", "200");
      url.searchParams.set("matter_id", matterId);
      url.searchParams.set("status", status);
      url.searchParams.set("fields", "id,date,total,price,quantity,non_billable,billable,type");
      try {
        while (url) {
          const data = await clioFetch(url);
          for (const activity of Array.isArray(data.data) ? data.data : []) {
            const isNonBillable = activity.non_billable === true || activity.billable === false;
            if (isNonBillable) continue;
            const amount = numberOrNull(activity.total ?? activity.price ?? 0);
            if (amount !== null) {
              total += amount;
              foundAny = true;
            }
          }
          const next = data?.meta?.paging?.next;
          url = next ? new URL(next) : null;
        }
      } catch {
        // Some accounts do not support all status filters. Try the next one.
      }
    }

    return foundAny ? total : null;
  }

  function firstNumeric(values) {
    for (const value of values) {
      const n = numberOrNull(value);
      if (n !== null) return n;
    }
    return null;
  }

  function trustBalanceFromMatter(matter) {
    if (!matter) return null;
    return firstNumeric([
      matter.trust_balance,
      matter.trust_account_balance,
      matter.matter_trust_funds,
      matter.funds_in_trust,
    ]);
  }

  function wipBalanceFromMatter(matter) {
    if (!matter) return null;
    return firstNumeric([
      matter.work_in_progress,
      matter.wip,
      matter.unbilled_balance,
      matter.unbilled_amount,
      matter.unbilled_time_balance,
    ]);
  }

  function computedValue({ requestedType, trust, wip, minimum }) {
    if (requestedType === "wip") return wip;
    if (requestedType === "trust_minus_minimum") return trust === null ? null : trust - minimum;
    if (requestedType === "trust_minus_wip") return trust === null || wip === null ? null : trust - wip;
    if (requestedType === "trust_minus_wip_minus_minimum") return trust === null || wip === null ? null : trust - wip - minimum;
    return trust;
  }

  try {
    const today = new Date().toISOString().slice(0, 10);
    const series = [];

    for (const matterId of matterIds) {
      const matter = await fetchMatterSummary(matterId);
      const txTrust = await fetchLatestTrustBalanceFromTransactions(matterId).catch(() => null);
      const matterTrust = trustBalanceFromMatter(matter);
      const trust = matterTrust !== null ? matterTrust : (txTrust?.balance ?? null);
      let wip = wipBalanceFromMatter(matter);
      if (wip === null && ["wip", "trust_minus_wip", "trust_minus_wip_minus_minimum"].includes(requestedType)) {
        wip = await fetchWipFromActivities(matterId).catch(() => null);
      }
      const minimum = Number(minimumBalances[String(matterId)] ?? defaultMinimumBalance) || defaultMinimumBalance;
      const currentBalance = computedValue({ requestedType, trust, wip, minimum });
      const points = [];

      if (currentBalance !== null) {
        points.push({
          date: today,
          balance: currentBalance,
          source: "current_clio_financial",
        });
      }

      series.push({
        matter_id: String(matterId),
        display_number: matter?.display_number || `Matter ${matterId}`,
        description: matter?.description || "",
        client_name: matter?.client?.name || "",
        account_type: requestedType,
        current_trust_balance: trust,
        current_work_in_progress: wip,
        minimum_balance: minimum,
        points,
      });
    }

    return res.status(200).json({ series });
  } catch (error) {
    return res.status(error.status || 500).json(error.payload || {
      error: error.message || String(error),
    });
  }
}
