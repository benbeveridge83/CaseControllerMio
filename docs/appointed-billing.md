# Appointed billing

Open **Billing → Bulk Billing → Appointed billing**. The workspace has three steps.

1. **Create invoices.** Select appointed matters with WIP and use the existing Bulk WIP review. Review entries, then create invoices individually or together. The verified invoices are automatically selected for the next step. Existing invoices may also be selected. This path does not pay from trust or email a client.
2. **Check voucher outlines.** Reuse each matter's saved attorney/case details. Fill missing details or import a prior one-page voucher outline, then save it. Cause-number mismatches must be resolved before billing. Attorney information is shared across outlines. These steps replace the first uploaded HTML.
3. **Fill & review vouchers.** Inspect all invoices on one scrolling page, change categories, or split mixed activities. Hours and cents must reconcile to the saved invoice. Review any notes from the limits printed on the supplied form. Approve one invoice or all invoices to fill their vouchers. Download each completed voucher or a ZIP of the completed vouchers. These steps replace the second uploaded HTML. No invoice is appended to the voucher in this release.

**New billing run** clears the selection and retains reusable outlines and past approvals. If an approved invoice, outline or attorney information changes, review and approve the current details again. Downloads from an earlier approval are hidden. After reopening the workspace, use **Rebuild voucher** to regenerate a saved approval.

Appointment classification uses the same saved Appointed overrides and defaults as Weekly Billing Settings. It includes appointed matters outside the DFPS case type, and respects a DFPS matter explicitly marked not appointed.

The supplied Brazoria County form is the default. Imported outlines must contain its named fields; unsupported forms are rejected with the missing field name. The app preserves an imported outline's page content and uses the exact category-field mapping from the supplied PDF, rather than inferring columns from coordinates. A date detail page is included when multiple service dates will not fit legibly on the main form.

All profile details, imported PDFs, outlines, invoice allocations and approvals are private account data in the existing Mio cloud store. Only the blank form is public. No new database schema is required. AI returns category suggestions and reasons; it cannot change invoice amounts, approve, sign, submit, or pay. The workflow remains usable through manual review if AI is unavailable.
