#!/usr/bin/env python3
"""Offline, extension-aware structural ECF5 XSD diagnostic.

Requires lxml. NOT a substitute for Tyler Stage certification, XMLDSIG
verification, or server-side submission authorization.
"""
import argparse
import copy
import json
from pathlib import Path

from lxml import etree

TYLER = "urn:tyler:ecf:v5.0:extensions:common"
STRUCTURES = "http://release.niem.gov/niem/structures/4.0/"
SIG_URL = "http://www.w3.org/TR/xmldsig-core/xmldsig-core-schema.xsd"
PARENTS = {
    ("ElectronicServiceAugmentation", "ElectronicServiceInformation"),
    ("AttachmentAugmentation", "Attachment"),
    ("DocumentAugmentation", "FilingConnectedDocument"),
    ("DocumentAugmentation", "FilingLeadDocument"),
    ("FilingMessageAugmentation", "FilingMessage"),
}


class LocalResolver(etree.Resolver):
    def __init__(self, schema_root):
        self.sig = (schema_root / "xmlsig" / "xmldsig-core-schema.xsd").resolve()

    def resolve(self, url, public_id, context):
        if url == SIG_URL:
            return self.resolve_filename(str(self.sig), context)
        return None


def parser_for(schema_root):
    parser = etree.XMLParser(
        no_network=True, resolve_entities=False, load_dtd=False, huge_tree=False
    )
    parser.resolvers.add(LocalResolver(schema_root))
    return parser


def read_xml(path, parser):
    if path.stat().st_size > 40 * 1024 * 1024:
        raise ValueError("XML exceeds offline validation size budget")
    tree = etree.parse(str(path), parser)
    if tree.docinfo.doctype:
        raise ValueError("DTD is forbidden")
    return tree


def schema_for(path, parser):
    return etree.XMLSchema(etree.parse(str(path), parser))


def errors(schema):
    return [str(entry) for entry in schema.error_log][:20]


def validate_filing(path, schema_root):
    parser = parser_for(schema_root)
    original = read_xml(Path(path), parser)
    base_schema = schema_for(schema_root / "filing.xsd", parser)
    ext_schema = schema_for(schema_root / "extension" / "common.xsd", parser)
    projected = copy.deepcopy(original)
    extension_count = 0
    issues = []

    for node in list(projected.getroot().iter()):
        if not isinstance(node.tag, str):
            continue
        name = etree.QName(node)
        if name.namespace != TYLER:
            continue
        parent = node.getparent()
        if parent is None:
            issues.append("Unexpected Tyler root element")
            continue
        if etree.QName(parent).namespace == TYLER:
            continue
        if (name.localname, etree.QName(parent).localname) not in PARENTS:
            issues.append(
                f"Unexpected Tyler augmentation {name.localname} "
                f"under {etree.QName(parent).localname}"
            )
            continue
        standalone = etree.ElementTree(copy.deepcopy(node))
        if not ext_schema.validate(standalone):
            issues += ["Tyler augmentation: " + message for message in errors(ext_schema)]
        extension_count += 1
        parent.remove(node)

    if not base_schema.validate(projected):
        issues += ["Base filing: " + message for message in errors(base_schema)]
    id_attr = f"{{{STRUCTURES}}}id"
    ref_attr = f"{{{STRUCTURES}}}ref"
    # Check original tree, including extension nodes, for broken NIEM references.
    ids = [
        n.get(id_attr)
        for n in original.iter()
        if isinstance(n.tag, str) and n.get(id_attr)
    ]
    refs = [
        n.get(ref_attr)
        for n in original.iter()
        if isinstance(n.tag, str) and n.get(ref_attr)
    ]
    if len(ids) != len(set(ids)):
        issues.append("Duplicate NIEM structures:id values")
    missing = sorted(set(refs).difference(ids))
    if missing:
        issues.append("Dangling NIEM structures:ref values: " + ",".join(missing))
    return {
        "ok": not issues,
        "validated_extensions": extension_count,
        "issues": issues,
        "profile": "base XSD + detached Tyler extension XSD + NIEM references "
                   "(NOT full integrated XSD)",
    }


def validate_payment(path, schema_root):
    parser = parser_for(schema_root)
    schema = schema_for(schema_root / "payment.xsd", parser)
    tree = read_xml(Path(path), parser)
    valid = schema.validate(tree)
    return {
        "ok": valid,
        "issues": [] if valid else errors(schema),
        "profile": "payment.xsd",
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--schema-root", type=Path, required=True)
    ap.add_argument("--filing", type=Path, required=True)
    ap.add_argument("--payment", type=Path)
    args = ap.parse_args()
    result = {"filing": validate_filing(args.filing, args.schema_root)}
    if args.payment:
        result["payment"] = validate_payment(args.payment, args.schema_root)
    print(json.dumps(result, indent=2))
    if any(not result[k]["ok"] for k in result):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
