// Temporary diagnostic endpoint. Install as api/clio/debug-balance.js if you want to inspect one matter.
// Example: /api/clio/debug-balance?matter_id=1644364324&from=2026-03-01&to=2026-06-21
export default async function handler(req, res) {
  const cookieHeader = req.headers.cookie || "";
  const tokenCookie = cookieHeader.split(";").map((c) => c.trim()).find((c) => c.startsWith("clio_access_token="));
  if (!tokenCookie) return res.status(401).json({ error: "Not authenticated" });
  const token = tokenCookie.split("=")[1];
  const matterId = String(req.query.matter_id || req.query.matter_ids || "").split(",")[0].trim();
  if (!matterId) return res.status(400).json({ error: "matter_id required" });

  async function clioFetch(url) {
    const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw_text: text }; }
    return { ok: response.ok, status: response.status, data };
  }

  async function call(path, params) {
    const url = new URL(`https://app.clio.com/api/v4/${path}`);
    for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    const result = await clioFetch(url);
    return { url: url.toString().replace(/access_token=[^&]+/g, "access_token=REDACTED"), ...result };
  }

  const fieldsAttempts = [
    "id,date,funds_out,funds_in,current_account_balance,running_balance,account_balance,balance_after,balance,matter{id,display_number}",
    "id,date,funds_out,funds_in,current_account_balance,running_balance,matter{id,display_number}",
    "id,date,funds_out,funds_in,current_account_balance",
    "id,date,funds_out,funds_in",
    "id,date,amount,current_account_balance,running_balance",
    "id,date,amount",
  ];

  const matter = await call(`matters/${matterId}`, { fields: "id,display_number,description,status,client{id,name},account_balances" });
  const txResults = [];
  for (const fields of fieldsAttempts) {
    txResults.push(await call("bank_transactions.json", { limit: 200, matter_id: matterId, type: "liability", fields }));
  }

  return res.status(200).json({ version: "v19", matter_id: matterId, matter, bank_transaction_attempts: txResults });
}
