"""デモのページを作る (GitHub Pages で出す)。

  python build/mkdemo.py [サイトの場所 (既定: docs)]

デモは サイトの場所/demo/ に作る (Pages の URL は /<リポジトリ名>/demo/)。サイトの入口 (index.html) はデモへ送るだけ。
root/www/ui をそのまま写し、build/demo/demo.js (ルーターの代わりの架空の応答) を app.js より前に読み込ませる。
Pages ではサイトの場所が /<リポジトリ名>/ になるので、/ui/ で始まる場所は ./ に直す。
画面に出す版は、git の一番新しいタグ (v1.0.1 など) から取る。
出力先は毎回作り直す (中身は手で直さない)。
"""
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
UI = os.path.join(HERE, '..', 'root', 'www', 'ui')
DEMO_JS = os.path.join(HERE, 'demo', 'demo.js')


def version():
    """一番新しいタグの版 (v を除く)。取れなければ空 (画面は「-」になる)"""
    try:
        tag = subprocess.run(['git', 'describe', '--tags', '--abbrev=0'], cwd=HERE, capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError) as e:
        print('mkdemo: 版を取れません (画面の版は空のまま):', e, file=sys.stderr)
        return ''
    return re.sub(r'^v', '', tag)


def main():
    site = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', 'docs'))
    out = os.path.join(site, 'demo')
    # 作り直す前に、別のものを消さないよう、前回このスクリプトが作った場所かを確かめる
    if os.path.exists(out):
        if not os.path.exists(os.path.join(out, 'demo.js')):
            sys.exit('%s はデモの出力先ではないようです (demo.js がない)。別の場所を指定してください' % out)
        shutil.rmtree(out)
    os.makedirs(site, exist_ok=True)
    shutil.copytree(UI, out)
    shutil.copy(DEMO_JS, os.path.join(out, 'demo.js'))

    ver = version()
    # /ui/ で始まる場所を、サイトの中の場所に直す。版は apk と同じく version.js の import に ?v= で渡す
    for dirpath, _, names in os.walk(out):
        for n in names:
            if not n.endswith(('.js', '.html', '.css')):
                continue
            p = os.path.join(dirpath, n)
            s = open(p, encoding='utf-8').read()
            t = re.sub(r"(['\"(])/ui/", r'\1./', s)
            if ver:
                t = re.sub(r"(from\s+'\.{1,2}/version\.js)(')", lambda m: m.group(1) + '?v=' + ver + m.group(2), t)
            if t != s:
                open(p, 'w', encoding='utf-8', newline='\n').write(t)

    # 入口: app.html にデモの応答を足して index.html にする (元の index.html はルーター用の転送なので使わない)
    app = open(os.path.join(out, 'app.html'), encoding='utf-8').read()
    app = app.replace('<script type="module"', '<script src="demo.js"></script>\n<script type="module"', 1)
    app = app.replace('<title>TachiGUI</title>', '<title>TachiGUI デモ / Demo</title>', 1)
    open(os.path.join(out, 'index.html'), 'w', encoding='utf-8', newline='\n').write(app)
    os.remove(os.path.join(out, 'app.html'))
    # 同梱のライブラリ (Preact、htm など) を配るので、ライセンスの表記も一緒に置く
    root = os.path.join(HERE, '..')
    for n in ('LICENSE', 'THIRD_PARTY_NOTICES.md'):
        shutil.copy(os.path.join(root, n), os.path.join(out, n))
    shutil.copytree(os.path.join(root, 'licenses'), os.path.join(out, 'licenses'))
    # サイトの入口は、デモへ送るだけ
    with open(os.path.join(site, 'index.html'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('<!doctype html>\n<meta charset="utf-8">\n<title>TachiGUI</title>\n'
                '<meta http-equiv="refresh" content="0; url=demo/">\n<a href="demo/">TachiGUI demo</a>\n')
    # Jekyll を通さない (ファイルをそのまま出す)
    open(os.path.join(site, '.nojekyll'), 'w').close()
    print('demo:', out)


if __name__ == '__main__':
    main()
