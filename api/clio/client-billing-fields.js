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

  const fromDay = req.query.from ? String(req.query.from).slice(0, 10) : null;
  const toDay = req.query.to ? String(req.query.to).slice(0, 10) : null;

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

  async function fetchMatter(matterId) {
    const fieldSets = [
      "id,display_number,description,status,client{id,name},account_balances",
      "id,display_number,description,status,client{id,name},work_in_progress,outstanding_balance,trust_balance,expenses,total_expenses",
      "id,display_number,description,status,client{id,name}",
    ];

    for (const fields of fieldSets) {
      const url = new URL(`https://app.clio.com/api/v4/matters/${matterId}`);
      url.searchParams.set("fields", fields);
      try {
        const data = await clioFetch(url);
        return data?.data || null;
      } catch {
        // try next
      }
    }
    return null;
  }

  function numericFromAccountBalances(matter, wantedType) {
    const accountBalances = matter?.account_balances || matter?.accountBalances || [];
    const rows = Array.isArray(accountBalances)
      ? accountBalances
      : Object.entries(accountBalances || {}).map(([key, value]) => ({ key, ...(typeof value === "object" ? value : { value }) }));

    for (const row of rows) {
      const label = String(row?.type || row?.account_type || row?.category || row?.name || row?.key || "").toLowerCase();
      if (wantedType === "trust" && !/trust|liability|client/.test(label)) continue;
      if (wantedType === "wip" && !/work|progress|wip|unbilled/.test(label)) continue;
      if (wantedType === "outstanding" && !/outstanding|receivable|balance|owing/.test(label)) continue;
      const n = firstNumber(row?.balance, row?.amount, row?.value, row?.total, row?.current_balance, row?.currentBalance);
      if (n !== null) return n;
    }
    return null;
  }

  async function fetchTrustTransactions(matterId) {
    const txs = await fetchPaged("bank_transactions.json", {
      limit: 200,
      matter_id: matterId,
      type: "liability",
      fields: "id,date,funds_out,funds_in,amount,running_balance,current_account_balance,matter{id,display_number}",
    }).catch(() => []);

    let fundsIn = 0;
    let fundsOut = 0;
    let running = null;
    let computed = 0;

    for (const tx of txs.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0))) {
      const day = tx.date ? String(tx.date).slice(0, 10) : null;
      const txFundsIn = numberOrNull(tx.funds_in) || 0;
      const txFundsOut = numberOrNull(tx.funds_out) || 0;
      const explicit = firstNumber(tx.running_balance, tx.current_account_balance);
      if (explicit !== null) computed = explicit;
      else computed += txFundsIn - txFundsOut;
      running = computed;

      if (!day || !inRange(day)) continue;
      fundsIn += txFundsIn;
      fundsOut += txFundsOut;
    }

    return { trust_funds_in: fundsIn, trust_funds_out: fundsOut, trust_running_balance: Number(running || 0) };
  }

  async function fetchActivities(matterId) {
    const activities = await fetchPaged("activities.json", {
      limit: 200,
      matter_id: matterId,
      fields: "id,date,total,price,quantity,non_billable,billed,bill{id,state,status},type",
    }).catch(() => []);

    let timeAmount = 0;
    let timeHours = 0;
    let expenses = 0;
    let wipFromUnbilled = 0;
    let foundWip = false;

    for (const a of activities) {
      const day = a.date ? String(a.date).slice(0, 10) : null;
      if (day && !inRange(day)) continue;
      const amount = firstNumber(a.total, a.price) || 0;
      const quantity = firstNumber(a.quantity) || 0;
      const typeText = String(a.type || a.activity_type || "").toLowerCase();
      const isExpense = /expense/.test(typeText);
      const isNonBillable = a.non_billable === true;
      const billState = String(a.bill?.state || a.bill?.status || "").toLowerCase();
      const clearlyBilled = a.billed === true || Boolean(a.bill?.id) || ["draft", "awaiting_payment", "paid", "approved", "sent"].includes(billState);

      if (isExpense) expenses += amount;
      else {
        timeAmount += amount;
        timeHours += quantity;
      }

      if (!isExpense && !isNonBillable && !clearlyBilled && (Object.prototype.hasOwnProperty.call(a, "billed") || "bill" in a)) {
        wipFromUnbilled += amount;
        foundWip = true;
      }
    }

    return { time_amount: timeAmount, time_hours: timeHours, expenses, wip_from_unbilled: foundWip ? wipFromUnbilled : null };
  }

  async function buildRow(matterId) {
    const [matter, trust, activity] = await Promise.all([
      fetchMatter(matterId),
      fetchTrustTransactions(matterId),
      fetchActivities(matterId),
    ]);

    const matterTrust = firstNumber(numericFromAccountBalances(matter, "trust"), matter?.trust_balance, matter?.trust_account_balance, matter?.matter_trust_funds);
    const matterWip = firstNumber(numericFromAccountBalances(matter, "wip"), matter?.work_in_progress, matter?.work_in_progress_balance, matter?.wip, matter?.unbilled_balance);
    const outstanding = firstNumber(numericFromAccountBalances(matter, "outstanding"), matter?.outstanding_balance, matter?.account_balance, matter?.balance, matter?.total_balance);

    const clientName = matter?.client?.name || "";
    const matterLabel = `${matter?.display_number || `Matter ${matterId}`}${matter?.description ? ` ${matter.description}` : ""}${clientName ? ` (${clientName})` : ""}`;

    return {
      matter_id: String(matterId),
      matter_label: matterLabel,
      clio_matter_number: matter?.display_number || "",
      clio_client_name: clientName,
      work_in_progress: Number(matterWip ?? activity.wip_from_unbilled ?? 0),
      outstanding_balance: Number(outstanding || 0),
      matter_trust_funds: Number(matterTrust ?? trust.trust_running_balance ?? 0),
      time_hours: Number(activity.time_hours || 0),
      time_amount: Number(activity.time_amount || 0),
      expenses: Number(activity.expenses || 0),
      trust_funds_out: Number(trust.trust_funds_out || 0),
      trust_funds_in: Number(trust.trust_funds_in || 0),
      trust_running_balance: Number(trust.trust_running_balance || 0),
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
    const settled = await mapWithConcurrency(matterIds, 4, buildRow);
    const rows = settled.filter((r) => r.status === "fulfilled" && r.value).map((r) => r.value);
    const failed = settled.filter((r) => r.status === "rejected").length;
    return res.status(200).json({ rows, meta: { requested: matterIds.length, returned: rows.length, failed, from: fromDay, to: toDay } });
  } catch (error) {
    return res.status(error.status || 500).json(error.payload || { error: error.message || String(error) });
  }
}