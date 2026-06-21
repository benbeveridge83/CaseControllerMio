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

  const accountType = req.query.account_type === "operating" ? "operating" : "trust";
  const today = new Date().toISOString().slice(0, 10);

  async function clioFetch(url) {
    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error?.message || data?.message || data?.error || `Clio request failed with ${response.status}`);
    }
    return data;
  }

  async function fetchMatter(matterId) {
    const url = new URL(`https://app.clio.com/api/v4/matters/${matterId}`);
    url.searchParams.set(
      "fields",
      [
        "id",
        "display_number",
        "description",
        "status",
        "client{id,name}",
        // These fields are requested defensively. Clio ignores neither invalid fields nor missing permissions,
        // so any error here is caught by the caller and the endpoint falls back to transactions/bills.
        "account_balances{balance,type}",
        "matter_balances{balance,type}",
        "outstanding_balance",
        "trust_balance",
        "work_in_progress"
      ].join(",")
    );
    return clioFetch(url);
  }

  function numberFrom(value) {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function balanceFromMatterFields(matter, wantedType) {
    if (!matter) return null;
    const directNames = wantedType === "trust"
      ? ["trust_balance", "trustBalance", "matter_trust_funds", "trust_funds"]
      : ["outstanding_balance", "outstandingBalance", "operating_balance", "balance"];

    for (const name of directNames) {
      const direct = numberFrom(matter[name]);
      if (direct !== null) return direct;
      const nested = numberFrom(matter[name]?.amount ?? matter[name]?.balance);
      if (nested !== null) return nested;
    }

    const arrays = [matter.account_balances, matter.matter_balances].filter(Array.isArray);
    for (const list of arrays) {
      for (const row of list) {
        const type = String(row?.type || row?.account_type || row?.name || "").toLowerCase();
        const balance = numberFrom(row?.balance ?? row?.amount ?? row?.total);
        if (balance === null) continue;
        if (wantedType === "trust" && /(trust|liability|client)/.test(type)) return balance;
        if (wantedType === "operating" && /(operating|asset|receivable|outstanding)/.test(type)) return balance;
      }
    }
    return null;
  }

  async function fetchLatestTrustBalanceForMatter(matterId) {
    let url = new URL("https://app.clio.com/api/v4/bank_transactions.json");
    url.searchParams.set("limit", "200");
    url.searchParams.set("matter_id", matterId);
    url.searchParams.set("type", "liability");
    url.searchParams.set("fields", "id,date,amount,funds_in,funds_out,current_account_balance,matter{id,display_number}");

    const transactions = [];
    while (url) {
      const data = await clioFetch(url);
      transactions.push(...(Array.isArray(data.data) ? data.data : []));
      const next = data?.meta?.paging?.next;
      url = next ? new URL(next) : null;
    }

    transactions.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));

    let runningBalance = 0;
    let lastDate = today;
    for (const tx of transactions) {
      if (tx.date) lastDate = tx.date;
      const current = numberFrom(tx.current_account_balance ?? tx.currentAccountBalance);
      if (current !== null) runningBalance = current;
      else runningBalance += Number(tx.funds_in || 0) - Number(tx.funds_out || 0);
    }

    return { balance: runningBalance, date: lastDate, source: transactions.length ? "bank_transactions" : "no_transactions" };
  }

  async function fetchOutstandingBillBalanceForMatter(matterId) {
    let url = new URL("https://app.clio.com/api/v4/bills");
    url.searchParams.set("limit", "200");
    url.searchParams.set("matter_id", matterId);
    url.searchParams.set("fields", "id,number,state,balance,due,paid,total,matter{id,display_number}");

    let totalBalance = 0;
    let latestDate = today;
    let count = 0;
    while (url) {
      const data = await clioFetch(url);
      for (const bill of Array.isArray(data.data) ? data.data : []) {
        const state = String(bill.state || "").toLowerCase();
        if (["void", "deleted", "draft"].includes(state)) continue;
        const balance = numberFrom(bill.balance ?? bill.due ?? (numberFrom(bill.total) !== null && numberFrom(bill.paid) !== null ? Number(bill.total) - Number(bill.paid) : null));
        if (balance !== null) {
          totalBalance += balance;
          count += 1;
        }
        latestDate = bill.updated_at || bill.due_at || latestDate;
      }
      const next = data?.meta?.paging?.next;
      url = next ? new URL(next) : null;
    }
    return { balance: totalBalance, date: latestDate, source: count ? "bills" : "no_open_bills" };
  }

  try {
    const series = [];

    for (const matterId of matterIds) {
      let matter = null;
      let displayNumber = `Matter ${matterId}`;
      let current = null;

      try {
        const matterResponse = await fetchMatter(matterId);
        matter = matterResponse?.data || null;
        displayNumber = matter?.display_number || displayNumber;
        const direct = balanceFromMatterFields(matter, accountType);
        if (direct !== null) current = { balance: direct, date: today, source: "matter_fields" };
      } catch (_matterError) {
        // Some Clio accounts/minor versions do not expose financial summary fields on matters.
        // Fall through to the transaction/bill endpoints below.
      }

      if (!current) {
        current = accountType === "trust"
          ? await fetchLatestTrustBalanceForMatter(matterId)
          : await fetchOutstandingBillBalanceForMatter(matterId);
      }

      series.push({
        matter_id: matterId,
        display_number: displayNumber,
        account_type: accountType,
        current_balance: current.balance,
        source: current.source,
        points: [
          {
            date: current.date || today,
            balance: current.balance,
            current: true,
            source: current.source,
          },
        ],
      });
    }

    return res.status(200).json({ mode: "current", series });
  } catch (error) {
    return res.status(500).json({
      error: error.message || String(error),
    });
  }
}
