"""英語化の点検: 訳し漏れと、辞書の過不足を出す。

  python build/check-i18n.py

1. 画面の JS で、T() の外にある日本語 (コメントと console.* と、i18n-ok と書いた行は除く)
2. T('...') の鍵のうち、英語の辞書 (root/www/ui/js/i18n/en.js) にないもの
3. 辞書にあるが、どこからも使っていない鍵
見つかれば終了コード 1 を返す。
"""
import glob
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'root', 'www', 'ui')
EN = os.path.join(ROOT, 'js', 'i18n', 'en.js')
JP = re.compile(r'[぀-ヿ一-鿿]')
# T('...') の第 1 引数 (1 行の文字列)
CALL = re.compile(r"""\bT\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)")""")
# 辞書の 1 行: '鍵': '訳',
ENTRY = re.compile(r"""^\s*'((?:[^'\\]|\\.)*)'\s*:\s*'((?:[^'\\]|\\.)*)',?\s*$""")


def unescape(s):
    return s.replace("\\'", "'").replace('\\"', '"').replace('\\\\', '\\')


def strip_comments(src):
    """コメントを空白に置き換える (行番号は保つ)。文字列の中の // や /* は残す"""
    out, i, n = [], 0, len(src)
    quote = None
    while i < n:
        ch = src[i]
        if quote:
            out.append(ch)
            if ch == '\\' and i + 1 < n:
                out.append(src[i + 1]); i += 2; continue
            if ch == quote:
                quote = None
            i += 1; continue
        if ch in '\'"`':
            quote = ch; out.append(ch); i += 1; continue
        if src.startswith('//', i):
            j = src.find('\n', i)
            j = n if j < 0 else j
            out.append(' ' * (j - i)); i = j; continue
        if src.startswith('/*', i):
            j = src.find('*/', i + 2)
            j = n if j < 0 else j + 2
            out.append(''.join(c if c == '\n' else ' ' for c in src[i:j])); i = j; continue
        out.append(ch); i += 1
    return ''.join(out)


def blank(m):
    return ''.join(c if c == '\n' else ' ' for c in m.group(0))


def main():
    files = [p for p in glob.glob(os.path.join(ROOT, 'js', '**', '*.js'), recursive=True)
             if os.sep + 'vendor' + os.sep not in p and os.sep + 'i18n' + os.sep not in p and not p.endswith('i18n.js')]
    keys, bad = {}, []
    for p in sorted(files):
        raw = open(p, encoding='utf-8').read()
        ok = {no for no, line in enumerate(raw.split('\n'), 1) if 'i18n-ok' in line}
        src = strip_comments(raw)
        for m in CALL.finditer(src):
            k = unescape(m.group(1) if m.group(1) is not None else m.group(2))
            keys.setdefault(k, os.path.relpath(p, ROOT) + ':' + str(src.count('\n', 0, m.start()) + 1))
        # 訳す呼び出しと、開発者向けのログを消してから、残った日本語を探す
        rest = CALL.sub(blank, src)
        rest = re.sub(r"""console\.(?:error|warn|log|info)\((?:[^()]|\([^()]*\))*\)""", blank, rest)
        for no, line in enumerate(rest.split('\n'), 1):
            if JP.search(line) and no not in ok:
                bad.append('%s:%d: %s' % (os.path.relpath(p, ROOT), no, line.strip()[:120]))

    # 補助スクリプトが画面に返す文 (fail、error など)。画面は tr() で訳すので、辞書に要る
    back = backend_messages()

    en = {}
    if os.path.exists(EN):
        for line in open(EN, encoding='utf-8'):
            m = ENTRY.match(line)
            if m:
                en[unescape(m.group(1))] = unescape(m.group(2))
    missing = [k for k in keys if k not in en]
    # スクリプトの文は、$変数 や、後ろにつなぐ値を {名前} にした鍵でもよい
    pats = [(k, re.compile('^' + re.sub(r'\\\{\w+\\\}', r'.+', re.escape(k)) + '$')) for k in en if '{' in k]
    def covered(msg):
        if msg in en:
            return msg
        probe = re.sub(r'\$\{?\w+\}?|%[ds]', 'X', msg)
        for k, rx in pats:
            if rx.match(probe) or rx.match(probe + 'X') or rx.match('X' + probe):
                return k
        return None
    back_missing = []
    used = set(keys)
    for msg, where in back.items():
        k = covered(msg)
        if k:
            used.add(k)
        else:
            back_missing.append('%s  (%s)' % (msg, where))
    unused = [k for k in en if k not in used]

    for title, items in (('T() の外の日本語', bad), ('辞書にない鍵', ['%s  (%s)' % (k, keys[k]) for k in missing]),
                         ('辞書にないスクリプトの文', back_missing), ('使っていない鍵', unused)):
        print('== %s: %d' % (title, len(items)))
        for x in items:
            print('  ' + x)
    print('鍵 %d、スクリプトの文 %d、辞書 %d' % (len(keys), len(back), len(en)))
    return 1 if bad or missing or back_missing else 0


BACK = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'root')
# 画面に返す文がある行 (ログに書くだけの行は除く)
SHOWN = re.compile(r"""\bfail\b|error|\berr\b|TXGL""")
LOGONLY = re.compile(r"""\blogger\b|\bwarn\(|console\.""")
LIT = re.compile(r"""'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)\"""")


def backend_messages():
    files = glob.glob(os.path.join(BACK, 'usr', 'libexec', 'tachigui-*')) + glob.glob(os.path.join(BACK, 'usr', 'share', 'rpcd', 'ucode', 'tachigui.*'))
    out = {}
    for p in sorted(files):
        for no, line in enumerate(open(p, encoding='utf-8'), 1):
            code = line.split('//')[0] if not line.lstrip().startswith('#') else ''
            if not SHOWN.search(code) or LOGONLY.search(code):
                continue
            for m in LIT.finditer(code):
                s = m.group(1) if m.group(1) is not None else m.group(2)
                if JP.search(s):
                    out.setdefault(unescape(s), os.path.relpath(p, BACK) + ':' + str(no))
    return out


if __name__ == '__main__':
    sys.exit(main())
