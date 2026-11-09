/* 骨組み: ログイン、メニュー、ページの切り替え */
import { T, tr } from './i18n.js';
import { login, logout, ssoSession, dropSession, hasSession, primeLuci, rpc, sys, AuthError } from './api.js';
import { h, clear, icon } from './util.js';
import * as theme from './theme.js';
import * as alerts from './alerts.js';
import { ask } from './dialog.js';
import { install as installSelect } from './select.js';
import { install as installTooltip } from './tooltip.js';
import { VERSION } from './version.js';

/* group: サイドバーの見出し (GL.iNet の管理パネルに、ならった並び) */
/* tabs: 同じ値のページは、メニューの 1 項目にまとめて、タブで切り替える (値がメニューの名前) */
const SETTINGS = T('設定');
const NET = T('ネットワーク設定');
/* ページのモジュールにも、この app.js と同じ番号を付ける (付けないと、更新後も古いページがキャッシュから読まれる) */
const VER = new URL(import.meta.url).search;
const PAGES = [
	{ id: 'internet', title: T('インターネット'), icon: 'globe', load: () => import('./pages/internet.js' + VER) },
	{ id: 'clients', title: T('クライアント'), icon: 'devices', load: () => import('./pages/clients.js' + VER) },
	{ id: 'network', title: T('ネットワーク設定'), tabs: NET, icon: 'network', load: () => import('./pages/network.js' + VER) },
	{ id: 'wifi', title: 'Wi-Fi', tabs: NET, load: () => import('./pages/wifi.js' + VER) },
	{ id: 'firewall', title: T('ファイアウォール'), icon: 'wall', load: () => import('./pages/firewall.js' + VER) },
	{ id: 'speedtest', title: T('スピードテスト'), tabs: T('テスト'), icon: 'gauge', group: T('アプリケーション'), load: () => import('./pages/speedtest.js' + VER) },
	{ id: 'nettest', title: T('接続テスト'), tabs: T('テスト'), group: T('アプリケーション'), load: () => import('./pages/nettest.js' + VER) },
	{ id: 'files', title: T('ファイルマネージャー'), icon: 'folder', group: T('アプリケーション'), load: () => import('./pages/files.js' + VER) },
	{ id: 'overview', title: T('概要'), tabs: T('概要'), icon: 'cog', group: T('システム'), load: () => import('./pages/overview.js' + VER) },
	{ id: 'security', title: T('セキュリティ'), tabs: T('概要'), group: T('システム'), load: () => import('./pages/security.js' + VER) },
	{ id: 'settings', title: T('基本設定'), tabs: SETTINGS, icon: 'sliders', group: T('システム'), load: () => import('./pages/settings.js' + VER) },
	{ id: 'admin', title: T('管理アクセス'), tabs: SETTINGS, group: T('システム'), load: () => import('./pages/admin.js' + VER) },
	{ id: 'schedule', title: T('スケジュール'), tabs: SETTINGS, group: T('システム'), load: () => import('./pages/schedule.js' + VER) },
	{ id: 'led', title: 'LED', tabs: SETTINGS, group: T('システム'), load: () => import('./pages/led.js' + VER) },
	{ id: 'appearance', title: T('外観'), tabs: SETTINGS, group: T('システム'), load: () => import('./pages/appearance.js' + VER) },
	{ id: 'logs', title: T('ログ'), icon: 'log', group: T('システム'), load: () => import('./pages/logs.js' + VER) }
];

/* 追加機能: 本体のパッケージには入れない。別のパッケージが入れた JS があるときだけ、after のページの次に出す */
const ADDONS = [
	{ id: 'screen', title: T('AP の画面'), icon: 'screen', group: T('アプリケーション'), after: 'files', url: './addons/screen.js' }
];
let addonsFound = false;
async function findAddons() {
	if (addonsFound) return;
	addonsFound = true;
	for (const a of ADDONS) {
		const url = new URL(a.url, import.meta.url);
		const ok = await fetch(url, { method: 'HEAD', cache: 'no-store' }).then(r => r.ok).catch(e => { console.warn('追加機能を確かめられません', a.id, e); return false; });
		if (ok) PAGES.splice(PAGES.findIndex(p => p.id === a.after) + 1, 0, { ...a, load: () => import(a.url + VER) });
	}
}

const $app = document.getElementById('app');
let current = null;
let host = '', verLabel = '';
let monitor = null, alertOpen = false, lastAlerts = [];

function store(key, val) { try { if (val === undefined) return localStorage.getItem(key); localStorage.setItem(key, val); } catch (e) { return null; } }

/* ---- ログイン ---- */
function showLogin(msg) {
	if (current) { current.stop(); current = null; }
	if (monitor) { monitor.stop(); monitor = null; }
	const user = h('input', { type: 'text', value: 'root', autocomplete: 'username', spellcheck: 'false' });
	const pass = h('input', { type: 'password', autocomplete: 'current-password', spellcheck: 'false' });
	/* 目のボタンで、入力した文字の表示を切り替える */
	const eye = h('button', { type: 'button', class: 'pweye', title: T('パスワードを表示'), 'aria-pressed': 'false', onclick: ev => {
		ev.preventDefault();
		const show = pass.type === 'password';
		pass.type = show ? 'text' : 'password';
		eye.title = show ? T('パスワードを隠す') : T('パスワードを表示');
		eye.setAttribute('aria-pressed', String(show));
		clear(eye).appendChild(icon(show ? 'eyeoff' : 'eye', 16));
	} }, icon('eye', 16));
	const err = h('div', { class: 'login-err' }, msg || '');
	const btn = h('button', { class: 'btn primary', type: 'submit' }, T('ログイン'));
	const form = h('form', { class: 'login-card', onsubmit: async ev => {
		ev.preventDefault();
		btn.disabled = true; err.textContent = '';
		try { await login(user.value, pass.value); start(); }
		catch (e) { err.textContent = e instanceof AuthError ? T('ユーザー名かパスワードが違います') : e.message; btn.disabled = false; pass.select(); }
	} }, h('h1', null, icon('bowl', 26), 'TachiGUI'), h('p', { class: 'tagline' }, 'Standing room only.'), h('label', null, T('ユーザー名'), user), h('label', null, T('パスワード'), h('span', { class: 'pwbox' }, pass, eye)), err, btn,
		h('a', { class: 'switch', href: '/cgi-bin/luci', target: '_blank', rel: 'noopener' }, T('LuCI で開く')));
	clear($app).appendChild(h('div', { class: 'login' }, form));
	setTimeout(() => pass.focus(), 0);
}

/* ---- 本体の枠 ---- */
/* ---- 重大な問題の表示 (ヘッダー) ---- */
const alertEl = h('div', { class: 'alerts' });
function drawAlerts(list) {
	lastAlerts = list;
	clear(alertEl);
	if (!list.length) { alertOpen = false; return; }
	const ng = list.filter(a => a.level === 'ng');
	const first = ng[0] || list[0];
	const more = list.length - 1;
	const chip = h('button', { class: 'alertchip ' + (ng.length ? 'ng' : 'warn'), title: T('一覧を表示'), onclick: e => { e.stopPropagation(); alertOpen = !alertOpen; drawAlerts(list); } },
		icon('alert', 16), h('span', null, first.title + (more > 0 ? '  ' + T('ほか {n} 件', { n: more }) : '')));
	alertEl.appendChild(chip);
	if (alertOpen)
		alertEl.appendChild(h('div', { class: 'alertpop', onclick: e => e.stopPropagation() }, list.map(a =>
			h('a', { class: 'alertitem ' + a.level, href: '#/' + a.page, onclick: () => { alertOpen = false; drawAlerts(list); } }, h('strong', null, a.title), a.hint ? h('small', null, a.hint) : null))));
}
document.addEventListener('click', () => { if (alertOpen) { alertOpen = false; drawAlerts(lastAlerts); } });

/* ヘッダーの再起動ボタン */
async function rebootRouter() {
	if (!await ask({ title: T('ルーターを再起動します'), body: T('LAN の端末は数分インターネットにつながりません'), ok: T('再起動'), danger: true })) return;
	try { await rpc('system', 'reboot'); }
	catch (e) { alert(T('再起動できませんでした: ') + e.message); return; }
	document.body.appendChild(h('div', { class: 'rebooting' }, h('div', null, icon('power', 36)), h('p', null, T('再起動しています。1〜2 分後に開き直してください'))));
}

function shell() {
	const side = h('nav', { class: 'side' });
	const main = h('main', { class: 'main' });
	const mini = store('tachigui.mini') === '1';
	const frame = h('div', { class: 'frame' + (mini ? ' mini' : '') },
		h('header', { class: 'top' },
			h('button', { class: 'btn icon', title: T('メニューの開閉'), onclick: () => { frame.classList.toggle('mini'); store('tachigui.mini', frame.classList.contains('mini') ? '1' : '0'); } }, icon('menu', 18)),
			h('div', { class: 'brand' }, icon('bowl', 20), h('span', VERSION ? { title: 'TachiGUI ' + VERSION } : null, 'TachiGUI'), h('small', { title: verLabel.full || '' }, verLabel.text || host)),
			alertEl,
			h('div', { class: 'grow' }),
			h('a', { class: 'btn icon', href: '/cgi-bin/luci', target: '_blank', rel: 'noopener', onclick: primeLuci, title: T('LuCI を開く') }, icon('swap', 18)),
			h('button', { class: 'btn icon', title: T('再起動'), onclick: rebootRouter }, icon('power', 18)),
			h('button', { class: 'btn icon', title: T('ログアウト'), onclick: async () => { await logout(); showLogin(); } }, icon('out', 18))),
		side, main);
	let grp = null;
	PAGES.forEach(p => {
		if (p.group && p.group !== grp) side.appendChild(h('div', { class: 'navgrp' }, p.group));
		grp = p.group || null;
		if (p.tabs && PAGES.find(x => x.tabs === p.tabs) !== p) return;     // まとめた項目は、先頭のページだけメニューに出す
		const label = p.tabs || p.title;
		side.appendChild(h('a', { href: '#/' + p.id, class: 'nav', 'data-id': label, title: label }, icon(p.icon, 18), h('span', null, label)));
	});
	clear($app).appendChild(frame);
	return { side, main };
}

let ui = null;

async function route() {
	if (!ui) return;
	const id = (location.hash.match(/^#\/(\w+)/) || [])[1] || 'internet';
	const page = PAGES.find(p => p.id === id) || PAGES[0];
	if (current) { current.stop(); current = null; }
	ui.side.querySelectorAll('.nav').forEach(a => a.classList.toggle('active', a.dataset.id === (page.tabs || page.title)));
	document.title = page.title + ' - TachiGUI';
	clear(ui.main);
	if (page.tabs) ui.main.appendChild(h('div', { class: 'pagetabs' }, PAGES.filter(p => p.tabs === page.tabs).map(p => h('a', { href: '#/' + p.id, class: 'pagetab' + (p === page ? ' on' : '') }, p.title))));
	try {
		const mod = await page.load();
		current = mod.mount(ui.main, { relogin: showLogin }) || null;
	} catch (e) {
		if (e instanceof AuthError) return showLogin(T('ログインの有効期限が切れました'));
		ui.main.appendChild(h('p', { class: 'warn-box' }, T('ページを開けませんでした: ') + e.message));
	}
}

async function start(tried) {
	try {
		const b = await sys.board();
		host = b.hostname || '';
		const v = (b.release && b.release.version) || '';
		verLabel = { text: (host === 'OpenWrt' || !host ? 'OpenWrt' : host + ' · OpenWrt') + (v ? ' ' + v : ''), full: (b.release && b.release.description) || '' };
	} catch (e) {
		if (e instanceof AuthError) {
			/* このブラウザの、セッションが、切れていたら、LuCI で、ログイン中か、探す (1 回だけ) */
			dropSession();
			if (!tried && await ssoSession()) return start(true);
			return showLogin();
		}
		return showLogin(e.message || '');
	}
	await findAddons();
	ui = shell();
	if (monitor) monitor.stop();
	monitor = alerts.start(drawAlerts);
	await route();
}

/* どこかの、通信が、権限エラーになったら、ログインに戻る */
window.addEventListener('unhandledrejection', ev => { if (ev.reason instanceof AuthError) { ev.preventDefault(); showLogin(T('ログインの有効期限が切れました')); } });
window.addEventListener('hashchange', route);

theme.load();
installSelect();
installTooltip();

(async () => {
	/* 保存したセッションが、なければ、LuCI のログインを、探す */
	if (!hasSession()) await ssoSession();
	if (hasSession()) start(); else showLogin();
})();
