"""Local diagnostic worker. Never authorizes issuance or signature validity."""
import base64
import hashlib
import io
import json
import pathlib
import os
import sys
from xml.parsers import expat

ROOT = pathlib.Path(__file__).resolve().parents[1]
MAX_BYTES = 2 * 1024 * 1024
NAMESPACE = 'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica'
PINS = [
    ('FacturaElectronica.uploaded-20261123.xsd', 119689, '926ba81325bc21102755bd8e4e570a63caaca086e680a877c3a6d15d6ee8a62f'),
    ('candidates/xmldsig-core-schema.w3c-2002.xsd', 10293, '35cf8197da812c85e40d57891b35c94187569ed474a2dac813ce5090dafcd35c'),
]

class InputFailure(Exception):
    pass

def report(status, issues, **extra):
    return dict(status=status, issues=issues, revisionConfirmed=False,
                signatureVerification='not_run', haciendaStatus='not_sent',
                emissionEnabled=False, **extra)

def inspect_input(content):
    if len(content) > MAX_BYTES:
        raise InputFailure('XML_SIZE_EXCEEDED')
    try:
        content.decode('utf-8', errors='strict')
    except UnicodeError:
        raise InputFailure('XML_ENCODING_UNSUPPORTED')
    parser = expat.ParserCreate(namespace_separator='|')
    depth = 0
    elements = 0
    def fail(code):
        raise InputFailure(code)
    def declaration(version, encoding, standalone):
        if version != '1.0': fail('XML_VERSION_UNSUPPORTED')
        if encoding and encoding.upper() != 'UTF-8': fail('XML_ENCODING_UNSUPPORTED')
    def start(name, attrs):
        nonlocal depth, elements
        depth += 1
        elements += 1
        if depth > 64 or elements > 20000 or len(attrs) > 64:
            fail('XML_STRUCTURE_LIMIT_EXCEEDED')
        if elements == 1 and name != NAMESPACE + '|FacturaElectronica':
            fail('XML_DOCUMENT_UNSUPPORTED')
    def end(name):
        nonlocal depth
        depth -= 1
    parser.XmlDeclHandler = declaration
    parser.StartElementHandler = start
    parser.EndElementHandler = end
    parser.StartDoctypeDeclHandler = lambda *args: fail('XML_DTD_FORBIDDEN')
    parser.ExternalEntityRefHandler = lambda *args: fail('XML_DTD_FORBIDDEN')
    parser.ProcessingInstructionHandler = lambda *args: fail('XML_PROCESSING_INSTRUCTION_FORBIDDEN')
    try:
        parser.Parse(content, True)
    except expat.ExpatError:
        fail('XML_MALFORMED')

def build_schema():
    import xmlschema
    import elementpath
    if xmlschema.__version__ != '4.3.2' or elementpath.__version__ != '5.1.4':
        raise InputFailure('XSD_ENGINE_VERSION_MISMATCH')
    resources = []
    base = ROOT / 'docs/reference/hacienda/v4.4'
    for name, length, digest in PINS:
        path = base / name
        if path.is_symlink() or path.resolve().parent not in (base.resolve(), (base / 'candidates').resolve()):
            raise InputFailure('XSD_SNAPSHOT_INTEGRITY_FAILED')
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(descriptor, "rb") as handle:
            content = handle.read(length + 1)
        if len(content) != length or hashlib.sha256(content).hexdigest() != digest:
            raise InputFailure('XSD_SNAPSHOT_INTEGRITY_FAILED')
        # Only the exact pinned W3C schema may contain its historic DTD.
        # ElementTree does not fetch external DTDs; resource locations are denied.
        resources.append(xmlschema.XMLResource(content, allow='none',
                         defuse='never' if name.startswith('candidates/') else 'always'))
    # Register the signature namespace first, preserving namespace declarations.
    return compile_resources(list(reversed(resources)))

def compile_resources(resources):
    import xmlschema
    return xmlschema.XMLSchema11(resources, allow='none', defuse='always', use_fallback=False)

def validate_snapshot(content):
    try:
        inspect_input(content)
        schema = build_schema()
        import xmlschema
        source = xmlschema.XMLResource(io.BytesIO(content), allow='none',
                                       block='file url', defuse='always')
        count = 0
        for error in schema.iter_errors(source, use_defaults=False, use_location_hints=False):
            count += 1
            if count >= 11: break
        return report('snapshot_invalid' if count else 'snapshot_matches',
                      ['XSD_STRUCTURE_INVALID'] if count else [],
                      xsdValidation='downloaded_snapshot_only',
                      errorCount=min(count, 10), errorsTruncated=count > 10)
    except InputFailure as error:
        return report('blocked', [str(error)], xsdValidation='not_run')
    except Exception:
        # Do not print exceptions: they may contain XML values or internal paths.
        return report('technical_error', ['XSD_ENGINE_FAILED'], xsdValidation='not_run')

def main():
    try:
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (256 * 1024 * 1024,) * 2)
        resource.setrlimit(resource.RLIMIT_CPU, (5, 5))
        data = sys.stdin.buffer.read(3 * 1024 * 1024 + 1)
        if len(data) > 3 * 1024 * 1024:
            raise InputFailure('XML_SIZE_EXCEEDED')
        request = json.loads(data)
        if not isinstance(request, dict) or set(request) != {'xml_base64'}:
            raise InputFailure('XSD_REQUEST_INVALID')
        content = base64.b64decode(request['xml_base64'], validate=True)
        result = validate_snapshot(content)
    except Exception:
        result = report('technical_error', ['XSD_REQUEST_INVALID'], xsdValidation='not_run')
    print(json.dumps(result, separators=(',', ':')))

if __name__ == '__main__':
    main()
