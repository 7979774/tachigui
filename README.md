# TachiGUI

[English](README.en.md)

シンプルで簡単、誰にでも易しい OpenWrt 用の Web UI。

[デモ](https://7979774.github.io/tachigui/demo/) (ブラウザだけで動く。値は架空)

## 機能

- インターネット接続の状態表示
- クライアント一覧、IP の固定
- ネットワーク設定 (MAP-E、DS-Lite、PPPoE、DHCP、固定 IP、ブリッジ)
- ポート転送
- スピードテスト、接続テスト
- ファイルマネージャー
- システム情報、セキュリティ診断
- 管理アクセス、再起動スケジュール、LED、外観の設定
- Wi-Fi の設定 (ルーター本体と、連携した OpenWrt 系の AP)

## 動作環境

- OpenWrt 25.12 以降 (LuCI が必要)
- 新しめのブラウザ (Chrome、Edge、Firefox、Safari)
- 確認した機種: BKHD-1264-SFP (x86)
- 確認した回線: v6プラス (MAP-E)
- ルール表にある回線: v6プラス、OCN、NURO など

他の環境では確認していない。

インターネットのスピードテストには `speedtest-go` が必要。

## 導入

[リリース](../../releases/latest) から apk を入手して、ルーターに入れる。

```bash
scp -O tachigui-1.0.0-r3.apk root@192.168.1.1:/tmp/
ssh root@192.168.1.1 apk add --allow-untrusted /tmp/tachigui-1.0.0-r3.apk
```

導入後は `http://192.168.1.1/ui/` を開く。`http://192.168.1.1/` を TachiGUI にするときは、ルーターで `/usr/libexec/tachigui-default on` を実行する。

## 注意

- 個人が趣味で作っているもの。サポートはしない。使うときは自己責任で。
- ネットワーク設定を書き換えるので、使う前に設定をバックアップすること。
- MAP-E のルール表は公式の情報ではない。表にない回線は、ネットワーク設定の詳細でルールを追加できる。
- AP の連携では、SSH の鍵と設定用のスクリプトを AP に置く。鍵は決まったコマンドしか動かせない。AP の root パスワードは保存しない。
- 各社の商標は各社に帰属する。このプロジェクトとは関係がない。

## 開発

- apk を作る: `python build/mkapk2.py 1.0.0-r3 root build dist` (`dist/` にできる)
- MAP-E のルール表を作り直す: `python build/update-rules.py`
- デモを作り直す: `python build/mkdemo.py` (`docs/demo/` にできる)
- 英語の訳は `root/www/ui/js/i18n/en.js`。訳し漏れは `python build/check-i18n.py` で確かめる。

## ライセンス

[MIT](LICENSE)。同梱物は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照。
