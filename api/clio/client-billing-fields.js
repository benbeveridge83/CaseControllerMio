export default async function handler(req, res) {
  const cookieHeader = req.headers.cookie || "";
  const tokenCookie = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("clio_access_token="));

  if (!tokenCookie) return res.status(401).json({ error: "Not authenticated" });

  const token = tokenCookie.split("=")[1];
  const matterIds = String(req.query.matter_ids || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

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
      else if ("value" in value) value = value.value;
      else if ("balance" in value) value = value.balance;
      else if ("total" in value) value = value.total;
      else return null;
    }
    if (typeof value === "string") {
      const cleaned = value.replace(/[$,\s]/g, "");
      if (cleaned === "") return null;
      value = cleaned;
    }
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

  function flattenNumericFields(obj, path = "", out = []) {
    if (obj === null || obj === undefined) return out;
    const n = numberOrNull(obj);
    if (n !== null && (typeof obj !== "object" || obj instanceof String)) {
      out.push({ path, value: n });
      return out;
    }
    if (Array.isArray(obj)) {
      obj.forEach((item, index) => flattenNumericFields(item, `${path} ${index}`, out));
      return out;
    }
    if (typeof obj === "object") {
      const labelBits = [
        obj.name,
        obj.label,
        obj.type,
        obj.account_type,
        obj.category,
        obj.key,
        obj.description,
      ].filter(Boolean).join(" ");
      for (const [key, value] of Object.entries(obj)) {
        flattenNumericFields(value, `${path} ${key} ${labelBits}`, out);
      }
    }
    return out;
  }

  function findNumericByKeywords(obj, positiveRegex, negativeRegex = null) {
    const fields = flattenNumericFields(obj);
    for (const row of fields) {
      const p = String(row.path || "").toLowerCase();
      if (positiveRegex.test(p) && !(negativeRegex && negativeRegex.test(p))) return row.value;
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

  async function fetchPaged(path, params, fallbackPaths = []) {
    const paths = [path, ...fallbackPaths];
    let lastError = null;
    for (const p of paths) {
      try {
        let url = new URL(`https://app.clio.com/api/v4/${p}`);
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
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error(`Could not fetch ${path}`);
  }

  async function fetchMatter(matterId) {
    const fieldSets = [
      "id,display_number,description,status,client{id,name},account_balances",
      "id,display_number,description,status,client{id,name},work_in_progress",
      "id,display_number,description,status,client{id,name},wip",
      "id,display_number,description,status,client{id,name},unbilled_balance",
      "id,display_number,description,status,client{id,name},outstanding_balance",
      "id,display_number,description,status,client{id,name},accounts_receivable_balance",
      "id,display_number,description,status,client{id,name},trust_balance",
      "id,display_number,description,status,client{id,name},trust_account_balance",
      "id,display_number,description,status,client{id,name}",
    ];

    let merged = null;
    for (const fields of fieldSets) {
      const url = new URL(`https://app.clio.com/api/v4/matters/${matterId}`);
      url.searchParams.set("fields", fields);
      try {
        const data = await clioFetch(url);
        merged = { ...(merged || {}), ...(data?.data || {}) };
      } catch {
        // Clio rejects unknown fields. Keep trying smaller requests.
      }
    }
    return merged || { id: matterId };
  }

  function matterWip(matter) {
    return firstNumber(
      matter?.work_in_progress,
      matter?.work_in_progress_balance,
      matter?.wip,
      matter?.unbilled_balance,
      findNumericByKeywords(matter?.account_balances, /(work|progress|wip|unbilled)/i)
    );
  }

  function matterOutstanding(matter) {
    return firstNumber(
      matter?.outstanding_balance,
      matter?.accounts_receivable_balance,
      matter?.account_balance,
      matter?.balance,
      matter?.total_balance,
      findNumericByKeywords(matter?.account_balances, /(outstanding|receivable|owed|owing|balance)/i, /(trust|liability|client|work|progress|wip|unbilled)/i)
    );
  }

  function matterTrust(matter) {
    return firstNumber(
      matter?.trust_balance,
      matter?.trust_account_balance,
      matter?.matter_trust_funds,
      matter?.funds_in_trust,
      findNumericByKeywords(matter?.account_balances, /(trust|liability|client)/i, /(work|progress|wip|unbilled|outstanding|receivable)/i)
    );
  }

  async function fetchTrustTransactions(matterId) {
    const fieldAttempts = [
      "id,date,funds_out,funds_in,amount,running_balance,current_account_balance,matter{id,display_number}",
      "id,date,funds_out,funds_in,amount,current_account_balance",
      "id,date,amount",
    ];
    let txs = [];
    for (const fields of fieldAttempts) {
      try {
        txs = await fetchPaged("bank_transactions.json", {
          limit: 200,
          matter_id: matterId,
          type: "liability",
          fields,
        }, ["bank_transactions"]);
        break;
      } catch {
        txs = [];
      }
    }

    let fundsIn = 0;
    let fundsOut = 0;
    let running = 0;

    for (const tx of txs.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0))) {
      const day = tx.date ? String(tx.date).slice(0, 10) : null;
      const txFundsIn = numberOrNull(tx.funds_in) || 0;
      const txFundsOut = numberOrNull(tx.funds_out) || 0;
      const explicit = firstNumber(tx.running_balance, tx.runningBalance, tx.current_account_balance, tx.currentAccountBalance);
      if (explicit !== null) running = explicit;
      else running += txFundsIn - txFundsOut;

      if (!day || !inRange(day)) continue;
      fundsIn += txFundsIn;
      fundsOut += txFundsOut;
    }

    return { trust_funds_in: fundsIn, trust_funds_out: fundsOut, trust_running_balance: Number(running || 0) };
  }

  async function fetchActivities(matterId) {
    const fieldAttempts = [
      "id,date,total,price,quantity,non_billable,billed,bill{id,state,status},type,activity_type",
      "id,date,total,quantity,non_billable,billed,bill{id,state,status}",
      "id,date,total,quantity",
    ];

    let activities = [];
    for (const fields of fieldAttempts) {
      try {
        activities = await fetchPaged("activities.json", {
          limit: 200,
          matter_id: matterId,
          fields,
        }, ["activities"]);
        break;
      } catch {
        activities = [];
      }
    }

    let timeAmount = 0;
    let timeHours = 0;
    let expenses = 0;
    let wip = 0;
    let foundWip = false;

    for (const a of activities) {
      const day = a.date ? String(a.date).slice(0, 10) : null;
      const inSelectedRange = !day || inRange(day);
      const amount = firstNumber(a.total, a.price) || 0;
      const quantity = firstNumber(a.quantity) || 0;
      const typeText = String(a.type || a.activity_type || a.activityType || "").toLowerCase();
      const isExpense = /expense/.test(typeText);
      const nonBillable = a.non_billable === true;
      const hasBilledFlag = Object.prototype.hasOwnProperty.call(a, "billed");
      const billState = String(a.bill?.state || a.bill?.status || "").toLowerCase();
      const clearlyBilled = a.billed === true || Boolean(a.bill?.id) || ["draft", "awaiting_payment", "paid", "approved", "sent"].includes(billState);

      if (inSelectedRange) {
        if (isExpense) expenses += amount;
        else {
          timeAmount += amount;
          timeHours += quantity;
        }
      }

      if (!isExpense && !nonBillable && !clearlyBilled && (hasBilledFlag || "bill" in a)) {
        wip += amount;
        foundWip = true;
      }
    }

    return { time_amount: timeAmount, time_hours: timeHours, expenses, wip_from_unbilled: foundWip ? wip : null };
  }

  async function fetchBills(matterId) {
    const fieldAttempts = [
      "id,state,status,total,balance,due,paid,matters{id,display_number}",
      "id,state,total,balance",
      "id,total",
    ];
    let bills = [];
    for (const fields of fieldAttempts) {
      try {
        bills = await fetchPaged("bills.json", {
          limit: 200,
          matter_id: matterId,
          fields,
        }, ["bills"]);
        break;
      } catch {
        bills = [];
      }
    }

    let outstanding = 0;
    let found = false;
    for (const bill of bills) {
      const state = String(bill.state || bill.status || "").toLowerCase();
      if (["paid", "void", "deleted"].includes(state)) continue;
      const bal = firstNumber(bill.balance, bill.due, bill.total);
      if (bal !== null) {
        outstanding += bal;
        found = true;
      }
    }
    return found ? outstanding : null;
  }

  async function buildRow(matterId) {
    const matter = await fetchMatter(matterId)
    const contactId = matter?.client?.id || matter?.client_id || matter?.clientId
    const [trust, activity, billOutstanding, contactDetails, reportFinancials] = await Promise.all([
      fetchTrustTransactions(matterId),
      fetchActivities(matterId),
      fetchBills(matterId),
      fetchContactDetails(contactId),
      fetchReportFinancials(matterId).catch(() => ({})),
    ]);

    const wip = matterWip(matter);
    const outstanding = matterOutstanding(matter);
    const trustBalance = matterTrust(matter);

    const clientName = matter?.client?.name || "";
    const matterLabel = `${matter?.display_number || `Matter ${matterId}`}${matter?.description ? ` ${matter.description}` : ""}${clientName ? ` (${clientName})` : ""}`;

    return {
      matter_id: String(matterId),
      matter_label: matterLabel,
      clio_matter_number: matter?.display_number || "",
      clio_client_name: clientName,
      clio_contact_id: contactDetails.clio_contact_id || (contactId ? String(contactId) : ""),
      clio_client_email: contactDetails.clio_client_email || "",
      clio_client_phone: contactDetails.clio_client_phone || "",
      work_in_progress: Number(wip ?? reportFinancials.work_in_progress ?? activity.wip_from_unbilled ?? 0),
      outstanding_balance: Number(outstanding ?? reportFinancials.outstanding_balance ?? billOutstanding ?? 0),
      matter_trust_funds: Number(trustBalance ?? trust.trust_running_balance ?? 0),
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
        try { results[currentIndex] = { status: "fulfilled", value: await mapper(items[currentIndex]) }; }
        catch (error) { results[currentIndex] = { status: "rejected", reason: error }; }
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
  }

  try {
    const settled = await mapWithConcurrency(matterIds, 3, buildRow);
    const rows = settled.filter((r) => r.status === "fulfilled" && r.value).map((r) => r.value);
    const failed = settled.filter((r) => r.status === "rejected").length;
    return res.status(200).json({ rows, meta: { requested: matterIds.length, returned: rows.length, failed, from: fromDay, to: toDay, mode: "billing_fields_recursive_account_balances" } });
  } catch (error) {
    return res.status(error.status || 500).json(error.payload || { error: error.message || String(error) });
  }
}
