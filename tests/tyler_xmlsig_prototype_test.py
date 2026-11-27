"""Cryptographic SOAP Body + Timestamp round-trip regression tests.

All keys/certificates are synthetic and generated in memory per test module.
No Tyler endpoints, real certificates, court data or secrets are used.
"""
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from lxml import etree
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from signxml.exceptions import InvalidSignature

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from tyler_xmlsig_prototype import sign_synthetic_soap, verify_synthetic_soap, WSU, SOAP, DS


def identity():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    n = datetime.now(timezone.utc)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Synthetic Mio Test Signer")])
    cert = (
        x509.CertificateBuilder()
        .subject_name(name).issuer_name(name).public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(n - timedelta(days=1))
        .not_valid_after(n + timedelta(days=2))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(x509.KeyUsage(
            digital_signature=True, content_commitment=False, key_encipherment=True,
            data_encipherment=False, key_agreement=False, key_cert_sign=False,
            crl_sign=False, encipher_only=False, decipher_only=False,
        ), critical=True)
        .sign(key, hashes.SHA256())
    )
    return (
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ),
        cert.public_bytes(serialization.Encoding.PEM),
    )


NOW = datetime.now(timezone.utc).replace(microsecond=0)
KEY, CERT = identity()
OTHER_KEY, OTHER_CERT = identity()
WSU_ID = f"{{{WSU}}}Id"


def unsigned():
    from lxml import etree
    root = etree.Element(f"{{{SOAP}}}Envelope", nsmap={
        "s": SOAP, "wsu": WSU,
        "wsse": "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd",
        "ds": DS,
    })
    header = etree.SubElement(root, f"{{{SOAP}}}Header")
    sec = etree.SubElement(header, "{http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd}Security")
    ts = etree.SubElement(sec, f"{{{WSU}}}Timestamp")
    ts.set(WSU_ID, "Timestamp-1")
    etree.SubElement(ts, f"{{{WSU}}}Created").text = (NOW-timedelta(seconds=20)).isoformat()
    etree.SubElement(ts, f"{{{WSU}}}Expires").text = (NOW+timedelta(minutes=3)).isoformat()
    body = etree.SubElement(root, f"{{{SOAP}}}Body")
    body.set(WSU_ID, "Body-1")
    request = etree.SubElement(body, "{https://docs.oasis-open.org/legalxml-courtfiling/ns/v5.0/wrappers}ReviewFilingRequest")
    etree.SubElement(request, "{https://docs.oasis-open.org/legalxml-courtfiling/ns/v5.0/ecf}DocumentName").text = "Synthetic motion"
    return etree.tostring(root)


class XMLDSIGRoundTripTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.signed = sign_synthetic_soap(unsigned(), KEY, CERT, NOW)

    def check(self, xml=None, cert=CERT, now=NOW):
        return verify_synthetic_soap(xml or self.signed, cert, now)

    def test_real_rsa_sha256_sign_and_verify_two_references(self):
        result = self.check()
        self.assertTrue(result["signature_verified_with_pinned_certificate"])
        self.assertFalse(result["replay_checked"])
        self.assertFalse(result["tyler_stage_approved"])
        self.assertEqual(result["bound_body_id"], "Body-1")
        self.assertEqual(result["bound_timestamp_id"], "Timestamp-1")

    def test_body_tampering_invalidates_signed_digest(self):
        tampered = self.signed.replace(b"Synthetic motion", b"Altered motion")
        with self.assertRaises(Exception):
            self.check(tampered)

    def test_timestamp_tampering_invalidates_signed_digest(self):
        tampered = self.signed.replace(b"Timestamp-1", b"Timestamp-2")
        with self.assertRaises(Exception):
            self.check(tampered)

    def test_wrong_pinned_certificate_is_rejected(self):
        with self.assertRaises(Exception):
            self.check(cert=OTHER_CERT)

    def test_expired_message_is_rejected(self):
        with self.assertRaises(ValueError):
            self.check(now=NOW+timedelta(hours=1))

    def test_missing_signed_body_id_is_rejected(self):
        tampered = self.signed.replace(b"Body-1", b"", 1)
        with self.assertRaises(Exception):
            self.check(tampered)

    def test_unsigned_message_and_dtd_rejected(self):
        with self.assertRaises(ValueError):
            self.check(unsigned())
        with self.assertRaises(ValueError):
            self.check(self.signed.replace(b"?>", b"?><!DOCTYPE s:Envelope [<!ENTITY x 'attack'>]>", 1))

    def test_duplicate_body_id_rejected_before_crypto_verification(self):
        root = etree.fromstring(self.signed)
        body = root.find(f"{{{SOAP}}}Body")
        clone = etree.fromstring(etree.tostring(body))
        root.append(clone)
        with self.assertRaises(ValueError):
            self.check(etree.tostring(root))


if __name__ == "__main__":
    unittest.main()
