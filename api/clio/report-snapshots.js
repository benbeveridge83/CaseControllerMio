export default async function handler(req, res) {
  const cookieHeader = req.headers.cookie || "";
  const tokenCookie = cookieHeader.split(";").map((c) => c.trim()).find((c) => c.startsWith("clio_access_token="));
  if (!tokenCookie) return res.status(401).json({ version: "v30", error: "Not authenticated with Clio." });
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
    return kind === "trust_management" || kind === "matter_balance_summary" || /trust management|matter balance summary/i.test(name);
  }

  function reportDate(report) {
    const name = String(report.name || "");
    const m = name.match(/\((\d{2})\/(\d{2})\/(\d{4})\)/);
    if (m) return `${m[3]}-${m[1]}-${m[2]}`;
    const d = new Date(report.updated_at || report.created_at || Date.now());
    return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : "";
  }

  try {
    const action = String(req.query.action || "list");
    if (action === "download") {
      const id = String(req.query.id || "").trim();
      if (!id) return res.status(400).json({ version: "v30", error: "Missing report id." });
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
      return res.status(502).json({ version: "v30", error: "Clio report download returned no CSV text or URL.", payload });
    }

    const reports = (await fetchReports())
      .filter((r) => String(r.state || "").toLowerCase() === "completed")
      .filter(isWantedReport)
      .map((r) => ({ ...r, report_date: reportDate(r) }))
      .sort((a, b) => new Date(b.report_date || b.updated_at || b.created_at || 0) - new Date(a.report_date || a.updated_at || a.created_at || 0) || Number(b.id || 0) - Number(a.id || 0));

    const trustReports = reports.filter((r) => String(r.kind || "").toLowerCase() === "trust_management" || /trust management/i.test(String(r.name || "")));
    const matterBalanceReports = reports.filter((r) => String(r.kind || "").toLowerCase() === "matter_balance_summary" || /matter balance summary/i.test(String(r.name || "")));
    return res.status(200).json({ version: "v30", reports, trust_reports: trustReports, matter_balance_reports: matterBalanceReports, report_count: reports.length });
  } catch (error) {
    return res.status(error.status || 500).json({ version: "v30", error: error.message || String(error), payload: error.payload || null, url: error.url || null });
  }
}
