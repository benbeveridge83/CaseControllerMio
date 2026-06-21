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
  const defaultMinimumBalance = Number(req.query.default_minimum_balance || 2000) || 2000;
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

  async function fetchMatterWithFields(matterId, extraFields) {
    const safe = ["id", "display_number", "description", "status", "client{id,name}"];
    const url = new URL(`https://app.clio.com/api/v4/matters/${matterId}`);
    url.searchParams.set("fields", [...safe, ...extraFields].join(","));
    const data = await clioFetch(url);
    return data?.data || null;
  }

  async function fetchMatterSummary(matterId) {
    const groups = [
      ["trust_balance", "trust_account_balance", "matter_trust_funds", "funds_in_trust"],
      ["work_in_progress", "wip", "unbilled_balance", "unbilled_amount", "unbilled_time_balance"],
      ["outstanding_balance", "account_balance", "balance", "total_balance"],
      [],
    ];

    let merged = null;
    for (const fields of groups) {
      try {
        const data = await fetchMatterWithFields(matterId, fields);
        merged = { ...(merged || {}), ...(data || {}) };
      } catch (error) {
        // Clio rejects unknown fields for some accounts. Keep trying smaller groups.
      }
    }
    return merged;
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

  function currentBalanceFromMatter(matter, matterId) {
    const trust = trustBalanceFromMatter(matter);
    const wip = wipBalanceFromMatter(matter);
    const matterMinimum = Number(minimumBalances[String(matterId)] ?? defaultMinimumBalance) || defaultMinimumBalance;

    if (requestedType === "wip") return wip;
    if (requestedType === "trust_minus_minimum") return trust === null ? null : trust - matterMinimum;
    if (requestedType === "trust_minus_wip") return trust === null || wip === null ? null : trust - wip;
    if (requestedType === "trust_minus_wip_minus_minimum") return trust === null || wip === null ? null : trust - wip - matterMinimum;
    return trust;
  }

  try {
    const today = new Date().toISOString().slice(0, 10);
    const series = [];

    for (const matterId of matterIds) {
      const matter = await fetchMatterSummary(matterId);
      const currentBalance = currentBalanceFromMatter(matter, matterId);
      const points = [];

      if (currentBalance !== null) {
        points.push({
          date: today,
          balance: currentBalance,
          source: "current_clio_matter_financial",
        });
      }

      series.push({
        matter_id: String(matterId),
        display_number: matter?.display_number || `Matter ${matterId}`,
        description: matter?.description || "",
        client_name: matter?.client?.name || "",
        account_type: requestedType,
        current_trust_balance: trustBalanceFromMatter(matter),
        current_work_in_progress: wipBalanceFromMatter(matter),
        minimum_balance: Number(minimumBalances[String(matterId)] ?? defaultMinimumBalance) || defaultMinimumBalance,
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
