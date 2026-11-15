export default async function handler(req, res) {
  const cookieHeader = req.headers.cookie || "";
  const tokenCookie = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("clio_access_token="));

  if (!tokenCookie) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const token = tokenCookie.split("=")[1];
  const requestedStatus = String(req.query.status || "open");
  const limit = String(req.query.limit || "200");

  async function fetchPageSet({ status }) {
    let url = new URL("https://app.clio.com/api/v4/matters");
    url.searchParams.set("limit", limit);
    if (status && status !== "all") url.searchParams.set("status", status);
    url.searchParams.set("fields", "id,display_number,status,description,client{id,name}");

    const allMatters = [];
    while (url) {
      const clioResponse = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });

      const data = await clioResponse.json();
      if (!clioResponse.ok) {
        const err = new Error(data?.error?.message || data?.message || data?.error || `Clio matters failed with ${clioResponse.status}`);
        err.status = clioResponse.status;
        err.payload = data;
        throw err;
      }

      allMatters.push(...(Array.isArray(data.data) ? data.data : []));
      const nextUrl = data?.meta?.paging?.next;
      url = nextUrl ? new URL(nextUrl) : null;
    }
    return allMatters;
  }

  try {
    let matters;
    let sourceStatus = requestedStatus;
    try {
      matters = await fetchPageSet({ status: requestedStatus });
    } catch (error) {
      // Some Clio accounts reject status=open. If that happens, load all pages and filter locally.
      if (requestedStatus !== "open") throw error;
      const all = await fetchPageSet({ status: "all" });
      matters = all.filter((matter) => String(matter.status || "").toLowerCase() === "open");
      sourceStatus = "all-filtered-open";
    }

    return res.status(200).json({
      meta: {
        records: matters.length,
        status: sourceStatus, version: "v23",
      },
      data: matters,
    });
  } catch (error) {
    return res.status(error.status || 500).json(error.payload || { error: String(error?.message || error) });
  }
}
