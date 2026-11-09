/* セキュリティ: 診断、待ち受けているポート */
import { T, tr } from '../i18n.js';
import { html, render, useState, useEffect } from '../ui-kit.js';
import { execJson } from '../api.js';
import { ask } from '../dialog.js';
import { HelpLayout } from '../help.js';

const HELP = {
	diag: { t: T('セキュリティ診断'), body: T('今の設定を確かめた結果。ボタンがある項目はその場で直せる'), items: [ [ 'ng', T('要対応'), T('外から入られるおそれがある。早めに直す') ], [ 'warn', T('注意'), T('すぐ危険ではないが、直すと安全になる') ], [ 'ok', T('問題なし'), T('対応は要らない') ] ] },
	port: { t: T('待ち受けているポート'), body: T('ルーターが接続を受け付ける入口。外から届くかはファイアウォールでも変わる'), items: [ [ 'all', T('全ネットワーク'), T('すべての接続先で待ち受ける') ], [ 'global', T('外部アドレス'), T('インターネット側のアドレスで待ち受ける') ], [ 'lan', 'LAN', T('家の中からだけ') ], [ 'local', T('この機器だけ'), T('ルーターの中からだけ') ] ] }
};

const helper = async args => (await execJson('/usr/libexec/tachigui-security', args)) || { ok: false, error: T('応答を読めませんでした') };
const SERVICES = { 22: 'SSH', 53: 'DNS', 67: 'DHCP', 68: 'DHCP', 80: 'HTTP', 443: 'HTTPS', 546: 'DHCPv6', 547: 'DHCPv6', 7681: T('ttyd (ウェブ端末)') };
/* DHCP は仕組み上、全ネットワークで待ち受ける (LAN への配布と、回線側からの IPv6 の受け取り)。止めるとつながらなくなる */
const isDhcp = l => l.proto.startsWith('udp') && [ 67, 68, 546, 547 ].includes(l.port);
const SCOPE = { all: T('全ネットワーク'), global: T('外部アドレス'), lan: 'LAN', local: T('この機器だけ') };
const ORDER = { ng: 0, warn: 1, ok: 2 };

/* 診断: 状態から、確認項目を作る */
function diagnose(st) {
	const items = [];
	const add = (level, title, desc, fix) => items.push({ level, title, desc, fix });
	const keyCount = (st.keys || []).length;
	const hasGlobal = (st.listening || []).some(l => l.scope === 'global');

	if (!st.root_pw) add('ng', T('root のパスワードが未設定'), T('パスワードなしでログインできます。「管理アクセス」で設定してください'));
	else add('ok', T('root のパスワード設定済み'), '');

	if (st.ssh.interface !== 'lan') add('ng', T('SSH が全ネットワークで待ち受け中'), T('LAN だけにすると外からの接続を防げます'), { label: T('LAN だけにする'), args: [ 'set', 'ssh_lan_only', 'on' ] });
	else add('ok', T('SSH は LAN だけで待ち受け'), '');

	if (st.ssh.password) {
		if (keyCount > 0) add('warn', T('SSH のパスワード認証が有効'), T('鍵で入れるので、止めると総当たりを防げます'), { label: T('鍵のみにする'), args: [ 'set', 'ssh_password', 'off' ], confirm: T('以降、SSH は登録済みの鍵でしか入れません') });
		else add('warn', T('SSH のパスワード認証が有効'), T('先に公開鍵を登録してください'));
	}
	else add('ok', T('SSH は鍵のみ (パスワード認証は無効)'), '');

	if (!st.http.redirect_https) add('warn', T('HTTP が HTTPS に転送されない'), T('パスワードが暗号化されずに流れることがあります'), { label: T('HTTPS に転送する'), args: [ 'set', 'https_redirect', 'on' ] });
	else add('ok', T('HTTP は HTTPS に転送'), '');

	if (st.ttyd.installed && st.ttyd.running) add('warn', T('ウェブ端末 (ttyd) が動作中'), T('使わないなら止めてください'), { label: T('止める'), args: [ 'set', 'ttyd', 'off' ] });
	else if (st.ttyd.installed) add('ok', T('ウェブ端末 (ttyd) は停止中'), '');

	if (st.firewall.guard) add('ok', T('IPv6 の外部から管理ポートに届かない'), T('SSH・HTTP・HTTPS・ttyd を遮断'));
	else if (hasGlobal) add('ng', T('IPv6 の外部から管理ポートに届くおそれ'), T('遮断ルールがありません。TachiGUI を入れ直してください'));

	if (st.firewall.input !== 'REJECT' && st.firewall.input !== 'DROP') add('warn', T('ファイアウォールの入力が初期値で許可'), T('拒否 (REJECT / DROP) が安全'));

	const open = (st.listening || []).filter(l => l.scope === 'all' && l.port !== 80 && l.port !== 443 && !isDhcp(l));
	if (open.length) add('warn', T('全ネットワークで待ち受けるポートあり'), open.map(l => l.proto + '/' + l.port + (SERVICES[l.port] ? ' (' + SERVICES[l.port] + ')' : '')).join(', ') + T('。不要なら LAN だけに'));
	return items;
}

function Page() {
	const [st, setSt] = useState(null);
	const [msg, setMsg] = useState(null);
	const [busy, setBusy] = useState(false);
	const say = (t, k) => setMsg(t ? { t, k } : null);

	async function reload() {
		const s = await helper([ 'status' ]);
		if (s && s.ssh) setSt(s);
		else say((s && tr(s.error)) || T('読み込めませんでした'), 'ng');
	}
	useEffect(() => { reload().catch(e => say(e.message, 'ng')); }, []);

	async function run(args) {
		say(T('適用しています…'));
		setBusy(true);
		try {
			const r = await helper(args);
			if (r && r.ok) { say(T('適用しました'), 'ok'); await reload(); }
			else say((r && tr(r.error)) || T('適用できませんでした'), 'ng');
		} catch (e) { say(T('実行できませんでした'), 'ng'); }
		setBusy(false);
	}

	if (!st) return html`<p class="muted">${msg ? msg.t : T('読み込み中…')}</p>`;

	const items = diagnose(st), n = { ok: 0, warn: 0, ng: 0 };
	items.forEach(i => n[i.level]++);
	items.sort((a, b) => ORDER[a.level] - ORDER[b.level]);

	return html`<${HelpLayout} help=${HELP}><div class="stack narrowcol">
		<section class="card"><h2>${T('セキュリティ診断')}</h2>
			<div class="chips"><span class="chip ng">${T('要対応')} ${n.ng}</span><span class="chip warn">${T('注意')} ${n.warn}</span><span class="chip ok">${T('問題なし')} ${n.ok}</span></div>
			${items.map(i => html`<div class="item" data-help="diag" data-help-on=${i.level}><span class=${'dot ' + i.level}></span><div><div>${i.title}</div>${i.desc ? html`<div class="f-d">${i.desc}</div>` : null}</div>
				${i.fix ? html`<button class="btn" disabled=${busy} onClick=${async () => { if (i.fix.confirm && !await ask({ title: i.fix.label, body: i.fix.confirm, ok: i.fix.label })) return; run(i.fix.args); }}>${i.fix.label}</button>` : html`<span></span>`}</div>`)}
			<div class="rowgap"><button class="btn" disabled=${busy} onClick=${() => { say(T('調べています…')); reload().then(() => say('')).catch(e => say(e.message, 'ng')); }}>${T('再診断')}</button></div>
			${msg ? html`<div class=${'alert ' + (msg.k || '')}>${msg.t}</div>` : null}
		</section>
		<section class="card"><h2>${T('待ち受けているポート')}</h2>
			<table class="tbl"><thead><tr><th>${T('プロトコル')}</th><th>${T('ポート')}</th><th>${T('アドレス')}</th><th>${T('範囲')}</th></tr></thead><tbody>
				${st.listening.slice().sort((a, b) => a.port - b.port || (a.proto < b.proto ? -1 : 1)).map(l => html`<tr data-help="port" data-help-on=${l.scope}><td>${l.proto}</td><td>${l.port}${SERVICES[l.port] ? ' (' + SERVICES[l.port] + ')' : ''}</td><td class="mono">${l.addr}</td><td><span class=${'tag ' + l.scope}>${SCOPE[l.scope] || l.scope}</span></td></tr>`)}</tbody></table>
		</section>
	</div><//>`;
}

export function mount(root) {
	root.appendChild(Object.assign(document.createElement('div'), { className: 'page-title', innerHTML: '<h1>' + T('セキュリティ') + '</h1>' }));
	const host = document.createElement('div');
	root.appendChild(host);
	render(html`<${Page} />`, host);
	return { stop() { render(null, host); } };
}
