#!/usr/bin/env python3
"""MAP-E のルール表 (root/usr/share/tachigui/rules.json) を、公開元から作り直す。

使い方: python build/update-rules.py [auto-config.js のパス]
パスを省くと公開元から取得する。今の表との増減を表示するので、確かめてからパッケージを作る。
"""
from __future__ import annotations

import collections
import ipaddress
import json
import os
import re
import sys
import urllib.request

URL = 'https://raw.githubusercontent.com/site-u2023/site-u2023.github.io/main/www/auto-config/auto-config.js'
SOURCE = 'https://github.com/site-u2023/site-u2023.github.io (www/auto-config/auto-config.js, mapRulesData.basicMapRules)'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'root', 'usr', 'share', 'tachigui', 'rules.json')

# BR ごとの回線名。公開元の見出しによる。分からない BR は名前なしにする (画面には MAP-E と出る)
NAMES = {
    '2001:260:700:1::1:275': 'v6プラス',
    '2001:260:700:1::1:276': 'v6プラス',
    '2001:380:a120::9': 'OCN',
    '2001:3b8:200:ff9::1': 'NURO',
}
MIN_RULES = 258     # これより減ったら、公開元の形式が変わったとみなして止める


def fetch(path: str | None) -> str:
    if path:
        with open(path, encoding='utf-8') as f:
            return f.read()
    with urllib.request.urlopen(URL, timeout=30) as res:
        return res.read().decode('utf-8')


def parse(text: str) -> list[dict]:
    """basicMapRules の中の 1 件ずつを取り出す。JS は実行せず、決まった形だけを読む"""
    start = text.index('basicMapRules')
    end = text.index('function checkDSLiteRule', start)
    rules: list[dict] = []
    for block in re.findall(r'\{[^{}]*?"brIpv6Address"[^{}]*?\}', text[start:end], re.S):
        f = dict(re.findall(r'"(\w+)"\s*:\s*"([^"]*)"', block))
        rules.append(check(f))
    return rules


def parse_aftr(text: str) -> list[dict]:
    """dsliteRulesData から、接続先と IPv6 プレフィックスの表を取り出す"""
    start = text.index('dsliteRulesData')
    end = text.index('mapRulesData', start)
    out: list[dict] = []
    for block in re.findall(r'aftrType:.*?tunlink', text[start:end], re.S):
        kind = re.search(r'aftrType:\s*"(\w+)"', block).group(1)
        host = re.search(r'aftrFqdn:\s*"([^"]+)"', block).group(1)
        ranges = re.search(r'ipv6PrefixRanges:\s*\[(.*?)\]', block, re.S).group(1)
        nets = [str(ipaddress.IPv6Network(x)) for x in re.findall(r'"([^"]+)"', ranges)]
        if not nets:
            raise ValueError(f'プレフィックスがありません: {kind}')
        out.append({'k': kind, 'host': host, 'p': nets})
    return out


def check(f: dict) -> dict:
    """値を確かめて、rules.json の形にする。おかしな値は例外で止める"""
    br = str(ipaddress.IPv6Address(f['brIpv6Address']))
    p = str(ipaddress.IPv6Address(f['ipv6Prefix']))
    v4 = str(ipaddress.IPv4Address(f['ipv4Prefix']))
    plen, v4len, ea, off = int(f['ipv6PrefixLength']), int(f['ipv4PrefixLength']), int(f['eaBitLength']), int(f['psIdOffset'])
    psidlen = ea - (32 - v4len)
    if not (0 < plen <= 64 and 0 < v4len <= 32 and plen + ea <= 64 and 0 <= psidlen and 0 < off and off + psidlen <= 16):
        raise ValueError(f'値が範囲外です: {f}')
    rule = {'p': p, 'l': plen, 'v4': v4, 'v4l': v4len, 'ea': ea, 'off': off, 'br': br}
    name = NAMES.get(br)
    if name:
        rule['n'] = name
    return rule


def key(r: dict) -> str:
    return str(ipaddress.IPv6Network((r['p'], r['l']), strict=False))


def main() -> int:
    try:
        text = fetch(sys.argv[1] if len(sys.argv) > 1 else None)
        rules = parse(text)
        aftr = parse_aftr(text)
    except (OSError, ValueError, KeyError, AttributeError) as e:
        print(f'読み取れません: {e}', file=sys.stderr)
        return 1
    if len(rules) < MIN_RULES:
        print(f'件数が少なすぎます ({len(rules)} 件)。公開元の形式を確かめてください', file=sys.stderr)
        return 1
    seen = collections.Counter(key(r) for r in rules)
    dup = [k for k, n in seen.items() if n > 1]
    if dup:
        print(f'同じプレフィックスが重複しています: {dup[:5]}', file=sys.stderr)
        return 1

    old: dict[str, dict] = {}
    try:
        with open(OUT, encoding='utf-8') as f:
            old = {key(r): r for r in json.load(f)['rules']}
    except (OSError, ValueError, KeyError) as e:
        print(f'今の表は読めません ({e})。新しく作ります')
    new = {key(r): r for r in rules}
    same = lambda a, b: all(a[k] == b[k] for k in ('v4', 'v4l', 'ea', 'off')) and ipaddress.IPv6Address(a['br']) == ipaddress.IPv6Address(b['br'])
    print(f'全 {len(rules)} 件 (追加 {len(new.keys() - old.keys())} / 削除 {len(old.keys() - new.keys())} / 変更 {sum(1 for k in new.keys() & old.keys() if not same(new[k], old[k]))})')
    for name, n in collections.Counter(r.get('n', '(名前なし)') for r in rules).most_common():
        print(f'  {name}: {n} 件')

    print('  DS-Lite: ' + ', '.join(a['k'] for a in aftr))

    lines = ',\n'.join(json.dumps(r, ensure_ascii=False, separators=(',', ':')) for r in rules)
    aftr_json = json.dumps(aftr, ensure_ascii=False, separators=(',', ':'))
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write('{"name":"MAP-E","source":%s,"count":%d,"aftr":%s,"rules":[\n%s\n]}\n' % (json.dumps(SOURCE), len(rules), aftr_json, lines))
    return 0


if __name__ == '__main__':
    sys.exit(main())
