/* ファイル: ルーターのファイルを見る、編集、アップロード、ダウンロード (LuCI のファイルマネージャーと同じ使い心地) */
import { T, tr } from '../i18n.js';
import { html, render, useState, useEffect, useRef } from '../ui-kit.js';
import { rpc, getSid } from '../api.js';
import { ask, prompt } from '../dialog.js';

const API = 'tachigui.files';
/* 複数の項目の失敗は errors に 1 件ずつ入るので、1 件ずつ訳す */
const errText = r => r && Array.isArray(r.errors) && r.errors.length ? r.errors.map(tr).join(' ') : r && tr(r.error);
const call = (m, p) => rpc(API, m, p).then(r => { if (!r || r.ok === false) throw new Error(errText(r) || T('操作に失敗しました')); return r; });

const BOOKMARKS = [
	{ label: T('ホーム'), path: '/root', ico: 'home' }, { label: T('ルート'), path: '/', ico: 'drive' }, { label: T('設定'), path: '/etc', ico: 'gear' },
	{ label: T('一時'), path: '/tmp', ico: 'clock' }, { label: T('ログ'), path: '/var/log', ico: 'log' }, { label: 'Web', path: '/www', ico: 'globe' },
	{ label: T('マウント'), path: '/mnt', ico: 'usb' }, { label: T('共有ファイル'), path: '/usr/share', ico: 'folder' }
];
const IMAGE_EXT = [ 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif' ];
const ARCHIVE_EXT = [ 'tar', 'gz', 'tgz', 'zip', 'bz2', 'xz', '7z', 'rar', 'apk', 'ipk', 'img' ];
const EXTRACT_RE = /\.(tar|tar\.gz|tgz)$/i;

const ICONS = {
	folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="currentColor" fill-opacity=".85" stroke="none"/>',
	file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
	text: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>',
	image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/>',
	archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9"/><path d="M10 13h4"/>',
	link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
	home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
	drive: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 14h18"/><circle cx="7" cy="17" r=".6" fill="currentColor"/>',
	gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
	clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
	log: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
	globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
	usb: '<circle cx="12" cy="18" r="2"/><path d="M12 16V4M9 7l3-3 3 3"/><path d="M12 11l4-2v3"/>',
	panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
	up: '<path d="M12 19V5M6 11l6-6 6 6"/>', back: '<path d="M15 6l-6 6 6 6"/>',
	refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
	upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
	download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
	edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
	copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
	cut: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8 7.5L20 18M8 16.5L20 6"/>',
	paste: '<rect x="6" y="5" width="12" height="16" rx="2"/><path d="M9 5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/>',
	trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12"/><path d="M9 7V4h6v3"/>',
	info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
	eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
	eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.6 7.6C3.8 9.3 2 12 2 12s4 7 10 7c1.5 0 2.9-.4 4.1-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
	unarchive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9"/><path d="M12 18v-6M9 15l3-3 3 3"/>',
	close: '<path d="M6 6l12 12M18 6L6 18"/>',
	save: '<path d="M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>',
	folderPlus: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10v6M9 13h6"/>',
	filePlus: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 11v6M9 14h6"/>',
	sortUp: '<path d="M6 14l6-6 6 6"/>', sortDown: '<path d="M6 10l6 6 6-6"/>',
	wrap: '<path d="M4 6h16M4 12h13a3 3 0 0 1 0 6h-4"/><path d="M15 15l-2 3 2 3"/>'
};
const Ico = ({ n, s, cls }) => html`<span class=${'fm-ico ' + (cls || '')} dangerouslySetInnerHTML=${{ __html: '<svg viewBox="0 0 24 24" width="' + (s || 18) + '" height="' + (s || 18) + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[n] || ICONS.file) + '</svg>' }}></span>`;

const ext = n => { const m = /\.([^.\/]+)$/.exec(n || ''); return m ? m[1].toLowerCase() : ''; };
const join = (d, n) => (d === '/' ? '' : d) + '/' + n;
const parentOf = p => { const i = p.lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i); };
const baseOf = p => p.slice(p.lastIndexOf('/') + 1);
const isDir = e => e.type === 'dir' || (e.type === 'link' && e.dir);
const kindOf = e => isDir(e) ? 'folder' : (IMAGE_EXT.includes(ext(e.name)) ? 'image' : (ARCHIVE_EXT.includes(ext(e.name)) ? 'archive' : (e.type === 'link' ? 'link' : (e.type === 'other' ? 'file' : 'text'))));
const fmtSize = n => { if (n == null) return ''; if (n < 1024) return n + ' B'; const u = [ 'KB', 'MB', 'GB', 'TB' ]; let v = n / 1024, i = 0; while (v >= 1024 && i < 3) { v /= 1024; i++; } return (v >= 100 ? v.toFixed(0) : v.toFixed(1)) + ' ' + u[i]; };
const pad = n => n < 10 ? '0' + n : String(n);
const fmtTime = s => { if (!s) return ''; const d = new Date(s * 1000); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const modeStr = (mode, type) => { const n = parseInt(mode, 8) || 0; let s = type === 'dir' ? 'd' : (type === 'link' ? 'l' : '-'); [ 6, 3, 0 ].forEach(sh => { const b = (n >> sh) & 7; s += (b & 4 ? 'r' : '-') + (b & 2 ? 'w' : '-') + (b & 1 ? 'x' : '-'); }); return s; };
const nat = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const validName = v => !v ? T('名前を入力してください') : (v.includes('/') ? T('名前に / は使えません') : ((v === '.' || v === '..') ? T('この名前は使えません') : null));

function sortEntries(list, key, dir) {
	const f = dir === 'desc' ? -1 : 1;
	return list.slice().sort((a, b) => {
		const da = isDir(a) ? 0 : 1, db = isDir(b) ? 0 : 1;
		if (da !== db) return da - db;
		const r = key === 'size' ? (a.size || 0) - (b.size || 0) : (key === 'mtime' ? (a.mtime || 0) - (b.mtime || 0) : (key === 'mode' ? nat(a.mode || '', b.mode || '') : nat(a.name, b.name)));
		return (r || nat(a.name, b.name)) * f;
	});
}

function submitDownload(path, filename) {
	const f = document.createElement('form');
	f.method = 'post'; f.action = '/cgi-bin/cgi-download'; f.style.display = 'none';
	[ [ 'sessionid', getSid() ], [ 'path', path ], [ 'filename', filename ] ].forEach(([ n, v ]) => { const i = document.createElement('input'); i.type = 'hidden'; i.name = n; i.value = v; f.appendChild(i); });
	document.body.appendChild(f); f.submit(); setTimeout(() => f.remove(), 2000);
}

async function fetchBlob(path) {
	const r = await fetch('/cgi-bin/cgi-download', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'sessionid=' + encodeURIComponent(getSid()) + '&path=' + encodeURIComponent(path) });
	if (!r.ok) throw new Error(T('読み込めません (HTTP {code})', { code: r.status }));
	return r.blob();
}

/* ---- 小さな部品 ---- */

function InfoModal({ info, done }) {
	const en = info.entry, n0 = parseInt(en.mode, 8) || 0;
	const [bits, setBits] = useState(n0);
	const [oct, setOct] = useState(en.mode);
	const [rec, setRec] = useState(false);
	const setBitsAll = v => { setBits(v); setOct('0' + v.toString(8).padStart(3, '0')); };
	const kv = (k, v) => html`<div class="k">${k}</div><div class="v">${v}</div>`;
	return html`<div class="modal-bg" onClick=${e => { if (e.target === e.currentTarget) done(null); }}><div class="modal">
		<h2>${T('情報・権限')}</h2>
		<div class="fm-kv">${kv(T('名前'), en.name)}${kv(T('場所'), parentOf(info.path))}${kv(T('種類'), en.type === 'dir' ? T('フォルダ') : (en.type === 'link' ? T('シンボリックリンク → ') + en.target : T('ファイル')))}
			${kv(T('サイズ'), isDir(en) ? '-' : fmtSize(en.size) + ' (' + T('{n} バイト', { n: en.size }) + ')')}${kv(T('更新日時'), fmtTime(en.mtime))}${kv(T('最終アクセス'), fmtTime(info.atime))}
			${kv(T('所有者'), en.user + ' : ' + en.group + '  (uid ' + en.uid + ' / gid ' + en.gid + ')')}${kv('inode', String(info.inode))}</div>
		<strong>${T('権限')}</strong>
		<div class="fm-perm">${[ [ T('所有者'), 6 ], [ T('グループ'), 3 ], [ T('その他'), 0 ] ].map(([ label, sh ]) => html`<span class="h">${label}</span>${[ [ 4, T('読む') ], [ 2, T('書く') ], [ 1, T('実行') ] ].map(([ b, t ]) => html`<label><input type="checkbox" checked=${!!((bits >> sh) & b)} onChange=${e => setBitsAll(e.target.checked ? bits | (b << sh) : bits & ~(b << sh))} /> ${t}</label>`)}`)}</div>
		<div>${T('8 進数:')} <input type="text" class="in" style="width:6rem;font-family:monospace" value=${oct} onInput=${e => { setOct(e.target.value); if (/^[0-7]{3,4}$/.test(e.target.value)) setBits(parseInt(e.target.value, 8)); }} /></div>
		${isDir(en) ? html`<label class="chk"><input type="checkbox" checked=${rec} onChange=${e => setRec(e.target.checked)} /> ${T('サブフォルダ・中のファイルにも適用')}</label>` : null}
		<div class="modal-act"><button class="btn" onClick=${() => done(null)}>${T('閉じる')}</button><button class="btn primary" onClick=${() => done({ mode: oct, recursive: rec })}>${T('権限を適用')}</button></div>
	</div></div>`;
}

/* 右から出る、編集 / プレビューの枠 */
function Drawer({ d, onClose, toast, onSaved }) {
	const [text, setText] = useState('');
	const [orig, setOrig] = useState('');
	const [st, setSt] = useState({ loading: true });
	const [wrap, setWrap] = useState(false);
	const name = baseOf(d.path), isImg = IMAGE_EXT.includes(ext(name));
	const dirty = st.text && text !== orig;
	const imgInfo = useRef('');

	useEffect(() => {
		let url = null, dead = false;
		(async () => {
			try {
				if (isImg) { const b = await fetchBlob(d.path); if (dead) return; url = URL.createObjectURL(b); setSt({ img: url, size: b.size }); return; }
				const r = await call('read_text', { path: d.path });
				if (dead) return;
				if (r.binary) return setSt({ binary: true, size: r.size });
				setText(r.content); setOrig(r.content); setSt({ text: true, readonly: !!r.truncated });
			} catch (e) { if (!dead) setSt({ err: e.message }); }
		})();
		return () => { dead = true; if (url) URL.revokeObjectURL(url); };
	}, [d.path]);

	async function save() {
		if (st.readonly || !dirty) return;
		try { await call('write_text', { path: d.path, content: text }); setOrig(text); toast(T('保存しました: ') + name); onSaved(); } catch (e) { toast(e.message, 'ng'); }
	}
	const lines = text.split('\n').length;

	return html`<div class="fm-drawer open">
		<div class="fm-dhead"><${Ico} n=${isImg ? 'image' : 'text'} s=${20} /><div class="ttl" title=${d.path}>${name}</div>
			${dirty ? html`<span class="dirty">${T('● 未保存')}</span>` : null}
			${st.text ? html`<button class=${'btn' + (wrap ? ' on' : '')} title=${T('折り返し')} onClick=${() => setWrap(!wrap)}><${Ico} n="wrap" s=${16} /><span>${T('折り返し')}</span></button><button class="btn primary" disabled=${st.readonly || !dirty} onClick=${save}><${Ico} n="save" s=${16} /><span>${T('保存')}</span></button>` : null}
			<button class="btn" onClick=${() => submitDownload(d.path, name)}><${Ico} n="download" s=${16} /><span>${T('ダウンロード')}</span></button>
			<button class="btn icon" title=${T('閉じる')} onClick=${onClose}><${Ico} n="close" s=${16} /></button></div>
		${st.loading ? html`<div class="fm-note">${T('読み込んでいます…')}</div>` : null}
		${st.err ? html`<div class="fm-note">${tr(st.err)}</div>` : null}
		${st.binary ? html`<div class="fm-note"><p>${T('バイナリファイルは編集できません')}</p><p>${fmtSize(st.size)}</p></div>` : null}
		${st.img ? html`<div class="fm-preview"><img src=${st.img} alt=${name} onLoad=${e => { imgInfo.current = e.target.naturalWidth + ' × ' + e.target.naturalHeight + T(' ・ ') + fmtSize(st.size); }} /></div>` : null}
		${st.text ? html`${st.readonly ? html`<div class="fm-note warn">${T('大きいファイルのため、先頭 512KB だけを読み取り専用で表示')}</div>` : null}
			<div class="fm-dbody"><textarea class=${'fm-editor' + (wrap ? ' wrap' : '')} spellcheck="false" wrap="off" readOnly=${st.readonly} value=${text} autofocus
				onInput=${e => setText(e.target.value)}
				onKeyDown=${e => {
					if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
					else if (e.key === 'Tab' && !st.readonly) { e.preventDefault(); const t = e.target, s = t.selectionStart, en = t.selectionEnd, v = text.slice(0, s) + '\t' + text.slice(en); setText(v); requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 1; }); }
					else if (e.key === 'Escape') onClose();
				}}></textarea></div>
			<div class="fm-dfoot"><span>${lines} ${T('行 ・')} ${new Blob([ text ]).size} ${T('バイト ・ UTF-8')}</span><span>${st.readonly ? T('読み取り専用') : T('Ctrl+S で保存')}</span></div>` : null}
	</div>`;
}

/* ---- 本体 ---- */

function Page() {
	const [cwd, setCwd] = useState('/');
	const [entries, setEntries] = useState([]);
	const [truncated, setTruncated] = useState(false);
	const [sel, setSel] = useState(new Set());
	const [last, setLast] = useState(null);
	const [filter, setFilter] = useState('');
	const [sort, setSort] = useState({ key: 'name', dir: 'asc' });
	const [showHidden, setShowHidden] = useState(true);
	const [clip, setClip] = useState(null);
	const [busy, setBusy] = useState(false);
	const [toasts, setToasts] = useState([]);
	const [info, setInfo] = useState(null);
	const [drawer, setDrawer] = useState(null);
	const [disk, setDisk] = useState(null);
	const [ups, setUps] = useState([]);
	const [menu, setMenu] = useState(null);
	const [editing, setEditing] = useState(null);   // パス欄の編集
	const [dropOn, setDropOn] = useState(false);
	const [dropTo, setDropTo] = useState(null);
	const [side, setSide] = useState(() => { try { return localStorage.getItem('tachigui.fm.side') !== '0'; } catch (e) { return true; } });
	const toggleSide = () => setSide(v => { try { localStorage.setItem('tachigui.fm.side', v ? '0' : '1'); } catch (e) { /* 無視 */ } return !v; });
	const hist = useRef({ list: [], pos: -1 });
	const fileIn = useRef(null);
	const S = useRef({}); S.current = { cwd, entries, sel, clip, drawer };

	const toast = (t, k) => { const id = Math.random(); setToasts(l => [ ...l, { id, t, k } ]); setTimeout(() => setToasts(l => l.filter(x => x.id !== id)), k === 'ng' ? 6000 : 3200); };
	const fail = e => toast(e.message || String(e), 'ng');

	async function go(path, o) {
		o = o || {};
		setBusy(true); setMenu(null);
		try {
			const r = await call('list', { path });
			setCwd(r.path); setEntries(r.entries || []); setTruncated(!!r.truncated); setEditing(null);
			if (!o.keep) { setSel(new Set()); setLast(null); }
			const h = hist.current;
			if (o.history !== false && h.list[h.pos] !== r.path) { h.list = h.list.slice(0, h.pos + 1).concat(r.path); h.pos = h.list.length - 1; }
			try { sessionStorage.setItem('fm.path', r.path); } catch (e) { /* 無視 */ }
			call('diskinfo', { path: r.path }).then(setDisk).catch(() => setDisk(null));
		} catch (e) { fail(e); setEditing(null); }
		setBusy(false);
	}
	const refresh = () => go(S.current.cwd, { keep: true, history: false });
	const histGo = d => { const h = hist.current, i = h.pos + d; if (i < 0 || i >= h.list.length) return; h.pos = i; go(h.list[i], { history: false }); };

	useEffect(() => {
		let start = '/root'; try { start = sessionStorage.getItem('fm.path') || '/root'; } catch (e) { /* 無視 */ }
		call('list', { path: start }).then(() => go(start)).catch(() => go('/'));
		const close = () => setMenu(null);
		document.addEventListener('click', close); window.addEventListener('blur', close);
		return () => { document.removeEventListener('click', close); window.removeEventListener('blur', close); };
	}, []);

	const visible = sortEntries(entries.filter(e => (showHidden || e.name[0] !== '.') && (!filter || e.name.toLowerCase().includes(filter.toLowerCase()))), sort.key, sort.dir);
	const chosen = visible.filter(e => sel.has(e.name));
	const one = chosen.length === 1 ? chosen[0] : null;
	const pathOf = e => join(cwd, e.name);

	/* ---- 操作 ---- */
	async function act(fn, ok) { setBusy(true); try { const r = await fn(); if (ok) toast(ok); await refresh(); return r; } catch (e) { fail(e); await refresh().catch(() => {}); } finally { setBusy(false); } }

	async function newFolder() { const n = await prompt({ title: T('新しいフォルダ'), ok: T('作成') }); if (n == null) return; const er = validName(n); if (er) return toast(er, 'ng'); act(() => call('mkdir', { path: join(cwd, n) }), T('作成しました')); }
	async function newFile() { const n = await prompt({ title: T('新しいファイル'), ok: T('作成') }); if (n == null) return; const er = validName(n); if (er) return toast(er, 'ng'); act(() => call('newfile', { path: join(cwd, n) }), T('作成しました')); }
	async function renameSel() { if (!one) return; const n = await prompt({ title: T('名前の変更'), value: one.name, ok: T('変更') }); if (n == null || n === one.name) return; const er = validName(n); if (er) return toast(er, 'ng'); act(() => call('rename', { path: pathOf(one), name: n }), T('変更しました')); }
	async function deleteSel() {
		if (!chosen.length) return;
		const names = chosen.slice(0, 6).map(e => e.name).join(', ') + (chosen.length > 6 ? T(' ほか') : '');
		if (!await ask({ title: T('削除の確認'), body: T('{n} 件を削除します。元に戻せません。', { n: chosen.length }) + '\n' + names, ok: T('削除'), danger: true })) return;
		act(() => call('delete', { paths: chosen.map(pathOf) }), T('削除しました'));
	}
	const setClipFrom = mode => { if (!chosen.length) return; setClip({ mode, dir: cwd, names: chosen.map(e => e.name) }); toast(mode === 'cut' ? T('{n} 件を切り取りました', { n: chosen.length }) : T('{n} 件をコピーしました', { n: chosen.length })); };
	async function paste() {
		const c = S.current.clip; if (!c) return;
		const dups = entries.filter(e => c.names.includes(e.name) && c.dir === cwd);
		if (c.mode === 'cut' && c.dir === cwd) return toast(T('同じフォルダには移動できません'), 'ng');
		let overwrite = false;
		if (c.mode === 'copy' && c.dir === cwd && dups.length) toast(T('同じフォルダへのコピーは上書きになります'));
		const paths = c.names.map(n => join(c.dir, n));
		await act(() => call(c.mode === 'cut' ? 'move' : 'copy', { paths, dest: cwd, overwrite }), c.mode === 'cut' ? T('移動しました') : T('コピーしました'));
		if (c.mode === 'cut') setClip(null);
	}
	async function archiveSel() { if (!chosen.length) return; const r = await act(() => call('archive', { paths: chosen.map(pathOf), dest: '' })); if (r) { submitDownload(r.path, r.name); setTimeout(() => call('cleanup', { path: r.path }).catch(() => {}), 120000); } }
	const extractSel = () => one && act(() => call('extract', { path: pathOf(one), dest: cwd }), T('展開しました'));
	async function downloadSel() {
		if (!chosen.length) return;
		if (one && !isDir(one)) return submitDownload(pathOf(one), one.name);
		toast(T('圧縮しています…'));
		try { const r = await call('archive', { paths: chosen.map(pathOf), dest: '' }); submitDownload(r.path, r.name); setTimeout(() => call('cleanup', { path: r.path }).catch(() => {}), 120000); } catch (e) { fail(e); }
	}
	async function infoSel() {
		if (!one) return;
		try {
			const path = pathOf(one), r = await call('stat', { path });
			const v = await new Promise(done => setInfo({ ...r, path, done: x => { setInfo(null); done(x); } }));
			if (v) { if (!/^[0-7]{3,4}$/.test(v.mode)) return toast(T('権限は 8 進数で入力してください'), 'ng'); act(() => call('chmod', { path, mode: v.mode, recursive: v.recursive }), T('権限を変更しました')); }
		} catch (e) { fail(e); }
	}
	async function openEntry(e) {
		if (isDir(e)) return go(pathOf(e));
		if (drawer && drawer.dirty && !await ask({ title: T('保存していない変更があります'), body: T('別のファイルを開くと変更は失われます'), ok: T('保存せずに開く'), danger: true })) return;
		setDrawer({ path: pathOf(e) });
	}

	async function upload(files) {
		if (!files.length) return;
		const dup = files.filter(f => entries.some(e => e.name === f.name));
		if (dup.length && !await ask({ title: T('上書きの確認'), body: T('すでにあります。上書きしますか?') + '\n' + dup.slice(0, 6).map(f => f.name).join(', ') + (dup.length > 6 ? ' ' + T('ほか') : ''), ok: T('上書き'), danger: true })) files = files.filter(f => !dup.includes(f));
		const dir = cwd;
		await Promise.all(files.map(file => new Promise(resolve => {
			const id = Math.random();
			const setP = p => setUps(u => u.some(x => x.id === id) ? u.map(x => x.id === id ? { ...x, ...p } : x) : [ ...u, { id, name: file.name, pct: 0, ...p } ]);
			setP({});
			const fd = new FormData();
			fd.append('sessionid', getSid()); fd.append('filename', join(dir, file.name)); fd.append('filedata', file);
			const xhr = new XMLHttpRequest();
			xhr.open('POST', '/cgi-bin/cgi-upload');
			xhr.upload.onprogress = ev => { if (ev.lengthComputable) setP({ pct: Math.round(ev.loaded / ev.total * 100) }); };
			xhr.onload = () => { let r = null; try { r = JSON.parse(xhr.responseText); } catch (e) { /* 無視 */ } const ok = xhr.status === 200 && !(r && r.failure); setP({ pct: 100, done: ok ? 'ok' : 'ng' }); if (!ok) toast(file.name + ': ' + ((r && r.message) || (xhr.status === 403 ? T('権限がありません') : 'HTTP ' + xhr.status)), 'ng'); resolve(); };
			xhr.onerror = () => { setP({ done: 'ng' }); toast(T('{name}: 通信に失敗しました', { name: file.name }), 'ng'); resolve(); };
			xhr.send(fd);
		})));
		if (dir === S.current.cwd) refresh();
		toast(T('アップロードが完了しました'));
		setTimeout(() => setUps([]), 3500);
	}

	/* 行や場所へのドロップ (移動) */
	function dropProps(destPath) {
		return {
			onDragOver: e => { if (e.dataTransfer && [ ...e.dataTransfer.types ].includes('text/x-fm')) { e.preventDefault(); setDropTo(destPath); } },
			onDragLeave: () => setDropTo(null),
			onDrop: e => {
				setDropTo(null);
				const raw = e.dataTransfer && e.dataTransfer.getData('text/x-fm');
				if (!raw) return;
				e.preventDefault(); e.stopPropagation();
				const d = JSON.parse(raw);
				if (d.dir === destPath) return;
				act(() => call('move', { paths: d.names.map(n => join(d.dir, n)), dest: destPath, overwrite: false }), T('移動しました'));
			}
		};
	}

	/* キーボード */
	useEffect(() => {
		const onKey = ev => {
			const t = ev.target;
			if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
			if (document.querySelector('.modal-bg')) return;
			const mod = ev.ctrlKey || ev.metaKey, k = ev.key.toLowerCase();
			if (ev.key === 'Delete' && chosen.length) { ev.preventDefault(); deleteSel(); }
			else if (ev.key === 'F2' && one) { ev.preventDefault(); renameSel(); }
			else if (ev.key === 'Enter' && one) { ev.preventDefault(); openEntry(one); }
			else if (ev.key === 'Backspace') { ev.preventDefault(); go(parentOf(cwd)); }
			else if (ev.key === 'Escape') { setMenu(null); setSel(new Set()); }
			else if (mod && k === 'a') { ev.preventDefault(); setSel(new Set(visible.map(e => e.name))); }
			else if (mod && k === 'c' && chosen.length) setClipFrom('copy');
			else if (mod && k === 'x' && chosen.length) setClipFrom('cut');
			else if (mod && k === 'v' && clip) paste();
		};
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	});

	const rowClick = (ev, e) => {
		if (isDir(e) && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey && ev.target.closest && ev.target.closest('.fm-name')) return go(pathOf(e));
		if (ev.shiftKey && last) {
			const names = visible.map(x => x.name), a = names.indexOf(last), b = names.indexOf(e.name);
			if (a >= 0 && b >= 0) { const s = ev.ctrlKey || ev.metaKey ? new Set(sel) : new Set(); names.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(n => s.add(n)); setSel(s); }
		}
		else if (ev.ctrlKey || ev.metaKey) { const s = new Set(sel); if (s.has(e.name)) s.delete(e.name); else s.add(e.name); setSel(s); setLast(e.name); }
		else { setSel(new Set([ e.name ])); setLast(e.name); }
	};
	const sortBy = key => setSort(s => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));
	const Th = (k, label, cls) => html`<th class=${'sortable ' + (cls || '')} onClick=${() => sortBy(k)}>${label}${sort.key === k ? html`<${Ico} n=${sort.dir === 'asc' ? 'sortUp' : 'sortDown'} s=${12} />` : null}</th>`;
	const Btn = (id, ico, label, fn, show, cls) => show === false ? null : html`<button class=${'btn icon ' + (cls || '')} title=${label} aria-label=${label} onClick=${e => { e.stopPropagation(); fn(e); }}><${Ico} n=${ico} s=${16} /></button>`;

	const crumbs = cwd === '/' ? [] : cwd.split('/').slice(1);
	const showMenuAt = (e, onItem, x, y) => { e.preventDefault(); setMenu({ x, y, onItem }); };
	const pct = disk && disk.total ? Math.round(disk.used / disk.total * 100) : 0;

	return html`<div class="fm" onClick=${() => setMenu(null)}>
		${info ? html`<${InfoModal} info=${info} done=${info.done} />` : null}
		${drawer ? html`<${Drawer} d=${drawer} onClose=${() => setDrawer(null)} toast=${toast} onSaved=${refresh} />` : null}

		<div class="card fm-toolbar"><div class="fm-bar">
			${Btn('side', 'panel', side ? T('場所を閉じる') : T('場所を開く'), toggleSide, true, side ? 'on' : '')} ${Btn('back', 'back', T('戻る'), () => histGo(-1))} ${Btn('up', 'up', T('上のフォルダ'), () => go(parentOf(cwd)))} ${Btn('refresh', 'refresh', T('更新'), refresh)}
			<div class="fm-path" onClick=${() => setEditing(cwd)}>
				${editing != null ? html`<input type="text" value=${editing} spellcheck="false" autofocus ref=${el => el && !el._f && (el._f = 1, el.focus(), el.select())} onInput=${e => setEditing(e.target.value)} onBlur=${() => setEditing(null)}
					onKeyDown=${e => { if (e.key === 'Enter') go(editing.trim() || '/'); else if (e.key === 'Escape') setEditing(null); }} />`
				: html`<span class="seg" onClick=${e => { e.stopPropagation(); go('/'); }}>/</span>${crumbs.map((c, i) => html`${i ? html`<span class="sl">/</span>` : null}<span class=${'seg' + (i === crumbs.length - 1 ? ' last' : '')} onClick=${e => { e.stopPropagation(); go('/' + crumbs.slice(0, i + 1).join('/')); }}>${c}</span>`)}`}
			</div>
			<span class="fm-grp">${Btn('newDir', 'folderPlus', T('新規フォルダ'), newFolder)}${Btn('newFile', 'filePlus', T('新規ファイル'), newFile)}${Btn('upload', 'upload', T('アップロード'), () => fileIn.current.click(), true, 'primary')}</span>
			<span class="fm-grp">${Btn('hidden', showHidden ? 'eyeOff' : 'eye', showHidden ? T('隠しファイルを表示中 (クリックで非表示)') : T('隠しファイルは非表示 (クリックで表示)'), () => setShowHidden(!showHidden), true, showHidden ? 'on' : '')}</span>
			<input type="search" class="fm-search" placeholder=${T('このフォルダ内を検索')} autocomplete="off" value=${filter} onInput=${e => setFilter(e.target.value)} />
			<input type="file" multiple hidden ref=${fileIn} onChange=${e => { upload([ ...e.target.files ]); e.target.value = ''; }} />
		</div></div>

		<div class="fm-layout card">
			${side ? html`<div class="fm-side"><h2>${T('場所')}</h2>
				${BOOKMARKS.map(b => html`<div class=${'item' + ((b.path === '/' ? cwd === '/' : (cwd === b.path || cwd.startsWith(b.path + '/'))) ? ' active' : '') + (dropTo === b.path ? ' drop' : '')} onClick=${() => go(b.path)} ...${dropProps(b.path)}><${Ico} n=${b.ico} s=${18} /><span>${b.label}</span></div>`)}
				${disk ? html`<div class="fm-disk"><div>${disk.mount}</div><div class="fm-meter"><i class=${pct > 90 ? 'warn' : ''} style=${'width:' + pct + '%'}></i></div><div>${fmtSize(disk.used)} / ${fmtSize(disk.total)} ${T('(空き')} ${fmtSize(disk.avail)})</div></div>` : null}
			</div>` : null}

			<div class=${'fm-main' + (busy ? ' fm-load' : '')}
				onDragEnter=${e => { if ([ ...(e.dataTransfer.types || []) ].includes('Files')) setDropOn(true); }}
				onDragOver=${e => { if ([ ...(e.dataTransfer.types || []) ].includes('Files')) e.preventDefault(); }}
				onDragLeave=${e => { if (e.currentTarget === e.target) setDropOn(false); }}
				onDrop=${e => { setDropOn(false); const f = [ ...(e.dataTransfer.files || []) ]; if (f.length) { e.preventDefault(); upload(f); } }}
				onContextMenu=${e => { if (e.target.closest && e.target.closest('tr.row')) return; showMenuAt(e, false, e.clientX, e.clientY); }}>
				${dropOn ? html`<div class="fm-drop on"><span>${T('ここにドロップしてアップロード')}</span></div>` : null}
				<div class="fm-scroll"><table class="fm-table">
					<thead><tr><th class="c"><input type="checkbox" checked=${visible.length > 0 && chosen.length === visible.length} onChange=${e => setSel(e.target.checked ? new Set(visible.map(x => x.name)) : new Set())} /></th>
						${Th('name', T('名前'))}${Th('size', T('サイズ'), 'hide-s')}${Th('mtime', T('更新日時'), 'hide-s')}${Th('mode', T('権限'), 'hide-m')}<th class="hide-m">${T('所有者')}</th></tr></thead>
					<tbody>${visible.map(e => { const k = kindOf(e), cut = clip && clip.mode === 'cut' && clip.dir === cwd && clip.names.includes(e.name); return html`
						<tr class=${'row' + (sel.has(e.name) ? ' sel' : '') + (cut ? ' cut' : '') + (dropTo === pathOf(e) ? ' drop' : '')} draggable="true" onClick=${ev => rowClick(ev, e)} onDblClick=${() => openEntry(e)}
							onContextMenu=${ev => { if (!sel.has(e.name)) { setSel(new Set([ e.name ])); setLast(e.name); } showMenuAt(ev, true, ev.clientX, ev.clientY); }}
							onDragStart=${ev => { const names = sel.has(e.name) ? [ ...sel ] : [ e.name ]; if (!sel.has(e.name)) setSel(new Set([ e.name ])); ev.dataTransfer.setData('text/x-fm', JSON.stringify({ dir: cwd, names })); ev.dataTransfer.effectAllowed = 'move'; }}
							...${isDir(e) ? dropProps(pathOf(e)) : {}}>
							<td class="c"><input type="checkbox" checked=${sel.has(e.name)} onClick=${ev => ev.stopPropagation()} onChange=${ev => { const s = new Set(sel); if (ev.target.checked) s.add(e.name); else s.delete(e.name); setSel(s); setLast(e.name); }} /></td>
							<td class="name"><span class=${'fm-name' + (isDir(e) ? ' dir' : '')}><${Ico} n=${k} s=${20} cls=${'k-' + k} /><span class="t">${e.name}</span>${e.type === 'link' ? html`<span class="tgt">→ ${e.target}</span>` : null}</span></td>
							<td class="num hide-s">${isDir(e) ? '' : fmtSize(e.size)}</td><td class="hide-s">${fmtTime(e.mtime)}</td><td class="mono hide-m">${modeStr(e.mode, e.type)} ${e.mode}</td><td class="hide-m">${e.user}:${e.group}</td></tr>`; })}
					</tbody></table>
					${!visible.length ? html`<div class="fm-empty">${busy ? T('読み込んでいます…') : (filter ? T('一致する項目がありません') : T('空のフォルダです'))}</div>` : null}
				</div>
				<div class="fm-foot">
					<span>${T('{n} 件', { n: visible.length })}${chosen.length ? ' ' + T('({n} 件を選択)', { n: chosen.length }) : ''}${truncated ? T(' / 多いので一部だけ表示') : ''}</span>
					<div class="fm-acts">
						<span class="fm-grp">${Btn('dl', 'download', T('ダウンロード'), downloadSel, chosen.length > 0)}${Btn('rn', 'edit', T('名前変更'), renameSel, !!one)}</span>
						<span class="fm-grp">${Btn('cp', 'copy', T('コピー'), () => setClipFrom('copy'), chosen.length > 0)}${Btn('ct', 'cut', T('切り取り'), () => setClipFrom('cut'), chosen.length > 0)}${Btn('ps', 'paste', clip ? T('貼り付け ({n} 個)', { n: clip.names.length }) : T('貼り付け'), paste, !!clip)}</span>
						<span class="fm-grp">${Btn('ar', 'archive', T('圧縮 (tar.gz)'), archiveSel, chosen.length > 0)}${Btn('ex', 'unarchive', T('ここに展開'), extractSel, !!(one && one.type !== 'dir' && EXTRACT_RE.test(one.name)))}${Btn('in', 'info', T('情報・権限'), infoSel, !!one)}${Btn('del', 'trash', T('削除'), deleteSel, chosen.length > 0, 'is-del')}</span>
					</div>
				</div>
			</div>
		</div>

		${menu ? html`<div class="fm-menu" style=${'left:' + menu.x + 'px;top:' + menu.y + 'px'} onClick=${e => e.stopPropagation()}>
			${(() => {
				const mi = (ico, label, fn, cls, dis) => html`<div class=${'mi ' + (cls || '') + (dis ? ' dis' : '')} onClick=${() => { setMenu(null); fn(); }}><${Ico} n=${ico} s=${16} />${label}</div>`;
				return menu.onItem && chosen.length ? html`${mi('eye', T('開く'), () => openEntry(one || chosen[0]), '', !one)}${mi('download', T('ダウンロード'), downloadSel)}<hr />${mi('edit', T('名前変更'), renameSel, '', !one)}${mi('copy', T('コピー'), () => setClipFrom('copy'))}${mi('cut', T('切り取り'), () => setClipFrom('cut'))}${mi('archive', T('圧縮 (tar.gz)'), archiveSel)}${one && EXTRACT_RE.test(one.name) ? mi('archive', T('ここに展開'), extractSel) : null}${mi('info', T('情報・権限'), infoSel, '', !one)}<hr />${mi('trash', T('削除'), deleteSel, 'is-del')}`
					: html`${mi('folderPlus', T('新規フォルダ'), newFolder)}${mi('filePlus', T('新規ファイル'), newFile)}${mi('upload', T('アップロード'), () => fileIn.current.click())}${mi('paste', clip ? T('貼り付け ({n})', { n: clip.names.length }) : T('貼り付け'), paste, '', !clip)}<hr />${mi('refresh', T('更新'), refresh)}`;
			})()}</div>` : null}

		${ups.length ? html`<div class="fm-up"><strong>${T('アップロード')}</strong>${ups.map(u => html`<div class="u"><div class="n"><span>${u.name}</span><span>${u.done === 'ok' ? T('完了') : (u.done === 'ng' ? T('失敗') : u.pct + '%')}</span></div><div class="fm-meter"><i style=${'width:' + u.pct + '%' + (u.done === 'ng' ? ';background:#f87171' : '')}></i></div></div>`)}</div>` : null}
		<div class="fm-toasts">${toasts.map(t => html`<div class=${'fm-toast ' + (t.k || 'ok')}>${t.t}</div>`)}</div>
	</div>`;
}

export function mount(root) {
	root.appendChild(Object.assign(document.createElement('div'), { className: 'page-title', innerHTML: '<h1>' + T('ファイルマネージャー') + '</h1>' }));
	const host = document.createElement('div');
	root.appendChild(host);
	root.classList.add('full');   /* 画面の高さいっぱいに使う */
	render(html`<${Page} />`, host);
	return { stop() { render(null, host); root.classList.remove('full'); } };
}
