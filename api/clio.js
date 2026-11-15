// Consolidated Clio API. One Vercel function dispatches the old /api/clio/* URLs
// via vercel.json rewrites (?action=...), preserving every original URL, method,
// query string, request body, and response.
import balanceHistory from '../lib/clio/handlers/balance-history.js'
import clientBillingFields from '../lib/clio/handlers/client-billing-fields.js'
import financialFieldAcquisition from '../lib/clio/handlers/financial-field-acquisition.js'
import matters from '../lib/clio/handlers/matters.js'
import reportSnapshots from '../lib/clio/handlers/report-snapshots.js'
import trustManagementReport from '../lib/clio/handlers/trust-management-report.js'

const HANDLERS = {
  balance_history: balanceHistory,
  client_billing_fields: clientBillingFields,
  financial_field_acquisition: financialFieldAcquisition,
  matters,
  report_snapshots: reportSnapshots,
  trust_management_report: trustManagementReport,
}

export default async function handler(req, res) {
  const action = String(req.query?.action || '')
  const fn = HANDLERS[action]
  if (!fn) return res.status(404).json({ error: 'Unknown Clio action.', ok: false })
  return fn(req, res)
}
