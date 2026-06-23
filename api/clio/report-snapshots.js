export default async function handler(req, res) {
  const cookieHeader = req.headers.cookie || "";
  const tokenCookie = cookieHeader.split(";").map((c) => c.trim()).find((c) => c.startsWith("clio_access_token="));
  if (!tokenCookie) return res.status(401).json({ version: "v35", error: "Not authenticated with Clio." });
  const token = tokenCookie.split("=")[1];

  async function clioFetch(url, options = {}) {
    const response = await fetch(url.toString(), {
      ...options,
      headers: { Authorization: `Bearer ${token}`, Accept: options.accept || "application/json", ...(options.headers || {}) },
    });
    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json") ? await response.json().catch(() => ({})) : await response.text();
    if (!response.ok) {
      const error = new Error(data?.error?.message || data?.message || data?.error || (typeof data === "string" ? data.slice(0, 500) : `Clio request failed with ${response.status}`));
      error.status = response.status;
      error.payload = data;
      error.url = url.toString();
      throw error;
    }
    return { data, response, contentType };
  }

  async function fetchReports() {
    let url = new URL("https://app.clio.com/api/v4/reports.json");
    url.searchParams.set("limit", "200");
    url.searchParams.set("fields", "id,name,kind,state,format,progress,category,source,created_at,updated_at");
    const reports = [];
    while (url) {
      const { data } = await clioFetch(url);
      reports.push(...(Array.isArray(data.data) ? data.data : []));
      const next = data?.meta?.paging?.next;
      url = next ? new URL(next) : null;
    }
    return reports;
  }

  function isWantedReport(report) {
    const kind = String(report.kind || "").toLowerCase();
    const name = String(report.name || "");
    return kind === "trust_management" || kind === "matter_balance_summary" || kind === "accounts_receivable" || /trust management|matter balance summary|accounts receivable/i.test(name);
  }

  function reportDate(report) {
    const name = String(report.name || "");
    const m = name.match(/\((\d{2})\/(\d{2})\/(\d{4})\)/);
    if (m) return `${m[3]}-${m[1]}-${m[2]}`;
    const d = new Date(report.updated_at || report.created_at || Date.now());
    return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : "";
  }


  async function tryCreateReport(payload, label) {
    const url = new URL("https://app.clio.com/api/v4/reports.json");
    url.searchParams.set("fields", "id,name,kind,state,format,progress,category,source,created_at,updated_at");
    const record = { label, url: url.toString(), payload };
    try {
      const response = await fetch(url.toString(), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const contentType = response.headers.get("content-type") || "";
      const data = contentType.includes("application/json") ? await response.json().catch(() => ({})) : await response.text();
      record.status = response.status;
      record.ok = response.ok;
      record.content_type = contentType;
      record.response = typeof data === "string" ? data.slice(0, 2000) : data;
      return record;
    } catch (error) {
      record.ok = false;
      record.error = error.message || String(error);
      return record;
    }
  }

  async function createMatterBalanceSummaryAllDates() {
    const attempts = [];
    const common = { kind: "matter_balance_summary", format: "csv" };
    const payloads = [
      { label: "kind-format-date_range_all", payload: { data: { ...common, date_range: "all" } } },
      { label: "kind-format-timeframe_all", payload: { data: { ...common, timeframe: "all" } } },
      { label: "kind-format-all_dates_true", payload: { data: { ...common, all_dates: true } } },
      { label: "kind-format-params-date_range_all", payload: { data: { ...common, parameters: { date_range: "all" } } } },
      { label: "kind-format-options-all_dates", payload: { data: { ...common, options: { all_dates: true } } } },
      { label: "kind-format-no-dates", payload: { data: { ...common } } },
    ];
    for (const item of payloads) {
      const result = await tryCreateReport(item.payload, item.label);
      attempts.push(result);
      if (result.ok) {
        const created = result.response?.data || result.response;
        return { ok: true, message: "A Matter Balance Summary report create request was accepted by Clio.", created_report: created, attempts };
      }
      if (result.status === 429) break;
    }
    return { ok: false, message: "Clio did not accept any tested Matter Balance Summary all-dates create payload.", attempts };
  }

  try {
    const action = String(req.query.action || "list");
    if (action === "create_matter_balance_all_dates") {
      const result = await createMatterBalanceSummaryAllDates();
      return res.status(result.ok ? 200 : 422).json({ version: "v35", ...result });
    }

    if (action === "download") {
      const id = String(req.query.id || "").trim();
      if (!id) return res.status(400).json({ version: "v35", error: "Missing report id." });
      const url = new URL(`https://app.clio.com/api/v4/reports/${encodeURIComponent(id)}/download.json`);
      const result = await clioFetch(url);
      let payload = result.data?.data ?? result.data;
      if (payload && typeof payload === "object") payload = payload.url || payload.download_url || payload.href || payload.file_url || payload.content || payload.csv || "";
      if (typeof payload === "string" && /^https?:\/\//i.test(payload)) {
        const remote = await fetch(payload);
        const text = await remote.text();
        res.setHeader("content-type", "text/csv; charset=utf-8");
        return res.status(200).send(text);
      }
      if (typeof payload === "string") {
        res.setHeader("content-type", "text/csv; charset=utf-8");
        return res.status(200).send(payload);
      }
      return res.status(502).json({ version: "v35", error: "Clio report download returned no CSV text or URL.", payload });
    }

    const reports = (await fetchReports())
      .filter((r) => String(r.state || "").toLowerCase() === "completed")
      .filter(isWantedReport)
      .map((r) => ({ ...r, report_date: reportDate(r) }))
      .sort((a, b) => new Date(b.report_date || b.updated_at || b.created_at || 0) - new Date(a.report_date || a.updated_at || a.created_at || 0) || Number(b.id || 0) - Number(a.id || 0));

    const trustReports = reports.filter((r) => String(r.kind || "").toLowerCase() === "trust_management" || /trust management/i.test(String(r.name || "")));
    const matterBalanceReports = reports.filter((r) => String(r.kind || "").toLowerCase() === "matter_balance_summary" || /matter balance summary/i.test(String(r.name || "")));
    const accountsReceivableReports = reports.filter((r) => String(r.kind || "").toLowerCase() === "accounts_receivable" || /accounts receivable/i.test(String(r.name || "")));
    return res.status(200).json({ version: "v35", reports, trust_reports: trustReports, matter_balance_reports: matterBalanceReports, accounts_receivable_reports: accountsReceivableReports, report_count: reports.length });
  } catch (error) {
    return res.status(error.status || 500).json({ version: "v35", error: error.message || String(error), payload: error.payload || null, url: error.url || null });
  }
}
