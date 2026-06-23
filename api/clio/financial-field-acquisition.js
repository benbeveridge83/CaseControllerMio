export default async function handler(req, res) {
  const cookieHeader = req.headers.cookie || "";
  const tokenCookie = cookieHeader.split(";").map((c) => c.trim()).find((c) => c.startsWith("clio_access_token="));
  if (!tokenCookie) return res.status(401).json({ version: "v36", error: "Not authenticated with Clio." });
  const token = tokenCookie.split("=")[1];
  const origin = "https://app.clio.com/api/v4";
  const attempts = [];

  const now = new Date();
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const from = String(req.query.from || sixMonthsAgo.toISOString().slice(0, 10));
  const to = String(req.query.to || now.toISOString().slice(0, 10));
  const matterId = String(req.query.matter_id || "").trim();

  async function fetchPaged(path, params = {}, label = path, maxRows = 5000) {
    let url = new URL(path.startsWith("http") ? path : `${origin}${path}`);
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    });
    const rows = [];
    const localAttempts = [];
    while (url && rows.length < maxRows) {
      const record = { label, url: url.toString() };
      try {
        const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
        const contentType = response.headers.get("content-type") || "";
        const data = contentType.includes("application/json") ? await response.json().catch(() => ({})) : await response.text();
        record.status = response.status;
        record.ok = response.ok;
        record.content_type = contentType;
        if (!response.ok) {
          record.error = data?.error?.message || data?.message || data?.error || (typeof data === "string" ? data.slice(0, 500) : `HTTP ${response.status}`);
          record.payload_sample = typeof data === "string" ? data.slice(0, 1000) : data;
          attempts.push(record);
          localAttempts.push(record);
          return { ok: false, rows: [], attempts: localAttempts, error: record.error };
        }
        const pageRows = Array.isArray(data?.data) ? data.data : [];
        rows.push(...pageRows);
        record.count = pageRows.length;
        record.sample_keys = pageRows[0] && typeof pageRows[0] === "object" ? Object.keys(pageRows[0]) : [];
        record.sample = pageRows.slice(0, 3);
        attempts.push(record);
        localAttempts.push(record);
        const next = data?.meta?.paging?.next;
        url = next ? new URL(next) : null;
      } catch (error) {
        record.ok = false;
        record.error = error.message || String(error);
        attempts.push(record);
        localAttempts.push(record);
        return { ok: false, rows: [], attempts: localAttempts, error: record.error };
      }
    }
    return { ok: true, rows, attempts: localAttempts };
  }

  function reportDate(report) {
    const name = String(report?.name || "");
    const m = name.match(/\((\d{2})\/(\d{2})\/(\d{4})\)/);
    if (m) return `${m[3]}-${m[1]}-${m[2]}`;
    const d = new Date(report?.updated_at || report?.created_at || Date.now());
    return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : "";
  }

  function fieldStatus(field, acquired, source, sample, note = "") {
    return { field, acquired: !!acquired, source, sample: sample || null, note };
  }

  async function contactsIndex() {
    const fieldSets = [
      { label: "contacts primary nested", fields: "id,name,primary_email_address,primary_phone_number,email_addresses{name,address},phone_numbers{name,number}" },
      { label: "contacts simple primary", fields: "id,name,primary_email_address,primary_phone_number" },
      { label: "contacts id name only", fields: "id,name" },
      { label: "contacts default", fields: "" }
    ];
    for (const item of fieldSets) {
      const params = { limit: 200 };
      if (item.fields) params.fields = item.fields;
      const result = await fetchPaged("/contacts.json", params, item.label, 10000);
      if (result.ok) {
        const contacts = result.rows.map((contact) => ({
          id: contact.id,
          name: contact.name || "",
          primary_email_address: contact.primary_email_address || "",
          primary_phone_number: contact.primary_phone_number || "",
          email_addresses: Array.isArray(contact.email_addresses) ? contact.email_addresses : [],
          phone_numbers: Array.isArray(contact.phone_numbers) ? contact.phone_numbers : [],
          raw: contact
        }));
        return { ok: true, contacts, attempts: result.attempts, field_set: item.label };
      }
    }
    return { ok: false, contacts: [], attempts, error: "No contacts field set succeeded." };
  }

  function normalizeBill(bill) {
    const matters = [];
    if (bill?.matter?.display_number) matters.push({ id: bill.matter.id || null, display_number: bill.matter.display_number });
    if (Array.isArray(bill?.matters)) {
      bill.matters.forEach((m) => matters.push({ id: m?.id || null, display_number: m?.display_number || "" }));
    }
    if (Array.isArray(bill?.matter_balances)) {
      bill.matter_balances.forEach((mb) => {
        if (mb?.matter?.display_number) matters.push({ id: mb.matter.id || null, display_number: mb.matter.display_number });
      });
    }
    return {
      id: bill.id,
      number: bill.number || bill.display_number || "",
      state: bill.state || "",
      issued_at: bill.issued_at || bill.sent_at || bill.created_at || null,
      due_at: bill.due_at || null,
      paid_at: bill.paid_at || null,
      total: bill.total ?? bill.total_amount ?? 0,
      balance: bill.balance ?? bill.outstanding_balance ?? 0,
      client: bill.client || null,
      matters,
      matter_balances: Array.isArray(bill.matter_balances) ? bill.matter_balances : [],
      raw: bill
    };
  }

  async function billsIndex() {
    const fieldSets = [
      { label: "bills with matters plural", fields: "id,number,state,issued_at,due_at,paid_at,total,balance,client{id,name},matters{id,display_number}" },
      { label: "bills with client", fields: "id,number,state,issued_at,due_at,paid_at,total,balance,client{id,name}" },
      { label: "bills basic", fields: "id,number,state,issued_at,due_at,paid_at,total,balance" },
      { label: "bills minimal", fields: "id,number,state,total,balance" },
      { label: "bills default", fields: "" }
    ];
    for (const item of fieldSets) {
      const params = { limit: 200 };
      if (item.fields) params.fields = item.fields;
      if (matterId) params.matter_id = matterId;
      const result = await fetchPaged("/bills.json", params, item.label, 10000);
      if (result.ok) {
        const bills = result.rows.map(normalizeBill);
        return { ok: true, bills, attempts: result.attempts, field_set: item.label, bill_count: bills.length };
      }
    }
    return { ok: false, bills: [], attempts, error: "No bills field set succeeded." };
  }

  async function auditV36() {
    const reportsResult = await fetchPaged("/reports.json", {
      limit: 200,
      fields: "id,name,kind,state,format,progress,category,source,created_at,updated_at"
    }, "reports list", 1000);
    const reports = (reportsResult.rows || [])
      .filter((r) => String(r.state || "").toLowerCase() === "completed")
      .map((r) => ({ ...r, report_date: reportDate(r) }))
      .filter((r) => !r.report_date || r.report_date >= from);
    const bills = await billsIndex();
    const contacts = await contactsIndex();
    const activities = await fetchPaged("/activities.json", { limit: 10, fields: "id,date,quantity,price,total,type,non_billable,matter{id,display_number},bill{id,state}", date_from: from, date_to: to }, "activities time/expense sample", 20);
    const bankTransactions = await fetchPaged("/bank_transactions.json", { limit: 10, fields: "id,date,funds_out,funds_in,running_balance,current_account_balance,matter{id,display_number}" }, "bank transactions sample", 20);

    const firstBill = bills.bills?.[0];
    const firstContact = contacts.contacts?.[0];
    const field_matrix = [
      fieldStatus("invoice_total", (bills.bills || []).some((b) => b.total !== undefined), "Bills API total", firstBill, "v36 can index Bills API fields; backfill is latest/current snapshot only."),
      fieldStatus("invoice_balance", (bills.bills || []).some((b) => b.balance !== undefined), "Bills API balance", firstBill, "A/R remains source of truth for outstanding balance; invoice_balance is invoice-specific."),
      fieldStatus("invoice_sent_at", (bills.bills || []).some((b) => b.issued_at), "Bills API issued_at/sent_at", firstBill),
      fieldStatus("paid_amount", (bills.bills || []).some((b) => Number(b.total || 0) > Number(b.balance || 0)), "Calculated from Bills API total - balance", firstBill),
      fieldStatus("client_email", (contacts.contacts || []).some((c) => c.primary_email_address || (Array.isArray(c.email_addresses) && c.email_addresses.length)), "Contacts API", firstContact),
      fieldStatus("client_phone", (contacts.contacts || []).some((c) => c.primary_phone_number || (Array.isArray(c.phone_numbers) && c.phone_numbers.length)), "Contacts API", firstContact),
      fieldStatus("time_hours", (activities.rows || []).some((r) => "quantity" in r), "Activities API quantity", activities.rows?.[0], "Still not trusted for snapshots until date filtering is proven."),
      fieldStatus("trust_funds_in", (bankTransactions.rows || []).some((r) => "funds_in" in r), "Bank transactions API funds_in", bankTransactions.rows?.[0], "Still needs mirror-transfer cleanup.")
    ];
    return {
      version: "v36",
      from,
      to,
      report_summary: {
        completed_reports_last_6_months: reports.length,
        trust_management_reports: reports.filter((r) => String(r.kind || "").toLowerCase() === "trust_management").length,
        matter_balance_summary_reports: reports.filter((r) => String(r.kind || "").toLowerCase() === "matter_balance_summary").length,
        accounts_receivable_reports: reports.filter((r) => String(r.kind || "").toLowerCase() === "accounts_receivable").length
      },
      bill_summary: { ok: bills.ok, field_set: bills.field_set, bill_count: bills.bill_count || 0, sample: firstBill || null },
      contact_summary: { ok: contacts.ok, field_set: contacts.field_set, contact_count: contacts.contacts?.length || 0, sample: firstContact || null },
      field_matrix,
      attempts
    };
  }

  try {
    const action = String(req.query.action || "audit_v36");
    if (action === "contacts_index") {
      const result = await contactsIndex();
      if (!result.ok) return res.status(422).json({ version: "v36", error: result.error || "Contact index failed", attempts: result.attempts || [] });
      return res.status(200).json({ version: "v36", contacts: result.contacts, contact_count: result.contacts.length, field_set: result.field_set, attempts: result.attempts || [] });
    }
    if (action === "bills_index") {
      const result = await billsIndex();
      if (!result.ok) return res.status(422).json({ version: "v36", error: result.error || "Bills index failed", attempts: result.attempts || [] });
      return res.status(200).json({ version: "v36", bills: result.bills, bill_count: result.bills.length, field_set: result.field_set, attempts: result.attempts || [] });
    }
    const result = await auditV36();
    return res.status(200).json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ version: "v36", error: error.message || String(error), attempts });
  }
}
