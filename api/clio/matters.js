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

  const clioResponse = await fetch(
    "https://app.clio.com/api/v4/matters?limit=200",
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  const data = await clioResponse.json();
  return res.status(clioResponse.status).json(data);
}