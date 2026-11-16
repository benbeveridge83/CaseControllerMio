export default async function handler(req, res) {
  const cookieHeader = req.headers.cookie || "";
  const tokenCookie = cookieHeader.split(";").map((c) => c.trim()).find((c) => c.startsWith("clio_access_token="));
  if (!tokenCookie) return res.status(401).json({ error: "Not authenticated" });
  const token = tokenCookie.split("=")[1];

  async function clioFetch(url, options = {}) {
    const response = await fetch(url.toString(), {
      ...options,
      headers: { Authorization: `Bearer ${token}`, Accept: options.accept || "application/json", ...(options.headers || {}) },
    });
    const contentType = response.headers.get("content-type") || "";
    let data = contentType.includes("application/json") ? await response.json().catch(() => ({})) : await response.text();
    if (!response.ok) {
      const error = new Error(data?.error?.message || data?.message || data?.error || (typeof data === "string" ? data.slice(0,300) : `Clio request failed with ${response.status}`));
      error.status = response.status; error.payload = data; error.url = url.toString(); throw error;
    }
    return { data, response, contentType };
  }
  async function fetchPagedReports() {
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
  try {
    const reports = await fetchPagedReports();
    const trustReports = reports
      .filter((r) => String(r.kind || "").toLowerCase() === "trust_management" || /trust.*management|management.*trust/i.test(String(r.name || "")))
      .filter((r) => String(r.state || "").toLowerCase() === "completed")
      .sort((a,b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0) || Number(b.id || 0) - Number(a.id || 0));
    const exact = trustReports[0] || null;

    if (String(req.query.download || "") === "1") {
      if (!exact?.id) return res.status(404).send("No completed Trust Management report was returned by Clio reports.json.");
      const downloadUrl = new URL(`https://app.clio.com/api/v4/reports/${exact.id}/download.json`);
      const result = await clioFetch(downloadUrl);
      let payload = result.data?.data ?? result.data;
      if (payload && typeof payload === "object") payload = payload.url || payload.download_url || payload.href || payload.file_url || payload.content || payload.csv || "";
      if (typeof payload === "string" && /^https?:\/\//i.test(payload)) return res.redirect(302, payload);
      if (typeof payload === "string") {
        res.setHeader("content-type", "text/csv; charset=utf-8");
        const safeName = String(exact.name || "trust-management-report.csv").replace(/[^a-zA-Z0-9_.() -]/g, "_");
        res.setHeader("content-disposition", `attachment; filename="${safeName}"`);
        return res.status(200).send(payload);
      }
      return res.status(200).json({ version: "v26", message: "Clio returned a download response but no CSV or URL field was recognized.", selected_report: exact, download_response: payload });
    }

    const matterBalanceReports = reports
      .filter((r) => String(r.kind || "").toLowerCase() === "matter_balance_summary")
      .sort((a,b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0) || Number(b.id || 0) - Number(a.id || 0));

    return res.status(200).json({ version: "v26", report_count: reports.length, trust_report_count: trustReports.length, selected_trust_report: exact, trust_reports: trustReports.slice(0, 25), latest_matter_balance_summary: matterBalanceReports[0] || null, matter_balance_summaries: matterBalanceReports.slice(0,10), all_report_summaries: reports.slice(0, 100).map((r) => ({ id: r.id, name: r.name, kind: r.kind, state: r.state, format: r.format, category: r.category, source: r.source, updated_at: r.updated_at })) });
  } catch (error) {
    return res.status(error.status || 500).json({ version: "v26", error: error.message || String(error), payload: error.payload || null, url: error.url || null });
  }
}
