// Temporary diagnostics route for one Clio matter.
// Open with a full URL like:
// https://case-controller-mio.vercel.app/api/clio/debug-balance?matter_id=1644364324&from=2026-03-01&to=2026-06-21
export default async function handler(req, res) {
  const cookieHeader = req.headers.cookie || "";
  const tokenCookie = cookieHeader.split(";").map((c) => c.trim()).find((c) => c.startsWith("clio_access_token="));
  if (!tokenCookie) return res.status(401).json({ error: "Not authenticated" });
  const token = tokenCookie.split("=")[1];
  const matterId = String(req.query.matter_id || req.query.matter || "").trim();
  if (!matterId) return res.status(400).json({ error: "matter_id is required" });

  function numberOrNull(value) {
    if (value && typeof value === "object") {
      if ("amount" in value) value = value.amount;
      else if ("cents" in value) value = Number(value.cents) / 100;
      else if ("value" in value) value = value.value;
      else if ("balance" in value) value = value.balance;
      else return null;
    }
    if (typeof value === "string") {
      const cleaned = value.replace(/[$,\s]/g, "");
      if (!cleaned || cleaned === "-") return null;
      value = cleaned;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  function firstNumber(...values) { for (const v of values) { const n = numberOrNull(v); if (n !== null) return n; } return null; }
  function fundsIn(tx) { return firstNumber(tx.funds_in, tx.fundsIn, tx.credit, tx.deposit); }
  function fundsOut(tx) { return firstNumber(tx.funds_out, tx.fundsOut, tx.debit, tx.withdrawal); }
  function explicit(tx) { return firstNumber(tx.running_balance, tx.runningBalance, tx.current_account_balance, tx.currentAccountBalance, tx.account_balance, tx.balance_after, tx.ending_balance, tx.current_balance); }
  async function clioFetch(url) {
    const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { error: data, status: response.status, url: url.toString() };
    return data;
  }
  async function fetchAll(path, params) {
    let url = new URL(`https://app.clio.com/api/v4/${path}`);
    Object.entries(params || {}).forEach(([k,v]) => { if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v)); });
    const all = [];
    let firstMeta = null;
    while (url) {
      const data = await clioFetch(url);
      if (data?.error) return { rows: all, error: data };
      if (!firstMeta) firstMeta = data?.meta || null;
      all.push(...(Array.isArray(data.data) ? data.data : []));
      const next = data?.meta?.paging?.next;
      url = next ? new URL(next) : null;
      if (all.length >= 500) break;
    }
    return { rows: all, meta: firstMeta };
  }
  const matterUrl = new URL(`https://app.clio.com/api/v4/matters/${matterId}`);
  matterUrl.searchParams.set("fields", "id,display_number,description,status,client{id,name},trust_balance,trust_account_balance,matter_trust_funds,funds_in_trust,work_in_progress,outstanding_balance");
  const matter = await clioFetch(matterUrl);

  const attempts = [];
  const fieldSets = [
    "id,date,funds_out,funds_in,running_balance,current_account_balance,account_balance,balance_after,ending_balance,current_balance,matter{id,display_number}",
    "id,date,funds_out,funds_in,running_balance,current_account_balance,matter{id,display_number}",
    "id,date,funds_out,funds_in,matter{id,display_number}",
    null,
  ];
  for (const fields of fieldSets) {
    const params = { limit: 200, matter_id: matterId, type: "liability" };
    if (fields) params.fields = fields;
    const got = await fetchAll("bank_transactions.json", params);
    attempts.push({ fields: fields || "default_fields", count: got.rows.length, error: got.error || null, sample: got.rows.slice(0, 3) });
    if (got.rows.length) break;
  }
  const rows = attempts.find((a) => a.count)?.sample ? (await fetchAll("bank_transactions.json", { limit: 200, matter_id: matterId, type: "liability" })).rows : [];
  let running = 0;
  const parsed_points = rows.sort((a,b) => new Date(a.date || 0) - new Date(b.date || 0)).map((tx) => {
    const e = explicit(tx);
    const fi = fundsIn(tx) || 0;
    const fo = fundsOut(tx) || 0;
    if (e !== null) running = e;
    else running += Number(fi) - Number(fo);
    return { date: String(tx.date || "").slice(0,10), explicit_balance: e, funds_in: fi, funds_out: fo, parsed_balance: running, raw_keys: Object.keys(tx || {}) };
  });
  return res.status(200).json({ version: "v20", matter_id: matterId, matter, attempts, transaction_count: rows.length, parsed_points });
}
