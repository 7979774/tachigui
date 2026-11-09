/* 接続テスト: ルーターから ping / 経路 / 名前解決を試す */
import { T, tr } from '../i18n.js';
import { html, render, useState } from '../ui-kit.js';
import { sys } from '../api.js';
import { HelpLayout } from '../help.js';

const TOOLS = [ [ 'ping', T('疎通 (ping)') ], [ 'trace', T('経路 (traceroute)') ], [ 'lookup', T('名前解決 (DNS)') ] ];
const PRESETS = [ '1.1.1.1', '8.8.8.8', '2606:4700:4700::1111', 'example.com' ];
const HELP = {
	tool: { t: T('調べ方'), items: [ [ 'ping', T('疎通'), T('相手に届くか、応答までの時間を見る') ], [ 'trace', T('経路'), T('相手までに通る機器を順に見る。最大 15 段') ], [ 'lookup', T('名前解決'), T('ルーターの DNS で名前をアドレスに変える') ] ] },
	host: { t: T('宛先'), body: T('名前か IP アドレス。ルーターから試すので、結果はルーターから見たもの') }
};

function Page() {
	const [tool, setTool] = useState('ping');
	const [host, setHost] = useState('');
	const [out, setOut] = useState(null);
	const [busy, setBusy] = useState(false);

	async function run(target) {
		const h = (target || host).trim();
		if (!h) return setOut({ k: 'ng', t: T('宛先を入れてください') });
		setHost(h); setBusy(true); setOut(null);
		try { setOut({ t: await sys.exec('/usr/libexec/tachigui-diag', [ tool, h ]) || T('結果なし') }); }
		catch (e) { console.error('nettest: 実行できません', e); setOut({ k: 'ng', t: T('実行できませんでした。ログインし直してください') }); }
		setBusy(false);
	}

	return html`<${HelpLayout} help=${HELP}><div class="stack narrowcol"><section class="card">
		<div class="f" data-help="tool" data-help-on=${tool}><label class="f-k">${T('調べ方')}</label><div class="f-v"><select class="in" value=${tool} onChange=${e => setTool(e.target.value)}>${TOOLS.map(x => html`<option value=${x[0]}>${x[1]}</option>`)}</select></div></div>
		<div class="f" data-help="host"><label class="f-k">${T('宛先')}</label><div class="f-v rowflex"><input type="text" class="in" style="flex:1" spellcheck="false" placeholder=${T('例: example.com')} value=${host} onInput=${e => setHost(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter' && !busy) run(); }} /><button class="btn primary" disabled=${busy} onClick=${() => run()}>${busy ? T('実行中…') : T('実行')}</button></div></div>
		<div class="chips">${PRESETS.map(p => html`<button type="button" class="chip pick" disabled=${busy} onClick=${() => run(p)}>${p}</button>`)}</div>
		${out ? (out.k ? html`<div class=${'alert ' + out.k}>${out.t}</div>` : html`<pre class="diagout mono">${out.t}</pre>`) : null}
	</section></div><//>`;
}

export function mount(root) {
	root.appendChild(Object.assign(document.createElement('div'), { className: 'page-title', innerHTML: '<h1>' + T('接続テスト') + '</h1>' }));
	const host = document.createElement('div');
	root.appendChild(host);
	render(html`<${Page} />`, host);
	return { stop() { render(null, host); } };
}
