// Hotfix for Mio V268 Calculated Trust Account.
// Runs immediately after the V268 source transform and removes the stale
// financialsForMatter reference that caused the Billing page to crash.
export default function mioV268Hotfix() {
  return {
    name: 'mio-v268-calculated-trust-hotfix',
    enforce: 'pre',
    transform(source, id) {
      if (!id.includes('/src/App.jsx')) return null

      const broken = "    const currentCalculatedTrust = matters.reduce((sum, matter) => sum + financeNumber(financialsForMatter(matter)?.trust), 0)"
      if (!source.includes(broken)) return null

      const fixed = "    const firmTrustSeries = calculatedFirmTrustSeries(mioTrustLedgerFinancialGraphRows())[0]\n    const currentCalculatedTrust = financeNumber(firmTrustSeries?.points?.[firmTrustSeries.points.length - 1]?.balance)"
      return { code: source.replace(broken, fixed), map: null }
    }
  }
}
