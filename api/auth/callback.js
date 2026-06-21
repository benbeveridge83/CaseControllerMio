export default async function handler(req, res) {
  const { code } = req.query;

  if (!code) {
    return res.status(400).json({ error: "No code received" });
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: process.env.CLIO_CLIENT_ID,
    client_secret: process.env.CLIO_CLIENT_SECRET,
    redirect_uri: process.env.CLIO_REDIRECT_URI,
    code,
  });

  const tokenResponse = await fetch("https://app.clio.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const data = await tokenResponse.json();

  if (!tokenResponse.ok) {
    return res.status(tokenResponse.status).json(data);
  }

  res.setHeader(
    "Set-Cookie",
    `clio_access_token=${data.access_token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${data.expires_in}`
  );

  return res.redirect("/#billing");
}