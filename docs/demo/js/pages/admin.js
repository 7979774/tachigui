/* 管理アクセス: 管理者パスワード、HTTPS / ttyd / SSH の設定、SSH 公開鍵 */
import { T, tr } from '../i18n.js';
import { html, render, useState, useEffect, PwInput } from '../ui-kit.js';
import { rpc, execJson } from '../api.js';
import { ask } from '../dialog.js';
import { HelpLayout } from '../help.js';

const HELP = {
	pw: { t: T('管理者パスワード (root)'), body: T('TachiGUI、LuCI、SSH のログインに使う') },
	http: { t: T('HTTP のポート'), body: T('暗号化しない接続の入口。普通は 80') },
	https: { t: T('HTTPS のポート'), body: T('暗号化した接続の入口。普通は 443') },
	redirect: { t: T('HTTPS に転送'), items: [ [ 'on', T('オン'), T('http:// で開いても https:// に切り替える') ], [ 'off', T('オフ'), T('http:// のまま開ける。パスワードが暗号化されずに流れることがある') ] ] },
	mins: { t: T('ログインの有効時間'), body: T('操作がないとログアウトするまでの時間。5〜1440 分') },
	ttyd: { t: T('ウェブ端末 (ttyd)'), body: T('ブラウザで使うコマンド画面'), items: [ [ 'on', T('オン'), T('動かす') ], [ 'off', T('オフ'), T('止める。自動でも起動しない') ] ] },
	ssh: { t: 'SSH', body: T('コマンドでルーターを操作する接続'), items: [ [ 'on', T('オン'), T('SSH で入れる') ], [ 'off', T('オフ'), T('SSH で入れない') ] ] },
	sshport: { t: T('SSH のポート'), body: T('普通は 22') },
	lan: { t: T('LAN だけで待ち受け'), items: [ [ 'on', T('オン'), T('LAN の機器からだけ入れる') ], [ 'off', T('オフ'), T('全ネットワークで待ち受ける。外から届くおそれがある') ] ] },
	sshpw: { t: T('パスワード認証'), items: [ [ 'on', T('オン'), T('パスワードでも SSH に入れる') ], [ 'off', T('オフ'), T('登録した鍵でだけ入れる。鍵がないとオフにできない') ] ] },
	apply: { t: T('適用'), body: T('「管理画面」と「SSH」の変更を反映する。パスワードと公開鍵は別') },
	key: { t: T('公開鍵'), body: T('登録した鍵ならパスワードなしで SSH に入れる。PC の公開鍵 (.pub) を貼り付ける。秘密鍵は貼らない。追加と削除はすぐ反映する') }
};

const helper = async args => (await execJson('/usr/libexec/tachigui-security', args)) || { ok: false, error: T('応答を読めませんでした') };

function PasswordCard() {
	const [pw1, setPw1] = useState('');
	const [pw2, setPw2] = useState('');
	const [msg, setMsg] = useState(null);
	const [busy, setBusy] = useState(false);

	async function changePw() {
		if (!pw1) return setMsg({ k: 'ng', t: T('新しいパスワードを入力してください') });
		if (pw1 !== pw2) return setMsg({ k: 'ng', t: T('確認用のパスワードが一致しません') });
		if (pw1.length < 8 && !await ask({ title: T('8 文字より短いパスワードです'), body: T('短いパスワードは推測されやすくなります'), ok: T('このまま変更') })) return;
		setBusy(true);
		try { await rpc('luci', 'setPassword', { username: 'root', password: pw1 }); setPw1(''); setPw2(''); setMsg({ k: 'ok', t: T('パスワードを変更しました') }); }
		catch (e) { setMsg({ k: 'ng', t: T('変更できませんでした: ') + e.message }); }
		setBusy(false);
	}

	return html`<section class="card" data-help="pw"><h2>${T('管理者パスワード (root)')}</h2>
		<div class="f"><label class="f-k">${T('新しいパスワード')}</label><div class="f-v"><${PwInput} class="in full" autocomplete="new-password" value=${pw1} onInput=${e => setPw1(e.target.value)} /></div></div>
		<div class="f"><label class="f-k">${T('確認')}</label><div class="f-v"><${PwInput} class="in full" autocomplete="new-password" value=${pw2} onInput=${e => setPw2(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter') changePw(); }} /></div></div>
		<div class="rowgap"><button class="btn primary" disabled=${busy} onClick=${changePw}>${T('変更')}</button></div>
		${msg ? html`<div class=${'alert ' + msg.k}>${msg.t}</div>` : null}
	</section>`;
}

function Page() {
	const [st, setSt] = useState(null);
	const [msg, setMsg] = useState({});           // 欄ごとのメッセージ
	const [form, setForm] = useState(null);       // 設定欄の編集中の値
	const [key, setKey] = useState('');
	const [keysOpen, setKeysOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const [pf, setPf] = useState(null);         // ポート欄: { http, https, sshOn, sshPort }
	const say = (box, t, k) => setMsg(m => ({ ...m, [box]: t ? { t, k } : null }));

	/* keepForm: 鍵の追加・削除では、適用前の入力を消さない */
	async function reload(keepForm) {
		const s = await helper([ 'status' ]);
		if (s && s.ssh && keepForm) setSt(s);
		else if (s && s.ssh) {
			setSt(s);
			setPf({ http: String(s.http.http_port), https: String(s.http.https_port), sshOn: s.ssh.enabled, sshPort: String(s.ssh.port) });
			setForm({ ssh_on: s.ssh.enabled, ssh_password: s.ssh.password && s.ssh.root_password, ssh_lan_only: s.ssh.interface === 'lan', https_redirect: s.http.redirect_https, ttyd: s.ttyd.running || s.ttyd.enabled, mins: Math.round(s.http.session_time / 60) });
		}
		else say('load', (s && tr(s.error)) || T('読み込めませんでした'), 'ng');
	}
	useEffect(() => { reload().catch(e => say('load', e.message, 'ng')); }, []);

	async function run(args, box) {
		say(box, T('適用しています…'));
		setBusy(true);
		try {
			const r = await helper(args);
			if (r && r.ok) { say(box, T('適用しました'), 'ok'); await reload(true); }
			else say(box, (r && tr(r.error)) || T('適用できませんでした'), 'ng');
		} catch (e) { say(box, T('実行できませんでした'), 'ng'); }
		setBusy(false);
	}

	/* 変更した項目だけを、順に適用する。注意が要る変更は、確認する */
	async function applyJobs(jobs, box, risky) {
		if (!jobs.length) { say(box, T('変更なし')); return null; }
		if (risky.length && !await ask({ title: T('注意が要る変更'), warns: risky.map(text => ({ level: 'warn', text })), ok: T('適用') })) return false;
		say(box, T('適用しています…')); setBusy(true);
		let failed = null;
		try { for (const j of jobs) { const r = await helper(j); if (!r || !r.ok) { failed = (r && tr(r.error)) || T('適用できませんでした'); break; } } }
		catch (e) { failed = T('実行できませんでした'); }
		setBusy(false);
		if (failed) { say(box, failed, 'ng'); return false; }
		return true;
	}

	/* 管理画面と SSH の変更を、まとめて適用する */
	async function applyAll() {
		const onoff = v => v ? 'on' : 'off', jobs = [], risky = [];
		const hp = parseInt(pf.http, 10), sp = parseInt(pf.https, 10), ssp = parseInt(pf.sshPort, 10);
		const okPort = n => n >= 1 && n <= 65535;
		if (!(okPort(hp) && okPort(sp) && okPort(ssp))) return say('apply', T('ポートは 1〜65535'), 'ng');
		const mins = parseInt(form.mins, 10);
		if (!(mins >= 5 && mins <= 1440)) return say('apply', T('ログインの有効時間は 5〜1440 分'), 'ng');

		/* 管理画面 */
		if (form.https_redirect !== st.http.redirect_https) { jobs.push([ 'set', 'https_redirect', onoff(form.https_redirect) ]); if (!form.https_redirect) risky.push(T('HTTP が HTTPS に転送されなくなります')); }
		if (st.ttyd.installed && form.ttyd !== (st.ttyd.running || st.ttyd.enabled)) jobs.push([ 'set', 'ttyd', onoff(form.ttyd) ]);
		if (mins * 60 !== st.http.session_time) jobs.push([ 'set', 'session_time', String(mins * 60) ]);
		const webChanged = hp !== st.http.http_port || sp !== st.http.https_port;
		if (webChanged) { jobs.push([ 'set', 'http_ports', hp + ':' + sp ]); risky.push(T('管理画面のポートが変わります。新しいアドレスで開き直してください')); }

		/* SSH */
		if (ssp !== st.ssh.port) { jobs.push([ 'set', 'ssh_port', String(ssp) ]); risky.push(T('SSH のポートが変わります')); }
		if (form.ssh_password !== st.ssh.password || form.ssh_password !== st.ssh.root_password) {
			jobs.push([ 'set', 'ssh_password', onoff(form.ssh_password) ], [ 'set', 'ssh_root_password', onoff(form.ssh_password) ]);      // 使うのは root だけなので、2 つは、いつも同じにする
			if (!form.ssh_password) risky.push(T('SSH は登録済みの鍵でしか入れなくなります'));
		}
		if (form.ssh_lan_only !== (st.ssh.interface === 'lan')) { jobs.push([ 'set', 'ssh_lan_only', onoff(form.ssh_lan_only) ]); if (!form.ssh_lan_only) risky.push(T('SSH が全ネットワークで待ち受けます (外から届くおそれ)')); }
		if (form.ssh_on !== st.ssh.enabled) { jobs.push([ 'set', 'ssh_enable', onoff(form.ssh_on) ]); if (!form.ssh_on) risky.push(T('SSH を止めます')); }

		const ok = await applyJobs(jobs, 'apply', risky);
		if (!ok) return;
		if (webChanged) {
			const https = location.protocol === 'https:', port = https ? sp : hp;
			const url = location.protocol + '//' + location.hostname + (port === (https ? 443 : 80) ? '' : ':' + port) + '/';
			say('apply', T('適用しました。新しいアドレスへ移ります: ') + url, 'ok');
			setTimeout(() => { location.href = url; }, 4000);
		}
		else { say('apply', T('適用しました'), 'ok'); await reload(); }
	}

	async function addKey() {
		const text = key.trim();
		if (!text) return say('key', T('公開鍵を貼り付けてください'), 'ng');
		await run([ 'key-add', text ], 'key');
		setKey('');
	}

	if (!st || !form || !pf) return html`<p class="muted">${msg.load ? msg.load.t : T('読み込み中…')}</p>`;

	const M = box => msg[box] ? html`<div class=${'alert ' + (msg[box].k || '')}>${msg[box].t}</div>` : null;
	/* 説明は右の説明欄に出す (help.js)。トグルは今の状態の行を目立たせる */
	const chk = (id, title, help) => html`<div class="f" data-help=${help} data-help-on=${form[id] ? 'on' : 'off'}><div class="f-k">${title}</div><div class="f-v"><input type="checkbox" class="tgl" aria-label=${title} checked=${form[id]} onChange=${e => setForm({ ...form, [id]: e.target.checked })} /></div></div>`;
	const num = (title, value, onInput, min, max, help) => html`<div class="f" data-help=${help}><label class="f-k">${title}</label><div class="f-v"><input type="number" class="in num" min=${min} max=${max} value=${value} onInput=${e => onInput(e.target.value)} /></div></div>`;

	return html`<${HelpLayout} help=${HELP}><div class="stack narrowcol">
		<${PasswordCard} />
		<section class="card"><h2>${T('管理画面')}</h2>
			${num(T('HTTP のポート'), pf.http, v => setPf({ ...pf, http: v }), 1, 65535, 'http')}
			${num(T('HTTPS のポート'), pf.https, v => setPf({ ...pf, https: v }), 1, 65535, 'https')}
			${chk('https_redirect', T('HTTPS に転送'), 'redirect')}
			${num(T('ログインの有効時間 (分)'), form.mins, v => setForm({ ...form, mins: v }), 5, 1440, 'mins')}
			${st.ttyd.installed ? chk('ttyd', T('ウェブ端末 (ttyd)'), 'ttyd') : null}
		</section>
		<section class="card"><h2>SSH</h2>
			${chk('ssh_on', 'SSH', 'ssh')}
			${num(T('ポート'), pf.sshPort, v => setPf({ ...pf, sshPort: v }), 1, 65535, 'sshport')}
			${chk('ssh_lan_only', T('LAN だけで待ち受け'), 'lan')}
			${chk('ssh_password', T('パスワード認証'), 'sshpw')}
			<div data-help="key">
			<div class="f"><div class="f-k">${T('公開鍵')}</div><div class="f-v"><button type="button" class="btn" aria-expanded=${keysOpen} onClick=${() => setKeysOpen(!keysOpen)}>${(st.keys || []).length} ${T('件')} <span class=${'chev' + (keysOpen ? ' open' : '')}></span></button></div></div>
			${keysOpen ? html`${(st.keys || []).length ? html`<table class="tbl"><thead><tr><th>${T('種類')}</th><th>${T('鍵 (先頭…末尾)')}</th><th>${T('コメント')}</th><th></th></tr></thead><tbody>
				${st.keys.map(k => html`<tr><td>${k.type}</td><td class="mono">${k.head}…${k.tail}</td><td>${k.comment || '-'}</td><td><button class="btn" disabled=${busy} onClick=${async () => { if (await ask({ title: T('鍵を削除'), rows: [ [ T('種類'), k.type ], [ T('コメント'), k.comment || '-' ] ], body: T('この鍵では SSH に入れなくなります'), ok: T('削除'), danger: true })) run([ 'key-del', String(k.line) ], 'key'); }}>${T('削除')}</button></td></tr>`)}</tbody></table>` : html`<p class="muted small">${T('鍵なし')}</p>`}
			<textarea class="in keyta" placeholder=${T('ssh-ed25519 AAAA… コメント')} spellcheck="false" value=${key} onInput=${e => setKey(e.target.value)}></textarea>
			<div class="rowgap"><button class="btn primary" disabled=${busy} onClick=${addKey}>${T('鍵を追加')}</button></div>
			${M('key')}` : null}
			</div>
		</section>
		<div class="applybar"><button class="btn primary" data-help="apply" disabled=${busy} onClick=${applyAll}>${T('適用')}</button></div>
		${M('apply')}
	</div><//>`;
}

export function mount(root) {
	root.appendChild(Object.assign(document.createElement('div'), { className: 'page-title', innerHTML: '<h1>' + T('管理アクセス') + '</h1>' }));
	const host = document.createElement('div');
	root.appendChild(host);
	render(html`<${Page} />`, host);
	return { stop() { render(null, host); } };
}
