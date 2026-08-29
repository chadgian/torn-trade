from pathlib import Path

p = Path('torn-trade-analyzer.user.js')
s = p.read_text(encoding='utf-8')

s = s.replace('// @version      0.2.26', '// @version      0.2.27', 1)
s = s.replace("const VERSION = '0.2.26';", "const VERSION = '0.2.27';", 1)

# Torn PDA / some Android WebViews can mis-decode UTF-8 userscript source served through
# intermediary hosting, producing mojibake such as 'â', 'Â', and replacement boxes.
# Make the shipped JavaScript source entirely ASCII while preserving every Unicode
# character at runtime through JavaScript Unicode escape sequences.
def js_escape_char(ch: str) -> str:
    cp = ord(ch)
    if cp <= 0x7f:
        return ch
    if cp <= 0xffff:
        return f'\\u{cp:04X}'
    cp -= 0x10000
    hi = 0xD800 + (cp >> 10)
    lo = 0xDC00 + (cp & 0x3FF)
    return f'\\u{hi:04X}\\u{lo:04X}'

s = ''.join(js_escape_char(ch) for ch in s)

if any(ord(ch) > 127 for ch in s):
    raise SystemExit('Non-ASCII characters remain after conversion')

p.write_text(s, encoding='ascii')
