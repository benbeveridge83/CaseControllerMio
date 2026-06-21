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

  const accountType = req.query.account_type === "operating" ? "asset" : "liability";
  const from = req.query.from ? new Date(req.query.from) : null;
  const to = req.query.to ? new Date(req.query.to) : null;

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
      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.error?.message ||
            data?.message ||
            `Clio bank transactions failed for matter ${matterId}`
        );
      }

      all.push(...(Array.isArray(data.data) ? data.data : []));

      const next = data?.meta?.paging?.next;
      url = next ? new URL(next) : null;
    }

    return all;
  }

  try {
    const series = [];

    for (const matterId of matterIds) {
      const transactions = await fetchAllTransactionsForMatter(matterId);

      const filtered = transactions
        .filter((tx) => tx.date)
        .filter((tx) => {
          const d = new Date(tx.date);
          if (from && d < from) return false;
          if (to && d > to) return false;
          return true;
        })
        .sort((a, b) => new Date(a.date) - new Date(b.date));

      let runningBalance = 0;

      const points = filtered.map((tx) => {
        const balance =
          tx.current_account_balance ??
          tx.currentAccountBalance ??
          null;

        if (balance !== null && balance !== undefined) {
          runningBalance = Number(balance) || 0;
        } else {
          runningBalance += Number(tx.funds_in || 0) - Number(tx.funds_out || 0);
        }

        return {
          date: tx.date,
          balance: runningBalance,
          transaction_id: tx.id,
        };
      });

      const displayNumber =
        filtered[0]?.matter?.display_number || `Matter ${matterId}`;

      series.push({
        matter_id: matterId,
        display_number: displayNumber,
        account_type: req.query.account_type || "trust",
        points,
      });
    }

    return res.status(200).json({ series });
  } catch (error) {
    return res.status(500).json({
      error: error.message || String(error),
    });
  }
}