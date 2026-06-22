export default async function handler(req, res) {
  const cookieHeader = req.headers.cookie || "";
  const tokenCookie = cookieHeader.split(";").map((c) => c.trim()).find((c) => c.startsWith("clio_access_token="));
  if (!tokenCookie) return res.status(401).json({ error: "Not authenticated" });
  const token = tokenCookie.split("=")[1];
  const matterId = String(req.query.matter_id || req.query.matter || "").trim();
  if (!matterId) return res.status(400).json({ error: "matter_id is required" });

  function normalizeDay(value) {
    if (!value) return null;
    const s = String(value).slice(0, 10);
    const d = new Date(`${s}T00:00:00Z`);
    return Number.isFinite(d.getTime()) ? s : null;
  }
  function numberOrNull(value) {
    if (value && typeof value === "object") {
      if ("amount" in value) value = value.amount;
      else if ("cents" in value) value = Number(value.cents) / 100;
      else return null;
    }
    if (typeof value === "string") {
      const cleaned = value.replace(/[$,\s()]/g, "");
      if (!cleaned || cleaned === "-") return null;
      value = /^\s*\(/.test(value) && !cleaned.startsWith("-") ? `-${cleaned}` : cleaned;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  function firstNumber(...values) { for (const v of values) { const n = numberOrNull(v); if (n !== null) return n; } return null; }
  function fundsIn(tx) { return firstNumber(tx.funds_in, tx.fundsIn, tx.credit, tx.deposit); }
  function fundsOut(tx) { return firstNumber(tx.funds_out, tx.fundsOut, tx.debit, tx.withdrawal); }
  function explicit(tx) { return firstNumber(tx.running_balance, tx.runningBalance, tx.current_account_balance, tx.currentAccountBalance); }
  async function clioFetch(url) {
    const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { error: data, status: response.status, url: url.toString() };
    return data;
  }
  async function fetchAll(path, params) {
    let url = new URL(`https://app.clio.com/api/v4/${path}`);
    Object.entries(params || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v)); });
    const all = [];
    let meta = null;
    while (url) {
      const data = await clioFetch(url);
      if (data?.error) return { rows: all, error: data };
      if (!meta) meta = data?.meta || null;
      all.push(...(Array.isArray(data.data) ? data.data : []));
      const next = data?.meta?.paging?.next;
      url = next ? new URL(next) : null;
      if (all.length >= 1000) break;
    }
    return { rows: all, meta };
  }

  const matterUrl = new URL(`https://app.clio.com/api/v4/matters/${matterId}`);
  matterUrl.searchParams.set("fields", "id,display_number,description,status,client{id,name}");
  const matter = await clioFetch(matterUrl);

  const attempts = [];
  const fieldSets = [
    "id,date,funds_out,funds_in,running_balance,current_account_balance,matter{id,display_number}",
    "id,date,funds_out,funds_in,matter{id,display_number}",
    "id,date,amount,matter{id,display_number}",
  ];
  let successfulRows = [];
  let successfulFields = null;
  for (const fields of fieldSets) {
    const params = { limit: 200, matter_id: matterId, type: "liability", fields };
    const got = await fetchAll("bank_transactions.json", params);
    attempts.push({ fields, count: got.rows.length, error: got.error || null, sample: got.rows.slice(0, 5) });
    if (!got.error && got.rows.length && !successfulRows.length) {
      successfulRows = got.rows;
      successfulFields = fields;
      break;
    }
  }

  let running = 0;
  const parsed_points = successfulRows
    .slice()
    .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0) || String(a.id).localeCompare(String(b.id)))
    .map((tx) => {
      const e = explicit(tx);
      const fi = fundsIn(tx) || 0;
      const fo = fundsOut(tx) || 0;
      if (e !== null) running = e;
      else running += Number(fi) - Number(fo);
      return {
        id: tx.id,
        date: normalizeDay(tx.date),
        explicit_balance: e,
        funds_in: fi,
        funds_out: fo,
        delta: Number(fi) - Number(fo),
        parsed_balance: running,
        raw_keys: Object.keys(tx || {}),
      };
    });

  return res.status(200).json({
    version: "v21",
    matter_id: matterId,
    matter,
    successful_fields: successfulFields,
    attempts,
    transaction_count: successfulRows.length,
    parsed_points,
    last_parsed_balance: parsed_points.length ? parsed_points[parsed_points.length - 1].parsed_balance : 0,
  });
}
