// Texas family-law request-for-disclosure catalog (request-based initial disclosures).
//
// VERIFICATION STATUS (checked 2026-11-01):
// - Tex. Fam. Code § 301.052(a)(1)–(11): VERIFIED verbatim against the Texas
//   Legislature text (https://tcss.legis.texas.gov/resources/FA/htm/FA.301.htm).
//   Eleven top-level categories; category 6 (testifying experts) nests (A)–(D).
// - Tex. Fam. Code § 301.051 request language + 30-days-after-service deadline:
//   VERIFIED (30 calendar days, not "business days").
// - Tex. R. Civ. P. 194a.2(a)–(k) letter mapping: UNVERIFIED. The official TRCP
//   PDF (https://www.txcourts.gov/media/1463426/texas-rules-of-civil-procedure.pdf)
//   could not be extracted as text in this environment, so the (a)–(k) letters
//   below follow the handoff and are keyed to § 301.052(a)(1)–(11) order. Spot-check
//   the lettering against the current compilation before relying on it in a filing.
// - Effective September 1, 2023 (Acts 2023, 88th Leg., R.S., ch. 844 (H.B. 2850)),
//   as amended (Acts 2025, 89th Leg., R.S., ch. 616 (H.B. 3180)).
//
// The catalog is selectable per category and is NOT universal across case types:
// applicability must be checked against the governing rule/regime for the
// proceeding (family request-based vs. Rule 194 non-family, and filing date).

export const DISCLOSURE_CATALOG_VERSION = 1

export const DISCLOSURE_CATEGORIES = [
  {
    id: 'fd-01-parties',
    number: 1,
    rule_ref: 'Tex. R. Civ. P. 194a.2(a)',
    statute_ref: 'Tex. Fam. Code § 301.052(a)(1)',
    label: 'Correct names of parties',
    text: 'The correct names of the parties to the action.'
  },
  {
    id: 'fd-02-potential-parties',
    number: 2,
    rule_ref: 'Tex. R. Civ. P. 194a.2(b)',
    statute_ref: 'Tex. Fam. Code § 301.052(a)(2)',
    label: 'Potential parties',
    text: 'The name, address, and telephone number of any potential parties.'
  },
  {
    id: 'fd-03-legal-theories',
    number: 3,
    rule_ref: 'Tex. R. Civ. P. 194a.2(c)',
    statute_ref: 'Tex. Fam. Code § 301.052(a)(3)',
    label: 'Legal theories and factual bases',
    text: "The legal theories and, in general, the factual bases of the responding party's claims or defenses."
  },
  {
    id: 'fd-04-economic-damages',
    number: 4,
    rule_ref: 'Tex. R. Civ. P. 194a.2(d)',
    statute_ref: 'Tex. Fam. Code § 301.052(a)(4)',
    label: 'Economic damages',
    text: 'The amount and any method of calculating economic damages.'
  },
  {
    id: 'fd-05-knowledge-persons',
    number: 5,
    rule_ref: 'Tex. R. Civ. P. 194a.2(e)',
    statute_ref: 'Tex. Fam. Code § 301.052(a)(5)',
    label: 'Persons with knowledge',
    text: "The name, address, and telephone number of any person having knowledge of relevant facts and a brief statement of each identified person's connection with the action."
  },
  {
    id: 'fd-06-testifying-experts',
    number: 6,
    rule_ref: 'Tex. R. Civ. P. 194a.2(f)',
    statute_ref: 'Tex. Fam. Code § 301.052(a)(6)',
    label: 'Testifying experts',
    nested: true,
    text: "For any testifying expert: the expert's name, address, and telephone number; the subject matter on which the expert will testify; the general substance of the expert's mental impressions and opinions and a brief summary of the basis for those impressions and opinions, or if the expert is not retained by, employed by, or otherwise subject to the control of the responding party, documents reflecting that information; and, if the expert is retained by, employed by, or otherwise subject to the control of the responding party, all documents, tangible things, reports, models, or data compilations that have been provided to, reviewed by, or prepared by or for the expert in anticipation of the expert's testimony, and the expert's current resume and biography."
  },
  {
    id: 'fd-07-settlement-agreements',
    number: 7,
    rule_ref: 'Tex. R. Civ. P. 194a.2(g)',
    statute_ref: 'Tex. Fam. Code § 301.052(a)(7)',
    label: 'Settlement agreements',
    text: 'Any discoverable settlement agreement described by Rule 192.3(g), Texas Rules of Civil Procedure.'
  },
  {
    id: 'fd-08-witness-statements',
    number: 8,
    rule_ref: 'Tex. R. Civ. P. 194a.2(h)',
    statute_ref: 'Tex. Fam. Code § 301.052(a)(8)',
    label: 'Witness statements',
    text: 'Any discoverable witness statement described by Rule 192.3(h), Texas Rules of Civil Procedure.'
  },
  {
    id: 'fd-09-medical-records',
    number: 9,
    rule_ref: 'Tex. R. Civ. P. 194a.2(i)',
    statute_ref: 'Tex. Fam. Code § 301.052(a)(9)',
    label: 'Medical records and bills (injury cases)',
    text: 'In an action alleging physical or mental injury and damages from the occurrence that is the subject of the action, all medical records and bills that are reasonably related to the injuries or damages asserted, or an authorization permitting the disclosure of that information.'
  },
  {
    id: 'fd-10-medical-records-obtained',
    number: 10,
    rule_ref: 'Tex. R. Civ. P. 194a.2(j)',
    statute_ref: 'Tex. Fam. Code § 301.052(a)(10)',
    label: 'Medical records obtained by authorization',
    text: 'In an action alleging physical or mental injury and damages from the occurrence that is the subject of the action, all medical records and bills obtained by the responding party through an authorization provided by the requesting party.'
  },
  {
    id: 'fd-11-responsible-third-party',
    number: 11,
    rule_ref: 'Tex. R. Civ. P. 194a.2(k)',
    statute_ref: 'Tex. Fam. Code § 301.052(a)(11)',
    label: 'Responsible third party',
    text: 'The name, address, and telephone number of any person who may be designated as a responsible third party.'
  }
]

// Tex. Fam. Code § 301.051 request language. The disclosure is due "not later
// than the 30th day after the date of service" — 30 calendar days, not business days.
export const DISCLOSURE_REQUEST_LANGUAGE = 'Under Subchapter B, Chapter 301, Family Code, you are requested to disclose, not later than the 30th day after the date of service of this request, the information or material described by Section {{provision}}.'

export const DISCLOSURE_REGIMES = [
  {
    id: 'family_current',
    label: 'Family case filed on or after September 1, 2023',
    authority: 'Tex. Fam. Code ch. 301; Tex. R. Civ. P. 194a',
    note: 'Request-based initial disclosures under Chapter 301 and Rule 194a.'
  },
  {
    id: 'family_2021',
    label: 'Family case filed January 1, 2021 – August 31, 2023',
    authority: 'Former Tex. R. Civ. P. 194.2 (2021 family disclosures)',
    note: 'The 2021 required-disclosure regime applies, subject to exemptions and court orders.'
  },
  {
    id: 'civil_current',
    label: 'Other civil case filed on or after January 1, 2021',
    authority: 'Tex. R. Civ. P. 194',
    note: 'Required disclosures under Rule 194, subject to exemptions and orders.'
  },
  {
    id: 'legacy',
    label: 'Case filed before January 1, 2021',
    authority: 'Pre-2021 Texas discovery rules',
    note: 'The pre-2021 request-based disclosure rules and applicable discovery control order apply.'
  }
]

export function normalizeDisclosureCategory(category, index = 0) {
  const number = Number(category?.number || index + 1)
  return {
    id: String(category?.id || `fd-${String(number).padStart(2, '0')}`),
    number,
    rule_ref: String(category?.rule_ref || ''),
    statute_ref: String(category?.statute_ref || ''),
    label: String(category?.label || `Category ${number}`),
    text: String(category?.text || ''),
    nested: category?.nested === true,
    is_active: category?.is_active !== false,
    sort_order: Number(category?.sort_order || number)
  }
}

export function normalizeDisclosureCatalog(catalog = []) {
  return (Array.isArray(catalog) ? catalog : []).map(normalizeDisclosureCategory)
}

