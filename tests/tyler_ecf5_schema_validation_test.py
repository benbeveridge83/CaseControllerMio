import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from validate_tyler_ecf5 import validate_filing

BASE_XSD = """<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
 targetNamespace="https://docs.oasis-open.org/legalxml-courtfiling/ns/v5.0/filing"
 xmlns:f="https://docs.oasis-open.org/legalxml-courtfiling/ns/v5.0/filing"
 elementFormDefault="qualified">
 <xs:element name="FilingMessage"><xs:complexType><xs:sequence>
 <xs:element name="FilingLeadDocument"><xs:complexType>
 <xs:sequence/><xs:anyAttribute processContents="lax"/>
 </xs:complexType></xs:element>
 </xs:sequence></xs:complexType></xs:element>
</xs:schema>
"""
EXT_XSD = """<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
 targetNamespace="urn:tyler:ecf:v5.0:extensions:common"
 xmlns:t="urn:tyler:ecf:v5.0:extensions:common"
 elementFormDefault="qualified">
 <xs:element name="DocumentAugmentation"><xs:complexType><xs:sequence>
 <xs:element name="Marker" type="xs:string"/>
 </xs:sequence></xs:complexType></xs:element>
</xs:schema>
"""
DOC = """<f:FilingMessage
 xmlns:f="https://docs.oasis-open.org/legalxml-courtfiling/ns/v5.0/filing"
 xmlns:t="urn:tyler:ecf:v5.0:extensions:common"
 xmlns:s="http://release.niem.gov/niem/structures/4.0/">
 <f:FilingLeadDocument s:id="filing-1">
 <t:DocumentAugmentation><t:Marker>ok</t:Marker></t:DocumentAugmentation>
 </f:FilingLeadDocument>
 </f:FilingMessage>"""


class OfflineExtensionValidationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / "extension").mkdir()
        (self.root / "filing.xsd").write_text(BASE_XSD)
        (self.root / "extension" / "common.xsd").write_text(EXT_XSD)

    def check(self, xml):
        p = self.root / "filing.xml"
        p.write_text(xml)
        return validate_filing(p, self.root)

    def test_whitelisted_augmentation_validates_separately(self):
        result = self.check(DOC)
        self.assertTrue(result["ok"], result["issues"])
        self.assertEqual(result["validated_extensions"], 1)

    def test_extension_content_must_match_extension_schema(self):
        result = self.check(DOC.replace("<t:Marker>ok</t:Marker>", "<t:Wrong/>"))
        self.assertFalse(result["ok"])
        self.assertTrue(any("Tyler augmentation" in i for i in result["issues"]))

    def test_unrecognized_extension_not_silently_stripped(self):
        result = self.check(DOC.replace("DocumentAugmentation", "OtherAugmentation"))
        self.assertFalse(result["ok"])
        self.assertTrue(any("Unexpected Tyler augmentation" in i for i in result["issues"]))

    def test_references_must_resolve_and_identifiers_unique(self):
        result = self.check(DOC.replace('s:id="filing-1"', 's:ref="missing"'))
        self.assertFalse(result["ok"])
        self.assertTrue(any("Dangling" in i for i in result["issues"]))

    def test_dtd_rejected(self):
        with self.assertRaises(ValueError):
            self.check("<!DOCTYPE f:FilingMessage [<!ENTITY x 'oops'>]>" + DOC)


if __name__ == "__main__":
    unittest.main()
