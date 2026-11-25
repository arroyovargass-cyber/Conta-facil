"""Full unchanged MH4.4 XSD plus pinned W3C signature schema; no trust claim."""
import base64
import hashlib
import importlib.util
import io
import json
import os
import pathlib
import re
import resource
import socket
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
BASE = ROOT / 'docs/reference/hacienda/v4.4'
NAMESPACE = 'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/mensajeHacienda'
PINS = [
    ('MensajeHacienda_V4.4.xsd', 7799, 'b2606156042b7aa7b7f7f61945f0ff1323661b43b5a1489ad5eafad1c52fd25e'),
    ('xmldsig-core-schema.w3c-2002.xsd', 10293, '35cf8197da812c85e40d57891b35c94187569ed474a2dac813ce5090dafcd35c'),
]
spec = importlib.util.spec_from_file_location('diagnostic', ROOT / 'infra/xml-validator-worker.py')
diagnostic = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagnostic)


def validate(content):
    import xmlschema
    import elementpath
    if len(content) > 1048576:
        raise ValueError('XML_SIZE_EXCEEDED')
    diagnostic.inspect_input(content, NAMESPACE + '|MensajeHacienda')
    if xmlschema.__version__ != '4.3.2' or elementpath.__version__ != '5.1.4':
        raise ValueError('XSD_ENGINE_VERSION_MISMATCH')
    resources = []
    for name, length, digest in PINS:
        path = BASE / name
        if path.is_symlink() or path.resolve().parent != BASE.resolve():
            raise ValueError('XSD_SNAPSHOT_INTEGRITY_FAILED')
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(descriptor, 'rb') as handle:
            data = handle.read(length + 1)
        if len(data) != length or hashlib.sha256(data).hexdigest() != digest:
            raise ValueError('XSD_SNAPSHOT_INTEGRITY_FAILED')
        # Only exact verified W3C bytes may contain their historic local DTD.
        # External locations remain disabled and sockets are sealed before validation.
        resources.append(xmlschema.XMLResource(data, allow='none',
                         defuse='never' if name == 'xmldsig-core-schema.w3c-2002.xsd' else 'always'))
    schema = xmlschema.XMLSchema11(list(reversed(resources)), allow='none',
                                  defuse='always', use_fallback=False)
    source = xmlschema.XMLResource(io.BytesIO(content), allow='none',
                                   block='file url', defuse='always')
    for error in schema.iter_errors(source, use_defaults=False, use_location_hints=False):
        return dict(valid=False, issues=['XSD_STRUCTURE_INVALID'])
    return dict(valid=True, issues=[])


def main():
    resource.setrlimit(resource.RLIMIT_AS, (256 * 1024 * 1024,) * 2)
    resource.setrlimit(resource.RLIMIT_CPU, (8, 8))
    import xmlschema
    import elementpath
    def denied(*args, **kwargs):
        raise OSError('network disabled')
    socket.socket = denied
    socket.create_connection = denied
    socket.getaddrinfo = denied
    try:
        raw = sys.stdin.buffer.read(1500001)
        if len(raw) > 1500000:
            raise ValueError('XML_SIZE_EXCEEDED')
        request = json.loads(raw)
        if not isinstance(request, dict) or set(request) != {'xml_base64'}:
            raise ValueError('XSD_REQUEST_INVALID')
        result = validate(base64.b64decode(request['xml_base64'], validate=True))
    except diagnostic.InputFailure as error:
        result = dict(valid=False, issues=[str(error)])
    except ValueError as error:
        code = str(error)
        result = dict(valid=False, issues=[code if re.fullmatch('[A-Z_]{1,64}', code) else 'XSD_REQUEST_INVALID'])
    except Exception:
        result = dict(valid=False, issues=['XSD_ENGINE_FAILED'])
    print(json.dumps(result))


if __name__ == '__main__':
    main()
