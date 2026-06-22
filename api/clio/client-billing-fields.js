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

  function normalizeDay(value) {
    if (!value) return null;
    const s = String(value).slice(0, 10);
    return asDate(s) ? s : null;
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
      const cleaned = value.replace(/[$,\s]/g, "").replace(/[()]/g, "");
      if (!cleaned || cleaned === "-") return null;
      const negative = /\(.*\)/.test(value) || /^-/.test(cleaned);
      value = negative && !cleaned.startsWith("-") ? `-${cleaned}` : cleaned;
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

  async function fetchPaged(path, params = {}, options = {}) {
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
      if (options.maxRecords && all.length >= options.maxRecords) break;
    }
    return all;
  }

  async function fetchMatter(matterId) {
    const attempts = [
      "id,display_number,description,status,client{id,name},work_in_progress,work_in_progress_balance,wip,unbilled_balance,outstanding_balance,accounts_receivable_balance,trust_balance,trust_account_balance,matter_trust_funds,funds_in_trust",
      "id,display_number,description,status,client{id,name}",
    ];
    let merged = null;
    for (const fields of attempts) {
      const url = new URL(`https://app.clio.com/api/v4/matters/${matterId}`);
      url.searchParams.set("fields", fields);
      try {
        const data = await clioFetch(url);
        merged = { ...(merged || {}), ...(data?.data || {}) };
      } catch {
        // Optional fields vary by account/API version.
      }
    }
    return merged || { id: matterId };
  }

  async function fetchContact(contactId) {
    if (!contactId) return null;
    const attempts = [
      "id,name,email_addresses,phone_numbers",
      "id,name,email_addresses{address,name,default_email,primary},phone_numbers{number,name,default_number,primary}",
      "id,name",
    ];
    for (const fields of attempts) {
      const url = new URL(`https://app.clio.com/api/v4/contacts/${contactId}`);
      url.searchParams.set("fields", fields);
      try {
        const data = await clioFetch(url);
        return data?.data || null;
      } catch {
        // Try next field set.
      }
    }
    return null;
  }

  function pickEmail(contact) {
    const list = Array.isArray(contact?.email_addresses) ? contact.email_addresses : [];
    const row = list.find((e) => e.primary || e.default_email) || list[0];
    return row?.address || row?.email || row?.name || "";
  }

  function pickPhone(contact) {
    const list = Array.isArray(contact?.phone_numbers) ? contact.phone_numbers : [];
    const row = list.find((p) => p.primary || p.default_number) || list[0];
    return row?.number || row?.phone || row?.name || "";
  }

  function txExplicitBalance(tx) {
    return firstNumber(
      tx?.running_balance,
      tx?.runningBalance,
      tx?.current_account_balance,
      tx?.currentAccountBalance,
      tx?.account_balance,
      tx?.accountBalance,
      tx?.balance_after,
      tx?.balanceAfter,
      tx?.ending_balance,
      tx?.endingBalance,
      tx?.current_balance,
      tx?.currentBalance
    );
  }

  function txFundsIn(tx) {
    return firstNumber(tx?.funds_in, tx?.fundsIn, tx?.funds_in_amount, tx?.credit, tx?.credit_amount, tx?.deposit, tx?.deposits);
  }

  function txFundsOut(tx) {
    return firstNumber(tx?.funds_out, tx?.fundsOut, tx?.funds_out_amount, tx?.debit, tx?.debit_amount, tx?.withdrawal, tx?.withdrawals);
  }

  async function fetchTrustTransactions(matterId) {
    const attempts = [
      { fields: "id,date,funds_out,funds_in,running_balance,current_account_balance,account_balance,balance_after,ending_balance,current_balance,matter{id,display_number}" },
      { fields: "id,date,funds_out,funds_in,running_balance,current_account_balance,matter{id,display_number}" },
      { fields: "id,date,funds_out,funds_in,matter{id,display_number}" },
      { fields: "id,date,amount,matter{id,display_number}" },
      { fields: null },
    ];
    let txs = [];
    for (const attempt of attempts) {
      try {
        const params = { limit: 200, matter_id: matterId, type: "liability" };
        if (attempt.fields) params.fields = attempt.fields;
        txs = await fetchPaged("bank_transactions.json", params, { maxRecords: 500 });
        if (txs.length || !attempt.fields) break;
      } catch {
        txs = [];
      }
    }

    let running = 0;
    let fundsInSelected = 0;
    let fundsOutSelected = 0;
    const rows = txs.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));

    for (const tx of rows) {
      const day = normalizeDay(tx.date || tx.created_at || tx.updated_at);
      const explicit = txExplicitBalance(tx);
      const fundsIn = txFundsIn(tx) || 0;
      const fundsOut = txFundsOut(tx) || 0;
      const amount = firstNumber(tx?.amount);
      if (explicit !== null) running = Number(explicit);
      else if (fundsIn || fundsOut) running += Number(fundsIn) - Number(fundsOut);
      else if (amount !== null) running += Number(amount);

      if (day && inRange(day)) {
        fundsInSelected += Number(fundsIn || 0);
        fundsOutSelected += Number(fundsOut || 0);
      }
    }

    return { trust_funds_in: fundsInSelected, trust_funds_out: fundsOutSelected, trust_running_balance: Number(running || 0) };
  }

  async function fetchActivities(matterId) {
    const attempts = [
      "id,date,total,price,quantity,non_billable,billed,bill{id,state,status},type,activity_type",
      "id,date,total,price,quantity,non_billable,billed,bill{id}",
      "id,date,total,price,quantity",
    ];
    let activities = [];
    for (const fields of attempts) {
      try {
        activities = await fetchPaged("activities.json", { limit: 200, matter_id: matterId, fields }, { maxRecords: 500 });
        break;
      } catch {
        activities = [];
      }
    }

    let timeAmountSelected = 0;
    let timeHoursSelected = 0;
    let expensesSelected = 0;
    let wip = 0;
    let foundWip = false;

    for (const a of activities) {
      const day = normalizeDay(a.date || a.created_at || a.updated_at);
      const inSelectedRange = !day || inRange(day);
      const amount = firstNumber(a.total, a.price, a.amount) || 0;
      const quantity = firstNumber(a.quantity, a.hours, a.time) || 0;
      const typeText = String(a.type || a.activity_type || a.activityType || "").toLowerCase();
      const isExpense = /expense/.test(typeText);
      const nonBillable = a.non_billable === true;
      const billState = String(a.bill?.state || a.bill?.status || "").toLowerCase();
      const billed = a.billed === true || Boolean(a.bill?.id) || ["draft", "awaiting_payment", "paid", "approved", "sent"].includes(billState);

      if (inSelectedRange) {
        if (isExpense) expensesSelected += Number(amount || 0);
        else {
          timeAmountSelected += Number(amount || 0);
          timeHoursSelected += Number(quantity || 0);
        }
      }

      // Current WIP is all billable, not billed time/expenses. Do not limit this by the selected date range.
      if (!isExpense && !nonBillable && !billed) {
        wip += Number(amount || 0);
        foundWip = true;
      }
    }

    return {
      time_amount: timeAmountSelected,
      time_hours: timeHoursSelected,
      expenses: expensesSelected,
      wip_from_unbilled: foundWip ? wip : null,
    };
  }

  async function fetchBillsOutstanding(matterId) {
    const attempts = [
      "id,state,status,total,balance,due,paid,matters{id,display_number}",
      "id,state,status,total,balance,due,paid",
      "id,total,balance",
    ];
    let bills = [];
    for (const fields of attempts) {
      try {
        bills = await fetchPaged("bills.json", { limit: 200, matter_id: matterId, fields }, { maxRecords: 500 });
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
    const matter = await fetchMatter(matterId);
    const contactId = matter?.client?.id || matter?.client_id || null;
    const [trust, activity, billOutstanding, contact] = await Promise.all([
      fetchTrustTransactions(matterId),
      fetchActivities(matterId),
      fetchBillsOutstanding(matterId),
      fetchContact(contactId),
    ]);

    const directWip = firstNumber(matter?.work_in_progress, matter?.work_in_progress_balance, matter?.wip, matter?.unbilled_balance);
    const directOutstanding = firstNumber(matter?.outstanding_balance, matter?.accounts_receivable_balance);
    const directTrust = firstNumber(matter?.trust_balance, matter?.trust_account_balance, matter?.matter_trust_funds, matter?.funds_in_trust);

    const clientName = matter?.client?.name || contact?.name || "";
    const matterLabel = `${matter?.display_number || `Matter ${matterId}`}${matter?.description ? ` ${matter.description}` : ""}${clientName ? ` (${clientName})` : ""}`;

    return {
      matter_id: String(matterId),
      matter_label: matterLabel,
      clio_matter_number: matter?.display_number || "",
      clio_client_name: clientName,
      clio_contact_id: contactId ? String(contactId) : "",
      clio_client_email: pickEmail(contact),
      clio_client_phone: pickPhone(contact),
      work_in_progress: Number(directWip ?? activity.wip_from_unbilled ?? 0),
      outstanding_balance: Number(directOutstanding ?? billOutstanding ?? 0),
      matter_trust_funds: Number(directTrust ?? trust.trust_running_balance ?? 0),
      time_hours: Number(activity.time_hours || 0),
      time_amount: Number(activity.time_amount || 0),
      expenses: Number(activity.expenses || 0),
      trust_funds_out: Number(trust.trust_funds_out || 0),
      trust_funds_in: Number(trust.trust_funds_in || 0),
      trust_running_balance: Number(directTrust ?? trust.trust_running_balance ?? 0),
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
    return res.status(200).json({ rows, meta: { requested: matterIds.length, returned: rows.length, failed, from: fromDay, to: toDay, version: "v20", mode: "net_trust_bills_outstanding_unbilled_activity_wip" } });
  } catch (error) {
    return res.status(error.status || 500).json(error.payload || { error: error.message || String(error) });
  }
}
