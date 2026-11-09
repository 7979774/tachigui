/* ログ: システムログを見る */
import { T, tr } from '../i18n.js';
import { html, render, useState, useEffect, useRef } from '../ui-kit.js';
import { fetchLogs, WAN_RE, LEVELS } from '../logs.js';

const PRESETS = {
	all: { label: T('すべて'), test: () => true },
	wan: { label: T('回線 (WAN)'), test: l => WAN_RE.test(l.proc + ' ' + l.msg) },
	dhcp: { label: 'DHCP', test: l => /dhcp|odhcp/i.test(l.proc + ' ' + l.msg) },
	warn: { label: T('警告以上'), test: l => (LEVELS[l.level] ?? 3) <= 1 },
	login: { label: T('ログイン / SSH'), test: l => /dropbear|dispatcher|rpcd|sshd/i.test(l.proc) }
};
/* 毎回のように出て、本題を埋めてしまう行 (どれも、異常ではない) */
const NOISE = /allmulticast mode|promiscuous mode|read \/(tmp\/hosts|etc\/hosts|etc\/ethers)|using only locally-known|lws_sort_dns|wifi-scripts: Bug|cmd \/usr\/libexec\/tachigui-mape-fix/;
const COLOR = l => { const n = LEVELS[l] ?? 3; return n === 0 ? 'ng' : (n === 1 ? 'warn' : (n === 2 ? 'ok' : '')); };

function Page() {
	const [rows, setRows] = useState(null);
	const [err, setErr] = useState(null);
	const [preset, setPreset] = useState('all');
	const [q, setQ] = useState('');
	const [n, setN] = useState(500);
	const [auto, setAuto] = useState(true);
	const [asc, setAsc] = useState(false);
	const [quiet, setQuiet] = useState(true);
	const busy = useRef(false);

	async function load() {
		if (busy.current) return;
		busy.current = true;
		try { setRows(await fetchLogs(n)); setErr(null); } catch (e) { setErr(e.message); }
		busy.current = false;
	}
	useEffect(() => { load(); }, [n]);
	useEffect(() => { if (!auto) return; const t = setInterval(() => { if (!document.hidden) load(); }, 3000); return () => clearInterval(t); }, [auto, n]);

	const word = q.trim().toLowerCase();
	let list = (rows || []).filter(l => PRESETS[preset].test(l) && (!quiet || !NOISE.test(l.raw)) && (!word || l.raw.toLowerCase().includes(word)));
	if (!asc) list = list.slice().reverse();

	function save() {
		const blob = new Blob([ list.map(l => l.raw).join('\n') + '\n' ], { type: 'text/plain' });
		const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'tachigui-log.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
	}

	return html`<div class="logpage"><section class="card">
		<div class="cl-head"><h2>${T('システムログ')} <small>${rows ? T('{n} / {all} 行', { n: list.length, all: rows.length }) : ''}</small></h2>
			<input type="text" class="in search" placeholder=${T('検索')} value=${q} onInput=${e => setQ(e.target.value)} />
			<select class="in" value=${n} onChange=${e => setN(+e.target.value)} title=${T('読み込む行数')}><option value="200">${T('200 行')}</option><option value="500">${T('500 行')}</option><option value="1000">${T('1000 行')}</option><option value="3000">${T('3000 行')}</option></select>
			<label class="chk"><input type="checkbox" checked=${auto} onChange=${e => setAuto(e.target.checked)} /> ${T('自動更新')}</label>
			<label class="chk"><input type="checkbox" checked=${quiet} onChange=${e => setQuiet(e.target.checked)} /> ${T('日常の行を隠す')}</label>
			<button class="btn" onClick=${load}>${T('更新')}</button><button class="btn" onClick=${() => setAsc(!asc)}>${asc ? T('古い順') : T('新しい順')}</button><button class="btn" onClick=${save}>${T('保存')}</button></div>
		<div class="chips">${Object.keys(PRESETS).map(k => html`<button class=${'chip pick' + (preset === k ? ' on' : '')} onClick=${() => setPreset(k)}>${PRESETS[k].label}</button>`)}</div>
		${err ? html`<p class="warn-box">${err}</p>` : null}
		${rows == null ? html`<p class="muted">${T('読み込み中…')}</p>` : html`<div class="logbox">${list.map(l => html`<div class=${'logline ' + COLOR(l.level)}><span class="lt">${l.time}</span><span class="lp">${l.proc}</span><span class="lm">${l.msg}</span></div>`)}${!list.length ? html`<p class="muted">${T('一致する行がありません')}</p>` : null}</div>`}
	</section></div>`;
}

export function mount(root) {
	root.appendChild(Object.assign(document.createElement('div'), { className: 'page-title', innerHTML: '<h1>' + T('ログ') + '</h1>' }));
	const host = document.createElement('div');
	root.appendChild(host);
	render(html`<${Page} />`, host);
	return { stop() { render(null, host); } };
}
