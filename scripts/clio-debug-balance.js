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
    if (value === null || value === undefined) return null;
    if (typeof value === "string" && value.trim() === "") return null;
    if (value && typeof value === "object") {
      if ("amount" in value) value = value.amount;
      else if ("cents" in value) value = Number(value.cents) / 100;
      else if ("value" in value) value = value.value;
      else if ("balance" in value) value = value.balance;
      else if ("total" in value) value = value.total;
      else return null;
    }
    if (typeof value === "string") {
      const negative = /^\s*\(.*\)\s*$/.test(value) || /^\s*-/.test(value);
      const cleaned = value.replace(/[$,\s()]/g, "");
      if (!cleaned || cleaned === "-") return null;
      value = negative && !cleaned.startsWith("-") ? `-${cleaned}` : cleaned;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function firstNumber(...values) {
    for (const v of values) {
      const n = numberOrNull(v);
      if (n !== null) return n;
    }
    return null;
  }
  function fundsIn(tx) { return firstNumber(tx.funds_in, tx.fundsIn, tx.credit, tx.deposit); }
  function fundsOut(tx) { return firstNumber(tx.funds_out, tx.fundsOut, tx.debit, tx.withdrawal); }
  function explicit(tx) { return firstNumber(tx.running_balance, tx.runningBalance, tx.current_account_balance, tx.currentAccountBalance); }

  async function clioFetch(url) {
    const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { error: data, status: response.status, url: url.toString() };
    return { data, status: response.status, url: url.toString() };
  }

  async function fetchMatter() {
    const url = new URL(`https://app.clio.com/api/v4/matters/${matterId}`);
    url.searchParams.set("fields", "id,display_number,description,status,client{id,name}");
    return clioFetch(url);
  }

  async function fetchTransactions(fields) {
    const url = new URL("https://app.clio.com/api/v4/bank_transactions.json");
    url.searchParams.set("limit", "200");
    url.searchParams.set("matter_id", matterId);
    url.searchParams.set("type", "liability");
    url.searchParams.set("fields", fields);
    return clioFetch(url);
  }

  async function fetchBills() {
    const attempts = [
      "id,state,status,total,balance,due,paid,matters{id,display_number}",
      "id,state,status,total,balance,due,paid"
    ];
    const out = [];
    for (const fields of attempts) {
      const url = new URL("https://app.clio.com/api/v4/bills.json");
      url.searchParams.set("limit", "200");
      url.searchParams.set("matter_id", matterId);
      url.searchParams.set("fields", fields);
      const result = await clioFetch(url);
      out.push({ fields, status: result.status, error: result.error || null, count: result.data?.data?.length || 0, sample: (result.data?.data || []).slice(0, 3) });
      if (!result.error) break;
    }
    return out;
  }

  async function fetchReportAttempts() {
    const paths = [
      "reports/work_in_progress.json",
      "reports/matter_balance_summary.json",
      "reports/accounts_receivable.json",
      "reports/client_activity.json"
    ];
    const out = [];
    for (const path of paths) {
      const url = new URL(`https://app.clio.com/api/v4/${path}`);
      url.searchParams.set("matter_id", matterId);
      url.searchParams.set("limit", "50");
      const result = await clioFetch(url);
      const rows = Array.isArray(result.data?.data) ? result.data.data : [];
      out.push({ path, status: result.status, error: result.error || null, count: rows.length, sample: rows.slice(0, 2) });
    }
    return out;
  }

  const matter = await fetchMatter();
  const fields = "id,date,funds_out,funds_in,running_balance,current_account_balance,matter{id,display_number}";
  const txResult = await fetchTransactions(fields);
  const transactions = Array.isArray(txResult.data?.data) ? txResult.data.data : [];

  const sortedTransactions = transactions
    .slice()
    .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0) || String(a.id).localeCompare(String(b.id)));

  const outBuckets = new Map();
  for (const tx of sortedTransactions) {
    const date = normalizeDay(tx.date);
    const fout = Number(fundsOut(tx) || 0);
    if (!date || fout <= 0) continue;
    const key = `${date}|${fout.toFixed(2)}`;
    outBuckets.set(key, (outBuckets.get(key) || 0) + 1);
  }

  let running = 0;
  let grossFundsInRaw = 0;
  let grossFundsIn = 0;
  let grossFundsOut = 0;
  let ignoredMirroredFundsIn = 0;
  const parsed_points = sortedTransactions.map((tx) => {
      const date = normalizeDay(tx.date);
      const explicit_balance = explicit(tx);
      const rawFin = Number(fundsIn(tx) || 0);
      const fout = Number(fundsOut(tx) || 0);
      let effectiveFin = rawFin;
      grossFundsInRaw += rawFin;
      grossFundsOut += fout;
      if (effectiveFin > 0) {
        const key = `${date}|${effectiveFin.toFixed(2)}`;
        const count = outBuckets.get(key) || 0;
        if (count > 0) {
          effectiveFin = 0;
          ignoredMirroredFundsIn += rawFin;
          outBuckets.set(key, count - 1);
        }
      }
      grossFundsIn += effectiveFin;
      if (explicit_balance !== null) running = Number(explicit_balance);
      else running += effectiveFin - fout;
      return {
        id: tx.id,
        date,
        explicit_balance,
        raw_funds_in: rawFin,
        effective_funds_in: effectiveFin,
        funds_out: fout,
        delta: effectiveFin - fout,
        parsed_balance: running,
        ignored_as_mirrored_transfer_in: rawFin > 0 && effectiveFin === 0,
        raw_keys: Object.keys(tx || {})
      };
    });

  const [bill_attempts, report_attempts] = await Promise.all([fetchBills(), fetchReportAttempts()]);

  return res.status(200).json({
    version: "v26",
    matter_id: matterId,
    matter,
    successful_fields: fields,
    transaction_count: transactions.length,
    raw_gross_funds_in_before_mirror_filter: grossFundsInRaw,
    ignored_mirrored_funds_in: ignoredMirroredFundsIn,
    trust_funds_in: grossFundsIn,
    trust_funds_out: grossFundsOut,
    calculated_current_trust: grossFundsIn - grossFundsOut,
    parsed_points,
    last_parsed_balance: parsed_points.length ? parsed_points[parsed_points.length - 1].parsed_balance : 0,
    bill_attempts,
    report_attempts
  });
}
