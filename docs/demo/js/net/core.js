/*
 * ネットワーク設定の、中身 (画面に、依存しない部分)。
 * LuCI 版 (LuCI 版の setup.js) の、定義と、設定を書く処理を、移した。
 */
import { T, tr } from '../i18n.js';
import * as uci from '../uci.js';

const L = { toArray: v => v == null ? [] : (Array.isArray(v) ? v : [ v ]) };

export const CONFIGS = [ 'network', 'firewall', 'dhcp', 'system', 'tachigui' ];
export const APPLY_TIMEOUT = 30;
export const PD_WAIT = 90;
export const UP_WAIT = 60;
export const MANAGED = [ 'wan', 'wan6', 'map0', 'dslite0' ];

export const TYPES = {
	v6plus: { title: T('MAP-E (v6プラス、OCN など)'), help: T('v6プラス・OCN・NURO など。IPv6 の上で IPv4 を使う。ルールはプレフィックスから自動判定'), router: true, pkgs: [ 'map' ] },
	dslite: { title: 'DS-Lite', help: T('transix・xpass・v6コネクト など。IPv6 の上で AFTR 経由で IPv4 を使う'), router: true, pkgs: [ 'ds-lite' ] },
	pppoe:  { title: 'PPPoE', help: T('ユーザー名とパスワードで接続'), router: true, pkgs: [ 'ppp-mod-pppoe' ] },
	dhcp:   { title: T('自動設定 - DHCP'), help: T('上位ルータ・CATV の配下など。アドレスを自動で取得'), router: true, pkgs: [] },
	static: { title: T('固定 IP'), help: T('アドレスとゲートウェイを手で指定'), router: true, pkgs: [] },
	ap:     { title: T('ブリッジ (AP) モード'), help: T('上位ルータの配下でスイッチとして使う。全ポートが LAN'), router: false, pkgs: [] }
};

export const AFTR = {
	transix: { label: 'transix (gw.transix.jp)', host: 'gw.transix.jp' },
	xpass: { label: 'xpass (dgw.xpass.jp)', host: 'dgw.xpass.jp' },
	v6connect: { label: T('v6コネクト (dslite.v6connect.net)'), host: 'dslite.v6connect.net' },
	custom: { label: T('手動で入力'), host: '' }
};

export const DNS_PRESETS = {
	cloudflare: [ '1.1.1.1', '1.0.0.1', '2606:4700:4700::1111', '2606:4700:4700::1001' ],
	google: [ '8.8.8.8', '8.8.4.4', '2001:4860:4860::8888', '2001:4860:4860::8844' ]
};

export const DNS_MODES = {
	auto: T('自動 (回線事業者の DNS)'),
	custom: T('手動で入力')
};

/* 手動のときに、一覧へ足せる、定番の DNS */
export const DNS_CHOICES = {
	cloudflare: { label: 'Cloudflare', list: DNS_PRESETS.cloudflare },
	google: { label: 'Google', list: DNS_PRESETS.google },
	quad9: { label: 'Quad9', list: [ '9.9.9.9', '149.112.112.112', '2620:fe::fe', '2620:fe::9' ] }
};

export function isIPv6(s) {
	return /^[0-9a-f:]+$/i.test((s || '').trim()) && (s.match(/:/g) || []).length >= 2;
}

export const ROLES = { wan: 'WAN', lan: 'LAN', none: T('無効') };

/* ---- 小物 ---- */

export function isIPv4(s) {
	const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec((s || '').trim());
	return !!m && m.slice(1).every(function(x) { return +x <= 255; });
}

export function isMask(s) {
	if (!isIPv4(s))
		return false;
	const n = s.trim().split('.').reduce(function(a, x) { return (a * 256) + (+x); }, 0);
	const inv = (~n >>> 0);
	return ((inv + 1) & inv) === 0;
}

export function dnsList(S) {
	if (S.dns.mode == 'custom')
		return S.dns.list.map(function(x) { return (x || '').trim(); }).filter(function(x) { return x.length; });
	return [];
}

/* ---- UCI の読み取り ---- */

export function bridgeSection() {
	let sid = null;
	uci.sections('network', 'device', function(s) {
		if (s.name == 'br-lan')
			sid = s['.name'];
	});
	return sid;
}

export function lanPorts() {
	const sid = bridgeSection();
	return sid ? L.toArray(uci.get('network', sid, 'ports')) : [];
}

export function wanDevice() {
	return uci.get('network', 'wan6', 'device') || uci.get('network', 'wan', 'device') || null;
}

export function detectType() {
	if (uci.get('network', 'map0', 'proto') == 'map')
		return 'v6plus';
	if (uci.get('network', 'dslite0', 'proto') == 'dslite')
		return 'dslite';
	const wan = uci.get('network', 'wan', 'proto');
	if (wan == 'pppoe' || wan == 'dhcp' || wan == 'static')
		return wan;
	/* WAN も トンネルもなく、DHCP を止めている、または、上位ルータ (ゲートウェイ) を指定している → AP モード */
	if (uci.get('dhcp', 'lan', 'ignore') == '1' || uci.get('network', 'lan', 'gateway'))
		return 'ap';
	return null;
}

export function dnsmasqSid() {
	const s = uci.sections('dhcp', 'dnsmasq')[0];
	return s ? s['.name'] : null;
}

export function systemSid() {
	const s = uci.sections('system', 'system')[0];
	return s ? s['.name'] : null;
}

export function detectDns() {
	const sid = dnsmasqSid();
	const servers = sid ? L.toArray(uci.get('dhcp', sid, 'server')) : [];
	if (!servers.length || uci.get('dhcp', sid, 'noresolv') != '1')
		return { mode: 'auto', list: [ '' ] };
	return { mode: 'custom', list: servers.slice() };
}

export function initialState(st) {
	const wanNow = wanDevice();
	const lanNow = lanPorts();
	const roles = {};
	st.devices.forEach(function(d) {
		roles[d.name] = (d.name == wanNow) ? 'wan' : (lanNow.indexOf(d.name) >= 0 ? 'lan' : 'none');
	});

	const aftr = uci.get('network', 'dslite0', 'peeraddr') || '';
	const aftrKey = Object.keys(AFTR).filter(function(k) { return AFTR[k].host && AFTR[k].host == aftr; })[0] || (aftr ? 'custom' : 'transix');
	const lanIp = uci.get('network', 'lan', 'ipaddr') || '192.168.1.1';
	const lanMask = uci.get('network', 'lan', 'netmask') || '255.255.255.0';
	const sys = systemSid(), dm = dnsmasqSid();

	return {
		type: detectType(),
		roles: roles,
		v6plus: { mtu: parseInt(uci.get('network', 'map0', 'mtu'), 10) || 1460, legacy: uci.get('network', 'map0', 'legacymap') != '0', prefix: '', relay: uci.get('dhcp', 'lan', 'ra') != 'hybrid', is64: uci.get('dhcp', 'lan', 'ra') == 'relay', mac: uci.get('network', 'wan6', 'macaddr') || '',
			ra: (uci.get('network', 'wan6', 'proto') == 'static' && uci.get('network', 'wan6', 'ip6prefix')) ? { addr: L.toArray(uci.get('network', 'wan6', 'ip6addr'))[0] || '', prefix: uci.get('network', 'wan6', 'ip6prefix'), gw: uci.get('network', 'wan6', 'ip6gw') || '' } : null },
		dslite: { aftr: aftrKey, custom: aftrKey == 'custom' ? aftr : '', mtu: parseInt(uci.get('network', 'dslite0', 'mtu'), 10) || 1460 },
		pppoe: { user: uci.get('network', 'wan', 'username') || '', pass: '', mtu: parseInt(uci.get('network', 'wan', 'mtu'), 10) || 1454, ipv6: false },
		dhcp: { ipv6: true },
		static: { ip: '', mask: '255.255.255.0', gw: '' },
		ap: { gw: uci.get('network', 'lan', 'gateway') || '', ipv6: uci.get('tachigui', 'main', 'enabled') != '0' },
		lan: {
			ip: lanIp, mask: lanMask,
			dhcp: uci.get('dhcp', 'lan', 'ignore') != '1',
			start: parseInt(uci.get('dhcp', 'lan', 'start'), 10) || 100,
			limit: parseInt(uci.get('dhcp', 'lan', 'limit'), 10) || 150,
			lease: uci.get('dhcp', 'lan', 'leasetime') || '12h'
		},
		dns: detectDns(),
		sys: {
			name: (sys && uci.get('system', sys, 'hostname')) || '',
			domain: (dm && uci.get('dhcp', dm, 'domain')) || ''
		},
		oldLan: { ip: lanIp, mask: lanMask }
	};
}

/* ---- UCI の書き込み ---- */

export function sec(conf, type, name) {
	if (uci.get(conf, name) == null)
		uci.add(conf, type, name);
}

export function rmSec(conf, name) {
	if (uci.get(conf, name) != null)
		uci.remove(conf, name);
}

/* 古い値を消してから、新しい値を設定する */
export function setOpts(conf, sid, values, clear) {
	(clear || []).forEach(function(o) { uci.unset(conf, sid, o); });
	Object.keys(values).forEach(function(k) {
		const v = values[k];
		if (v == null || v === '')
			uci.unset(conf, sid, k);
		else
			uci.set(conf, sid, k, Array.isArray(v) ? v : String(v));
	});
}

export function setMap(m, mtu, legacy) {
	sec('network', 'interface', 'map0');
	setOpts('network', 'map0', {
		proto: 'map', maptype: 'map-e', tunlink: 'wan6',
		peeraddr: m.peeraddr, ipaddr: m.ipaddr, ip4prefixlen: m.ip4prefixlen,
		ip6prefix: m.ip6prefix, ip6prefixlen: m.ip6prefixlen,
		ealen: m.ealen, psidlen: m.psidlen, offset: m.offset,
		mtu: mtu, encaplimit: 'ignore', legacymap: legacy ? '1' : '0'
	});
}

export function rolesOf(S) {
	const names = Object.keys(S.roles);
	return {
		wan: names.filter(function(n) { return S.roles[n] == 'wan'; })[0] || null,
		lan: names.filter(function(n) { return S.roles[n] == 'lan'; })
	};
}

export function writeConfig(S, map) {
	const t = S.type, router = TYPES[t].router;
	const r = rolesOf(S);

	/* ブリッジ (LAN ポート) */
	let sid = bridgeSection();
	if (!sid) {
		sid = uci.add('network', 'device');
		uci.set('network', sid, 'name', 'br-lan');
		uci.set('network', sid, 'type', 'bridge');
	}
	uci.set('network', sid, 'ports', r.lan);

	/* LAN インターフェース */
	sec('network', 'interface', 'lan');
	if (router) {
		const relay = t == 'v6plus' && S.v6plus.relay && S.v6plus.is64;
		setOpts('network', 'lan', Object.assign({ proto: 'static', device: 'br-lan', ipaddr: S.lan.ip, netmask: S.lan.mask }, relay ? {} : { ip6assign: 64 }), [ 'gateway', 'dns' ].concat(relay ? [ 'ip6assign' ] : []));
	}
	else {
		const dns = dnsList(S);
		setOpts('network', 'lan', { proto: 'static', device: 'br-lan', ipaddr: S.lan.ip, netmask: S.lan.mask, gateway: S.ap.gw, dns: dns.length ? dns : [ S.ap.gw ] }, [ 'ip6assign' ]);
		/* この機器自身の IPv6 (上流のルーターから受け取る) */
		sec('tachigui', 'ipv6', 'main');
		uci.set('tachigui', 'main', 'enabled', S.ap.ipv6 ? '1' : '0');
	}

	/* WAN 側 */
	const present = [];
	const wanDev = r.wan;
	const OPTS = [ 'username', 'password', 'ipaddr', 'netmask', 'gateway', 'ipv6', 'mtu', 'dns', 'peerdns' ];
	const useWan = function(values) { sec('network', 'interface', 'wan'); setOpts('network', 'wan', values, OPTS); present.push('wan'); };
	const useWan6 = function() {
		sec('network', 'interface', 'wan6');
		/* extendprefix: PD が出ない回線 (ひかり電話なし等) でも、RA で配られる /64 を、プレフィックスとして使う (RFC 7278) */
		if (t == 'v6plus' && S.v6plus.ra)
			/* RA で配られる /64 を、そのまま、固定で持つ (DHCPv6 が、使えない回線の、確実なやり方) */
			setOpts('network', 'wan6', { proto: 'static', device: wanDev, ip6addr: S.v6plus.ra.addr, ip6prefix: S.v6plus.ra.prefix, ip6gw: S.v6plus.ra.gw }, [ 'reqaddress', 'reqprefix', 'extendprefix', 'ra_holdoff' ]);
		else
			/* ra_holdoff: RA の更新を受け付ける最短の間隔 (初期値 3 秒)。RA の更新 → odhcpd の再設定 → odhcpd が RS を送る → 回線が RA を返す、
			   が 3 秒ごとに回り続けるのを、60 秒に 1 回まで減らす */
			setOpts('network', 'wan6', { proto: 'dhcpv6', device: wanDev, reqaddress: 'try', reqprefix: 'auto', extendprefix: '1', ra_holdoff: '60' }, [ 'ip6addr', 'ip6prefix', 'ip6gw' ]);
		/* 前の機器の MAC を名乗る (NTT 側の、MAC の記録の更新を、待たずに済む) */
		if (t == 'v6plus') {
			const mac = (S.v6plus.mac || '').trim().toLowerCase();
			if (mac) uci.set('network', 'wan6', 'macaddr', mac); else uci.unset('network', 'wan6', 'macaddr');
		}
		present.push('wan6');
	};

	switch (t) {
	case 'v6plus':
		useWan6();
		/* ルールが分かる前に map0 を作ると、netifd が「ルールが不正」で、止まったまま (autostart なし) になる。分かってから作る */
		if (map || uci.get('network', 'map0', 'ipaddr')) {
			sec('network', 'interface', 'map0');
			setOpts('network', 'map0', { proto: 'map', maptype: 'map-e', tunlink: 'wan6', mtu: S.v6plus.mtu, encaplimit: 'ignore', legacymap: S.v6plus.legacy ? '1' : '0' });
			if (map)
				setMap(map, S.v6plus.mtu, S.v6plus.legacy);
			present.push('map0');
		}
		break;
	case 'dslite':
		useWan6();
		sec('network', 'interface', 'dslite0');
		setOpts('network', 'dslite0', { proto: 'dslite', tunlink: 'wan6', peeraddr: S.dslite.aftr == 'custom' ? S.dslite.custom.trim() : AFTR[S.dslite.aftr].host, mtu: S.dslite.mtu, encaplimit: 'ignore' });
		present.push('dslite0');
		break;
	case 'pppoe':
		useWan({ proto: 'pppoe', device: wanDev, username: S.pppoe.user, password: S.pppoe.pass, mtu: S.pppoe.mtu, ipv6: S.pppoe.ipv6 ? 'auto' : '0' });
		if (S.pppoe.ipv6)
			useWan6();
		break;
	case 'dhcp':
		useWan({ proto: 'dhcp', device: wanDev });
		if (S.dhcp.ipv6)
			useWan6();
		break;
	case 'static':
		useWan({ proto: 'static', device: wanDev, ipaddr: S.static.ip, netmask: S.static.mask, gateway: S.static.gw });
		break;
	}

	/* OpenWrt 25.12 の不具合 (hexdump_2hex が無い) で、DHCPv6 が失敗するため、既定の DUID の設定は、持たない */
	if (t != 'ap')
		uci.sections('network', 'globals', function(g) { uci.unset('network', g['.name'], 'dhcp_default_duid'); });

	/* 使わないインターフェースは消す */
	MANAGED.forEach(function(n) { if (present.indexOf(n) < 0) rmSec('network', n); });

	/* DHCP サーバ / RA */
	sec('dhcp', 'dhcp', 'lan');
	if (router) {
		/* /64 だけが配られる回線では、回線側の RA と NDP を、LAN へ中継する (端末が、グローバルなアドレスを持てる) */
		const relay = t == 'v6plus' && S.v6plus.relay && S.v6plus.is64;
		/* 手動の DNS の一覧のうち、IPv6 のものは、LAN の端末にも、DHCPv6 で配る (回線は、IPv6 の DNS を、端末に配らないため) */
		const v6dns = dnsList(S).filter(isIPv6);
		setOpts('dhcp', 'lan', { interface: 'lan', dhcpv4: 'server', ignore: S.lan.dhcp ? '0' : '1', start: S.lan.start, limit: S.lan.limit, leasetime: S.lan.lease, dhcpv6: relay ? (v6dns.length ? 'server' : 'disabled') : 'hybrid', ra: relay ? 'relay' : 'hybrid', ndp: relay ? 'relay' : '', dns: v6dns }, relay ? [ 'dhcp_option', 'ra_flags' ] : [ 'dhcp_option' ]);
		if (relay) {
			sec('dhcp', 'dhcp', 'wan6');
			/* ignore: dnsmasq の担当から外す。回線の RA (数秒ごと) で wan6 が更新されるたびに、dnsmasq が読み直されるのを防ぐ。
			   odhcpd は、ra / dhcpv6 / ndp を明示しているので、そのまま中継する */
			setOpts('dhcp', 'wan6', { interface: 'wan6', ignore: '1', master: '1', ra: 'relay', dhcpv6: 'relay', ndp: 'relay' });
		}
		else
			rmSec('dhcp', 'wan6');
	}
	else if (S.lan.dhcp) {
		/* AP モードの DHCP サーバ: 端末に配るゲートウェイと DNS は、このルーターではなく、上位ルータにする */
		const gwDns = dnsList(S).length ? dnsList(S) : [ S.ap.gw ];
		setOpts('dhcp', 'lan', { interface: 'lan', dhcpv4: 'server', ignore: '0', start: S.lan.start, limit: S.lan.limit, leasetime: S.lan.lease, dhcpv6: 'disabled', ra: 'disabled', ndp: 'disabled',
			dhcp_option: [ '3,' + S.ap.gw, '6,' + gwDns.join(',') ] });
	}
	else {
		setOpts('dhcp', 'lan', { interface: 'lan', ignore: '1', dhcpv6: 'disabled', ra: 'disabled', ndp: 'disabled' }, [ 'dhcp_option' ]);
	}

	/* DNS (dnsmasq の上流) とドメイン名 */
	const dm = dnsmasqSid();
	if (dm) {
		const list = router ? dnsList(S) : (dnsList(S).length ? dnsList(S) : [ S.ap.gw ]);
		if (list.length)
			setOpts('dhcp', dm, { noresolv: '1', server: list });
		else
			setOpts('dhcp', dm, { noresolv: '0' }, [ 'server' ]);

		const domain = S.sys.domain.trim();
		if (domain)
			setOpts('dhcp', dm, { domain: domain, local: '/' + domain + '/' });
	}

	/* ファイアウォール: WAN ゾーン */
	uci.sections('firewall', 'zone', function(z) {
		if (z.name != 'wan')
			return;
		const nets = L.toArray(z.network).filter(function(n) { return MANAGED.indexOf(n) < 0; }).concat(present);
		if (nets.length)
			uci.set('firewall', z['.name'], 'network', nets);
		else
			uci.unset('firewall', z['.name'], 'network');
	});

	/* ルーター名 */
	const ss = systemSid();
	if (ss && S.sys.name.trim())
		uci.set('system', ss, 'hostname', S.sys.name.trim());
}

/* ---- 適用 ---- */


export function reloadUci() { CONFIGS.forEach(c => uci.unload(c)); return uci.load(CONFIGS); }
