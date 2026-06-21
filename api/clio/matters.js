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

  const status = String(req.query.status || "open"); // default: open
  const limit = String(req.query.limit || "200");

  let url = new URL("https://app.clio.com/api/v4/matters");
  url.searchParams.set("limit", limit);
  url.searchParams.set("status", status);
  url.searchParams.set("fields", "id,display_number,status,description,client{id,name}");

  const allMatters = [];

  try {
    while (url) {
      const clioResponse = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });

      const data = await clioResponse.json();

      if (!clioResponse.ok) {
        return res.status(clioResponse.status).json(data);
      }

      allMatters.push(...(data.data || []));

      const nextUrl = data?.meta?.paging?.next;
      url = nextUrl ? new URL(nextUrl) : null;
    }

    return res.status(200).json({
      meta: {
        records: allMatters.length,
        status,
      },
      data: allMatters,
    });
  } catch (error) {
    return res.status(500).json({ error: String(error?.message || error) });
  }
}