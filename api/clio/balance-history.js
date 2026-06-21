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
  const accountType = requestedType === "operating" ? "asset" : "liability";
  const from = req.query.from ? new Date(req.query.from) : null;
  const to = req.query.to ? new Date(req.query.to) : null;

  function validDate(value) {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  function dateInRange(dateValue) {
    const d = validDate(dateValue);
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  }

  function numberOrNull(value) {
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

  async function fetchMatterSummary(matterId) {
    const url = new URL(`https://app.clio.com/api/v4/matters/${matterId}`);
    url.searchParams.set(
      "fields",
      [
        "id",
        "display_number",
        "description",
        "status",
        "client{id,name}",
        "trust_balance",
        "trust_account_balance",
        "account_balance",
        "outstanding_balance",
        "balance",
        "total_balance",
      ].join(",")
    );

    try {
      const data = await clioFetch(url);
      return data?.data || null;
    } catch (error) {
      // Some Clio fields may not be enabled for a given account. Retry with only safe matter fields.
      const fallbackUrl = new URL(`https://app.clio.com/api/v4/matters/${matterId}`);
      fallbackUrl.searchParams.set("fields", "id,display_number,description,status,client{id,name}");
      const fallback = await clioFetch(fallbackUrl);
      return fallback?.data || null;
    }
  }

  async function fetchAllTransactionsForMatter(matterId) {
    let url = new URL("https://app.clio.com/api/v4/bank_transactions.json");
    url.searchParams.set("limit", "200");
    url.searchParams.set("matter_id", matterId);
    url.searchParams.set("type", accountType);
    url.searchParams.set(
      "fields",
      "id,date,amount,funds_in,funds_out,current_account_balance,matter{id,display_number}"
    );

    const all = [];
    while (url) {
      const data = await clioFetch(url);
      all.push(...(Array.isArray(data.data) ? data.data : []));
      const next = data?.meta?.paging?.next;
      url = next ? new URL(next) : null;
    }
    return all;
  }

  function currentBalanceFromMatter(matter) {
    if (!matter) return null;
    const candidates = requestedType === "operating"
      ? [matter.outstanding_balance, matter.account_balance, matter.balance, matter.total_balance]
      : [matter.trust_balance, matter.trust_account_balance, matter.account_balance, matter.balance];
    for (const value of candidates) {
      const n = numberOrNull(value);
      if (n !== null) return n;
    }
    return null;
  }

  try {
    const series = [];

    for (const matterId of matterIds) {
      const [matter, transactions] = await Promise.all([
        fetchMatterSummary(matterId),
        fetchAllTransactionsForMatter(matterId),
      ]);

      const sorted = transactions
        .filter((tx) => tx.date)
        .sort((a, b) => new Date(a.date) - new Date(b.date));

      let runningBalance = 0;
      const points = [];

      for (const tx of sorted) {
        const explicitBalance = numberOrNull(tx.current_account_balance ?? tx.currentAccountBalance);
        if (explicitBalance !== null) {
          runningBalance = explicitBalance;
        } else {
          runningBalance += Number(tx.funds_in || 0) - Number(tx.funds_out || 0);
        }

        if (dateInRange(tx.date)) {
          points.push({
            date: tx.date,
            balance: runningBalance,
            transaction_id: tx.id,
            source: "bank_transaction",
          });
        }
      }

      const currentBalance = currentBalanceFromMatter(matter);
      const today = new Date().toISOString().slice(0, 10);
      if (currentBalance !== null && dateInRange(today)) {
        const last = points[points.length - 1];
        if (!last || String(last.date).slice(0, 10) !== today || Number(last.balance) !== currentBalance) {
          points.push({
            date: today,
            balance: currentBalance,
            source: "current_matter_balance",
          });
        }
      }

      if (!points.length && currentBalance !== null) {
        points.push({
          date: today,
          balance: currentBalance,
          source: "current_matter_balance",
        });
      }

      const displayNumber =
        matter?.display_number ||
        sorted[0]?.matter?.display_number ||
        `Matter ${matterId}`;

      series.push({
        matter_id: String(matterId),
        display_number: displayNumber,
        description: matter?.description || "",
        client_name: matter?.client?.name || "",
        account_type: requestedType,
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
