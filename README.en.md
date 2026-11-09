# TachiGUI

[日本語](README.md)

A simple, easy web UI for OpenWrt.

[Demo](https://7979774.github.io/tachigui/demo/) (runs in your browser; values are fictional)

## Features

- Internet connection status
- Client list, IP reservations
- Network settings (MAP-E, DS-Lite, PPPoE, DHCP, static IP, bridge)
- Port forwarding
- Speed test, connectivity test
- File manager
- System info, security check
- Admin access, restart schedule, LEDs, appearance
- Wi-Fi settings (this router and linked OpenWrt-based APs)

## Requirements

- OpenWrt 25.12 or later (LuCI required)
- A recent browser (Chrome, Edge, Firefox, Safari)
- Tested on: BKHD-1264-SFP (x86)
- Tested line: v6 Plus (MAP-E, Japan)
- Lines in the rule table: v6 Plus, OCN, NURO, etc.

Other setups are untested.

The internet speed test needs `speedtest-go`.

## Install

Get the apk from [Releases](../../releases/latest) and install it on the router.

```bash
scp -O tachigui-1.0.0-r3.apk root@192.168.1.1:/tmp/
ssh root@192.168.1.1 apk add --allow-untrusted /tmp/tachigui-1.0.0-r3.apk
```

After installing, open `http://192.168.1.1/ui/`. To make `http://192.168.1.1/` open TachiGUI, run `/usr/libexec/tachigui-default on` on the router.

## Notes

- A personal hobby project. No support is provided. Use at your own risk.
- It rewrites network settings, so back up your settings first.
- The MAP-E rule table is not official. For lines not in the table, add a rule in the advanced network settings.
- Linking an AP places SSH keys and a setup script on the AP. The keys can run only fixed commands. The AP's root password is not saved.
- Trademarks belong to their owners. This project is not affiliated with them.

## Development

- Build the apk: `python build/mkapk2.py 1.0.0-r3 root build dist` (output in `dist/`)
- Rebuild the MAP-E rule table: `python build/update-rules.py`
- Rebuild the demo: `python build/mkdemo.py` (output in `docs/demo/`)
- Translations: `root/www/ui/js/i18n/en.js`. Check for gaps with `python build/check-i18n.py`.

## License

[MIT](LICENSE). For bundled components, see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
