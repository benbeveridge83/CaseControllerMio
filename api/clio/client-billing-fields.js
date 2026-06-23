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
    const d = new Date(`${day}T00:00:00Z`);
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
    if (value === null || value === undefined) return null;
    if (typeof value === "string" && value.trim() === "") return null;
    if (value && typeof value === "object") {
      if ("amount" in value) value = value.amount;
      else if ("cents" in value) value = Number(value.cents) / 100;
      else if ("value" in value) value = value.value;
      else if ("balance" in value) value = value.balance;
      else if ("total" in value) value = value.total;
      else return null;
    }
    if (typeof value === "string") {
      const negative = /^\s*\(.*\)\s*$/.test(value) || /^\s*-/.test(value);
      const cleaned = value.replace(/[$,\s()]/g, "");
      if (!cleaned || cleaned === "-") return null;
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

  async function clioFetch(url, options = {}) {
    const response = await fetch(url.toString(), {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: options.accept || "application/json",
        ...(options.headers || {}),
      },
    });
    const contentType = response.headers.get("content-type") || "";
    let data;
    if (contentType.includes("application/json")) data = await response.json().catch(() => ({}));
    else data = await response.text();
    if (!response.ok) {
      const error = new Error(data?.error?.message || data?.message || data?.error || (typeof data === "string" ? data.slice(0, 300) : `Clio request failed with ${response.status}`));
      error.status = response.status;
      error.payload = data;
      error.url = url.toString();
      throw error;
    }
    return { data, response, contentType };
  }

  async function fetchPaged(path, params = {}, options = {}) {
    let url = new URL(`https://app.clio.com/api/v4/${path}`);
    for (const [key, value] of Object.entries(params || {})) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
    const all = [];
    while (url) {
      const { data } = await clioFetch(url);
      all.push(...(Array.isArray(data.data) ? data.data : []));
      const next = data?.meta?.paging?.next;
      url = next ? new URL(next) : null;
      if (options.maxRecords && all.length >= options.maxRecords) break;
    }
    return all;
  }

  async function fetchMatter(matterId) {
    const url = new URL(`https://app.clio.com/api/v4/matters/${matterId}`);
    url.searchParams.set("fields", "id,display_number,description,status,client{id,name}");
    try {
      const { data } = await clioFetch(url);
      return data?.data || { id: matterId };
    } catch {
      return { id: matterId };
    }
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
        const { data } = await clioFetch(url);
        return data?.data || null;
      } catch {}
    }
    return null;
  }

  function pickEmail(contact) {
    const list = Array.isArray(contact?.email_addresses) ? contact.email_addresses : [];
    const row = list.find((e) => e.primary || e.default_email) || list[0];
    return row?.address || row?.email || "";
  }

  function pickPhone(contact) {
    const list = Array.isArray(contact?.phone_numbers) ? contact.phone_numbers : [];
    const row = list.find((p) => p.primary || p.default_number) || list[0];
    return row?.number || row?.phone || "";
  }

  function txFundsIn(tx) {
    return firstNumber(tx?.funds_in, tx?.fundsIn, tx?.FundsIn, tx?.credit, tx?.credit_amount, tx?.deposit, tx?.deposit_amount);
  }

  function txFundsOut(tx) {
    return firstNumber(tx?.funds_out, tx?.fundsOut, tx?.FundsOut, tx?.debit, tx?.debit_amount, tx?.withdrawal, tx?.withdrawal_amount);
  }

  async function fetchTrustTransactions(matterId) {
    const attempts = [
      "id,date,funds_out,funds_in,running_balance,current_account_balance,matter{id,display_number}",
      "id,date,funds_out,funds_in,matter{id,display_number}",
    ];
    let txs = [];
    for (const fields of attempts) {
      try {
        txs = await fetchPaged("bank_transactions.json", { limit: 200, matter_id: matterId, type: "liability", fields }, { maxRecords: 1000 });
        if (txs.length) break;
      } catch { txs = []; }
    }

    const rows = txs
      .map((tx) => ({
        id: tx.id,
        day: normalizeDay(tx.date || tx.created_at || tx.updated_at),
        fundsIn: Number(txFundsIn(tx) || 0),
        fundsOut: Number(txFundsOut(tx) || 0),
      }))
      .filter((row) => row.day)
      .sort((a, b) => new Date(`${a.day}T00:00:00Z`) - new Date(`${b.day}T00:00:00Z`) || String(a.id).localeCompare(String(b.id)));

    let grossFundsInAll = 0;
    let grossFundsOutAll = 0;
    let grossFundsInSelected = 0;
    let grossFundsOutSelected = 0;

    for (const row of rows) {
      grossFundsInAll += row.fundsIn;
      grossFundsOutAll += row.fundsOut;
      if (!fromDay && !toDay || inRange(row.day)) {
        grossFundsInSelected += row.fundsIn;
        grossFundsOutSelected += row.fundsOut;
      }
    }

    // Clio's matter-filtered trust transactions include mirrored funds_in rows for transfers from trust to operating.
    // Actual trust deposits = gross funds in minus gross funds out. Current trust = actual deposits minus gross funds out.
    const actualTrustFundsInAll = grossFundsInAll - grossFundsOutAll;
    const currentTrust = actualTrustFundsInAll - grossFundsOutAll;
    const actualTrustFundsInSelected = grossFundsInSelected - grossFundsOutSelected;

    return {
      trust_funds_in: Number(Math.max(0, actualTrustFundsInSelected) || 0),
      trust_funds_out: Number(grossFundsOutSelected || 0),
      trust_running_balance: Number(currentTrust || 0),
      gross_funds_in: Number(grossFundsInAll || 0),
      gross_funds_out: Number(grossFundsOutAll || 0),
      actual_trust_funds_in_all: Number(Math.max(0, actualTrustFundsInAll) || 0),
    };
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
        activities = await fetchPaged("activities.json", { limit: 200, matter_id: matterId, fields }, { maxRecords: 1000 });
        break;
      } catch { activities = []; }
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
      let quantity = firstNumber(a.quantity, a.hours, a.time) || 0;
      if (quantity > 24) quantity = quantity / 3600;
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
      if (!isExpense && !nonBillable && !billed) {
        wip += Number(amount || 0);
        foundWip = true;
      }
    }
    return { time_amount: timeAmountSelected, time_hours: timeHoursSelected, expenses: expensesSelected, wip_from_unbilled: foundWip ? wip : null };
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
        bills = await fetchPaged("bills.json", { limit: 200, matter_id: matterId, fields }, { maxRecords: 1000 });
        break;
      } catch { bills = []; }
    }
    let outstanding = 0;
    let found = false;
    for (const bill of bills) {
      const state = String(bill.state || bill.status || "").toLowerCase();
      if (["paid", "void", "deleted"].includes(state)) continue;
      const bal = firstNumber(bill.balance, bill.due, bill.total);
      if (bal !== null) { outstanding += bal; found = true; }
    }
    return found ? outstanding : null;
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quote = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quote) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quote = false;
        else cell += ch;
      } else {
        if (ch === '"') quote = true;
        else if (ch === ',') { row.push(cell); cell = ""; }
        else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ""; }
        else if (ch !== '\r') cell += ch;
      }
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    if (!rows.length) return [];
    const header = rows.shift().map((h) => String(h || "").trim());
    return rows.filter((r) => r.some((c) => String(c || "").trim())).map((r) => {
      const obj = {};
      header.forEach((h, i) => obj[h] = r[i] ?? "");
      return obj;
    });
  }

  async function fetchLatestTrustManagementMap() {
    try {
      const reports = await fetchPaged("reports.json", { limit: 200, fields: "id,name,kind,state,format,progress,category,source,created_at,updated_at" }, { maxRecords: 1000 });
      const trustReports = reports
        .filter((r) => String(r.kind || "").toLowerCase() === "trust_management" && String(r.state || "").toLowerCase() === "completed")
        .sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0) || Number(b.id || 0) - Number(a.id || 0));
      const report = trustReports[0];
      if (!report?.id) return { map: new Map(), report: null, row_count: 0 };
      const downloadUrl = new URL(`https://app.clio.com/api/v4/reports/${report.id}/download.json`);
      const result = await clioFetch(downloadUrl);
      let payload = result.data?.data ?? result.data;
      if (payload && typeof payload === "object") payload = payload.url || payload.download_url || payload.href || payload.file_url || payload.content || payload.csv || "";
      if (!payload || typeof payload !== "string") return { map: new Map(), report, row_count: 0 };
      if (/^https?:\/\//i.test(payload)) {
        const response = await fetch(payload);
        payload = await response.text();
      }
      const rows = parseCsv(payload);
      const map = new Map();
      for (const row of rows) {
        const matterNumber = String(row.Matter || row.matter || "").trim();
        if (!matterNumber || /not linked/i.test(matterNumber)) continue;
        map.set(matterNumber, {
          work_in_progress: numberOrNull(row["Unbilled amount"] ?? row.unbilled_amount ?? row.WIP),
          amount_in_trust: numberOrNull(row["Amount in trust"] ?? row.amount_in_trust),
          client: row.Client || row.client || "",
          report_name: report.name || "",
          report_updated_at: report.updated_at || report.created_at || "",
        });
      }
      return { map, report, row_count: rows.length };
    } catch (error) {
      return { map: new Map(), report: null, row_count: 0, error: error.message || String(error) };
    }
  }

  async function buildRow(matterId, trustReportMap) {
    const matter = await fetchMatter(matterId);
    const contactId = matter?.client?.id || matter?.client_id || null;
    const [trust, activity, billOutstanding, contact] = await Promise.all([
      fetchTrustTransactions(matterId),
      fetchActivities(matterId),
      fetchBillsOutstanding(matterId),
      fetchContact(contactId),
    ]);

    const clientName = matter?.client?.name || contact?.name || "";
    const matterNumber = matter?.display_number || "";
    const reportRow = matterNumber ? trustReportMap.get(matterNumber) : null;
    const matterLabel = `${matterNumber || `Matter ${matterId}`}${matter?.description ? ` ${matter.description}` : ""}${clientName ? ` (${clientName})` : ""}`;

    const reportWip = reportRow?.work_in_progress;
    const reportTrust = reportRow?.amount_in_trust;

    return {
      matter_id: String(matterId),
      matter_label: matterLabel,
      clio_matter_number: matterNumber,
      clio_client_name: clientName,
      clio_contact_id: contactId ? String(contactId) : "",
      clio_client_email: pickEmail(contact),
      clio_client_phone: pickPhone(contact),
      work_in_progress: Number(reportWip ?? activity.wip_from_unbilled ?? 0),
      outstanding_balance: Number(billOutstanding ?? 0),
      matter_trust_funds: Number(reportTrust ?? trust.trust_running_balance ?? 0),
      time_hours: Number(activity.time_hours || 0),
      time_amount: Number(activity.time_amount || 0),
      expenses: Number(activity.expenses || 0),
      trust_funds_out: Number(trust.trust_funds_out || 0),
      trust_funds_in: Number(trust.actual_trust_funds_in_all ?? trust.trust_funds_in ?? 0),
      trust_running_balance: Number(reportTrust ?? trust.trust_running_balance ?? 0),
      trust_report_name: reportRow?.report_name || "",
      trust_report_updated_at: reportRow?.report_updated_at || "",
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
    const trustReport = await fetchLatestTrustManagementMap();
    const settled = await mapWithConcurrency(matterIds, 2, (matterId) => buildRow(matterId, trustReport.map));
    const rows = settled.filter((r) => r.status === "fulfilled" && r.value).map((r) => r.value);
    const failed = settled.filter((r) => r.status === "rejected").length;
    return res.status(200).json({ rows, meta: { requested: matterIds.length, returned: rows.length, failed, from: fromDay, to: toDay, version: "v26", mode: "trust_gross_in_minus_gross_out_trust_report_wip", trust_report: { id: trustReport.report?.id || null, name: trustReport.report?.name || null, updated_at: trustReport.report?.updated_at || null, row_count: trustReport.row_count, error: trustReport.error || null } } });
  } catch (error) {
    return res.status(error.status || 500).json(error.payload || { error: error.message || String(error) });
  }
}
