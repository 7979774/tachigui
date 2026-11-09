/* ファイアウォール: ポート転送 (外から、家の中の機器に、届かせる) */
import { T, tr } from '../i18n.js';
import { html, render, useState, useEffect } from '../ui-kit.js';
import { sys, execJson } from '../api.js';
import { isClient } from '../util.js';
import { ask } from '../dialog.js';
import { HelpLayout } from '../help.js';

const helper = async args => (await execJson('/usr/libexec/tachigui-security', args)) || { ok: false, error: T('応答を読めませんでした') };
const BLANK = { name: '', proto: 'tcp', ext: '', ip: '', port: '' };
const short = s => String(s || '').replace(/\.lan$/i, '');

/* 右側の説明欄 (help.js) の中身 */
const HELP = {
	ping: { t: T('PING に答える'), body: T('外からこのルーターの生存を確かめられる。ルーターの存在も外から分かる') },
	ipsec: { t: T('IPsec を家の中に通す'), body: T('家の中の機器で IPsec VPN を使うときだけ。ESP と UDP 500 を通す') },
	fwd: { t: T('ポート転送'), body: T('外から決めたポートに来た通信を、家の中の機器へ届ける。MAP-E の IPv4 は割り当てられたポートしか使えない。確実なのは IPv6') },
	name: { t: T('名前'), body: T('規則の名前。英数字で付ける') },
	proto: { t: T('種類'), items: [ [ 'tcp', 'TCP', T('Web やゲームなど多くの通信') ], [ 'udp', 'UDP', T('通話や VPN など') ], [ 'tcpudp', 'TCP + UDP', T('どちらか分からないとき') ] ] },
	ext: { t: T('外側のポート'), body: T('外から接続するときの番号。範囲は 8000-8100 のように書く') },
	port: { t: T('転送先のポート'), body: T('機器が待ち受けている番号。空なら外側と同じ') },
	target: { t: T('転送先'), items: [ [ 'v4', T('IPv4 のアドレス'), T('外側のポートをこの機器へ転送') ], [ 'v6', T('IPv6 のアドレス'), T('変換なしで外からこの機器に直接届く') ] ] },
	add: { t: T('追加'), body: T('確認のあとすぐに反映') },
	del: { t: T('削除'), body: T('この規則を消す。すぐに反映する') }
};

function Page() {
	const [rules, setRules] = useState(null);
	const [wan, setWan] = useState(null);         // { ping, ipsec } (true = 通す)
	const [wmsg, setWmsg] = useState(null);
	const [hosts, setHosts] = useState([]);       // [{ name, addrs: [...] }]
	const [f, setF] = useState(BLANK);
	const [manual, setManual] = useState(false);
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState(null);

	async function reload() {
		const s = await helper([ 'status' ]);
		if (s && s.ssh) { setRules(s.forwards || []); setWan(s.wan || {}); }
	}

	useEffect(() => {
		reload().catch(e => setMsg({ k: 'ng', t: e.message }));
		Promise.all([ sys.hostHints(), sys.ifaces().catch(() => []) ]).then(([ h, ifs ]) => {
			const lan = (((ifs.find(i => i.interface === 'lan') || {})['ipv4-address'] || [])[0] || {}).address;
			setHosts(Object.keys(h || {}).filter(m => isClient(h[m]) && (h[m].ipv4 || (h[m].ipaddrs || [])[0]) !== lan).map(m => {   // ルーター自身は、転送先に出さない
				const r = h[m];
				return { name: short(r.name) || m.toUpperCase(), addrs: [ r.ipv4 || (r.ipaddrs || [])[0] ].concat((r.ip6addrs || []).filter(a => /^[23]/.test(a))).filter(Boolean) };
			}).sort((a, b) => a.name.localeCompare(b.name)));
		}).catch(() => {});
	}, []);

	async function run(args, okText) {
		setBusy(true); setMsg(null);
		try {
			const r = await helper(args);
			if (r && r.ok) { setMsg({ k: 'ok', t: okText }); await reload(); setBusy(false); return true; }
			setMsg({ k: 'ng', t: (r && tr(r.error)) || T('適用できませんでした') });
		} catch (e) { setMsg({ k: 'ng', t: T('実行できませんでした') }); }
		setBusy(false);
		return false;
	}

	/* WAN 側の標準の許可: スイッチを切り替えたら、その場で反映する */
	async function toggleWan(key, on, risk) {
		if (on && risk && !await ask({ title: T('外からの通信を通す'), warns: [ { level: 'warn', text: risk } ], ok: T('通す') })) return;
		setBusy(true); setWmsg(null);
		try {
			const r = await helper([ 'set', 'wan_' + key, on ? 'on' : 'off' ]);
			if (r && r.ok) { setWan({ ...wan, [key]: on }); setWmsg({ k: 'ok', t: on ? T('通すようにしました') : T('止めました') }); }
			else setWmsg({ k: 'ng', t: (r && tr(r.error)) || T('反映できませんでした') });
		} catch (e) { setWmsg({ k: 'ng', t: T('実行できませんでした') }); }
		setBusy(false);
	}

	async function add() {
		const ext = f.ext.trim(), ip = f.ip.trim(), port = (f.port.trim() || ext);
		if (!f.name.trim() || !ext || !ip) return setMsg({ k: 'ng', t: T('名前・外側のポート・転送先を入れてください') });
		if (/-/.test(ext) && f.port.trim() && f.port.trim() !== ext) return setMsg({ k: 'ng', t: T('範囲のときは転送先も同じ範囲に (空なら同じ)') });
		const v6 = ip.includes(':');
		if (!await ask({ title: T('ポート転送を追加'), rows: [ [ T('名前'), f.name.trim() ], [ T('外側'), f.proto.replace(' ', '+') + '/' + ext ], [ T('転送先'), (v6 ? '[' + ip + ']' : ip) + ':' + port ] ],
			warns: v6 ? [ { level: 'warn', text: T('IPv6 は変換なしで外からその機器に直接届きます') } ] : [], ok: T('追加') })) return;
		const ok = await run([ 'fwd-add', f.name.trim(), f.proto, ext, ip, port ], T('追加しました'));
		if (ok) { setF(BLANK); setManual(false); }
	}

	if (!rules) return html`<p class="muted">${msg ? msg.t : T('読み込み中…')}</p>`;
	const known = hosts.some(h => h.addrs.includes(f.ip));
	const sw = (key, title, risk) => wan[key] == null ? null : html`<label class="set" data-help=${key}><input type="checkbox" checked=${!!wan[key]} disabled=${busy} onChange=${e => toggleWan(key, e.target.checked, risk)} /><div><div>${title}</div></div></label>`;
	return html`<${HelpLayout} help=${HELP}><div class="stack narrowcol">
	<section class="card"><h2>${T('WAN 側からの通信')}</h2>
		${sw('ping', T('PING (IPv4) に答える'), T('このルーターの存在が外から分かるようになります'))}
		${sw('ipsec', T('IPsec (VPN) を家の中に通す'), T('IPsec の通信が家の中の機器まで届くようになります'))}
		${wmsg ? html`<div class=${'alert ' + wmsg.k}>${wmsg.t}</div>` : null}
	</section>
	<section class="card" data-help="fwd"><h2>${T('ポート転送')}</h2>
		${rules.length ? html`<table class="tbl"><thead><tr><th>${T('名前')}</th><th>${T('外側')}</th><th>${T('転送先')}</th><th></th></tr></thead><tbody>
			${rules.map(o => html`<tr><td>${o.name}</td><td class="mono">${o.proto.replace(' ', '+')}/${o.ext}</td><td class="mono">${o.family === 'ipv6' ? '[' + o.ip + ']' : o.ip}:${o.port}</td><td><button class="btn" data-help="del" disabled=${busy} onClick=${async () => { if (await ask({ title: T('「{name}」を削除', { name: o.name }), ok: T('削除'), danger: true })) run([ 'fwd-del', o.id ], T('削除しました')); }}>${T('削除')}</button></td></tr>`)}</tbody></table>` : html`<p class="muted small">${T('転送の規則なし')}</p>`}
		<div class="openform">
			<input type="text" class="in" data-help="name" placeholder=${T('名前 (英数字)')} value=${f.name} onInput=${e => setF({ ...f, name: e.target.value })} />
			<select class="in" data-help="proto" data-help-on=${f.proto} value=${f.proto} onChange=${e => setF({ ...f, proto: e.target.value })}><option value="tcp">TCP</option><option value="udp">UDP</option><option value="tcpudp">TCP + UDP</option></select>
			<input type="text" class="in" data-help="ext" placeholder=${T('外側のポート (例: 8080)')} value=${f.ext} onInput=${e => setF({ ...f, ext: e.target.value })} />
			<input type="text" class="in" data-help="port" placeholder=${T('転送先のポート (空なら同じ)')} value=${f.port} onInput=${e => setF({ ...f, port: e.target.value })} />
			<select class="in span2" data-help="target" data-help-on=${f.ip.includes(':') ? 'v6' : f.ip ? 'v4' : ''} value=${manual ? '__manual' : f.ip} onChange=${e => { if (e.target.value === '__manual') { setManual(true); setF({ ...f, ip: '' }); } else { setManual(false); setF({ ...f, ip: e.target.value }); } }}>
				<option value="">${T('転送先の機器を選ぶ…')}</option>
				${hosts.map(h => html`<optgroup label=${h.name}>${h.addrs.map(a => html`<option value=${a}>${a}</option>`)}</optgroup>`)}
				<option value="__manual">${T('アドレスを手で入れる…')}</option>
			</select>
			${manual || (f.ip && !known) ? html`<input type="text" class="in span2" data-help="target" data-help-on=${f.ip.includes(':') ? 'v6' : f.ip ? 'v4' : ''} placeholder=${T('転送先のアドレス (例: 192.168.1.50)')} value=${f.ip} onInput=${e => setF({ ...f, ip: e.target.value })} />` : null}
			<button class="btn primary" data-help="add" disabled=${busy} onClick=${add}>${T('追加')}</button>
		</div>
		${msg ? html`<div class=${'alert ' + msg.k}>${msg.t}</div>` : null}
	</section></div><//>`;
}

export function mount(root) {
	root.appendChild(Object.assign(document.createElement('div'), { className: 'page-title', innerHTML: '<h1>' + T('ファイアウォール') + '</h1>' }));
	const host = document.createElement('div');
	root.appendChild(host);
	render(html`<${Page} />`, host);
	return { stop() { render(null, host); } };
}
