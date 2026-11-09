/* 概要: 使用状況、スループット (ポートごと)、ストレージ、機器の情報 */
import { T, tr } from '../i18n.js';
import { sys, execJson } from '../api.js';
import { h, morph, fmt, icon, spark } from '../util.js';
import { VERSION } from '../version.js?v=1.0.0';

const HIST = 60;
/* グラフの履歴。ほかのページへ移っても残す */
const KEEP = { series: { cpu: [], mem: [], temp: [], fan: [], load: [] }, hist: {} };
/* 内部の名前を、利用者の言葉に */
const DEV = n => n === 'br-lan' ? 'LAN' : (n === 'map-map0' || n === 'map0' ? 'MAP-E' : (/^eth\d+$/.test(n) ? n.toUpperCase() : n));

/* LAN 側はルーターの受信が端末の上り、送信が端末の下り。↓ / ↑ は下り / 上りにそろえる */
const flow = (r, lan) => lan ? { dn: r.tx, up: r.rx } : { dn: r.rx, up: r.tx };

/* 中身を入れ替える (配列も展開する)。変わった所だけ書き換える */
function fill(el, ...kids) { morph(el, kids); }

/* 稼働時間: 6日 23時間 27分 */
function uptimeDhm(sec) {
	const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
	return (d ? T('{n}日 ', { n: d }) : '') + (d || h ? T('{n}時間 ', { n: h }) : '') + T('{n}分', { n: m });
}

/* タイルの列数: 各行の枚数がそろう数を選ぶ。そろわない枚数は、行の差が最も小さくなる数にする */
const TILE_MIN = 170, TILE_GAP = 11.2;
function tileCols(n, width) {
	const fit = Math.max(1, Math.floor((width + TILE_GAP) / (TILE_MIN + TILE_GAP)));
	if (n <= fit) return Math.max(1, n);
	for (let c = fit; c > 1; c--) if (n % c === 0) return c;
	return Math.ceil(n / Math.ceil(n / fit));
}

export function mount(root) {
	const S = { cpuPrev: null, cpu: null, netPrev: null, rates: {}, hist: KEEP.hist, fan: null, info: null, board: null, temp: null, ports: [], disk: [], err: null, series: KEEP.series };
	let stopped = false, slowBusy = false;
	const timers = [];
	/* タイルの小さなグラフ用に、直近の値を覚える */
	const remember = (k, v) => { if (v == null) return; const a = S.series[k]; a.push(v); if (a.length > HIST) a.shift(); };

	const view = {
		tiles: h('div', { class: 'tiles' }),
		traffic: h('section', { class: 'card traffic' }),
		info: h('section', { class: 'card' }),
		ap: h('div', { class: 'stack' }),
		storage: h('section', { class: 'card' })
	};
	root.appendChild(h('div', { class: 'page-title' }, h('h1', null, T('概要'))));
	root.appendChild(view.tiles);
	root.appendChild(h('div', { class: 'grid2' }, h('div', { class: 'stack' }, view.traffic, view.storage), h('div', { class: 'stack' }, view.info, view.ap)));

	/* ---- 取得 ---- */

	async function fast() {
		try {
			const [ stat, dev, fans ] = await Promise.all([ sys.read('/proc/stat'), sys.read('/proc/net/dev'), execJson('/usr/libexec/tachigui-fan').catch(() => null) ]);
			/* 読めなかった回は前の値を残す (カードが消えると、ページが縮んでスクロールが戻る) */
			if (fans) S.fan = fans.fans || null;
			if (S.fan && S.fan.length) remember('fan', S.fan[0].rpm);

			/* CPU 使用率: 前回との差 */
			const m = stat.match(/^cpu\s+(.*)$/m);
			if (m) {
				const v = m[1].trim().split(/\s+/).map(Number);
				const idle = (v[3] || 0) + (v[4] || 0), total = v.reduce((a, x) => a + x, 0);
				if (S.cpuPrev && total > S.cpuPrev.total)
					S.cpu = Math.max(0, Math.min(100, (1 - (idle - S.cpuPrev.idle) / (total - S.cpuPrev.total)) * 100));
				S.cpuPrev = { idle: idle, total: total };
				remember('cpu', S.cpu);
			}
			/* コアごと: 1 コアだけ張り付いても平均では低く見えるので、一番高いコアも出す */
			const cores = (stat.match(/^cpu\d+\s+.*$/mg) || []).map(l => {
				const v = l.trim().split(/\s+/).slice(1).map(Number);
				return { idle: (v[3] || 0) + (v[4] || 0), total: v.reduce((a, x) => a + x, 0) };
			});
			if (S.corePrev && S.corePrev.length === cores.length && cores.length)
				S.coreMax = Math.max(...cores.map((c, i) => { const dt = c.total - S.corePrev[i].total; return dt > 0 ? Math.max(0, Math.min(100, (1 - (c.idle - S.corePrev[i].idle) / dt) * 100)) : 0; }));
			S.corePrev = cores;

			/* 通信量: 前回との差 */
			const now = performance.now(), cur = {};
			dev.split('\n').forEach(l => {
				const i = l.indexOf(':');
				if (i < 0) return;
				const name = l.slice(0, i).trim(), f = l.slice(i + 1).trim().split(/\s+/).map(Number);
				if (name && name !== 'lo' && f.length >= 9) cur[name] = { rx: f[0], tx: f[8] };
			});
			if (S.netPrev) {
				const dt = (now - S.netPrev.t) / 1000;
				Object.keys(cur).forEach(n => {
					const p = S.netPrev.d[n];
					if (!p || dt <= 0) return;
					const rx = Math.max(0, (cur[n].rx - p.rx) * 8 / dt / 1e6), tx = Math.max(0, (cur[n].tx - p.tx) * 8 / dt / 1e6);
					S.rates[n] = { rx: rx, tx: tx };
					const hh = S.hist[n] = S.hist[n] || { rx: [], tx: [] };
					hh.rx.push(rx); hh.tx.push(tx);
					if (hh.rx.length > HIST) { hh.rx.shift(); hh.tx.shift(); }
				});
			}
			S.netPrev = { t: now, d: cur };
			S.err = null;
		} catch (e) {
			S.err = e.message;
		}
		if (!stopped) { drawTiles(); drawTraffic(); }
	}

	async function slow() {
		if (slowBusy) return;
		slowBusy = true;
		try {
			const [ info, hw, en, board, df, ap ] = await Promise.all([
				sys.info(), execJson('/usr/libexec/tachigui-hw').catch(() => null), sys.network().catch(() => null), S.board ? Promise.resolve(S.board) : sys.board().catch(() => null),
				sys.exec('/bin/df', [ '-k', '/', '/tmp' ]).catch(() => ''),
				execJson('/usr/libexec/tachigui-wifi', [ 'status' ]).catch(() => null)
			]);
			S.info = info;
			if (board) S.board = board;
			/* AP に届かない間も、最後に読めた機器の情報は残す */
			if (ap && Array.isArray(ap.aps)) S.aps = ap.aps.map(a => ({ ...a, sys: a.sys || ((S.aps || []).find(o => o.host === a.host) || {}).sys }));
			if (en && en.devices) S.ports = en.devices;
			const disk = df.split('\n').slice(1).map(l => l.trim().split(/\s+/)).filter(f => f.length >= 6).map(f => ({ total: +f[1] * 1024, used: +f[2] * 1024, mount: f[5] }));
			if (disk.length) S.disk = disk;

			if (hw) { S.temp = hw.temp; S.model = hw.model; }
			const mem = info.memory;
			if (mem) remember('mem', (1 - (mem.available != null ? mem.available : mem.free) / mem.total) * 100);
			remember('temp', S.temp);
			if (info.load) remember('load', info.load[0] / 65535);
			S.err = null;
		} catch (e) {
			S.err = e.message;
		}
		slowBusy = false;
		if (!stopped) { drawTiles(); drawTraffic(); drawInfo(); drawAp(); drawStorage(); }
	}

	/* ---- 描画 ---- */

	/* タイルは、どれも同じ形: アイコンと名前、大きな値、補足、背景の小さなグラフ */
	function tile(ic, color, label, value, sub, graph) {
		return h('div', { class: 'tile', style: '--c:' + color }, h('div', { class: 'tile-k' }, h('span', { class: 'tile-ic' }, icon(ic, 15)), label), h('div', { class: 'tile-v' }, value), sub ? h('div', { class: 'tile-s' }, sub) : null, graph || null);
	}
	const unit = (n, u) => [ n, h('small', null, u) ];

	/* 背景のグラフ。lo〜hi を縦いっぱいに使う */
	function tileGraph(vals, lo, hi) {
		if (vals.length < 2) return null;
		const x = i => (100 - (vals.length - 1 - i) * 100 / (HIST - 1)).toFixed(2), y = v => (30 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo || 1) * 28).toFixed(2);
		const line = vals.map((v, i) => x(i) + ',' + y(v)).join(' ');
		return h('div', { class: 'tile-graph', html: '<svg viewBox="0 0 100 30" preserveAspectRatio="none"><polygon points="' + x(0) + ',30 ' + line + ' 100,30"/><polyline points="' + line + '" vector-effect="non-scaling-stroke"/></svg>' });
	}

	function layoutTiles() {
		const kids = view.tiles.children, n = kids.length, cols = tileCols(n, view.tiles.clientWidth), rest = n % cols;
		view.tiles.style.gridTemplateColumns = 'repeat(' + cols * 2 + ', minmax(0, 1fr))';
		/* 端数の行の先頭をずらして、中央に寄せる */
		Array.from(kids).forEach((k, i) => { k.style.gridColumnStart = rest && i === n - rest ? cols - rest + 1 : ''; });
	}

	function drawTiles() {
		const G = S.series, mem = S.info && S.info.memory ? S.info.memory : null;
		const memUsed = mem ? mem.total - (mem.available != null ? mem.available : mem.free) : null;
		const memPct = mem ? memUsed / mem.total * 100 : null;
		const load = S.info && S.info.load ? S.info.load.map(x => (x / 65535).toFixed(2)) : null;
		const fans = S.fan ? S.fan.filter(f => f.rpm > 0) : null;
		const level = (v, warn, ng, base) => v >= ng ? '#f87171' : (v >= warn ? '#fbbf24' : base);
		const span = a => { const lo = Math.min(...a), hi = Math.max(...a), m = Math.max(1, (hi - lo) * .3); return [ lo - m, hi + m ]; };
		const up = S.info ? S.info.uptime : null;
		const hhmm = t => t.getMonth() + 1 + '/' + t.getDate() + ' ' + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');

		fill(view.tiles,
			tile('cpu', level(S.cpu, 70, 90, '#38bdf8'), 'CPU', S.cpu == null ? '-' : unit(Math.round(S.cpu), '%'), S.coreMax == null ? null : T('最も高いコア {pct}%', { pct: Math.round(S.coreMax) }), tileGraph(G.cpu, 0, Math.max(10, ...G.cpu))),
			tile('mem', level(memPct, 75, 90, '#a78bfa'), T('メモリ'), memPct == null ? '-' : unit(Math.round(memPct), '%'), mem ? fmt.bytes(memUsed) + ' / ' + fmt.bytes(mem.total) : null, tileGraph(G.mem, 0, 100)),
			S.temp == null ? null : tile('temp', level(S.temp, 70, 85, '#fb923c'), h('span', { title: T('全センサーの最大値') }, T('温度')), unit(Math.round(S.temp), '°C'), T('直近の最高 {temp}°C', { temp: Math.round(Math.max(...G.temp, S.temp)) }), tileGraph(G.temp, ...span(G.temp))),
			fans ? tile('fan', '#2dd4bf', T('ファン'), fans.length ? unit(fans[0].rpm, 'rpm') : T('停止'), fans.length > 1 ? fans.map(f => f.rpm).join(' / ') + ' rpm' : (fans.length ? T('1 台') : null), tileGraph(G.fan, ...span(G.fan))) : null,
			tile('clock', '#4ade80', T('稼働'), up == null ? '-' : [ up >= 86400 ? unit(Math.floor(up / 86400), T('日')) : null, up >= 3600 ? unit(Math.floor(up % 86400 / 3600), T('時間')) : null, unit(Math.floor(up % 3600 / 60), T('分')) ], up == null ? null : T('起動 ') + hhmm(new Date(Date.now() - up * 1000))),
			tile('gauge', '#fbbf24', T('負荷平均'), load ? load[0] : '-', load ? T('5分 {a} / 15分 {b}', { a: load[1], b: load[2] }) : null, tileGraph(G.load, 0, Math.max(1, ...G.load))),
			(S.aps || []).map(a => tile('t_router', '#f472b6', a.name, a.ok ? unit(a.count, T('台')) : h('span', { style: 'color:#fbbf24' }, T('接続できません')), a.ok ? Object.keys(a.bands).filter(k => a.bands[k]).map(k => h('div', null, k.replace('G', 'GHz') + ' ' + a.bands[k] + T(' 台'))) : a.host)),
			S.err ? h('div', { class: 'tile warn' }, S.err) : null
		);
		layoutTiles();
	}

	/* 通信量: LAN 全体のグラフと、ポートごとの、リンクと速度 */
	function drawTraffic() {
		const main = S.rates['br-lan'] ? 'br-lan' : null;
		const r = main ? flow(S.rates[main], true) : null, hh = main ? S.hist[main] : null;
		const ports = S.ports.map(p => {
			const rate = S.rates[p.name] ? flow(S.rates[p.name], p.master === 'br-lan') : null;
			return h('div', { class: 'row prow' + (p.carrier ? '' : ' off') },
				h('span', { class: 'dot ' + (p.carrier ? 'ok' : '') }),
				h('strong', null, p.label || p.name),
				h('small', { class: 'muted' }, p.carrier ? (p.speed > 0 ? (p.speed >= 1000 ? p.speed / 1000 + ' Gbps' : p.speed + ' Mbps') : T('リンクあり')) : T('リンクなし')),
				h('span', { class: 'grow' }),
				p.carrier && rate ? h('small', { class: 'mono' }, '↓' + fmt.mbps(rate.dn) + '  ↑' + fmt.mbps(rate.up) + ' Mbps') : null);
		});
		fill(view.traffic,
			h('h2', null, icon('arrows', 16), T('スループット'), h('small', null, 'LAN')),
			h('div', { class: 'bigrates' }, h('span', { class: 'dn' }, '↓ ', h('b', null, r ? fmt.mbps(r.dn) : '-'), ' Mbps'), h('span', { class: 'up' }, '↑ ', h('b', null, r ? fmt.mbps(r.up) : '-'), ' Mbps')),
			hh ? spark([ hh.tx, hh.rx ], [ '#38bdf8', '#fb923c' ], 300, 70, HIST) : null,
			h('div', { class: 'ratelist' }, ports));
	}

	const row = (k, v) => h('div', { class: 'kvrow' }, h('span', null, k), h('span', { class: 'mono' }, v || '-'));

	function drawInfo() {
		const b = S.board;
		fill(view.info, h('h2', null, icon('info', 16), T('機器の情報')),
			b ? [ row(T('ルーター名'), b.hostname), row(T('モデル'), S.model || b.model), row('CPU', b.system), row('OpenWrt', b.release && b.release.description), row(T('カーネル'), b.kernel), row('TachiGUI', VERSION) ] : h('p', { class: 'muted' }, T('読み込み中…')));
	}

	/* 連携している AP の情報 */
	function drawAp() {
		view.ap.style.display = (S.aps || []).length ? '' : 'none';
		fill(view.ap, (S.aps || []).map(a => {
			const x = a.sys, b = x && x.board;
			return h('section', { class: 'card' }, h('h2', null, icon('t_router', 16), a.name),
				b ? [ row(T('稼働'), uptimeDhm(x.uptime)), row(T('ホスト名'), b.hostname), row(T('モデル'), b.model), row('CPU', b.system), row('OpenWrt', b.release && b.release.description), row(T('カーネル'), b.kernel) ]
					: h('p', { class: 'muted' }, a.ok ? T('機器の情報がありません') : T('AP に接続できません')));
		}));
	}

	function drawStorage() {
		const pct = d => d.total > 0 ? Math.max(0, Math.min(100, Math.round(d.used / d.total * 100))) : 0;
		fill(view.storage, h('h2', null, icon('folder', 16), T('ストレージ')),
			S.disk.length ? S.disk.map(d => h('div', { class: 'meter' },
				h('div', { class: 'meter-h' }, h('span', null, d.mount), h('strong', { class: 'mono' }, pct(d) + ' %')),
				h('div', { class: 'meter-bar' }, h('i', { class: pct(d) >= 90 ? 'm-ng' : (pct(d) >= 75 ? 'm-warn' : 'm-ok'), style: 'width:' + pct(d) + '%' })),
				h('div', { class: 'muted small' }, fmt.bytes(d.used) + ' / ' + fmt.bytes(d.total)))) : h('p', { class: 'muted' }, T('読み込み中…')));
	}

	/* ---- 開始 ---- */
	drawTiles(); drawTraffic(); drawInfo(); drawAp(); drawStorage();
	const resize = new ResizeObserver(layoutTiles);
	resize.observe(view.tiles);
	fast(); slow();
	timers.push(setInterval(() => { if (!document.hidden) fast(); }, 2000));
	timers.push(setInterval(() => { if (!document.hidden) slow(); }, 5000));

	return { stop() { stopped = true; timers.forEach(clearInterval); resize.disconnect(); } };
}
