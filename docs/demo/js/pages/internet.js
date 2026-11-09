/* インターネット: ホーム。つながりの図と、回線の情報 */
import { T, tr } from '../i18n.js';
import { sys, rpc, execJson } from '../api.js';
import { h, morph, icon, ip6Compress, isClient } from '../util.js';
import { fetchLogs, WAN_RE } from '../logs.js';

function fill(el, ...kids) { morph(el, kids); }

const ROUTER_SVG = '<svg viewBox="0 0 160 90" width="190" height="107" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
	+ '<path d="M22 44l14-12h88l14 12v26a4 4 0 0 1-4 4H26a4 4 0 0 1-4-4z"/><path d="M22 44h116"/>'
	+ '<circle cx="40" cy="60" r="2.4"/><circle cx="52" cy="60" r="2.4"/><circle cx="64" cy="60" r="2.4"/>'
	+ '<path d="M104 56h26M104 63h26"/><path d="M48 32l-5-22M112 32l5-22"/></svg>';

/* MAP-E の表示名: ルール表に回線名があれば添える */
const mapeLabel = m => m && m.name ? m.name + ' (MAP-E)' : 'MAP-E';

function typeOf(ifaces, mape) {
	const up = n => ifaces.find(i => i.interface === n);
	if (up('map0')) return { name: mapeLabel(mape), wan: up('map0') };
	if (up('dslite0')) return { name: 'DS-Lite', wan: up('dslite0') };
	const w = up('wan');
	if (w) return { name: w.proto === 'pppoe' ? 'PPPoE' : (w.proto === 'static' ? T('固定 IP') : 'DHCP'), wan: w };
	return { name: T('上位ルータ (ブリッジ)'), wan: up('lan') };
}

export function mount(root) {
	let stopped = false;
	const hero = h('section', { class: 'hero' });
	const cards = h('div', { class: 'cols home' });
	const failure = h('div');
	root.appendChild(hero);
	root.appendChild(failure);
	root.appendChild(cards);

	/* 実際に、外に出られるか (経路が、上がっているだけでは、「つながっている」と言わない) と、外から見た IP */
	const net = { ok: null, ip4: '', ip6: '', busy: false, ipAt: 0, mape: null, dns: null };
	async function probe() {
		if (net.busy || stopped) return;
		net.busy = true;
		try {
			const c = await rpc('tachigui.network', 'check');
			net.ok = !!(c && c.ok);
			if (net.ok && Date.now() - net.ipAt > 60000) {
				const r = await execJson('/usr/libexec/tachigui-speedtest', [ 'inet-ip' ]);
				if (r) { net.ip4 = r.ip || ''; net.ip6 = r.ip6 || ''; net.ipAt = Date.now(); }
			}
		} catch (e) { net.ok = null; }
		net.busy = false;
		if (!stopped) load();
	}

	async function load() {
		try {
			const [ ifaces, hints, en, inet6, route6, logs ] = await Promise.all([
				sys.ifaces(), sys.hostHints().catch(() => ({})), sys.network().catch(() => null),
				sys.read('/proc/net/if_inet6').catch(() => ''), sys.read('/proc/net/ipv6_route').catch(() => ''),
				fetchLogs(400).catch(() => [])
			]);
			net.dns = await rpc('uci', 'get', { config: 'dhcp', type: 'dnsmasq' }).then(r => { const d = Object.values(r.values || {})[0] || {}; const list = [].concat(d.server || []).filter(x => !x.startsWith('/')); return d.noresolv === '1' && list.length ? list : null; }).catch(() => null);
			/* 読めなかった回は前の値を残す */
			net.ap = await execJson('/usr/libexec/tachigui-wifi', [ 'status' ]).then(r => r && Array.isArray(r.aps) ? r : null).catch(() => null) || net.ap;
			net.mape = ifaces.some(i => i.interface === 'map0') ? await rpc('tachigui.network', 'mape').catch(() => null) : null;
			if (stopped) return;
			fill(failure);
			draw(ifaces.filter(i => i.interface !== 'loopback'), hints || {}, en, inet6, route6, logs);
		} catch (e) {
			/* 一時的な失敗で前の内容を消さない (ページが縮んで、スクロールが一番上に戻る) */
			console.error('internet: 状態を読めません', e);
			if (!stopped) fill(failure, h('p', { class: 'warn-box' }, T('更新できません: ') + e.message));
		}
	}

	function row(k, v) {
		const val = Array.isArray(v) ? (v.length ? v.map(x => h('div', null, x)) : '-') : (v || '-');
		return h('div', { class: 'kvrow' }, h('span', null, k), h('span', { class: 'mono' }, val));
	}

	/* いま、何をしていて、どこまで進んだか。上から順に、最初に進んでいない所が、いまの状態 */
	function situation(ifaces, en, gw) {
		const by = n => ifaces.find(i => i.interface === n);
		const wan6 = by('wan6'), wan = by('wan'), map = by('map0'), ds = by('dslite0');
		const steps = [];
		if (!wan && !wan6) {
			const lan = by('lan');
			steps.push({ s: 'ok', k: T('ブリッジ (AP) モード'), d: T('上位ルーター {gw} 経由でインターネットへ', { gw: gw || '' }) });
			steps.push({ s: lan && lan.up ? 'ok' : 'ng', k: 'LAN', d: lan && lan.up ? T('稼働中 ({ip})', { ip: ((lan['ipv4-address'] || [])[0] || {}).address || '-' }) : T('停止中') });
			return { steps, router: false, msg: T('オンライン'), lvl: 'ok', ap: true };
		}
		const dev = (wan6 && wan6.device) || (wan && wan.device) || 'eth0';
		const d = en && en.devices ? en.devices.find(x => x.name === dev) : null;
		const link = d ? d.carrier : null;
		steps.push({ s: link ? 'ok' : (link === false ? 'ng' : 'wait'), k: T('回線のケーブル ({port})', { port: d ? d.label : dev }), d: link ? T('リンクあり') + (d.speed > 0 ? ' ' + d.speed + 'M' : '') : (link === false ? T('リンクなし。ONU の電源とケーブルを確かめてください') : T('確認中')) });
		const base = wan6 || wan;
		const bup = !!(base && base.up);
		steps.push({ s: bup ? 'ok' : (link ? 'wait' : 'ng'), k: T('WAN インターフェース'), d: bup ? T('稼働中') + (base.uptime ? ' ' + T('({n} 分)', { n: Math.floor(base.uptime / 60) }) : '') : T('待機中') });
		let last = bup ? 'ok' : 'ng';
		if (wan6) {
			const pd = (wan6['ipv6-prefix'] || [])[0];
			const mins = wan6.uptime ? Math.floor(wan6.uptime / 60) : 0;
			steps.push({ s: pd ? 'ok' : (bup ? 'wait' : 'ng'), k: T('IPv6 プレフィックス'), d: pd ? pd.address + '/' + pd.mask : (bup ? T('NTT からの割り当てを待っています (経過 {n} 分)。返事がないときはログの「回線」を見てください', { n: mins }) : T('未取得')) });
			last = pd ? 'ok' : (bup ? 'wait' : 'ng');
		}
		const tun = map || ds;
		if (tun) {
			const tv4 = (tun['ipv4-address'] || [])[0];
			steps.push({ s: tun.up && tv4 ? 'ok' : (last === 'ng' ? 'ng' : 'wait'), k: map ? mapeLabel(net.mape) : 'DS-Lite', d: tun.up && tv4 ? 'IPv4 ' + tv4.address : (last === 'ok' ? T('設定中') : T('IPv6 の準備待ち')) });
		}
		else if (wan) {
			const v4 = (wan['ipv4-address'] || [])[0];
			steps.push({ s: wan.up && v4 ? 'ok' : (link ? 'wait' : 'ng'), k: T('IPv4 アドレス'), d: wan.up && v4 ? v4.address : T('取得待ち') });
		}
		const bad = steps.find(x => x.s !== 'ok');
		return { steps, router: true, bad: bad, ap: false, msg: bad ? ({ ng: T('回線につながっていません: '), wait: T('接続の準備中です: ') }[bad.s]) + bad.k : T('オンライン'), lvl: bad ? bad.s : 'ok' };
	}

	function draw(ifaces, hints, en, inet6, route6, logs) {
		const t = typeOf(ifaces, net.mape), w = t.wan || {};
		const v4 = (w['ipv4-address'] || [])[0];
		let gw = null, dns = w['dns-server'] || [];
		ifaces.forEach(i => { const r = (i.route || []).find(x => x.target === '0.0.0.0' && x.mask === 0); if (r && !gw) gw = r.nexthop; if (!dns.length && i['dns-server']) dns = i['dns-server']; });
		const clients = Object.keys(hints).filter(m => isClient(hints[m])).length;
		const links = en && en.devices ? en.devices.filter(d => d.carrier).length : 0;
		const up = !!w.up;
		const sit = situation(ifaces, en, gw);
		/* 経路が整っていても、実際に外に出られるか確かめるまでは、「つながっている」と言わない */
		if (sit.lvl === 'ok') {
			if (net.ok === true) sit.msg = sit.ap ? T('オンライン') : T('オンライン');
			else if (net.ok === false) { sit.lvl = 'ng'; sit.msg = T('経路はありますが、インターネットに出られません'); }
			else { sit.lvl = 'wait'; sit.msg = T('インターネットへの接続を確認しています…'); }
		}

		const wanDev = ((ifaces.find(i => i.interface === 'wan6') || {}).device) || ((ifaces.find(i => i.interface === 'wan') || {}).device) || 'eth0';
		const wanMac = ((en && en.devices ? en.devices : []).find(x => x.name === wanDev) || {}).mac || '';
		/* ポートごとの、いまの速度 (前回との差)。ホームの線の動きと、ポートの表に使う */
		const devs = (en && en.devices) || [];
		const nowT = Date.now(), pv = net.portPrev || {}, nextPrev = {}, rates = {};
		const wanDevName = ((ifaces.find(i => i.interface === 'wan6') || ifaces.find(i => i.interface === 'wan') || {}).device) || '';
		devs.forEach(d => {
			nextPrev[d.name] = { t: nowT, rx: d.rx_bytes, tx: d.tx_bytes };
			const p = pv[d.name], dt = p ? (nowT - p.t) / 1000 : 0;
			const rate = (a, b) => dt > 0 && a >= b ? (a - b) / dt : 0;
			rates[d.name] = p ? { rx: rate(d.rx_bytes, p.rx), tx: rate(d.tx_bytes, p.tx) } : { rx: 0, tx: 0 };
		});
		net.portPrev = nextPrev;
		/* 光が走る位相。線は作り直さないので、最初に決めた値を使い続ける (変えると動きが飛ぶ) */
		const glint = () => net.gd || (net.gd = '--gd: -' + (Date.now() / 1000 % 7.2).toFixed(2) + 's');

		fill(hero,
			h('div', { class: 'hero-col' }, h('div', { class: 'hero-in' },
				h('div', { class: 'hnode left' }, h('div', { class: 'hlab' }, icon('globe', 22), h('span', null, up ? t.name : T('未接続'))), h('span', { class: 'hline ' + { ok: 'flow gl', wait: 'wait', ng: 'ng' }[sit.lvl], style: glint(0) })),
				h('div', { class: 'hnode mid' }, h('div', { class: 'hrouter', html: ROUTER_SVG }), h('div', { class: 'hname' }, 'OpenWrt'), wanMac ? h('div', { class: 'hmac mono' }, wanMac.toUpperCase()) : null),
				h('div', { class: 'hnode right' }, h('span', { class: 'hline flow gr', style: glint(0) }),
					h('div', { class: 'hbranch' },
						h('a', { class: 'hlab', href: '#/clients' }, icon('devices', 22), h('span', { class: 'badge' }, clients), h('span', null, T('クライアント'))),
						h('a', { class: 'hlab', href: '#/network' }, icon('lan', 22), h('span', { class: 'badge' }, links), h('span', null, T('リンク中のポート'))),
						net.ap ? net.ap.aps.map(a => h('a', { class: 'hlab', href: '#/clients', title: a.ok ? a.host : T('{host} に接続できません', { host: a.host }) }, icon('t_router', 22), h('span', { class: 'badge' }, a.ok ? a.count : '-'), h('span', null, a.name))) : null))),
			h('div', { class: 'hmsg ' + sit.lvl }, sit.msg),
			sit.router && sit.lvl !== 'ok' ? h('div', { class: 'trk' }, sit.steps.map((x, i) => [
				i ? h('span', { class: 'tl ' + (sit.steps[i - 1].s === 'ok' ? (x.s === 'ok' ? 'done' : x.s) : 'off') }) : null,
				h('span', { class: 'tn ' + x.s }, h('i', { class: 'tdot' }), h('b', null, x.k.replace(/\s*\(.*$/, '')))
			])) : null,
			sit.router && sit.bad ? h('div', { class: 'hdetail' }, sit.bad.d) : null));

		/* IPv6: WAN 側のアドレス (ブリッジのときは、LAN 側) と、既定の経路 */
		const wan6 = ifaces.find(i => i.interface === 'wan6');
		let g6 = ((wan6 && wan6['ipv6-address']) || []).map(a => a.address).find(a => !/^(f[cd]|fe80)/i.test(a)) || null, ula6 = null;
		if (!g6)
			inet6.split('\n').forEach(l => {
				const f = l.trim().split(/\s+/);
				if (f.length < 6 || f[5] !== 'br-lan' || f[3] !== '00' || (parseInt(f[4], 16) & 0x40)) return;
				if (/^f[cd]/i.test(f[0])) ula6 = ula6 || ip6Compress(f[0]); else g6 = g6 || ip6Compress(f[0]);
			});
		const gw6 = route6.split('\n').some(l => { const f = l.trim().split(/\s+/); return f.length >= 10 && f[0] === '0'.repeat(32) && f[1] === '00' && f[9] !== 'lo'; });
		const pd = ifaces.map(i => (i['ipv6-prefix'] || [])[0]).find(Boolean);
		const v6state = g6 && gw6 ? T('取得済み') : (g6 ? T('経路なし') : (ula6 ? T('ローカルのみ') : T('無効')));

		const lanV6 = Object.values(hints).filter(x => (x.ip6addrs || []).some(a => /^[23]/.test(a)));   // 2xxx / 3xxx = グローバル
		const lanV6Row = row(T('グローバル IPv6 を持つ端末'), lanV6.length ? T('{n} 台', { n: lanV6.length }) : T('なし'));

		const lanAddr = ((ifaces.find(i => i.interface === 'lan') || {})['ipv4-address'] || [])[0];
		const wanV4 = v4 ? v4.address : '';

		/* MAP-E の割り当て (純正のルーターの「インターネットの設定」と、同じ内容) */
		const mp = net.mape && net.mape.ok ? net.mape : null;
		const portRow = mp ? h('div', { class: 'kvrow' }, h('span', null, T('利用可能ポート')),
			h('div', { class: 'ports-det' + (net.portsOpen ? ' open' : '') },
			h('a', { class: 'ports-sum', onclick: e => { e.preventDefault(); net.portsOpen = !net.portsOpen; e.currentTarget.parentNode.classList.toggle('open', net.portsOpen); } }, T('{n} 個 ({r} 範囲)', { n: mp.port_count, r: mp.ports.length })),
			h('div', { class: 'ports-body' }, h('div', { class: 'mono' }, mp.ports.map(r => h('span', { class: 'pr' }, r)))))) : null;

		const HOME_RE = /netifd|odhcp6c|pppd|pppoe|map0|wan6?|dslite|eth0|link is|igc|tachigui/i;
		const rel = [];
		(logs || []).filter(l => l.proc !== 'dnsmasq-dhcp' && !/radio\d|wifi-scripts/.test(l.msg) && HOME_RE.test(l.proc + ' ' + l.msg)).forEach(l => {
			const msg = l.msg.replace(/^\[\s*\d+\.\d+\]\s*/, '');
			const last = rel[rel.length - 1];
			if (last && last.proc === l.proc && last.msg === msg) { last.n++; last.time = l.time; }
			else rel.push({ time: l.time, proc: l.proc, msg, n: 1 });
		});
		rel.splice(0, Math.max(0, rel.length - 14));
		rel.reverse();
		const mark = { ok: '✅', wait: '⏳', ng: '❌' };

		const isV6 = x => String(x).includes(':');
		const dnsAll = net.dns || dns || [];
		const dnsMode = net.dns ? T('手動') : T('自動');
		const dns4Row = row(T('DNS サーバー ({mode})', { mode: dnsMode }), dnsAll.filter(x => !isV6(x)));
		const dns6 = dnsAll.filter(isV6);

		/* ポート: 1 つずつの状態 (リンク、速度、通信量、つながっている機器の数) */
		const fmtB = n => { n = Number(n) || 0; const u = [ 'B', 'KB', 'MB', 'GB', 'TB' ]; let i = 0; while (n >= 1024 && i < 4) { n /= 1024; i++; } return n.toFixed(2) + ' ' + u[i]; };
		const fmtSpeed = m => m >= 1000 ? (m / 1000) + ' Gbps' : m + ' Mbps';
		const portRows = devs.map(d => {
			/* LAN 側はルーターの受信が端末の上り、送信が端末の下り。↓ / ↑ は下り / 上りにそろえる */
			const lan = d.master === 'br-lan', rx = lan ? rates[d.name].tx : rates[d.name].rx, tx = lan ? rates[d.name].rx : rates[d.name].tx;
			const role = d.name === wanDevName ? 'WAN' : (d.master === 'br-lan' ? 'LAN' : '—');
			return h('tr', { class: d.carrier ? '' : 'portoff' },
				h('td', null, h('span', { class: 'dot ' + (d.carrier ? 'ok' : '') }), h('strong', null, d.label)),
				h('td', null, h('span', { class: 'tag' + (role === 'WAN' ? ' wanrole' : '') }, role)),
				h('td', null, d.carrier ? [ fmtSpeed(d.speed), d.duplex ? ' ' + (d.duplex === 'full' ? T('全二重') : T('半二重')) : '' ] : h('span', { class: 'muted' }, T('リンクなし'))),
				h('td', { class: 'mono hide-s' }, d.mac ? d.mac.toUpperCase() : '-'),
				h('td', { class: 'mono hide-s' }, h('div', { class: 'spd' + (rx >= 1 ? ' dn' : '') }, '↓ ' + fmtB(rx) + '/s'), h('div', { class: 'spd' + (tx >= 1 ? ' up' : '') }, '↑ ' + fmtB(tx) + '/s')),
				h('td', { class: 'mono hide-s' }, h('div', null, '↓ ' + fmtB(lan ? d.tx_bytes : d.rx_bytes)), h('div', null, '↑ ' + fmtB(lan ? d.rx_bytes : d.tx_bytes))),
				h('td', { class: 'mono hide-s' + (d.rx_errors + d.tx_errors ? ' errc' : '') }, String(d.rx_errors + d.tx_errors)));
		});
		const portsCard = devs.length ? h('section', { class: 'card sit' },
			h('h2', null, T('ポート')),
			h('div', { class: 'tblwrap' }, h('table', { class: 'cltbl ptbl' },
				h('thead', null, h('tr', null, [ T('ポート'), T('役割'), T('リンク'), 'MAC', T('転送速度'), T('通信量 (起動から)'), T('エラー') ].map((x, i) => h('th', { class: i >= 3 ? 'hide-s' : '' }, x)))),
				h('tbody', null, portRows)))) : null;

		fill(cards,
			h('section', { class: 'card' },
				h('h2', null, h('span', { class: 'dot ' + (up ? 'ok' : 'ng') }), 'IPv4'),
				row(T('接続方式'), t.name),
				row(T('グローバル IP'), net.ip4 || (sit.ap ? '' : wanV4)),
				row(T('ローカル IP'), lanAddr ? lanAddr.address : ''),
				gw && gw !== '0.0.0.0' ? row(T('ゲートウェイ'), gw) : null,
				dns4Row,
				portRow),
			h('section', { class: 'card' },
				h('h2', null, h('span', { class: 'dot ' + (v6state === T('取得済み') ? 'ok' : (g6 || ula6 ? 'warn' : '')), title: T('このルーターの IPv6: ') + v6state }), 'IPv6', v6state === T('取得済み') ? null : h('small', { class: 'muted' }, v6state)),
				row(T('グローバル IP'), g6 || ula6),
				dns6.length ? row(T('DNS サーバー ({mode})', { mode: dnsMode }), dns6) : null,
				row(T('プレフィックス'), pd ? pd.address + '/' + pd.mask : ''),
				mp ? row(T('MAP-E の自分側 (EC)'), mp.ce6) : null,
				mp ? row(T('中継装置 (BR)'), mp.br) : null),
			portsCard,
			rel.length ? h('section', { class: 'card sit' },
				h('h2', null, T('最近の回線ログ'), h('small', null, h('a', { href: '#/logs' }, T('すべて見る')))),
				h('div', { class: 'sit-log' }, rel.map(l => h('div', { class: 'logline' }, h('span', { class: 'lt' }, l.time), h('span', { class: 'lp' }, l.proc), h('span', { class: 'lm' }, l.msg + (l.n > 1 ? '  (×' + l.n + ')' : '')))))) : null);
	}

	load();
	probe();
	const t = setInterval(() => { if (!document.hidden) load(); }, 5000);
	const t2 = setInterval(() => { if (!document.hidden) probe(); }, 15000);
	return { stop() { stopped = true; clearInterval(t); clearInterval(t2); } };
}
