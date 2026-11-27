"""Offline SOAP 1.1 / WS-Security XMLDSIG experimental engine.

This module uses SignXML for real RSA-SHA256 XMLDSIG generation and verification,
but remains an isolated, synthetic-certificate prototype. It is NOT invoked by
Mio's live submission or callback endpoints and MUST NOT authorize court filing.

It enforces the signature's *location* and requires the SOAP Body and signed
Timestamp to be the only two signed references. Always trust verified signed
objects, never re-parse and trust an unsigned duplicate body.

Requires signxml==5.1.0, cryptography and lxml. No network fetches.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from lxml import etree
from signxml import (
    XMLSigner, XMLVerifier, SignatureConfiguration,
    SignatureMethod, DigestAlgorithm, methods,
)
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa

SOAP = "http://schemas.xmlsoap.org/soap/envelope/"
WSSE = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"
WSU = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"
DS = "http://www.w3.org/2000/09/xmldsig#"
C14N = "http://www.w3.org/2001/10/xml-exc-c14n#"
NSMAP = {"soap": SOAP, "wsse": WSSE, "wsu": WSU, "ds": DS}
ID = f"{{{WSU}}}Id"
TAG_BODY = f"{{{SOAP}}}Body"
TAG_TIMESTAMP = f"{{{WSU}}}Timestamp"
TAG_SIGNATURE = f"{{{DS}}}Signature"


def _parse(xml: bytes | str):
    if isinstance(xml, str):
        xml = xml.encode("utf-8")
    if not isinstance(xml, bytes) or len(xml) > 8 * 1024 * 1024:
        raise ValueError("SOAP XML must be nonempty bytes within 8 MiB")
    parser = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False,
                              huge_tree=False, remove_blank_text=False)
    root = etree.fromstring(xml, parser=parser)
    if root.getroottree().docinfo.doctype:
        raise ValueError("DTD is forbidden")
    if root.tag != f"{{{SOAP}}}Envelope":
        raise ValueError("SOAP 1.1 envelope required")
    return root


def _elements(root):
    header = root.findall(f"{{{SOAP}}}Header")
    body = root.findall(TAG_BODY)
    if len(header) != 1 or len(body) != 1:
        raise ValueError("Exactly one SOAP header and body required")
    security = header[0].findall(f"{{{WSSE}}}Security")
    if len(security) != 1:
        raise ValueError("Exactly one WS-Security header required")
    timestamps = security[0].findall(TAG_TIMESTAMP)
    if len(timestamps) != 1:
        raise ValueError("Exactly one signed timestamp required")
    ids = [e.get(ID) for e in root.iter() if e.get(ID) is not None]
    if any(not x for x in ids) or len(set(ids)) != len(ids):
        raise ValueError("Missing or duplicate wsu:Id")
    body_id, timestamp_id = body[0].get(ID), timestamps[0].get(ID)
    if not body_id or not timestamp_id or body_id == timestamp_id:
        raise ValueError("Distinct SOAP Body and Timestamp wsu:Id required")
    return security[0], body[0], timestamps[0], body_id, timestamp_id


def _timestamp(timestamp, now: datetime):
    created = timestamp.find(f"{{{WSU}}}Created")
    expires = timestamp.find(f"{{{WSU}}}Expires")
    if created is None or expires is None or created.text is None or expires.text is None:
        raise ValueError("Created and Expires timestamps required")
    def parse(s):
        return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)
    start, end = parse(created.text), parse(expires.text)
    if end <= start or end-start > timedelta(minutes=10):
        raise ValueError("Invalid signed timestamp lifetime")
    if start > now + timedelta(minutes=5) or end < now - timedelta(minutes=5):
        raise ValueError("SOAP timestamp outside accepted clock skew")
    return start, end


def _binding_policy(root, now: datetime):
    security, body, timestamp, body_id, timestamp_id = _elements(root)
    _timestamp(timestamp, now)
    signatures = root.findall(".//" + TAG_SIGNATURE)
    if len(signatures) != 1 or signatures[0].getparent() is not security:
        raise ValueError("Signature must be inside the WS-Security header")
    refs = signatures[0].findall(f"./{{{DS}}}SignedInfo/{{{DS}}}Reference")
    uris = [r.get("URI") for r in refs]
    if len(refs) != 2 or set(uris) != {"#" + body_id, "#" + timestamp_id}:
        raise ValueError("Exactly the SOAP body and timestamp must be signed")
    for ref in refs:
        if not ref.get("URI", "").startswith("#"):
            raise ValueError("External XML signature references forbidden")
    return security, body, timestamp, body_id, timestamp_id


def _allowed_signature_config():
    return SignatureConfiguration(
        require_x509=True,
        expect_references=2,
        signature_methods=frozenset({SignatureMethod.RSA_SHA256}),
        digest_algorithms=frozenset({DigestAlgorithm.SHA256}),
        location=f"./{{{SOAP}}}Header/{{{WSSE}}}Security/",
    )


def sign_synthetic_soap(xml: bytes | str, private_key_pem: bytes,
                        certificate_pem: bytes, now: datetime):
    """Create a real XMLDSIG signature over body and timestamp.

    This is an offline test helper, never wired to a live Tyler sender.
    """
    root = _parse(xml)
    security, body, timestamp, body_id, timestamp_id = _elements(root)
    if root.findall(".//" + TAG_SIGNATURE):
        raise ValueError("SOAP request already contains a signature")
    _timestamp(timestamp, now)
    placeholder = etree.SubElement(security, TAG_SIGNATURE)
    placeholder.set("Id", "placeholder")
    signer = XMLSigner(method=methods.enveloped, signature_algorithm="rsa-sha256",
                       digest_algorithm="sha256", c14n_algorithm=C14N)
    signer.namespaces = {"ds": DS}
    signed = signer.sign(
        root, key=private_key_pem, cert=certificate_pem,
        reference_uri=["#" + body_id, "#" + timestamp_id],
        id_attribute="Id",
    )
    return etree.tostring(signed, encoding="utf-8", xml_declaration=True)


def verify_synthetic_soap(xml: bytes | str, trusted_certificate_pem: bytes,
                          now: datetime):
    """Verify real signature/digests and exact trusted SOAP nodes.

    Trusted cert must be provisioned separately; never use a certificate
    recovered from the untrusted incoming SOAP as the trust anchor.
    This does not provide durable replay protection or Tyler policy approval.
    """
    root = _parse(xml)
    security, body, timestamp, body_id, timestamp_id = _binding_policy(root, now)
    # This is certificate pinning supplied out of band. Verify expiry as well.
    cert = x509.load_pem_x509_certificate(trusted_certificate_pem)
    current = now.astimezone(timezone.utc)
    if not (cert.not_valid_before_utc <= current < cert.not_valid_after_utc):
        raise ValueError("Pinned certificate expired or not yet valid")
    verified = XMLVerifier().verify(
        root, x509_cert=trusted_certificate_pem,
        expect_config=_allowed_signature_config(),
        id_attribute="Id",
        validate_schema=True,
    )
    results = verified if isinstance(verified, list) else [verified]
    if len(results) != 2:
        raise ValueError("Exactly two cryptographic references required")
    nodes = {item.signed_xml.tag: item.signed_xml for item in results}
    if set(nodes) != {TAG_BODY, TAG_TIMESTAMP}:
        raise ValueError("Verified references do not bind Body and Timestamp")
    if nodes[TAG_BODY].get(ID) != body_id or nodes[TAG_TIMESTAMP].get(ID) != timestamp_id:
        raise ValueError("Cryptographically signed body/timestamp do not match expected IDs")
    return {
        "signature_verified_with_pinned_certificate": True,
        "bound_body_id": body_id,
        "bound_timestamp_id": timestamp_id,
        "body_element": nodes[TAG_BODY],
        "timestamp_element": nodes[TAG_TIMESTAMP],
        "replay_checked": False,
        "tyler_stage_approved": False,
    }
