/* スピードテスト: インターネット (ルーター ⇔ サーバー) と LAN (このブラウザ ⇔ ルーター) */
import { T, tr } from '../i18n.js';
import { html, render, Fragment, useState, useEffect, useRef } from '../ui-kit.js';
import { sys, execJson, getSid } from '../api.js';
import { fmt as F } from '../util.js';
import { ask } from '../dialog.js';

const helper = async arg => (await execJson('/usr/libexec/tachigui-speedtest', Array.isArray(arg) ? arg : [ arg ])) || { error: 'bad reply' };

const MiB = 1048576;
const DL_PATH = '/tmp/tachigui-st-lan.bin';
const UP_PATH = '/tmp/tachigui-st-lan-up.bin';
const DL_SIZE = 64 * MiB, UP_SIZE = 32 * MiB, ROUNDS = 3, NPTS = 60;

const mbps = (bytes, ms) => ms > 0 ? bytes * 8 / (ms / 1000) / 1e6 : 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SERVER_KEY = 'tachigui.speedtest.server';
/* 例: Tokyo (Japan) by IPA CyberLab 400G → IPA CyberLab 400G (Tokyo・6ms) */
const serverLabel = s => { const m = /^(.*?) \(.*?\) by (.*?)\s*$/.exec(s.name); return (m ? m[2] + ' (' + m[1] : s.name.trim() + ' (') + (m ? T('・') : '') + s.ms + 'ms)'; };
const savedServer = () => { try { return localStorage.getItem(SERVER_KEY) || ''; } catch (e) { return ''; } };
const linkText = m => m >= 1000 ? m / 1000 + ' Gbps' : m + ' Mbps';

function Num({ label, value, live }) {
	return html`<div class=${'st-num' + (live ? ' live' : '')}><div class="k">${label}</div><div><span class="v">${value == null ? '-' : F.mbps(value)}</span><span class="u">Mbps</span></div></div>`;
}

function Live({ dn, up }) {
	const max = Math.max(10, ...dn, ...up) * 1.1;
	const pts = h => h.map((v, i) => (i * 300 / (NPTS - 1)).toFixed(1) + ',' + (54 - v / max * 52).toFixed(1)).join(' ');
	return html`<svg viewBox="0 0 300 56" preserveAspectRatio="none" class="livesvg">
		<polyline fill="none" stroke="#38bdf8" stroke-width="1.6" stroke-linejoin="round" vector-effect="non-scaling-stroke" points=${pts(dn)} />
		<polyline fill="none" stroke="#fb923c" stroke-width="1.6" stroke-linejoin="round" vector-effect="non-scaling-stroke" points=${pts(up)} /></svg>`;
}

/* 最高記録の 1 行。fresh は今回の測定で更新した方向 ({ dl, ul }) */
function Best({ kind, best, fresh, onClear }) {
	const b = best && best[kind];
	if (!b || (!b.dl && !b.ul)) return null;
	const one = (mark, r, isNew) => r ? html`<span class="st-rec">${mark} <b>${F.mbps(r.v)}</b> Mbps <span class="muted">${r.at.slice(0, 10)}</span>${isNew ? html` <span class="tag all">${T('新記録')}</span>` : null}</span>` : null;
	return html`<div class="st-best"><span class="k">${T('最高記録')}</span>${one('↓', b.dl, fresh && fresh.dl)}${one('↑', b.ul, fresh && fresh.ul)}<button type="button" class="btn icon" title=${T('最高記録を消す')} onClick=${onClear}>×</button></div>`;
}

/* 最高記録の読み書き。measured: ボタンで測った結果のときだけ「新記録」を出す */
function useBest(kind) {
	const [best, setBest] = useState(null);
	const [fresh, setFresh] = useState(null);
	const cur = useRef(null);
	const keep = b => { cur.current = b; setBest(b); };
	useEffect(() => { helper('best-get').then(keep).catch(e => console.error('speedtest: 最高記録を読めません', e)); }, []);
	async function record(dl, ul, at, measured) {
		try {
			const before = (cur.current && cur.current[kind]) || {};
			const after = await helper([ 'best-put', kind, dl.toFixed(1), ul.toFixed(1), at || '' ]);
			const a = after[kind] || {};
			keep(after);
			if (measured) setFresh({ dl: a.dl && (!before.dl || a.dl.v > before.dl.v), ul: a.ul && (!before.ul || a.ul.v > before.ul.v) });
		} catch (e) { console.error('speedtest: 最高記録を保存できません', e); }
	}
	async function clear() {
		if (!await ask({ title: T('最高記録を消す'), body: T('インターネットと LAN の両方の記録が消えます'), ok: T('消す'), danger: true })) return;
		try { keep(await helper('best-clear')); setFresh(null); }
		catch (e) { console.error('speedtest: 最高記録を消せません', e); }
	}
	return { best, fresh, record, clear };
}

/* ---- インターネット ---- */
function Inet() {
	const [mode, setMode] = useState('auto');
	const [run, setRun] = useState(false);
	const [msg, setMsg] = useState(null);
	const [dl, setDl] = useState(null), [ul, setUl] = useState(null);
	const [meta, setMeta] = useState(null);
	const [ips, setIps] = useState({ ip: '', ip6: '' });
	const [server, setServer] = useState('');     // '' は自動
	const [servers, setServers] = useState([]);
	const [installed, setInstalled] = useState(true);
	const [lv, setLv] = useState({ dn: [], up: [], ph: '' });
	const alive = useRef(true), timer = useRef(null), prev = useRef(null);
	const rec = useBest('inet');

	function show(res, m, ip, measured) {
		const sv = res && res.servers && res.servers[0];
		if (!sv) return setMsg({ k: 'ng', t: T('測定できませんでした。インターネットの接続を確かめてください') });
		setDl(sv.dl_speed * 8 / 1e6); setUl(sv.ul_speed * 8 / 1e6);
		const rows = [ [ T('遅延'), T('{lat} ms (ジッター {jit} ms)', { lat: (sv.latency / 1e6).toFixed(1), jit: (sv.jitter / 1e6).toFixed(1) }) ], [ T('サーバー'), sv.name + ' / ' + sv.sponsor + ' (' + Math.round(sv.distance) + ' km)' ] ];
		if (m && m.family) rows.push([ T('測定に使った通信'), (m.family === 'ipv6' ? 'IPv6' : 'IPv4') + (m.mode === 'v4' ? T(' (固定)') : T(' (自動)')) ]);
		if (ip.ip) rows.push([ T('出口 IP (IPv4)'), ip.ip ]);
		if (ip.ip6) rows.push([ T('出口 IP (IPv6)'), ip.ip6 ]);
		if (res.timestamp) rows.push([ T('測定日時'), res.timestamp.replace(/\.\d+$/, '') ]);
		setMeta(rows); setMsg(null);
		rec.record(sv.dl_speed * 8 / 1e6, sv.ul_speed * 8 / 1e6, (res.timestamp || '').slice(0, 16), measured);
	}

	/* 測定中の、ルーターの通信量 (br-lan の増え方) を、いまの速度として出す */
	async function tick() {
		try {
			const t = await sys.read('/proc/net/dev');
			const line = t.split('\n').map(l => l.trim()).find(l => l.indexOf('br-lan:') === 0);
			if (!line) return;
			const f = line.split(':')[1].trim().split(/\s+/).map(Number), c = { rx: f[0], tx: f[8], t: performance.now() };
			const p = prev.current; prev.current = c;
			if (!p || !alive.current) return;
			const dt = c.t - p.t, dn = Math.max(0, mbps(c.rx - p.rx, dt)), up = Math.max(0, mbps(c.tx - p.tx, dt));
			setLv(s => ({ dn: [ ...s.dn, dn ].slice(-NPTS), up: [ ...s.up, up ].slice(-NPTS), ph: dn > 2 && dn > up * 3 ? T('ダウンロードを測定中') : (up > 2 && up > dn * 3 ? T('アップロードを測定中') : T('準備中 / 遅延を測定中')) }));
			if (dn > 2 && dn > up * 3) setDl(dn); else if (up > 2 && up > dn * 3) setUl(up);
		} catch (e) { /* 無視 */ }
	}
	const liveStart = () => { prev.current = null; setLv({ dn: [], up: [], ph: '' }); tick(); timer.current = setInterval(tick, 1000); };
	const liveStop = () => { if (timer.current) clearInterval(timer.current); timer.current = null; setLv(s => ({ ...s, ph: T('測定終了') })); };

	async function poll(t0, ip) {
		while (alive.current) {
			const s = await helper('inet-status').catch(() => null);
			if (!s) { setMsg({ k: 'ng', t: T('状態を取得できませんでした') }); break; }
			if (!s.running) { liveStop(); show(s.result, s, ip, true); break; }
			setMsg({ k: '', t: T('測定中… {s} 秒 (約 30 秒かかります)', { s: Math.round((Date.now() - t0) / 1000) }) });
			await sleep(1500);
		}
		setRun(false);
	}

	async function start() {
		setRun(true); setDl(null); setUl(null); setMeta(null); setMsg({ k: '', t: T('測定を始めています…') });
		liveStart();
		try { await helper([ 'inet-start', mode, server ]); poll(Date.now(), ips); }
		catch (e) { liveStop(); setRun(false); setMsg({ k: 'ng', t: T('測定を開始できませんでした') }); }
	}

	/* 一覧は応答時間も測るので数秒かかる。前に選んだサーバーは、一覧にあるときだけ戻す */
	useEffect(() => {
		helper('inet-check').then(r => { if (r.installed === false && alive.current) setInstalled(false); }).catch(e => console.error('speedtest: 確認できません', e));
		helper('inet-servers').then(r => {
			const list = (r.servers || []).slice().sort((a, b) => a.ms - b.ms);
			if (!alive.current) return;
			setServers(list);
			const s = savedServer();
			if (list.some(x => x.id === s)) setServer(s);
		}).catch(e => console.error('speedtest: サーバーの一覧を読めません', e));
	}, []);

	function pickServer(v) {
		setServer(v);
		try { localStorage.setItem(SERVER_KEY, v); } catch (e) { /* 覚えられなくても動く */ }
	}

	useEffect(() => {
		alive.current = true;
		(async () => {
			const [ s, ip ] = await Promise.all([ helper('inet-status').catch(() => ({})), helper('inet-ip').catch(() => ({})) ]);
			const i = { ip: (ip && ip.ip) || '', ip6: (ip && ip.ip6) || '' };
			setIps(i);
			if (s && s.result) show(s.result, s, i);
			else if (s && s.running) { setRun(true); liveStart(); poll(Date.now(), i); }
		})();
		return () => { alive.current = false; if (timer.current) clearInterval(timer.current); };
	}, []);

	return html`<section class="card">
		<h2>${T('インターネット回線')}
			<span class="grow"></span>
			<select class="in" value=${mode} disabled=${run} onChange=${e => setMode(e.target.value)} title=${T('測定に使う通信')}><option value="auto">${T('自動 (IPv6 / IPv4)')}</option><option value="v4">${T('IPv4 に固定')}</option></select>
			<button class="btn primary" disabled=${run || !installed} onClick=${start}>${T('測定開始')}</button></h2>
		<p class="f-d">${T('ルーターからインターネット上のサーバーまでの速度 (Speedtest.net 互換)')}</p>
		${installed ? null : html`<div class="alert warn">${T('speedtest-go が必要です:')} <code>apk add speedtest-go</code></div>`}
		<div class="st-server"><span class="k">${T('サーバー')}</span><select class="in" value=${server} disabled=${run} onChange=${e => pickServer(e.target.value)}><option value="">${T('自動')}</option>${servers.map(s => html`<option value=${s.id}>${serverLabel(s)}</option>`)}</select></div>
		<div class="st-nums"><${Num} label=${T('ダウンロード (下り)')} value=${dl} live=${run} /><${Num} label=${T('アップロード (上り)')} value=${ul} live=${run} /></div>
		<${Best} kind="inet" best=${rec.best} fresh=${rec.fresh} onClear=${rec.clear} />
		<div class=${'st-bar' + (run ? ' ind' : '')}><i></i></div>
		${lv.dn.length ? html`<div class="st-live"><div class="liverow"><span>↓</span><b class="dn">${F.mbps(lv.dn[lv.dn.length - 1])}</b><span>Mbps</span><span>↑</span><b class="up">${F.mbps(lv.up[lv.up.length - 1])}</b><span>Mbps</span><span class="muted">${lv.ph}</span></div><${Live} dn=${lv.dn} up=${lv.up} /></div>` : null}
		${msg ? html`<div class=${'st-msg ' + msg.k}>${msg.t}</div>` : null}
		${meta ? html`<div class="st-meta">${meta.map(r => html`<span class="k">${r[0]}</span><span>${r[1]}</span>`)}</div>` : null}
	</section>`;
}

/* ---- LAN ---- */
function Lan() {
	const [run, setRun] = useState(false);
	const [msg, setMsg] = useState(null);
	const [dl, setDl] = useState(null), [ul, setUl] = useState(null);
	const [live, setLive] = useState(null);       // 'dl' | 'ul' | null
	const [pct, setPct] = useState(0);
	const [meta, setMeta] = useState(null);
	const [links, setLinks] = useState(null);
	const rec = useBest('lan');

	useEffect(() => { helper('lan-link').then(r => setLinks(r.links || [])).catch(e => console.error('speedtest: リンク速度を読めません', e)); }, []);

	async function latency() {
		const t = [];
		for (let i = 0; i < 10; i++) {
			const t0 = performance.now();
			await fetch('/ui/app.css?_=' + Math.random(), { method: 'HEAD', cache: 'no-store' });
			t.push(performance.now() - t0);
		}
		t.sort((a, b) => a - b);
		return { min: t[0], med: t[Math.floor(t.length / 2)] };
	}

	async function download() {
		const body = 'sessionid=' + encodeURIComponent(getSid()) + '&path=' + encodeURIComponent(DL_PATH);
		const t0 = performance.now();
		const r = await fetch('/cgi-bin/cgi-download', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
		if (!r.ok || !r.body) throw new Error('HTTP ' + r.status);
		const rd = r.body.getReader();
		let got = 0;
		for (;;) {
			const x = await rd.read();
			if (x.done) break;
			got += x.value.length;
			setDl(mbps(got, performance.now() - t0)); setPct(got / DL_SIZE);
		}
		return mbps(got, performance.now() - t0);
	}

	function upload() {
		return helper('lan-prep').then(() => new Promise((resolve, reject) => {
			const fd = new FormData();
			fd.append('sessionid', getSid());
			fd.append('filename', UP_PATH);
			fd.append('filedata', new Blob([ new Uint8Array(UP_SIZE) ]), 'speedtest.bin');
			const xhr = new XMLHttpRequest();
			let t0 = 0, last = 0;
			xhr.open('POST', '/cgi-bin/cgi-upload');
			xhr.upload.onloadstart = () => { t0 = performance.now(); };
			xhr.upload.onprogress = ev => { if (!t0) t0 = performance.now(); if (!ev.lengthComputable) return; last = ev.loaded; setUl(mbps(ev.loaded, performance.now() - t0)); setPct(ev.loaded / ev.total); };
			xhr.upload.onload = () => { last = UP_SIZE; };
			xhr.onload = () => xhr.status === 200 ? resolve(mbps(last || UP_SIZE, performance.now() - t0)) : reject(new Error('HTTP ' + xhr.status));
			xhr.onerror = () => reject(new Error(T('通信エラー')));
			xhr.send(fd);
		}));
	}

	async function start() {
		setRun(true); setDl(null); setUl(null); setMeta(null); setPct(0); setMsg({ k: '', t: T('準備しています…') });
		const res = { dl: [], ul: [] };
		try {
			await helper('lan-prep');
			setMsg({ k: '', t: T('応答時間を測っています…') });
			res.lat = await latency();
			setLive('dl');
			for (let i = 0; i < ROUNDS; i++) { setMsg({ k: '', t: T('ダウンロードを測っています… ({i}/{n})', { i: i + 1, n: ROUNDS }) }); setPct(0); res.dl.push(await download()); setDl(Math.max(...res.dl)); }
			setLive('ul');
			for (let i = 0; i < 2; i++) { setMsg({ k: '', t: T('アップロードを測っています… ({i}/{n})', { i: i + 1, n: 2 }) }); setPct(0); res.ul.push(await upload()); setUl(Math.max(...res.ul)); }
			const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
			setMeta([ [ T('応答時間'), T('{min} ms (中央値 {med} ms)', { min: res.lat.min.toFixed(1), med: res.lat.med.toFixed(1) }) ],
				[ T('ダウンロード'), T('最大 {max} / 平均 {avg} Mbps ({n} 回)', { max: F.mbps(Math.max(...res.dl)), avg: F.mbps(avg(res.dl)), n: res.dl.length }) ],
				[ T('アップロード'), T('最大 {max} / 平均 {avg} Mbps ({n} 回)', { max: F.mbps(Math.max(...res.ul)), avg: F.mbps(avg(res.ul)), n: res.ul.length }) ] ]);
			setPct(1); setMsg({ k: '', t: T('完了しました') });
			await rec.record(Math.max(...res.dl), Math.max(...res.ul), '', true);
		} catch (e) { setMsg({ k: 'ng', t: T('測定に失敗しました: ') + (e && e.message ? e.message : e) }); }
		setLive(null); setRun(false);
		helper('lan-clean').catch(() => {});
	}

	return html`<section class="card">
		<h2>${T('LAN (このブラウザ ⇔ ルーター)')}<span class="grow"></span><button class="btn primary" disabled=${run} onClick=${start}>${T('測定開始')}</button></h2>
		<p class="f-d">${T('HTTPS を通した速度の目安 (下り: ルーター → 端末)')}</p>
		${links && links.length ? html`<div class="st-meta"><span class="k">${T('リンク速度')}</span><span>${links.map(l => l.port + ' ' + linkText(l.speed)).join(' / ')}</span></div>` : null}
		<div class="st-nums"><${Num} label=${T('ダウンロード (下り)')} value=${dl} live=${live === 'dl'} /><${Num} label=${T('アップロード (上り)')} value=${ul} live=${live === 'ul'} /></div>
		<${Best} kind="lan" best=${rec.best} fresh=${rec.fresh} onClear=${rec.clear} />
		<div class="st-bar"><i style=${'width:' + Math.round(pct * 100) + '%'}></i></div>
		${msg ? html`<div class=${'st-msg ' + msg.k}>${msg.t}</div>` : null}
		${meta ? html`<div class="st-meta">${meta.map(r => html`<span class="k">${r[0]}</span><span>${r[1]}</span>`)}</div>` : null}
	</section>`;
}

export function mount(root) {
	root.appendChild(Object.assign(document.createElement('div'), { className: 'page-title', innerHTML: '<h1>' + T('スピードテスト') + '</h1>' }));
	const host = document.createElement('div');
	host.className = 'cols';
	root.appendChild(host);
	render(html`<${Fragment}><${Inet} /><${Lan} /><//>`, host);
	return { stop() { render(null, host); } };
}
