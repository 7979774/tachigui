/* TachiGUI のデモ: ルーターの代わりに、架空の応答を返す (GitHub Pages などで、ブラウザだけで動かすため)
   build/mkdemo.py が app.html の app.js より前に読み込む。書き込みはこのページの中で覚えるだけで、どこにも送らない
   値はすべて架空 (MAC はローカル用、IPv6 は説明用の 2001:db8::/32、公開の IPv4 は説明用の 203.0.113.0/24) */
(function () {
	'use strict';
	try { sessionStorage.setItem('tachigui.sid', 'de000000000000000000000000000000'); } catch (e) { console.warn('demo: セッションを保存できません', e); }

	const now = () => Math.floor(Date.now() / 1000);
	const BOOT = now() - (3 * 86400 + 5 * 3600 + 42 * 60);
	const up = () => now() - BOOT;
	const ja = (() => { try { const v = localStorage.getItem('tachigui.lang'); if (v) return v === 'ja'; } catch (e) { /* 読めなくても動く */ } return /^ja\b/i.test(navigator.language || ''); })();

	/* ---- 機器と端末 ---- */
	const PORTS = [ [ 'eth0', 'ETH0', 1000, true ], [ 'eth1', 'ETH1', 2500, true ], [ 'eth2', 'ETH2', 1000, true ], [ 'eth3', 'SFP0', 0, false ], [ 'eth4', 'SFP1', 0, false ] ];
	const PFX = '2001:db8:4a1c:5600';
	const AP = { host: '192.168.1.3', name: ja ? '2階の AP' : 'Upstairs AP', mac: '58:ef:68:31:0c:01' };
	/* [ MAC, IPv4, 名前 (DHCP), つけた名前, ポート, Wi-Fi の帯域, 電波 ] */
	const HOSTS = [
		[ '00:11:32:a7:3c:01', '192.168.1.20', 'nas', 'NAS', 'eth1', null, 0 ],
		[ 'd8:5e:d3:41:9b:02', '192.168.1.21', 'desktop-pc', '', 'eth2', null, 0 ],
		[ '02:11:22:33:44:03', '192.168.1.50', 'iPhone', ja ? '家族の iPhone' : 'Family iPhone', 'eth2', '5G', -48 ],
		[ 'f4:7b:09:5c:21:04', '192.168.1.51', 'Galaxy-S24', '', 'eth2', '5G', -61 ],
		[ '3c:22:fb:8e:10:05', '192.168.1.52', 'MacBook-Air', '', 'eth2', '5G', -55 ],
		[ 'a8:23:fe:6d:42:06', '192.168.1.60', 'living-tv', ja ? 'リビングのテレビ' : 'Living room TV', 'eth2', '2.4G', -66 ],
		[ '30:05:5c:7a:93:07', '192.168.1.61', 'printer', '', 'eth2', '2.4G', -70 ],
		[ 'b0:a7:32:15:c8:08', '192.168.1.62', '', '', 'eth2', '2.4G', -74 ],
		[ AP.mac, AP.host, 'ap', '', 'eth2', null, 0 ]
	];
	const files = {
		'/www/ui/clients.json': JSON.stringify(Object.fromEntries(HOSTS.filter(h => h[3]).map(h => [ h[0].toUpperCase(), h[3] ]))),
		'/www/ui/clients-meta.json': JSON.stringify({
			'00:11:32:a7:3c:01': { type: 'nas' }, 'd8:5e:d3:41:9b:02': { type: 'desktop' }, '02:11:22:33:44:03': { type: 'phone' }, 'f4:7b:09:5c:21:04': { type: 'phone' },
			'3c:22:fb:8e:10:05': { type: 'laptop' }, 'a8:23:fe:6d:42:06': { type: 'tv' }, '30:05:5c:7a:93:07': { type: 'printer' },
			'7c:bb:8a:20:5d:09': { type: 'game', ip: '192.168.1.70', host: 'game-console', seen: (now() - 7200) * 1000 }
		}),
		'/etc/crontabs/root': '0 4 * * 1 sleep 70 && touch /etc/banner && reboot\n'
	};
	const metaKeys = () => { const m = JSON.parse(files['/www/ui/clients-meta.json']); return Object.fromEntries(Object.entries(m).map(([ k, v ]) => [ k.toUpperCase(), v ])); };
	files['/www/ui/clients-meta.json'] = JSON.stringify(metaKeys());

	/* ---- 増えていく数 (グラフと速度のため) ---- */
	/* 増え続ける数。毎秒 bps の 0.3〜1.7 倍で増える (揺れの項は小さくして、減らないようにする) */
	const rate = (bps, phase) => Math.floor(bps * up() + bps * 14 * Math.sin(Date.now() / 20000 + phase));
	const traffic = (i) => [ rate(9000 * (i + 1), i) + 3e8 * (i + 1), rate(1500 * (i + 1), i + 1) + 4e7 * (i + 1) ];

	function procStat() {
		const t = up() * 100, lines = [];
		let all = [ 0, 0, 0, 0 ];
		for (let c = 0; c < 4; c++) {
			const busy = Math.floor(t * (0.06 + 0.02 * c) + 100 * Math.sin(Date.now() / 20000 + c));
			const v = [ Math.floor(busy * 0.7), 0, Math.floor(busy * 0.3), t - busy ];
			all = all.map((x, i) => x + v[i]);
			lines.push('cpu' + c + ' ' + v[0] + ' 0 ' + v[2] + ' ' + v[3] + ' 0 0 0 0 0 0');
		}
		return 'cpu  ' + all[0] + ' 0 ' + all[2] + ' ' + all[3] + ' 0 0 0 0 0 0\n' + lines.join('\n') + '\n';
	}
	function procNetDev() {
		const row = (n, rx, tx) => '  ' + n + ': ' + rx + ' 0 0 0 0 0 0 0 ' + tx + ' 0 0 0 0 0 0 0';
		const wan = [ rate(2400000, 0) + 8.8e10, rate(380000, 1) + 5.5e9 ];
		return 'Inter-|   Receive |  Transmit\n face |bytes packets|bytes packets\n' + [
			row('lo', 1200000, 1200000), row('eth0', wan[0], wan[1]), row('eth1', rate(400000, 2) + 3e10, rate(1800000, 3) + 6e10),
			row('eth2', rate(300000, 4) + 2e10, rate(900000, 5) + 4e10), row('br-lan', wan[1] * 0.9 | 0, wan[0] * 0.9 | 0), row('map-map0', wan[0] * 0.8 | 0, wan[1] * 0.8 | 0)
		].join('\n') + '\n';
	}

	/* ---- UCI (書き込みはこのページの中だけ) ---- */
	const sec = (type, o) => ({ '.type': type, '.anonymous': false, ...o });
	const UCI = {
		network: {
			loopback: sec('interface', { device: 'lo', proto: 'static', ipaddr: '127.0.0.1', netmask: '255.0.0.0' }),
			globals: sec('globals', { ula_prefix: 'fd12:3456:789a::/48' }),
			cfg030f15: { ...sec('device', { name: 'br-lan', type: 'bridge', ports: [ 'eth1', 'eth2' ] }), '.anonymous': true },
			lan: sec('interface', { device: 'br-lan', proto: 'static', ipaddr: '192.168.1.1', netmask: '255.255.255.0', ip6assign: '60' }),
			wan6: sec('interface', { proto: 'dhcpv6', device: 'eth0', reqaddress: 'try', reqprefix: 'auto', ra_holdoff: '60' }),
			map0: sec('interface', { proto: 'map', maptype: 'map-e', tunlink: 'wan6', mtu: '1460', encaplimit: 'ignore', legacymap: '1' })
		},
		dhcp: {
			cfg01411c: { ...sec('dnsmasq', { domainneeded: '1', localise_queries: '1', local: '/lan/', domain: 'lan', authoritative: '1' }), '.anonymous': true },
			lan: sec('dhcp', { interface: 'lan', start: '100', limit: '150', leasetime: '12h', dhcpv6: 'server', ra: 'server' }),
			wan: sec('dhcp', { interface: 'wan', ignore: '1' }),
			nas: sec('host', { name: 'nas', mac: '00:11:32:a7:3c:01', ip: '192.168.1.20' })
		},
		system: {
			cfg01e48a: { ...sec('system', { hostname: 'OpenWrt', timezone: 'JST-9', zonename: 'Asia/Tokyo', ttylogin: '0' }), '.anonymous': true },
			ntp: sec('timeserver', { enabled: '1', enable_server: '0', server: [ 'ntp.nict.jp', '0.openwrt.pool.ntp.org' ] })
		},
		firewall: {
			cfg01e63d: { ...sec('defaults', { input: 'REJECT', output: 'ACCEPT', forward: 'REJECT', syn_flood: '1' }), '.anonymous': true },
			cfg02dc81: { ...sec('zone', { name: 'lan', network: [ 'lan' ], input: 'ACCEPT', output: 'ACCEPT', forward: 'ACCEPT' }), '.anonymous': true },
			cfg03dc81: { ...sec('zone', { name: 'wan', network: [ 'wan6', 'map0' ], input: 'REJECT', output: 'ACCEPT', forward: 'REJECT', masq: '1', mtu_fix: '1' }), '.anonymous': true }
		},
		tachigui: { main: sec('ipv6', { enabled: '1' }) }
	};
	let uciN = 0;
	function uciGet(p) {
		const c = UCI[p.config];
		if (!c) return [ 5, null ];
		if (p.section) return c[p.section] ? [ 0, { values: c[p.section] } ] : [ 5, null ];
		const vals = {};
		Object.keys(c).forEach((k, i) => { if (!p.type || c[k]['.type'] === p.type) vals[k] = { ...c[k], '.name': k, '.index': i }; });
		return [ 0, { values: vals } ];
	}
	function uciCall(m, p) {
		const c = UCI[p.config] || (UCI[p.config] = {});
		if (m === 'get') return uciGet(p);
		if (m === 'add') { const n = p.name || 'cfg' + (0x900 + ++uciN).toString(16) + 'a1'; c[n] = { '.type': p.type, '.anonymous': !p.name, ...(p.values || {}) }; return [ 0, { section: n } ]; }
		if (m === 'set') { if (!c[p.section]) return [ 5, null ]; Object.assign(c[p.section], p.values || {}); return [ 0, {} ]; }
		if (m === 'delete') { if (p.options) p.options.forEach(o => { if (c[p.section]) delete c[p.section][o]; }); else delete c[p.section]; return [ 0, {} ]; }
		if (m === 'changes') return [ 0, { changes: {} } ];
		return [ 0, {} ];      // commit / apply / confirm / revert
	}

	/* ---- ネットワーク ---- */
	function ifaces() {
		const ip4 = (a, m) => [ { address: a, mask: m } ];
		return [
			{ interface: 'lan', up: true, proto: 'static', device: 'br-lan', l3_device: 'br-lan', uptime: up() - 20, 'ipv4-address': ip4('192.168.1.1', 24), 'ipv6-address': [], 'ipv6-prefix': [], 'ipv6-prefix-assignment': [ { address: PFX + '::', mask: 60, 'local-address': { address: PFX + '::1', mask: 60 } } ], route: [], 'dns-server': [], data: {} },
			{ interface: 'loopback', up: true, proto: 'static', device: 'lo', l3_device: 'lo', uptime: up(), 'ipv4-address': ip4('127.0.0.1', 8), 'ipv6-address': [], 'ipv6-prefix': [], route: [], 'dns-server': [], data: {} },
			{ interface: 'map0', up: true, proto: 'map', l3_device: 'map-map0', uptime: up() - 60, 'ipv4-address': ip4('203.0.113.42', 32), 'ipv6-address': [], 'ipv6-prefix': [], route: [ { target: '0.0.0.0', mask: 0, nexthop: '0.0.0.0', source: '0.0.0.0/0' } ], 'dns-server': [], data: {} },
			{ interface: 'wan6', up: true, proto: 'dhcpv6', device: 'eth0', l3_device: 'eth0', uptime: up() - 40, 'ipv4-address': [], 'ipv6-address': [ { address: '2001:db8:4a1c:5600:5a7e:31ff:fe0c:aa01', mask: 64 } ], 'ipv6-prefix': [ { address: PFX + '::', mask: 56 } ], route: [ { target: '::', mask: 0, nexthop: 'fe80::1', source: '::/0' } ], 'dns-server': [ '2001:db8:0:53::1', '2001:db8:0:53::2' ], data: {} }
		];
	}
	function netStatus() {
		return {
			ifaces: [
				{ name: 'lan', proto: 'static', up: true, device: 'br-lan', ipv4: '192.168.1.1', ipv6: null, pd: null, errors: null },
				{ name: 'map0', proto: 'map', up: true, device: 'map-map0', ipv4: '203.0.113.42', ipv6: null, pd: null, errors: null },
				{ name: 'wan6', proto: 'dhcpv6', up: true, device: 'eth0', ipv4: null, ipv6: PFX + ':5a7e:31ff:fe0c:aa01', pd: PFX + '::/56', errors: null }
			],
			wan6: { up: true, device: 'eth0', pd: PFX + '::/56' },
			map: { up: true, errors: null, ipv4: '203.0.113.42' },
			devices: PORTS.map(([ n, l, s, c ], i) => ({ name: n, label: l, driver: 'igc', mac: '02:5a:7e:00:00:0' + i, carrier: c, speed: c ? s : -1, duplex: c ? 'full' : 'unknown', master: n === 'eth1' || n === 'eth2' ? 'br-lan' : null,
				rx_bytes: c ? 4e10 + rate(300000, i) : 0, tx_bytes: c ? 9e9 + rate(80000, i) : 0, rx_errors: 0, tx_errors: 0 })),
			packages: { map: true, 'ds-lite': false, 'ppp-mod-pppoe': true }
		};
	}
	const MAPE = { ok: true, iface: 'map0', name: ja ? 'v6プラス' : 'v6 Plus', ipv4: '203.0.113.42', ce6: PFX + ':cb00:712a:5600:0', br: '2001:db8:0:100::64',
		ports: [ '5136-5151', '9232-9247', '13328-13343', '17424-17439', '21520-21535', '25616-25631', '29712-29727', '33808-33823', '37904-37919', '42000-42015', '46096-46111', '50192-50207', '54288-54303', '58384-58399', '62480-62495' ], port_count: 240 };
	const TRIG = [ 'none', 'timer', 'heartbeat', 'default-on', 'netdev' ];
	const LEDS = { leds: [ 'eth0', 'eth1', 'eth2' ].flatMap((p, i) => [ 0, 1, 2 ].map(k => ({ name: 'igc-0' + (i + 1) + '00-led' + k, trigger: 'netdev', triggers: TRIG, brightness: 1, max_brightness: 1, port: p, dev: p,
		modes: k === 0 ? [ 'link_2500' ] : k === 1 ? [ 'link_10', 'link_100', 'link_1000' ] : [ 'tx', 'rx' ], speeds: [ '10', '100', '1000', '2500' ] }))) };

	function hostHints() {
		const r = {};
		HOSTS.forEach(([ mac, ip, name ], i) => { r[mac.toUpperCase()] = { ipaddrs: [ ip ], ip6addrs: i < 6 ? [ PFX + ':' + (0x1000 + i).toString(16) + '::' + (i + 2) ] : [], name: name || undefined }; });
		return r;
	}
	const leases = () => ({ dhcp_leases: HOSTS.filter(h => h[1] !== AP.host && h[0] !== '00:11:32:a7:3c:01').map(([ mac, ip, name ], i) => ({ macaddr: mac, ipaddr: ip, hostname: name || undefined, expires: 20000 + i * 1800 })) });

	function clientsHelper() {
		const links = {}, tr = {}, apNames = {};
		HOSTS.forEach(([ mac, ip, , , port, band, sig ], i) => {
			links[mac] = { port };
			if (band) links[mac].wifi = { band, ssid: 'TachiNet', signal: sig, rx: [ 866, 433, 650, 144, 72, 58 ][i - 2] || 144, tx: [ 1201, 573, 866, 173, 86, 65 ][i - 2] || 144, ap: AP.name };
			tr[ip] = traffic(i);
		});
		HOSTS.slice(2, 8).forEach(h => { if (h[3]) apNames[h[0]] = h[3]; });
		return { uptime: up(), links, traffic: tr, aps: [ { host: AP.host, name: AP.name } ], names: apNames };
	}

	/* ---- Wi-Fi (この機器には無線がない。AP が 1 台) ---- */
	const ENC = [ 'none', 'psk2', 'psk-mixed', 'sae', 'sae-mixed' ];
	const TX = [ [ 'Max', '最大' ], [ 'High', '高' ], [ 'Medium', '中' ], [ 'Low', '低' ] ];
	const ch = (list, dfs) => list.map(c => ({ ch: c, dfs: dfs ? c >= 52 && c <= 144 : false }));
	const AP_RADIOS = [
		{ device: 'wifi0', band: '2.4G', iface: 'wifi2g', enabled: true, ssid: 'TachiNet', key: 'demo-password', encryption: 'sae-mixed', encryptions: ENC, hidden: false, channel: 0, channels: ch([ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13 ]),
			width: '40', widthsBy: { '11b/g/n/ax/be': [ '20', '40', 'auto' ] }, mode: '11b/g/n/ax/be', modes: [ '11b/g/n/ax/be', '11ax/be' ], txpower: 'Max', txpowers: TX, random_bssid: false },
		{ device: 'wifi1', band: '5G', iface: 'wifi5g', enabled: true, ssid: 'TachiNet', key: 'demo-password', encryption: 'sae-mixed', encryptions: ENC, hidden: false, channel: 36, channels: ch([ 36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140 ], true),
			width: '80', widthsBy: { '11a/n/ac/ax/be': [ '20', '40', '80', '160', 'auto' ], '11ax/be': [ '20', '40', '80', '160', 'auto' ] }, mode: '11a/n/ac/ax/be', modes: [ '11a/n/ac/ax/be', '11ax/be' ], txpower: 'High', txpowers: TX, random_bssid: false }
	];
	const wifiStatus = () => ({ configured: true, aps: [ { host: AP.host, name: AP.name, ok: true, at: now() - 3, count: 6, bands: { '2.4G': 3, '5G': 3, '6G': 0 },
		sys: { uptime: up() - 300, board: { hostname: 'ap', model: 'Example Wi-Fi 7 AP', system: 'ARMv8 Processor rev 4', release: { description: 'OpenWrt 23.05' }, kernel: '5.4.213' } }, write: true } ] });

	/* ---- そのほかの補助スクリプト ---- */
	const SECURITY = { root_pw: true, ssh: { password: true, root_password: true, interface: 'lan', port: 22, enabled: true, running: true },
		keys: [ { line: 0, type: 'ssh-ed25519', head: 'AAAAC3NzaC', tail: 'Demo0Key', comment: 'user@laptop' } ],
		http: { redirect_https: true, listen_http: [ '0.0.0.0:80', '[::]:80' ], listen_https: [ '0.0.0.0:443', '[::]:443' ], http_port: 80, https_port: 443, session_time: 3600 },
		ttyd: { installed: false, enabled: false, running: false }, firewall: { input: 'REJECT', guard: true },
		listening: [ { proto: 'tcp', addr: '0.0.0.0', port: 80, scope: 'all' }, { proto: 'tcp', addr: '0.0.0.0', port: 443, scope: 'all' }, { proto: 'tcp', addr: '192.168.1.1', port: 22, scope: 'lan' },
			{ proto: 'udp', addr: '0.0.0.0', port: 53, scope: 'all' }, { proto: 'udp', addr: '0.0.0.0', port: 67, scope: 'all' }, { proto: 'tcp', addr: '127.0.0.1', port: 53, scope: 'local' } ],
		forwards: [ { id: 'cfg0a92bd', name: 'nas_web', proto: 'tcp', ext: '5150', ip: '192.168.1.20', port: '443', family: 'ipv4' } ], wan: { ping: false, ipsec: false } };
	const SERVERS = { servers: [ { id: '48463', km: 12, ms: 4, name: 'Tokyo (IPA CyberLab)' }, { id: '21569', km: 15, ms: 5, name: 'Tokyo (GLBB Japan)' }, { id: '50686', km: 380, ms: 11, name: 'Osaka (Rakuten Mobile)' } ] };
	let stStart = 0;
	function speed(args) {
		const a = args[0];
		if (a === 'inet-check') return { installed: true };
		if (a === 'inet-servers') return SERVERS;
		if (a === 'inet-start') { stStart = Date.now(); return { started: true, running: true }; }
		if (a === 'inet-ip') return { ip: '203.0.113.42', ip6: PFX + ':5a7e:31ff:fe0c:aa01' };
		if (a === 'inet-status') {
			if (stStart && Date.now() - stStart < 12000) return { running: true };
			if (!stStart) return { running: false };
			return { running: false, mode: 'auto', family: 'ipv6', result: { timestamp: new Date().toISOString().slice(0, 19).replace('T', ' '),
				servers: [ { name: 'Tokyo', sponsor: 'IPA CyberLab', distance: 12.3, latency: 4.2e6, jitter: 0.6e6, dl_speed: 112e6, ul_speed: 61e6 } ] } };
		}
		if (a === 'best-get') return { inet: { dl: { v: 894.2, at: '2026-11-01 21:10' }, ul: { v: 486.0, at: '2026-11-01 21:10' } }, lan: null };
		if (a === 'lan-link') return { speed: 1000 };
		return { ok: true };
	}
	function diag(tool, host) {
		const h = host || 'example.com';
		if (tool === 'ping') return 'PING ' + h + ' (93.184.215.14): 56 data bytes\n' + [ 0, 1, 2, 3 ].map(i => '64 bytes from 93.184.215.14: seq=' + i + ' ttl=55 time=' + (8.1 + i * 0.3).toFixed(3) + ' ms').join('\n') + '\n\n--- ' + h + ' ping statistics ---\n4 packets transmitted, 4 packets received, 0% packet loss\nround-trip min/avg/max = 8.100/8.550/9.000 ms\n';
		if (tool === 'traceroute') return 'traceroute to ' + h + ' (93.184.215.14), 15 hops max\n 1  203.0.113.1  1.204 ms\n 2  198.51.100.9  3.877 ms\n 3  198.51.100.33  5.102 ms\n 4  93.184.215.14  8.411 ms\n';
		return 'Server:\t\t127.0.0.1\nAddress:\t127.0.0.1:53\n\nName:\t' + h + '\nAddress: 93.184.215.14\nAddress: 2606:2800:21f:cb07:6820:80da:af6b:8b2c\n';
	}
	function logs(n) {
		const base = new Date(Date.now() - 3600000), out = [];
		const L = [ [ 'daemon.notice', 'netifd', "Interface 'wan6' is now up" ], [ 'daemon.info', 'odhcp6c[1840]', 'Got a valid reply (IA_PD ' + PFX + '::/56)' ],
			[ 'daemon.notice', 'netifd', "Interface 'map0' is now up" ], [ 'daemon.info', 'dnsmasq-dhcp[2210]', 'DHCPACK(br-lan) 192.168.1.50 02:11:22:33:44:03 iPhone' ],
			[ 'authpriv.info', 'dropbear[3302]', "Child connection from 192.168.1.21:52344" ], [ 'authpriv.notice', 'dropbear[3302]', "Pubkey auth succeeded for 'root' with ssh-ed25519 key" ],
			[ 'daemon.info', 'dnsmasq-dhcp[2210]', 'DHCPACK(br-lan) 192.168.1.60 a8:23:fe:6d:42:06 living-tv' ], [ 'kern.info', 'kernel', '[273620.11] igc 0000:02:00.0 eth1: NIC Link is Up 2500 Mbps Full Duplex' ],
			[ 'user.notice', 'tachigui', 'MAP-E のポート範囲を確かめました' ], [ 'daemon.warn', 'odhcpd[1777]', 'No default route present, overriding ra_lifetime!' ] ];
		for (let i = 0; i < Math.min(n || 60, 60); i++) {
			const d = new Date(base.getTime() + i * 55000), x = L[i % L.length];
			out.push(d.toString().slice(0, 3) + ' ' + d.toString().slice(4, 10).replace(/ 0/, '  ') + ' ' + d.toTimeString().slice(0, 8) + ' ' + d.getFullYear() + ' ' + x[0] + ' ' + x[1] + ': ' + x[2]);
		}
		return out.join('\n') + '\n';
	}
	const FS = {
		'/root': [ [ '.ssh', 'dir', 4096, '0700' ], [ 'backup', 'dir', 4096, '0755' ], [ 'notes.txt', 'file', 312, '0644' ], [ 'network.bak', 'file', 1009, '0600' ] ],
		'/': [ [ 'bin', 'dir' ], [ 'etc', 'dir' ], [ 'lib', 'dir' ], [ 'root', 'dir' ], [ 'tmp', 'dir' ], [ 'usr', 'dir' ], [ 'var', 'link' ], [ 'www', 'dir' ] ],
		'/etc': [ [ 'config', 'dir' ], [ 'crontabs', 'dir' ], [ 'dropbear', 'dir' ], [ 'banner', 'file', 420, '0644' ], [ 'hosts', 'file', 52, '0644' ], [ 'openwrt_release', 'file', 284, '0644' ] ],
		'/tmp': [ [ 'dhcp.leases', 'file', 412, '0644' ], [ 'resolv.conf.d', 'dir' ], [ 'run', 'dir' ] ]
	};
	function fsList(path) {
		const p = (path || '/root').replace(/\/+$/, '') || '/';
		const items = FS[p] || [];
		return { ok: true, path: p, real: p, parent: p === '/' ? null : p.replace(/\/[^/]+$/, '') || '/', entries: items.map(([ name, type, size, mode ], i) => ({ name, type, size: size || 4096, mtime: now() - 86400 * (i + 2), mode: mode || '0755', uid: 0, gid: 0, user: 'root', group: 'root', target: type === 'link' ? '/tmp' : undefined, dir: type === 'link' })) };
	}
	const TEXT = { '/root/notes.txt': 'TachiGUI demo\n\nThis file is not real.\nChanges are not saved.\n', '/etc/banner': '  TachiGUI demo\n', '/etc/hosts': '127.0.0.1 localhost\n::1 localhost\n' };

	function exec(cmd, args) {
		const out = s => [ 0, { code: 0, stdout: typeof s === 'string' ? s : JSON.stringify(s) } ];
		switch (cmd) {
		case '/usr/libexec/tachigui-clients': return out(clientsHelper());
		case '/usr/libexec/tachigui-hw': return out({ model: 'Intel(R) N150', temp: 47 + 3 * Math.sin(Date.now() / 9000) });
		case '/usr/libexec/tachigui-fan': return out({ fans: [ { id: 1, rpm: 1810 + Math.round(60 * Math.sin(Date.now() / 6000)) } ] });
		case '/usr/libexec/tachigui-security': return out(args[0] === 'status' || !args[0] ? SECURITY : { ok: true });
		case '/usr/libexec/tachigui-speedtest': return out(speed(args));
		case '/usr/libexec/tachigui-ipv6': return out({ dev: 'br-lan', ap_mode: false, enabled: true, accept_ra: '0', addrs: [ { addr: PFX + '::1', plen: 60, scope: 'global', dynamic: true, tentative: false, deprecated: false } ], routes: [] });
		case '/usr/libexec/tachigui-wifi':
			if (args[0] === 'status' || args[0] === 'refresh') return out(wifiStatus());
			if (args[0] === 'wlan' && args[1] === 'get') return out({ ok: true, v: 2, kind: 'gl', radios: AP_RADIOS });
			return out({ ok: true, ng: [] });
		case '/usr/libexec/tachigui-wlan': return out(args[0] === 'get' ? { ok: true, v: 2, kind: 'owrt', radios: [] } : { ok: true });
		case '/usr/libexec/tachigui-diag': return out(diag(args[0], args[1]));
		case '/sbin/logread': return out(logs(+args[1]));
		case '/bin/df': return out('Filesystem           1K-blocks      Used Available Use% Mounted on\n/dev/root               245760     98304    147456  40% /\ntmpfs                  4026532      2048   4024484   0% /tmp\n');
		default: return out('');
		}
	}

	/* ---- ubus の呼び出し ---- */
	function call(obj, m, p) {
		p = p || {};
		if (obj === 'session') return m === 'login' ? [ 0, { ubus_rpc_session: 'de000000000000000000000000000000' } ] : [ 0, {} ];
		if (obj === 'system') {
			if (m === 'board') return [ 0, { kernel: '6.12.54', hostname: (UCI.system.cfg01e48a || {}).hostname || 'OpenWrt', system: 'Intel(R) N150', model: 'TachiGUI Demo Router', board_name: 'demo', rootfs_type: 'squashfs', release: { distribution: 'OpenWrt', version: '25.12.2', description: 'OpenWrt 25.12.2 r30000-demo' } } ];
			if (m === 'info') return [ 0, { localtime: now() + 9 * 3600, uptime: up(), load: [ 9830, 12452, 11141 ].map(x => x + Math.round(2000 * Math.sin(Date.now() / 8000))), memory: { total: 8241995776, free: 6892126208, shared: 4194304, buffered: 0, available: 7189557248, cached: 402653184 }, root: { total: 245760, free: 147456, used: 98304, avail: 147456 }, tmp: { total: 4026532, free: 4024484, used: 2048, avail: 4024484 }, swap: { total: 0, free: 0 } } ];
			return [ 0, {} ];
		}
		if (obj === 'network.interface' && m === 'dump') return [ 0, { interface: ifaces() } ];
		if (obj === 'network.device') return [ 0, {} ];
		if (obj === 'luci-rpc') return m === 'getHostHints' ? [ 0, hostHints() ] : [ 0, leases() ];
		if (obj === 'luci') {
			if (m === 'getTimezones') return [ 0, { 'Asia/Tokyo': { tzstring: 'JST-9' }, 'America/New_York': { tzstring: 'EST5EDT,M3.2.0,M11.1.0' }, 'Europe/London': { tzstring: 'GMT0BST,M3.5.0/1,M10.5.0' }, UTC: { tzstring: 'UTC0' } } ];
			if (m === 'getUnixtime') return [ 0, { result: now() } ];
			return [ 0, { result: true } ];
		}
		if (obj === 'uci') return uciCall(m, p);
		if (obj === 'file') {
			if (m === 'read') {
				if (p.path === '/proc/stat') return [ 0, { data: procStat() } ];
				if (p.path === '/proc/net/dev') return [ 0, { data: procNetDev() } ];
				if (p.path === '/proc/net/if_inet6') return [ 0, { data: '20010db84a1c56005a7e31fffe0caa01 03 40 00 80     eth0\nfe80000000000000005a7efffe0caa01 03 40 20 80     eth0\n00000000000000000000000000000001 01 80 10 80       lo\n' } ];
				if (p.path === '/proc/net/ipv6_route') return [ 0, { data: '00000000000000000000000000000000 00 00000000000000000000000000000000 00 fe800000000000000000000000000001 00000400 00000001 00000000 00000003     eth0\n' } ];
				if (p.path in files) return [ 0, { data: files[p.path] } ];
				return [ 4, null ];
			}
			if (m === 'write') { files[p.path] = p.data; return [ 0, {} ]; }
			if (m === 'list') return [ 0, { entries: [] } ];
			if (m === 'exec') return exec(p.command, p.params || []);
			return [ 0, {} ];
		}
		if (obj === 'tachigui.network') {
			if (m === 'status') return [ 0, netStatus() ];
			if (m === 'mape') return [ 0, MAPE ];
			if (m === 'leds') return [ 0, LEDS ];
			if (m === 'user_rules') return [ 0, { ok: true, rules: [] } ];
			if (m === 'detect') return [ 0, { ok: true, kind: 'mape', name: MAPE.name, prefix: PFX + '::/56', wan: 'eth0' } ];
			if (m === 'check') return [ 0, { ok: true, v4: true } ];
			return [ 0, { ok: true } ];
		}
		if (obj === 'tachigui.files') {
			if (m === 'list') return [ 0, fsList(p.path) ];
			if (m === 'diskinfo') return [ 0, { ok: true, fs: 'squashfs', total: 251658240, used: 100663296, avail: 150994944, mount: '/' } ];
			if (m === 'read_text') return [ 0, { ok: true, content: TEXT[p.path] || '', size: (TEXT[p.path] || '').length, truncated: false, binary: false } ];
			if (m === 'stat') return [ 0, { ok: true, path: p.path, atime: now() - 3600 } ];
			return [ 0, { ok: true, done: 1, errors: [] } ];
		}
		return [ 0, {} ];
	}

	const real = window.fetch.bind(window);
	window.fetch = async (url, opt) => {
		const u = String(url);
		if (u === '/ubus') {
			const body = JSON.parse(opt.body);
			const [ , obj, m, p ] = body.params;
			let r;
			try { r = call(obj, m, p); } catch (e) { console.error('demo: 応答を作れません', obj, m, e); r = [ 0, {} ]; }
			await new Promise(res => setTimeout(res, 40 + Math.random() * 80));
			return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: r[1] === null ? [ r[0] ] : r }), { headers: { 'Content-Type': 'application/json' } });
		}
		if (u.startsWith('/cgi-bin/')) return new Response('', { status: 404 });
		return real(url, opt);
	};

	/* デモの印 (右下)。画面の作りには混ぜない */
	addEventListener('DOMContentLoaded', () => {
		const b = document.createElement('div');
		b.textContent = ja ? 'デモ: 値は架空で、変更は保存されません' : 'Demo: values are fictional and changes are not saved';
		b.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:9999;padding:6px 12px;border-radius:999px;background:rgba(234,179,8,.92);color:#111;font:600 12px/1.4 system-ui,sans-serif;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.3)';
		document.body.appendChild(b);
	});
})();
