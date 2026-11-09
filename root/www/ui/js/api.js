import { T, tr } from './i18n.js';
/* ubus (JSON-RPC) への入り口。LuCI には、依存しない。 */

const NULL_SID = '00000000000000000000000000000000';
let sid = null;
try { sid = sessionStorage.getItem('tachigui.sid'); } catch (e) { /* 保存できなくても動く */ }

export class AuthError extends Error {}

export function hasSession() { return !!sid; }
export function getSid() { return sid; }

export async function rpc(object, method, params, session) {
	const res = await fetch('/ubus', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'call', params: [ session || sid || NULL_SID, object, method, params || {} ] })
	});
	if (!res.ok)
		throw new Error('HTTP ' + res.status);
	const j = await res.json();
	if (j.error)
		throw new Error(j.error.message || T('RPC エラー'));
	const r = j.result;
	if (!Array.isArray(r))
		throw new Error(T('応答を読めません'));
	if (r[0] === 6)
		throw new AuthError('permission denied');
	if (r[0] !== 0)
		throw new Error(T('{call} が失敗しました ({code})', { call: object + '.' + method, code: r[0] }));
	return r[1] || {};
}

/*
 * ログインは、LuCI と、共通にする。
 *  - LuCI のログイン (POST /cgi-bin/luci/…) で、ブラウザに、LuCI のクッキーが、入る。
 *  - LuCI のページの中に、セッション ID が、書かれている (L = new LuCI({ …, "sessionid": "…" }))。それを、取り出して、ubus に使う。
 *  → どちらで、ログインしても、もう一方は、ログイン不要になる。
 */
const LUCI_PAGE = '/cgi-bin/luci/admin/status/overview';

function extractSid(html) {
	const m = /"sessionid"\s*:\s*"([0-9a-f]{32})"/.exec(html);
	return m ? m[1] : null;
}

function keep(id) {
	sid = id;
	try { sessionStorage.setItem('tachigui.sid', id); } catch (e) { /* 無視 */ }
}

/* LuCI で、すでに、ログインしていれば、そのセッション ID を、使う */
export async function ssoSession() {
	try {
		const r = await fetch(LUCI_PAGE, { credentials: 'same-origin' });
		const id = extractSid(await r.text());
		if (id) { keep(id); return id; }
	} catch (e) { /* 無視 */ }
	return null;
}

/*
 * ログイン: ルーターの認証 (rpcd の session login) に、直接、つなぐ。LuCI の画面は、通らない。
 * そのあと、LuCI も、同じセッションで入れるように、LuCI 用の Cookie と、セッションの情報を入れる (ログインの共通化)。
 */
const DEFAULT_TIME = 3600;     // LuCI の初期値と同じ

/* ログインの有効時間 (「管理アクセス」の設定。LuCI と同じ luci.sauth.sessiontime)。読めなければ null */
async function sessionTime(id) {
	try {
		const r = await rpc('uci', 'get', { config: 'luci', section: 'sauth', option: 'sessiontime' }, id);
		const n = +r.value;
		return n >= 60 ? n : null;
	} catch (e) {
		console.warn('api: ログインの有効時間を読めません (' + DEFAULT_TIME + ' 秒のまま)', e);
		return null;
	}
}

export async function login(username, password) {
	const r = await rpc('session', 'login', { username: username, password: password, timeout: DEFAULT_TIME }, NULL_SID);   // パスワードが違うと、AuthError
	let id = r.ubus_rpc_session;
	if (!id)
		throw new AuthError(T('ユーザー名かパスワードが違います。'));
	/* 有効時間を設定に合わせる。設定はログインしないと読めないので、読んでから、その時間でログインし直す (最初のセッションは消す) */
	const t = await sessionTime(id);
	if (t && t !== DEFAULT_TIME) {
		try {
			const r2 = await rpc('session', 'login', { username: username, password: password, timeout: t }, NULL_SID);
			if (r2.ubus_rpc_session) {
				await rpc('session', 'destroy', {}, id).catch(e => console.warn('api: 最初のセッションを消せません', e));
				id = r2.ubus_rpc_session;
			}
		} catch (e) { console.warn('api: 有効時間を合わせられません (' + DEFAULT_TIME + ' 秒のまま)', e); }
	}
	keep(id);
	await shareWithLuci(id, username, password);
	return id;
}

async function shareWithLuci(id, username, password) {
	/* 古い LuCI のログインが残っていると、Cookie を上書きできないので、先に消す */
	try { await fetch('/cgi-bin/luci/admin/logout', { credentials: 'same-origin', redirect: 'manual' }); } catch (e) { /* 無視 */ }
	try {
		const tok = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
		await rpc('session', 'set', { values: { username: username, token: tok } }, id);   /* 対象のセッションは、呼び出しのセッションそのもの */
		primeLuci();
	} catch (e) {
		/* セッションに情報を足せないときは、LuCI にも、同じ内容でログインして、Cookie をもらう */
		try { await fetch(LUCI_PAGE, { method: 'POST', body: new URLSearchParams({ luci_username: username, luci_password: password }), credentials: 'same-origin' }); } catch (e2) { /* 共通化できなくても、TachiGUI には入れる */ }
	}
}

export async function logout() {
	try { await fetch('/cgi-bin/luci/admin/logout', { credentials: 'same-origin' }); } catch (e) { /* 無視 */ }
	sid = null;
	try { sessionStorage.removeItem('tachigui.sid'); } catch (e) { /* 無視 */ }
}

/* LuCI へ移る前に、持っているセッション ID を、LuCI の Cookie として、入れておく (LuCI のログイン画面を、出さないため) */
export function primeLuci() {
	if (!sid) return;
	const https = location.protocol === 'https:';
	try { document.cookie = (https ? 'sysauth_https=' : 'sysauth_http=') + sid + '; path=/cgi-bin/luci; SameSite=Strict' + (https ? '; Secure' : ''); } catch (e) { /* 無視 */ }
}

export function dropSession() {
	sid = null;
	try { sessionStorage.removeItem('tachigui.sid'); } catch (e) { /* 無視 */ }
}

/* 便利な呼び出し */
export const sys = {
	info: () => rpc('system', 'info'),
	board: () => rpc('system', 'board'),
	ifaces: () => rpc('network.interface', 'dump').then(r => r.interface || []),
	device: name => rpc('network.device', 'status', { name: name }),
	/* 端末の一覧は、取るたびに、ルーターの中で、小さな更新が走り、ログが増える。20 秒は、使い回す */
	hostHints: () => {
		const now = Date.now();
		if (!sys._hh || now - sys._hh.t > 20000) sys._hh = { t: now, p: rpc('luci-rpc', 'getHostHints').catch(e => { sys._hh = null; throw e; }) };
		return sys._hh.p;
	},
	network: () => rpc('tachigui.network', 'status'),
	read: path => rpc('file', 'read', { path: path }).then(r => String(r.data || '')),
	exec: (command, params) => rpc('file', 'exec', { command: command, params: params || [] }).then(r => r.stdout || '')
};

/* JSON を出すスクリプト */
export async function execJson(command, params) {
	const out = await sys.exec(command, params);
	try { return JSON.parse(out); } catch (e) { return null; }
}
