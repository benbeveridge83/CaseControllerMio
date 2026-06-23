export default async function handler(req, res) {
  const cookieHeader = req.headers.cookie || "";
  const tokenCookie = cookieHeader.split(";").map((c) => c.trim()).find((c) => c.startsWith("clio_access_token="));
  if (!tokenCookie) return res.status(401).json({ version: "v30", error: "Not authenticated with Clio." });
  const token = tokenCookie.split("=")[1];

  const origin = "https://app.clio.com/api/v4";
  const attempts = [];
  const now = new Date();
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const from = String(req.query.from || sixMonthsAgo.toISOString().slice(0, 10));
  const to = String(req.query.to || now.toISOString().slice(0, 10));
  const matterId = String(req.query.matter_id || "").trim();

  async function clioFetch(path, params = {}, label = path) {
    const url = new URL(path.startsWith("http") ? path : `${origin}${path}`);
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    });
    const record = { label, url: url.toString().replace(/access_token=[^&]+/g, "access_token=REDACTED") };
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
        return { ok: false, response, data, error: record.error };
      }
      const rows = Array.isArray(data?.data) ? data.data : [];
      record.count = rows.length;
      record.sample_keys = rows[0] && typeof rows[0] === "object" ? Object.keys(rows[0]) : [];
      record.sample = rows.slice(0, 3);
      attempts.push(record);
      return { ok: true, response, data, rows, contentType };
    } catch (error) {
      record.ok = false;
      record.error = error.message || String(error);
      attempts.push(record);
      return { ok: false, error: record.error };
    }
  }

  function reportDate(report) {
    const name = String(report?.name || "");
    const m = name.match(/\((\d{2})\/(\d{2})\/(\d{4})\)/);
    if (m) return `${m[3]}-${m[1]}-${m[2]}`;
    const d = new Date(report?.updated_at || report?.created_at || Date.now());
    return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : "";
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    const input = String(text || "");
    for (let i = 0; i < input.length; i += 1) {
      const ch = input[i];
      const next = input[i + 1];
      if (ch === '"') {
        if (inQuotes && next === '"') { field += '"'; i += 1; }
        else inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        row.push(field); field = "";
      } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
        if (ch === "\r" && next === "\n") i += 1;
        row.push(field);
        if (row.some((cell) => String(cell).trim() !== "")) rows.push(row);
        row = []; field = "";
      } else field += ch;
    }
    row.push(field);
    if (row.some((cell) => String(cell).trim() !== "")) rows.push(row);
    if (!rows.length) return { headers: [], rows: [] };
    const headers = rows[0].map((h) => String(h || "").trim());
    const objects = rows.slice(1).map((cells) => {
      const obj = {};
      headers.forEach((h, idx) => { obj[h] = cells[idx] ?? ""; });
      return obj;
    });
    return { headers, rows: objects };
  }

  function fieldStatus(label, ok, source, sample) {
    return { field: label, acquired: !!ok, source, sample: sample ?? null };
  }

  async function downloadReport(report) {
    if (!report?.id) return null;
    const url = new URL(`${origin}/reports/${encodeURIComponent(report.id)}/download.json`);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json") ? await response.json().catch(() => ({})) : await response.text();
    if (!response.ok) return { error: data?.message || data?.error || `HTTP ${response.status}`, raw: data };
    let payload = data?.data ?? data;
    if (payload && typeof payload === "object") payload = payload.url || payload.download_url || payload.href || payload.file_url || payload.content || payload.csv || "";
    if (typeof payload === "string" && /^https?:\/\//i.test(payload)) {
      const remote = await fetch(payload);
      payload = await remote.text();
    }
    return typeof payload === "string" ? parseCsv(payload) : { error: "No CSV payload recognized", raw: data };
  }

  try {
    const reportsResult = await clioFetch("/reports.json", {
      limit: 200,
      fields: "id,name,kind,state,format,progress,category,source,created_at,updated_at"
    }, "reports list");
    const allReports = (reportsResult.rows || [])
      .filter((r) => String(r.state || "").toLowerCase() === "completed")
      .map((r) => ({ ...r, report_date: reportDate(r) }))
      .filter((r) => !r.report_date || r.report_date >= from)
      .sort((a, b) => new Date(b.report_date || b.updated_at || 0) - new Date(a.report_date || a.updated_at || 0));
    const trustReports = allReports.filter((r) => String(r.kind || "").toLowerCase() === "trust_management" || /trust management/i.test(String(r.name || "")));
    const matterBalanceReports = allReports.filter((r) => String(r.kind || "").toLowerCase() === "matter_balance_summary" || /matter balance summary/i.test(String(r.name || "")));
    const billingReports = allReports.filter((r) => /balance|billing|receivable|invoice|trust|work in progress|wip/i.test(`${r.kind || ""} ${r.name || ""} ${r.category || ""}`));

    const newestTrustReport = trustReports[0] || null;
    const newestMatterBalanceReport = matterBalanceReports[0] || null;
    const trustCsv = await downloadReport(newestTrustReport);
    const matterBalanceCsv = await downloadReport(newestMatterBalanceReport);

    const mattersParams = { limit: 5, fields: "id,display_number,description,status,client{id,name}" };
    if (matterId) mattersParams.ids = matterId;
    const matters = await clioFetch("/matters.json", mattersParams, "matters fields");

    const activitiesParams = { limit: 10, fields: "id,date,quantity,price,total,type,non_billable,matter{id,display_number},bill{id,state}", date_from: from, date_to: to };
    if (matterId) activitiesParams.matter_id = matterId;
    const activities = await clioFetch("/activities.json", activitiesParams, "activities fields/time expenses");

    const billsParams = { limit: 10, fields: "id,number,state,issued_at,due_at,paid_at,total,balance,client{id,name},matter{id,display_number},payments{id,amount,state,paid_at}" };
    if (matterId) billsParams.matter_id = matterId;
    const bills = await clioFetch("/bills.json", billsParams, "bills fields/invoices");

    const bankParams = { limit: 10, fields: "id,date,funds_out,funds_in,running_balance,current_account_balance,matter{id,display_number}" };
    if (matterId) bankParams.matter_id = matterId;
    const bankTransactions = await clioFetch("/bank_transactions.json", bankParams, "bank transactions fields/trust movement");

    const field_matrix = [
      fieldStatus("work_in_progress", !!(trustCsv?.headers || []).find((h) => /unbilled/i.test(h)), "Trust Management Report: Unbilled amount", trustCsv?.rows?.[0]),
      fieldStatus("matter_trust_funds", !!(trustCsv?.headers || []).find((h) => /amount in trust/i.test(h)), "Trust Management Report: Amount in trust", trustCsv?.rows?.[0]),
      fieldStatus("outstanding_balance", !!(matterBalanceCsv?.headers || []).find((h) => /outstanding|receivable|balance/i.test(h)) || (bills.rows || []).some((b) => "balance" in b), "Matter Balance Summary or Bills API balance", matterBalanceCsv?.rows?.[0] || bills.rows?.[0]),
      fieldStatus("trust_funds_in", (bankTransactions.rows || []).some((r) => "funds_in" in r), "Bank transactions API funds_in", bankTransactions.rows?.[0]),
      fieldStatus("trust_funds_out", (bankTransactions.rows || []).some((r) => "funds_out" in r), "Bank transactions API funds_out", bankTransactions.rows?.[0]),
      fieldStatus("trust_running_balance", (bankTransactions.rows || []).some((r) => r.running_balance != null || r.current_account_balance != null), "Bank transactions API running balance; otherwise calculated", bankTransactions.rows?.[0]),
      fieldStatus("time_amount", (activities.rows || []).some((r) => "total" in r || "price" in r), "Activities API total/price", activities.rows?.[0]),
      fieldStatus("time_hours", (activities.rows || []).some((r) => "quantity" in r), "Activities API quantity", activities.rows?.[0]),
      fieldStatus("expenses", (activities.rows || []).some((r) => /expense/i.test(String(r.type || ""))), "Activities API expense-type rows", activities.rows?.find((r) => /expense/i.test(String(r.type || ""))) || activities.rows?.[0]),
      fieldStatus("invoice_total", (bills.rows || []).some((r) => "total" in r), "Bills API total", bills.rows?.[0]),
      fieldStatus("invoice_balance", (bills.rows || []).some((r) => "balance" in r), "Bills API balance", bills.rows?.[0]),
      fieldStatus("invoice_sent_at", (bills.rows || []).some((r) => "issued_at" in r || "sent_at" in r), "Bills API issued/sent fields", bills.rows?.[0]),
      fieldStatus("client_email", false, "Contacts API/email fields - not tested in v30 audit yet", null),
      fieldStatus("client_phone", false, "Contacts API/phone fields - not tested in v30 audit yet", null)
    ];

    return res.status(200).json({
      version: "v30",
      from,
      to,
      matter_id: matterId || null,
      report_summary: {
        completed_reports_last_6_months: allReports.length,
        trust_management_reports: trustReports.length,
        matter_balance_summary_reports: matterBalanceReports.length,
        relevant_billing_reports: billingReports.slice(0, 50),
        selected_trust_report: newestTrustReport,
        selected_matter_balance_report: newestMatterBalanceReport,
        trust_report_headers: trustCsv?.headers || [],
        matter_balance_report_headers: matterBalanceCsv?.headers || []
      },
      field_matrix,
      attempts
    });
  } catch (error) {
    return res.status(500).json({ version: "v30", error: error.message || String(error), attempts });
  }
}
