# Invoice PDF font

DejaVu Sans is vendored unchanged from
`/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf` (Debian `fonts-dejavu-core`).
Upstream: https://dejavu-fonts.github.io/

SHA-256: `57f73e11f51999432bf7ab22ce55b6f945d5eca1bf824404cfa9ec2e3718c84e`

The renderer verifies this hash before embedding a subset. This font was checked
with fontkit for U+20A1 COSTA RICAN COLON SIGN support. Every rendered text code
point is checked against the embedded font's character set; unavailable glyphs
are rejected without changing names.

`LICENSE` is copied verbatim from
`/usr/share/doc/fonts-dejavu-core/copyright`. The font is covered by the
Bitstream Vera license; DejaVu changes are public domain. The Debian packaging
license section is retained as part of that provenance document.
