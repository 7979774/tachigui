/* クライアント: つながっている機器の一覧 (名前・種類の変更、接続方法、転送速度、オフラインの機器) */
import { T, tr } from '../i18n.js';
import { html, render, useState, useEffect, useRef, Icon } from '../ui-kit.js';
import { sys, rpc, execJson } from '../api.js';
import { isClient } from '../util.js';
import { ask } from '../dialog.js';

const ipOf = r => r.ipv4 || (r.ipaddrs && r.ipaddrs[0]) || '';
const left = sec => sec == null || sec < 0 ? '' : (sec >= 3600 ? T('{h}時間 {m}分', { h: Math.floor(sec / 3600), m: Math.floor(sec % 3600 / 60) }) : T('{m}分', { m: Math.floor(sec / 60) }));
const NAMES = '/www/ui/clients.json';        // つけた名前 ({ MAC: 名前 })
const META = '/www/ui/clients-meta.json';    // 種類と、最後に見た様子 ({ MAC: { type, ip, host, seen } })
const WIFI = '/usr/libexec/tachigui-wifi';     // 連携した AP の管理画面の名前に書く
const NSET = '/tmp/.tachigui-names-set';
const STEP = 10 * 60 * 1000;                 // 「最後に見た時刻」は、この単位に丸めて、保存する回数を減らす

const TYPES = [
	[ 'desktop', T('デスクトップ') ], [ 'laptop', T('ノートパソコン') ], [ 'phone', T('携帯電話') ], [ 'tablet', T('タブレット') ], [ 'tv', T('テレビ') ],
	[ 'game', T('ゲーム機') ], [ 'camera', T('カメラ') ], [ 'speaker', T('スピーカー') ], [ 'printer', T('プリンタ') ], [ 'watch', T('ウェアラブル') ],
	[ 'smart', T('スマート家電') ], [ 'gateway', T('ゲートウェイ') ], [ 'router', T('Wi-Fi ルーター') ],[ 'nas', 'NAS' ], [ 'server', T('サーバー') ], [ 'switch', T('スイッチ') ], [ 'charger', T('充電器') ], [ 'other', T('その他') ]
];
const iconOf = type => type && type !== 'other' ? 't_' + type : 'pc';
const GUESS = [ [ /phone|xperia|android|pixel|galaxy|スマホ/i, 'phone' ], [ /ipad|tablet/i, 'tablet' ], [ /anker|charger|充電/i, 'charger' ], [ /router|ルーター|wi-?fi|slate|^gl-/i, 'router' ] ];     // i18n-ok: 名前から種類を推す (画面には出さない)
const guess = name => { const g = GUESS.find(x => x[0].test(name || '')); return g ? g[1] : ''; };
/* 先頭のオクテットの下から 2 ビット目が 1 (2 文字目が 2 / 6 / A / E) なら、メーカーの番号ではなく端末が決めた MAC */
const randomTag = mac => /^.[26AE]/i.test(mac || '') ? html`<span class="tag mactag" title=${T('変わると別の機器として表示')}>${T('ランダム')}</span>` : null;

function bytes(n) {
	n = Number(n) || 0;
	const u = [ 'B', 'KB', 'MB', 'GB', 'TB' ];
	let i = 0;
	while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
	return n.toFixed(i ? 2 : 2) + ' ' + u[i];
}
const when = ms => { const d = new Date(ms); return isNaN(d) ? '-' : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const short = s => String(s || '').replace(/\.lan$/i, '');
const isIpv4 = s => /^(\d{1,3}\.){3}\d{1,3}$/.test(s) && s.split('.').every(x => +x <= 255);
const ipNum = s => s.split('.').reduce((n, x) => n * 256 + +x, 0);
/* 同じネットワークか: マスクのビット数ぶん、上位を比べる */
const sameNet = (a, b, mask) => { const d = 2 ** (32 - mask); return Math.floor(ipNum(a) / d) === Math.floor(ipNum(b) / d); };
/* ファイルがまだ無いときだけ空とする。読めないときは例外にする (空として保存すると、中身が消えるため) */
const readJson = async path => {
	let data;
	try { data = (await rpc('file', 'read', { path })).data; }
	catch (e) { if (/\(4\)$/.test(e.message)) return {}; throw e; }     // 4 = ubus の NOT_FOUND
	if (!data) return {};
	const j = JSON.parse(data);
	if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error(T('{path}: 形式が違います', { path }));
	return j;
};

function Page() {
	const self = useRef({ lanIp: '', host: 'OpenWrt', prev: null, meta: null, metaText: '' }).current;
	const [rows, setRows] = useState(null);
	const [alias, setAlias] = useState({});
	const [apNames, setApNames] = useState({});    // AP でつけた名前 ({ MAC: 名前 })。TachiGUI の名前より先に使う
	const [meta, setMetaState] = useState({});
	const [q, setQ] = useState('');
	const [sort, setSort] = useState('ip');
	const [dlg, setDlg] = useState(null);
	const [err, setErr] = useState(null);
	const [locked, setLocked] = useState(false);    // 保存済みの内容を読めていない間は、変更を止める
	const [hosts, setHosts] = useState({});         // IP を固定した機器 ({ MAC: { sid, ip } })
	const [offOpen, setOffOpen] = useState(true);

	/* 保存済みの内容を読む。読めるまで self.meta は null のままで、保存はすべて止まる */
	async function readFiles() {
		try {
			const [ names, m ] = await Promise.all([ readJson(NAMES), readJson(META) ]);
			if (self.stopped || self.meta) return;
			self.alias = names; setAlias(names);
			self.meta = m; self.metaText = JSON.stringify(m); setMetaState(m);
			setLocked(false);
		} catch (e) {
			if (self.stopped) return;
			/* 4 秒ごとに読み直すので、同じ原因は 1 回だけログに残す */
			if (self.readErr !== e.message) { self.readErr = e.message; console.error('clients: 読み込み失敗', e); }
			setLocked(true);
		}
	}

	async function saveMeta(next) {
		if (!self.meta) return;
		const text = JSON.stringify(next);
		self.meta = next; setMetaState(next);
		if (text === self.metaText) return;
		self.metaText = text;
		try { await rpc('file', 'write', { path: META, data: text, mode: 420 }); } catch (e) { setErr(T('保存できませんでした: ') + e.message); }
	}

	async function load() {
		try {
			const [ hints, leases, ifs, extra ] = await Promise.all([
				sys.hostHints().catch(() => ({})), rpc('luci-rpc', 'getDHCPLeases', { family: 4 }).catch(() => ({})), sys.ifaces().catch(() => []),
				execJson('/usr/libexec/tachigui-clients').catch(() => null)
			]);
			sys.board().then(b => { if (b && b.hostname) self.host = b.hostname; }).catch(() => {});
			const lan = ((ifs.find(i => i.interface === 'lan') || {})['ipv4-address'] || [])[0];
			self.lanIp = lan ? lan.address : '';
			self.lanMask = lan ? lan.mask : 24;
			self.aps = (extra && extra.aps) || [];
			if (extra) takeApNames(extra.names);
			const lease = {};
			/* 一覧を読めなかったときは「記録なし」と判断しない */
			const leaseKnown = Array.isArray(leases.dhcp_leases);
			(leases.dhcp_leases || []).forEach(l => { lease[(l.macaddr || '').toLowerCase()] = l; });

			/* 転送速度: 前回からの増え方 / 経過時間。カウンターが戻ったとき (再読み込み) は 0 */
			const tr = (extra && extra.traffic) || {}, upt = extra ? extra.uptime : 0, prev = self.prev;
			const dt = prev && upt > prev.upt ? upt - prev.upt : 0;
			const speedOf = (ips, i) => {
				if (!dt) return 0;
				return ips.reduce((s, a) => { const c = tr[a], p = prev.tr[a]; return s + (c && p && c[i] >= p[i] ? (c[i] - p[i]) / dt : 0); }, 0);
			};
			const totalOf = (ips, i) => ips.reduce((s, a) => s + ((tr[a] || [])[i] || 0), 0);

			const out = Object.keys(hints || {}).filter(mac => isClient(hints[mac])).map(mac => {
				const r = hints[mac], l = lease[mac.toLowerCase()];
				const v6 = (r.ip6addrs || []).filter(a => /^[23]/.test(a)), ip = ipOf(r);
				const ips = (ip ? [ ip ] : []).concat(v6);
				const link = ((extra && extra.links) || {})[mac.toLowerCase()] || null;
				return {
					mac: mac.toUpperCase(), host: short(r.name || (l && l.hostname)), ip, v6, ll: (r.ip6addrs || []).filter(a => /^fe80/i.test(a)),
					expires: l ? l.expires : null, link,
					noLease: leaseKnown && !l && !!ip,      // IPv4 があるのに DHCP の貸し出し記録がない = 端末側で設定している可能性
					down: speedOf(ips, 0), up: speedOf(ips, 1), dtotal: totalOf(ips, 0), utotal: totalOf(ips, 1)
				};
			});
			self.prev = { upt, tr };
			self.rows = out;
			setRows(out);
			setErr(null);

			/* 見た機器を覚える (オフライン一覧のため)。変わったときだけ書く */
			if (self.meta) {
				const next = { ...self.meta }, now = Math.floor(Date.now() / STEP) * STEP;
				out.forEach(r => {
					const o = next[r.mac] || {};
					const n = { ...o, ip: r.ip || o.ip || '', host: short(r.host || o.host), seen: now };
					if (!o.seen || o.ip !== n.ip || o.host !== n.host || o.seen !== now) next[r.mac] = n;
				});
				if (JSON.stringify(next) !== self.metaText) saveMeta(next);
			}
		} catch (e) { setErr(e.message); }
	}

	/* AP の名前は、機器の情報と一緒に届く。書いた直後は、AP を読み直すまで書いた名前を使う (前の名前に戻って見えないように) */
	function takeApNames(names) {
		const m = {}, now = Date.now();
		Object.keys(names || {}).forEach(k => { if (typeof names[k] === 'string' && names[k]) m[k.toUpperCase()] = names[k]; });
		Object.keys(self.pend || {}).forEach(k => {
			const p = self.pend[k];
			if (now - p.t > 30000 || (m[k] || '') === p.name) { delete self.pend[k]; return; }
			if (p.name) m[k] = p.name; else delete m[k];
		});
		self.apNames = m; setApNames(m);
	}

	/* AP にも名前を書く ({ MAC: 名前 }、空は消す)。AP の画面などでも同じ名前になるように */
	async function writeApNames(map) {
		if (!(self.aps || []).length) return;
		self.pend = self.pend || {};
		Object.keys(map).forEach(k => { self.pend[k] = { name: map[k], t: Date.now() }; });
		takeApNames(Object.fromEntries(Object.entries(self.apNames || {}).map(([ k, v ]) => [ k.toLowerCase(), v ])));
		try {
			await rpc('file', 'write', { path: NSET, data: JSON.stringify(map), mode: 384 });
			const r = await execJson(WIFI, [ 'names', 'set' ]);
			if (!r || !r.ok) setErr(T('AP の名前を変えられませんでした'));
			else if (r.ng && r.ng.length) setErr(T('{aps} の名前を変えられませんでした。Wi-Fi のタブで登録し直してください', { aps: r.ng.join(', ') }));
		} catch (e) { console.error('clients: AP の名前を書けません', e); setErr(T('AP の名前を変えられませんでした: ') + e.message); }
	}

	useEffect(() => {
		const tick = async () => { if (!self.meta) await readFiles(); if (!self.stopped) load(); };
		tick();
		loadHosts();
		const t = setInterval(() => { if (!document.hidden) tick(); }, 4000);
		return () => { self.stopped = true; clearInterval(t); };
	}, []);

	const isSelf = r => !!r.ip && r.ip === self.lanIp;     // このルーター自身の行
	const apOf = r => !!r.ip && (self.aps || []).find(a => a.host === r.ip);     // 連携している Wi-Fi の AP
	const isAp = r => !!apOf(r);
	const nameOf = r => apNames[r.mac] || alias[r.mac] || (isSelf(r) && self.host) || (isAp(r) && apOf(r).name) || r.host || short((meta[r.mac] || {}).host);
	const typeOf = r => (meta[r.mac] || {}).type || (isSelf(r) ? 'gateway' : isAp(r) ? 'router' : guess(nameOf(r)));

	/* 名前と種類を保存する (詳細の画面から、その場で呼ばれる) */
	async function saveNames(next) {
		self.alias = next; setAlias(next);
		try { await rpc('file', 'write', { path: NAMES, data: JSON.stringify(next), mode: 420 }); } catch (e) { setErr(T('名前を保存できませんでした: ') + e.message); }
	}

	async function save(r, name, type) {
		if (!self.meta) return;
		/* 本体の名前がルーター名のままなら、固定しない (基本設定で変えたときに、一覧にも反映するため) */
		const keep = name.trim() && !(isSelf(r) && name.trim() === self.host);
		const next = { ...self.alias }; if (keep) next[r.mac] = name.trim(); else delete next[r.mac];
		await saveNames(next);
		if ((next[r.mac] || '') !== ((self.apNames || {})[r.mac] || '')) writeApNames({ [r.mac]: next[r.mac] || '' });
		const cur = self.meta || {}, o = cur[r.mac] || {};
		await saveMeta({ ...cur, [r.mac]: { ...o, type, ip: r.ip || o.ip || '', host: short(r.host || o.host), seen: o.seen || Math.floor(Date.now() / STEP) * STEP } });
	}

	/* IP の固定 (DHCP の host セクション) */
	async function loadHosts() {
		try {
			const r = await rpc('uci', 'get', { config: 'dhcp', type: 'host' });
			const m = {};
			Object.keys(r.values || {}).forEach(sid => {
				const s = r.values[sid];
				/* LuCI では 1 つの欄に MAC を複数入れられる。macs に欄の MAC をすべて持つ */
				const macs = [].concat(s.mac || []).join(' ').split(/\s+/).filter(Boolean);
				macs.forEach(x => { m[x.toUpperCase()] = { sid, ip: s.ip || '', macs }; });
			});
			self.hosts = m; setHosts(m);
		} catch (e) { console.error('clients: 固定 IP を読めません', e); }
	}

	/* ip が空なら固定を外す。エラーの文を返す (成功は null) */
	async function saveHost(r, ip) {
		/* 詳細を開いたままでも最新を見るよう、self から読む */
		const hostsNow = self.hosts || {}, cur = hostsNow[r.mac];
		if (ip) {
			if (!isIpv4(ip)) return T('IP アドレスを確かめてください');
			if (!sameNet(ip, self.lanIp, self.lanMask)) return T('LAN の範囲 ({net}) で指定してください', { net: self.lanIp + '/' + self.lanMask });
			if (ip === self.lanIp) return T('ルーターのアドレスは使えません');
			/* LAN の先頭 (ネットワーク) と末尾 (ブロードキャスト) は、機器に使えない */
			const d = 2 ** (32 - self.lanMask), k = ipNum(ip) % d;
			if (d > 2 && (k === 0 || k === d - 1)) return T('{ip} は機器に使えません', { ip });
			const other = Object.keys(hostsNow).find(m => m !== r.mac && hostsNow[m].ip === ip);
			if (other) { const o = (self.rows || []).find(x => x.mac === other); return T('{ip} は {name} に固定済みです', { ip, name: (o && nameOf(o)) || (self.alias || {})[other] || other }); }
			/* 端末側で設定した機器は host に載らないので、今使っている IP でも確かめる */
			const using = (self.rows || []).find(x => x.mac !== r.mac && x.ip === ip);
			if (using) return T('{ip} は {name} が使用中です', { ip, name: nameOf(using) });
		}
		if (!await ask({ title: ip ? T('IP を {ip} に固定', { ip }) : T('IP の固定を外す'), rows: [ [ T('機器'), nameOf(r) || r.mac ], [ 'MAC', r.mac ] ], body: T('機器の次の更新か再接続で反映します'), warns: /^.[26AE]/i.test(r.mac) && ip ? [ { level: 'warn', text: T('ランダム MAC は変わると固定が効かなくなります') } ] : [], ok: ip ? T('固定') : T('外す') })) return false;
		try {
			/* ほかの機器と共有の欄なら、その欄からこの機器の MAC だけを外す (ほかの機器の固定は変えない) */
			const shared = cur && cur.macs.length > 1;
			if (shared) await rpc('uci', 'set', { config: 'dhcp', section: cur.sid, values: { mac: cur.macs.filter(x => x.toUpperCase() !== r.mac.toUpperCase()) } });
			if (!ip) { if (cur && !shared) await rpc('uci', 'delete', { config: 'dhcp', section: cur.sid }); }
			else if (cur && !shared) await rpc('uci', 'set', { config: 'dhcp', section: cur.sid, values: { ip } });
			else {
				const a = await rpc('uci', 'add', { config: 'dhcp', type: 'host' });
				const name = (nameOf(r) || '').replace(/[^A-Za-z0-9-]/g, '').replace(/^-+|-+$/g, '');
				await rpc('uci', 'set', { config: 'dhcp', section: a.section, values: { mac: r.mac, ip, ...(name ? { name } : {}) } });
			}
			await rpc('uci', 'apply', { rollback: false });
			await loadHosts();
			return null;
		} catch (e) {
			console.error('clients: 固定 IP を保存できません', e);
			await rpc('uci', 'revert', { config: 'dhcp' }).catch(() => {});
			return T('保存できませんでした: ') + e.message;
		}
	}

	function openDetail(r, off) {
		setDlg({ detail: r, off: !!off, locked: !self.meta, fixable: !isSelf(r) && !isAp(r), saveHost: ip => saveHost(r, ip), title: T('詳細'), value: apNames[r.mac] || alias[r.mac] || (isSelf(r) && self.host) || (isAp(r) && apOf(r).name) || short(r.host) || short((meta[r.mac] || {}).host), type: typeOf(r) || 'other',
			save: (name, type) => save(r, name, type),
			done: act => { setDlg(null); if (act === 'forget') forget([ r.mac ], nameOf(r) || r.mac); } });
	}

	/* オフラインの機器を消す。名前も一緒に消す (ランダム MAC の名前が、残り続けないように) */
	async function forget(macs, title) {
		if (!self.meta) return;
		if (!await ask({ title: T('{name} を削除', { name: title }), body: T('つけた名前と種類も消えます'), ok: T('削除'), danger: true })) return;
		const names = { ...self.alias }, next = { ...self.meta };
		macs.forEach(m => { delete names[m]; delete next[m]; });
		if (macs.some(m => m in self.alias)) await saveNames(names);
		await saveMeta(next);
		const ap = macs.filter(m => (self.apNames || {})[m]);
		if (ap.length) writeApNames(Object.fromEntries(ap.map(m => [ m, '' ])));
	}

	const word = q.trim().toLowerCase();
	let list = (rows || []).filter(r => !word || (nameOf(r) + ' ' + r.ip + ' ' + r.mac + ' ' + r.v6.join(' ')).toLowerCase().includes(word));
	const key = { ip: r => r.ip || '￿' + r.mac, name: r => nameOf(r) || '￿' + r.mac, mac: r => r.mac }[sort];
	list = list.slice().sort((a, b) => key(a).localeCompare(key(b), undefined, { numeric: true }));

	const onlineMacs = new Set((rows || []).map(r => r.mac));
	const off = Object.keys(meta).filter(m => !onlineMacs.has(m) && meta[m].seen).map(m => ({ mac: m, ...meta[m] }))
		.filter(o => !word || ((apNames[o.mac] || alias[o.mac] || o.host || '') + ' ' + (o.ip || '') + ' ' + o.mac).toLowerCase().includes(word))
		.sort((a, b) => b.seen - a.seen);

	return html`<div class="cl">
		${dlg ? html`<${NameModal} dlg=${dlg} fixed=${hosts[dlg.detail.mac]} />` : null}
		<section class="card">
			<div class="cl-head"><h2>${T('オンライン')} <small>${rows ? T('{n} 台', { n: list.length }) : ''}</small></h2>
				<input type="text" class="in search" placeholder=${T('名前・IP・MAC で検索')} value=${q} onInput=${e => setQ(e.target.value)} />
				<select class="in" value=${sort} onChange=${e => setSort(e.target.value)} title=${T('並び順')}><option value="ip">${T('IP 順')}</option><option value="name">${T('名前順')}</option><option value="mac">${T('MAC 順')}</option></select></div>
			${locked ? html`<p class="warn-box">${T('保存済みの名前を読めないため変更を止めています')}</p>` : null}
			${err ? html`<p class="warn-box">${err}</p>` : null}
			${rows == null ? html`<p class="muted">${T('読み込み中…')}</p>` : html`<div class="tblwrap"><table class="cltbl">
				<thead><tr><th>${T('名前')}</th><th>IP + MAC</th><th class="hide-s">${T('転送速度')}</th><th class="hide-s">${T('トラフィック')}</th></tr></thead>
				<tbody>${list.map(r => html`<tr>
					<td><div class="clname"><${Icon} n=${iconOf(typeOf(r))} s=${26} /><div class="clnm"><div><a class="nm" onClick=${() => openDetail(r)}>${nameOf(r) || T('不明なデバイス')}</a>${isSelf(r) ? html`<span class="tag">${T('本体')}</span>` : null}${isAp(r) ? html`<span class="tag">AP</span>` : null}</div>${r.link && r.link.wifi ? html`<div class="muted small" title=${linkText(r.link)}>${wifiShort(r.link.wifi)}</div>` : null}</div></div></td>
					<td><div class="mono">${r.ip || r.ll[0] || '-'}${fixTag(r, hosts[r.mac])}</div><div class="mono muted">${r.mac}${randomTag(r.mac)}</div></td>
					<td class="hide-s mono"><div class=${r.down >= 1 ? 'spd dn' : 'spd'}>↓ ${bytes(r.down)}/s</div><div class=${r.up >= 1 ? 'spd up' : 'spd'}>↑ ${bytes(r.up)}/s</div></td>
					<td class="hide-s mono"><div>↓ ${bytes(r.dtotal)}</div><div>↑ ${bytes(r.utotal)}</div></td>
					</tr>`)}
				</tbody></table></div>`}
		</section>
		${rows && Object.keys(meta).length ? html`<section class="card">
			<div class="cl-head"><h2 class="clk" onClick=${() => setOffOpen(!offOpen)}>${T('オフライン')} <small>${off.length} ${T('台')}</small> <span class=${'chev' + (offOpen ? ' open' : '')}></span></h2>
				${off.length ? html`<button class="btn" onClick=${() => forget(off.map(o => o.mac), T('オフラインの {n} 台', { n: off.length }))}>${T('すべて削除')}</button>` : null}</div>
			${offOpen ? (off.length ? html`<div class="tblwrap"><table class="cltbl">
				<thead><tr><th>${T('名前')}</th><th>${T('最後の IP + MAC')}</th><th class="hide-s">${T('最後に見た時刻')}</th><th class="op"></th></tr></thead>
				<tbody>${off.map(o => html`<tr class="offrow">
					<td><div class="clname"><${Icon} n=${iconOf(o.type || guess(apNames[o.mac] || alias[o.mac] || o.host))} s=${26} /><a class="nm" onClick=${() => openDetail({ mac: o.mac, ip: o.ip, host: o.host, v6: [], ll: [] }, true)}>${apNames[o.mac] || alias[o.mac] || short(o.host) || T('不明なデバイス')}</a></div></td>
					<td><div class="mono">${o.ip || '-'}</div><div class="mono muted">${o.mac}${randomTag(o.mac)}</div></td>
					<td class="hide-s">${when(o.seen)}</td>
						<td class="op"><button type="button" class="btn icon" title=${T('削除')} onClick=${() => forget([ o.mac ], apNames[o.mac] || alias[o.mac] || short(o.host) || o.mac)}><${Icon} n="trash" s=${16} /></button></td>
					</tr>`)}
				</tbody></table></div>` : html`<p class="muted">${T('オフラインの機器なし')}</p>`) : null}
		</section>` : null}
	</div>`;
}

/* 接続の様子。Wi-Fi は親機の情報 (電波の強さ、速度)、それ以外は有線のポート */
const bandText = b => ({ '2.4G': '2.4GHz', '5G': '5GHz', '6G': '6GHz' }[b] || b || '');
const signalWord = s => s >= -60 ? T('強い') : s >= -70 ? T('普通') : T('弱い');
const wifiShort = w => w ? bandText(w.band) + (w.signal ? ' ' + w.signal + ' dBm' : '') : '';
function linkText(link) {
	if (!link) return '';
	const w = link.wifi;
	if (!w) return link.port ? T('LAN ポート {port}', { port: link.port }) : '';      // AP の先の機器もこのポートに見えるので、有線とは言い切らない
	return 'Wi-Fi ' + [ bandText(w.band), w.ssid, w.ap ].filter(Boolean).join(' / ');
}

/* 固定の印。今の IP と違うときは、まだ反映されていないことを示す */
function fixTag(r, h) {
	if (!h) return null;
	const same = !r.ip || r.ip === h.ip;
	const label = same ? T('固定') : r.noLease ? T('未反映') : T('再接続待ち');
	const title = same ? T('DHCP で {ip} に固定', { ip: h.ip }) : r.noLease ? T('{ip} に固定済み。端末側の IP を使っているようです', { ip: h.ip }) : T('{ip} に固定済み。機器の次の更新か再接続で変わります', { ip: h.ip });
	return html`<span class="tag mactag" title=${title}>${label}</span>`;
}

/* 詳細の中の、IP を固定する欄 */
function IpFix({ dlg, fixed }) {
	const r = dlg.detail;
	const [ip, setIp] = useState((fixed && fixed.ip) || r.ip || '');
	const [on, setOn] = useState(!!fixed);
	const [msg, setMsg] = useState(null);
	const [busy, setBusy] = useState(false);
	async function apply(value) {
		setBusy(true); setMsg(null);
		const e = await dlg.saveHost(value);
		if (e === false) setOn(!!fixed);
		else if (e) { setMsg({ k: 'ng', t: e }); if (!value) setOn(true); }
		else setMsg({ k: 'ok', t: value ? T('固定しました') : T('固定を外しました') });
		setBusy(false);
	}
	const toggle = e => { const v = e.target.checked; setOn(v); setMsg(null); if (!v && fixed) apply(''); };
	const dirty = on && ip.trim() && (!fixed || fixed.ip !== ip.trim());
	return html`<div class="ipfix"><span>${T('IP を固定')}</span><input type="checkbox" class="tgl" aria-label=${T('IP を固定')} disabled=${busy} checked=${on} onChange=${toggle} />
		${on ? html`<input type="text" class="in mono" spellcheck="false" placeholder="192.168.1.50" value=${ip} onInput=${e => setIp(e.target.value)} /><button type="button" class="btn primary" disabled=${busy || !dirty} onClick=${() => apply(ip.trim())}>${T('保存')}</button>` : null}
		${msg ? html`<div class=${'alert ' + msg.k} style="width:100%">${msg.t}</div>` : null}</div>`;
}

function NameModal({ dlg, fixed }) {
	const r = dlg.detail, w = r.link && r.link.wifi;
	const [v, setV] = useState(dlg.value || '');
	const [t, setT] = useState(dlg.type || 'other');
	const timer = useRef(null);
	const kv = (k, x) => html`<div class="k">${k}</div><div class="v">${x || '-'}</div>`;
	const flush = (name, type) => { clearTimeout(timer.current); dlg.save(name, type); };
	const onName = e => { const n = e.target.value; setV(n); clearTimeout(timer.current); timer.current = setTimeout(() => dlg.save(n, t), 700); };
	const onType = x => { setT(x); flush(v, x); };
	const close = act => { if (timer.current) flush(v, t); dlg.done(act); };
	const [pick, setPick] = useState(false);
	const [editing, setEditing] = useState(false);
	const finish = () => { if (timer.current) flush(v, t); setEditing(false); };
	/* アイコンの一覧は、詳細の枠の上に、別の枠で重ねて出す。外を押すと、一覧だけが閉じる */
	return html`<div class="modal-bg" onClick=${e => { if (e.target === e.currentTarget) close(null); }}><div class="modal"><h2>${dlg.title}</h2>
		<div class="dhead">
			<button type="button" class=${'dico' + (pick ? ' on' : '')} title=${dlg.locked ? null : T('種類を変える')} disabled=${dlg.locked} onClick=${() => setPick(!pick)}><${Icon} n=${iconOf(t)} s=${32} /></button>
			${editing
				? html`<input type="text" class="in" style="flex:1" value=${v} placeholder=${T('名前')} ref=${el => el && !el._f && (el._f = 1, el.focus(), el.select())} onInput=${onName} onBlur=${finish} onKeyDown=${e => { if (e.key === 'Enter' || e.key === 'Escape') e.target.blur(); }} />`
				: html`<span class="dname">${v || T('不明なデバイス')}</span>${dlg.locked ? null : html`<button type="button" class="btn icon" title=${T('名前を変える')} onClick=${() => setEditing(true)}><${Icon} n="edit" s=${16} /></button>`}`}
		</div>
		<div class="fm-kv">${kv('IPv4', r.ip)}${kv('IPv6', r.v6.join(', '))}${kv(T('リンクローカル'), r.ll.join(', '))}${kv(T('MAC アドレス'), html`${r.mac}${randomTag(r.mac)}`)}${r.link ? kv(T('接続'), linkText(r.link)) : null}${w && w.signal ? kv(T('電波'), w.signal + ' dBm (' + signalWord(w.signal) + ')') : null}${w && (w.rx || w.tx) ? kv(T('リンク速度'), T('下り ') + w.tx + T(' / 上り ') + w.rx + ' Mbps') : null}${kv(T('リース残り'), left(r.expires))}</div>
		${r.noLease && dlg.fixable && !dlg.off ? html`<div class="alert warn" style="margin-top:.7rem">${T('端末側で IP を設定している可能性があります。その場合、ここでの固定は効きません')}</div>` : null}
		${dlg.fixable && !dlg.locked ? html`<${IpFix} dlg=${dlg} fixed=${fixed} />` : null}
		<div class="modal-act">${dlg.off ? html`<button class="btn" onClick=${() => close('forget')}>${T('削除')}</button>` : null}<button class="btn primary" onClick=${() => close(null)}>${T('閉じる')}</button></div></div>
		${pick ? html`<div class="modal-bg over" onClick=${e => { if (e.target === e.currentTarget) setPick(false); }}><div class="modal typepanel" role="dialog" aria-label=${T('アイコンを選ぶ')}><h2>${T('アイコンを選ぶ')}<button type="button" class="btn icon" title=${T('閉じる')} onClick=${() => setPick(false)}>×</button></h2>
			<div class="typegrid">${TYPES.map(x => html`<button type="button" class=${'typeopt' + (t === x[0] ? ' on' : '')} onClick=${() => { onType(x[0]); setPick(false); }}><${Icon} n=${iconOf(x[0])} s=${26} /><span>${x[1]}</span></button>`)}</div></div></div>` : null}
	</div>`;
}

export function mount(root) {
	root.appendChild(Object.assign(document.createElement('div'), { className: 'page-title', innerHTML: '<h1>' + T('クライアント') + '</h1>' }));
	const host = document.createElement('div');
	root.appendChild(host);
	render(html`<${Page} />`, host);
	return { stop() { render(null, host); } };
}
