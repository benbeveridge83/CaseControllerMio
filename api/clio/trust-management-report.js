export default async function handler(req, res) {
  const cookieHeader = req.headers.cookie || "";
  const tokenCookie = cookieHeader.split(";").map((c) => c.trim()).find((c) => c.startsWith("clio_access_token="));
  if (!tokenCookie) return res.status(401).json({ error: "Not authenticated" });
  const token = tokenCookie.split("=")[1];

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
    if (contentType.includes("application/json")) {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(data?.error?.message || data?.message || data?.error || `Clio request failed with ${response.status}`);
        error.status = response.status;
        error.payload = data;
        error.url = url.toString();
        throw error;
      }
      return { data, response, contentType };
    }
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(text || `Clio request failed with ${response.status}`);
      error.status = response.status;
      error.payload = { raw: text.slice(0, 2000) };
      error.url = url.toString();
      throw error;
    }
    return { data: text, response, contentType };
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
    const trustReports = reports.filter((report) => {
      const blob = [report.name, report.kind, report.category, report.source].filter(Boolean).join(" ").toLowerCase();
      return /trust/.test(blob) && /(management|ledger|listing|account)/.test(blob);
    });
    const exact = trustReports.find((report) => /trust.*management|management.*trust/i.test([report.name, report.kind].join(" "))) || trustReports[0] || null;

    if (String(req.query.download || "") === "1") {
      if (!exact?.id) {
        res.setHeader("content-type", "text/plain; charset=utf-8");
        return res.status(404).send("No existing Trust Management/Trust report was returned by Clio reports.json. Open the JSON debug route without ?download=1 to see available report names/kinds.");
      }
      const downloadUrl = new URL(`https://app.clio.com/api/v4/reports/${exact.id}/download.json`);
      const result = await clioFetch(downloadUrl);
      // Clio may return a signed URL or a file payload depending on report state/account.
      const payload = result.data?.data || result.data;
      const url = payload?.url || payload?.download_url || payload?.href || payload?.file_url;
      if (url) return res.redirect(302, url);
      res.setHeader("content-type", "application/json; charset=utf-8");
      return res.status(200).json({ version: "v24", message: "Clio returned a download response but no URL field was recognized.", selected_report: exact, download_response: payload });
    }

    return res.status(200).json({
      version: "v24",
      report_count: reports.length,
      trust_report_count: trustReports.length,
      selected_trust_report: exact,
      trust_reports: trustReports.slice(0, 25),
      all_report_summaries: reports.slice(0, 100).map((r) => ({ id: r.id, name: r.name, kind: r.kind, state: r.state, format: r.format, category: r.category, source: r.source, updated_at: r.updated_at })),
      note: "This route discovers/downloads existing reports exposed by Clio. If no Trust Management report exists yet, generate it once in Clio or use the shown report kind/id to add a create-report step."
    });
  } catch (error) {
    return res.status(error.status || 500).json({ version: "v24", error: error.message || String(error), payload: error.payload || null, url: error.url || null });
  }
}
