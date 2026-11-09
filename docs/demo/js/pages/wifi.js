/* Wi-Fi: ルーター本体の無線と、連携した AP の Wi-Fi の設定。AP との連携の登録もここで行う
   読み書きは tachigui-wlan (ルーター本体) と tachigui-wifi wlan (AP。AP に写した tachigui-wlan を SSH で動かす) */
import { T, tr } from '../i18n.js';
import { html, render, useState, useEffect, PwInput } from '../ui-kit.js';
import { rpc, execJson } from '../api.js';
import { ask } from '../dialog.js';
import { HelpLayout } from '../help.js';

const WLAN = '/usr/libexec/tachigui-wlan';
const ENC = { none: T('なし'), psk2: 'WPA2-PSK', 'psk-mixed': 'WPA/WPA2-PSK', sae: 'WPA3-SAE', 'sae-mixed': 'WPA2-PSK/WPA3-SAE' };

const HELP = {
	on: { t: T('Wi-Fi を有効化'), body: T('オフにすると、この帯域の電波を止める') },
	tx: { t: T('送信電力'), body: T('電波の強さ。弱くすると届く範囲が狭くなる。近所への混信は減る') },
	ssid: { t: T('Wi-Fi 名 (SSID)'), body: T('機器の一覧に出る名前。32 バイトまで。帯域ごとに同じ名前でもよい') },
	enc: { t: T('セキュリティ'), body: T('暗号化の方式'), items: [ [ 'sae-mixed', 'WPA2-PSK/WPA3-SAE', T('おすすめ。古い機器もつながる') ], [ 'sae', 'WPA3-SAE', T('一番安全。古い機器はつながらない') ], [ 'psk2', 'WPA2-PSK', T('古い機器向け') ], [ 'psk-mixed', 'WPA/WPA2-PSK', T('とても古い機器向け。安全ではない') ], [ 'none', T('なし'), T('誰でもつながる。使わない') ] ] },
	key: { t: T('Wi-Fi パスワード'), body: T('8〜63 文字の英数字と記号') },
	hidden: { t: T('SSID の可視性'), body: T('隠すと、機器の一覧に名前が出ない。つなぐときは名前を手で入れる') },
	mode: { t: T('Wi-Fi モード'), body: T('使える規格の組み合わせ。古い規格を外すと、古い機器はつながらない') },
	width: { t: T('帯域幅'), body: T('広いほど速い。周りの Wi-Fi が多いときは、狭いほうが安定する') },
	ch: { t: T('チャネル'), body: T('使う周波数。自動なら空いているところを選ぶ。DFS のチャネルは、使い始めるまで 1 分ほど待つ。レーダーを見つけると移る') },
	ap: { t: T('AP との連携'), body: T('このルーターにつないだ Wi-Fi の親機を登録すると、その Wi-Fi の設定と、つながっている機器をここで見られる。OpenWrt 系の機器だけ') },
	aphost: { t: T('AP のアドレス'), body: T('AP の IP アドレス。例: 192.168.1.3') },
	apname: { t: T('AP の名前'), body: T('画面に出す名前。例: 2階') },
	appw: { t: T('AP の root パスワード'), body: T('AP の管理者のパスワード。登録に 1 回だけ使い、保存しない') },
	apreg: { t: T('登録'), body: T('8 台まで。AP で SSH と ucode を使える必要がある。登録すると AP に SSH の鍵 2 つと、設定用のスクリプト (/etc/tachigui/wlan) を置く') }
};

const wifiHelper = async args => (await execJson('/usr/libexec/tachigui-wifi', args)) || { ok: false, error: T('応答を読めませんでした') };
const bytes = s => new TextEncoder().encode(s).length;
const widthLabel = (w, all) => (w === 'auto' ? all.filter(x => x !== 'auto').join('/') : w) + ' MHz';
const FIELDS = [ 'enabled', 'ssid', 'key', 'encryption', 'hidden', 'channel', 'width', 'txpower', 'mode' ];
const pick = r => Object.fromEntries(FIELDS.map(k => [ k, r[k] ]));
const bandName = b => b.replace('G', ' GHz');
/* 高い帯域から並べる (GL.iNet の画面と同じく 5 GHz が上) */
const byBand = rs => rs.slice().sort((a, b) => parseFloat(b.band) - parseFloat(a.band));

/* 帯域ごとのカード。値を変えて「変更」で、確認してから save に渡す */
function RadioCard({ r, src, save }) {
	const [f, setF] = useState(pick(r));
	const [msg, setMsg] = useState(null);
	const [busy, setBusy] = useState(false);
	useEffect(() => { setF(pick(r)); }, [ r ]);

	const widths = (r.widthsBy && r.widthsBy[f.mode]) || [];
	const dirty = FIELDS.some(k => f[k] !== r[k]);
	const set = (k, v) => setF(x => {
		const n = { ...x, [k]: v };
		/* モードを変えて今の幅が使えなくなったら、使える一番広い幅にする (GL.iNet の画面と同じ) */
		if (k === 'mode') { const ws = r.widthsBy[v] || []; if (ws.length && !ws.includes(n.width)) n.width = ws[ws.length - 1]; }
		return n;
	});
	const chLabel = c => c ? c + (((r.channels.find(x => x.ch === c) || {}).dfs) ? ' (DFS)' : '') : T('自動');
	const txLabel = v => tr((r.txpowers.find(t => t[0] === v) || [ v, v ])[1]);
	const yes = b => b ? T('オン') : T('オフ');

	async function apply() {
		if (!bytes(f.ssid) || bytes(f.ssid) > 32) return setMsg({ k: 'ng', t: T('Wi-Fi 名は 1〜32 バイト') });
		if (f.encryption !== 'none' && !(/^[\x20-\x7e]{8,63}$/.test(f.key) || /^[0-9A-Fa-f]{64}$/.test(f.key))) return setMsg({ k: 'ng', t: T('パスワードは 8〜63 文字 (英数字と記号)') });
		const rows = [
			[ T('有効'), yes(r.enabled), yes(f.enabled) ],
			[ T('Wi-Fi 名'), r.ssid, f.ssid ],
			[ T('セキュリティ'), ENC[r.encryption] || r.encryption, ENC[f.encryption] || f.encryption ],
			[ T('パスワード'), '●●●●', f.key === r.key ? '●●●●' : T('新しいパスワード') ],
			[ 'SSID', r.hidden ? T('隠す') : T('表示'), f.hidden ? T('隠す') : T('表示') ],
			...(r.modes.length ? [ [ T('Wi-Fi モード'), r.mode, f.mode ] ] : []),
			[ T('帯域幅'), widthLabel(r.width, widths), widthLabel(f.width, widths) ],
			[ T('チャネル'), chLabel(r.channel), chLabel(f.channel) ],
			[ T('送信電力'), txLabel(r.txpower), txLabel(f.txpower) ]
		];
		/* つないでいる機器が切れる変更は目立たせる。この画面を Wi-Fi で開いていると、画面も切れる */
		const warns = [];
		if (!f.enabled && r.enabled) warns.push({ level: 'ng', text: T('この Wi-Fi は止まります。この Wi-Fi でつないでいると、この画面も切れます') });
		else if ([ 'ssid', 'key', 'encryption' ].some(k => f[k] !== r[k])) warns.push({ level: 'ng', text: T('この Wi-Fi の機器は切れます。新しい名前とパスワードでつなぎ直してください') });
		else warns.push({ level: 'warn', text: T('Wi-Fi が少しの間切れます') });
		if (f.channel !== r.channel && (r.channels.find(x => x.ch === f.channel) || {}).dfs) warns.push({ level: 'warn', text: T('DFS のチャネルは、使い始めるまで 1 分ほどかかります') });
		if (!await ask({ title: T('{src} の {band} Wi-Fi を変更', { src, band: bandName(r.band) }), rows, warns, ok: T('変更') })) return;
		setBusy(true); setMsg({ k: '', t: T('変更しています…') });
		try {
			const e = await save({ device: r.device, ...f });
			setMsg(e ? { k: 'ng', t: e } : { k: 'ok', t: T('変更しました') });
		} catch (e) {
			console.error('wifi: 変更の応答がありません', r.device, e);
			setMsg({ k: 'ng', t: T('応答がありません。Wi-Fi がつながり直したら、読み直してください') });
		}
		setBusy(false);
	}

	const off = !f.enabled;
	return html`<section class="card">
		<h2>${bandName(r.band)} Wi-Fi</h2>
		<div class="f" data-help="on" data-help-on=${f.enabled ? 'on' : 'off'}><div class="f-k">${T('Wi-Fi を有効化')}</div><div class="f-v"><input type="checkbox" class="tgl" aria-label=${T('Wi-Fi を有効化')} checked=${f.enabled} onChange=${e => set('enabled', e.target.checked)} /></div></div>
		<div class="f" data-help="tx"><label class="f-k">${T('送信電力')}</label><div class="f-v"><select class="in full" disabled=${off} value=${f.txpower} onChange=${e => set('txpower', e.target.value)}>${r.txpowers.map(([ v, t ]) => html`<option value=${v}>${tr(t)}</option>`)}</select></div></div>
		<div class="f" data-help="ssid"><label class="f-k">${T('Wi-Fi 名 (SSID)')}</label><div class="f-v"><input type="text" class="in full" spellcheck="false" disabled=${off} value=${f.ssid} onInput=${e => set('ssid', e.target.value)} /></div></div>
		<div class="f" data-help="enc" data-help-on=${f.encryption}><label class="f-k">${T('セキュリティ')}</label><div class="f-v"><select class="in full" disabled=${off} value=${f.encryption} onChange=${e => set('encryption', e.target.value)}>${r.encryptions.map(v => html`<option value=${v}>${ENC[v] || v}</option>`)}</select></div></div>
		${f.encryption !== 'none' ? html`<div class="f" data-help="key"><label class="f-k">${T('Wi-Fi パスワード')}</label><div class="f-v"><${PwInput} class="in full" autocomplete="off" disabled=${off} value=${f.key} onInput=${e => set('key', e.target.value)} /></div></div>` : null}
		<div class="f" data-help="hidden"><label class="f-k">${T('SSID の可視性')}</label><div class="f-v"><select class="in full" disabled=${off} value=${f.hidden ? '1' : '0'} onChange=${e => set('hidden', e.target.value === '1')}><option value="0">${T('表示')}</option><option value="1">${T('隠す')}</option></select></div></div>
		${r.modes.length ? html`<div class="f" data-help="mode"><label class="f-k">${T('Wi-Fi モード')}</label><div class="f-v"><select class="in full" disabled=${off} value=${f.mode} onChange=${e => set('mode', e.target.value)}>${r.modes.map(v => html`<option value=${v}>${v}</option>`)}</select></div></div>` : null}
		${widths.length ? html`<div class="f" data-help="width"><label class="f-k">${T('帯域幅')}</label><div class="f-v"><select class="in full" disabled=${off} value=${f.width} onChange=${e => set('width', e.target.value)}>${widths.map(v => html`<option value=${v}>${widthLabel(v, widths)}</option>`)}</select></div></div>` : null}
		<div class="f" data-help="ch"><label class="f-k">${T('チャネル')}</label><div class="f-v"><select class="in full" disabled=${off} value=${String(f.channel)} onChange=${e => set('channel', +e.target.value)}><option value="0">${T('自動')}</option>${r.channels.map(c => html`<option value=${String(c.ch)}>${chLabel(c.ch)}</option>`)}</select></div></div>
		<div class="rowgap"><button class="btn primary" disabled=${busy || !dirty} onClick=${apply}>${T('変更')}</button>${dirty && !busy ? html` <button class="btn" onClick=${() => { setF(pick(r)); setMsg(null); }}>${T('元に戻す')}</button>` : null}</div>
		${msg ? html`<div class=${'alert ' + msg.k}>${msg.t}</div>` : null}
	</section>`;
}

/* 登録の共通部分: パスワードは一時ファイルで渡す (コマンドの引数は ps で見えるため)。補助スクリプトが読んだらすぐ消す */
async function registerAp(host, name, pw) {
	await rpc('file', 'write', { path: '/tmp/.tachigui-wifi-pw', data: pw, mode: 384 });
	return wifiHelper([ 'register', host.trim(), name.trim() ]);
}
const regMsg = r => r.reg && r.reg.write ? { k: 'ok', t: T('登録しました') } : { k: 'ng', t: T('登録しました。AP に ucode がないので、設定は変えられません') };

/* 登録済みの 1 台。設定を変える鍵がないとき (前の版で登録した、AP 側が古い) は、パスワードを 1 回入れて登録し直す */
function ApRow({ a, onChange }) {
	const [pw, setPw] = useState('');
	const [msg, setMsg] = useState(null);
	const [busy, setBusy] = useState(false);

	async function again() {
		if (!pw) return setMsg({ k: 'ng', t: T('パスワードを入力してください') });
		setBusy(true); setMsg({ k: '', t: T('登録しています…') });
		try {
			const r = await registerAp(a.host, a.name, pw);
			if (r.error) setMsg({ k: 'ng', t: tr(r.error) }); else { setPw(''); setMsg(regMsg(r)); onChange(r); }
		} catch (e) { console.error('wifi: AP を登録し直せません', a.host, e); setMsg({ k: 'ng', t: T('登録できませんでした。ログインし直してください') }); }
		setBusy(false);
	}

	async function remove() {
		if (!await ask({ title: T('{name} の連携を解除', { name: a.name }), body: T('この AP の鍵をルーターから消します。AP に残る行は、この鍵がないと使えません'), ok: T('解除'), danger: true })) return;
		setBusy(true);
		try { onChange(await wifiHelper([ 'unregister', a.host ])); }
		catch (e) { console.error('wifi: AP の連携を解除できません', a.host, e); setMsg({ k: 'ng', t: T('解除できませんでした: ') + e.message }); setBusy(false); }
	}

	return html`<div class="f"><div class="f-k">${a.name}</div><div class="f-v">
		<div class="rowflex"><span class="grow">${a.host} ${T('・')} ${a.ok ? T('接続中の機器 {n} 台', { n: a.count }) : T('AP に接続できません')}</span><button class="btn" disabled=${busy} onClick=${remove}>${T('連携を解除')}</button></div>
		${!a.write || a.old ? html`<p class="muted small">${a.old ? T('AP 側の更新には、登録し直してください') : T('設定を変えるには、登録し直してください')}</p>
			<div class="rowflex" data-help="appw"><${PwInput} class="in" style="flex:1" autocomplete="off" placeholder=${T('root パスワード')} value=${pw} onInput=${e => setPw(e.target.value)} /><button class="btn primary" disabled=${busy} onClick=${again}>${T('登録し直す')}</button></div>` : null}
		${msg ? html`<div class=${'alert ' + msg.k}>${msg.t}</div>` : null}
	</div></div>`;
}

/* AP との連携の一覧と、追加の入力欄。1 台もなければ入力欄を開いておく */
function ApCard({ st, onChange }) {
	const [open, setOpen] = useState(false);
	const [host, setHost] = useState('');
	const [name, setName] = useState('');
	const [pw, setPw] = useState('');
	const [msg, setMsg] = useState(null);
	const [busy, setBusy] = useState(false);

	async function add() {
		if (!host.trim()) return setMsg({ k: 'ng', t: T('アドレスを入力してください') });
		if (st.aps.some(a => a.host === host.trim())) return setMsg({ k: 'ng', t: T('登録済みのアドレスです') });
		if (!pw) return setMsg({ k: 'ng', t: T('パスワードを入力してください') });
		setBusy(true); setMsg({ k: '', t: T('登録しています…') });
		try {
			const r = await registerAp(host, name, pw);
			if (r.error) setMsg({ k: 'ng', t: tr(r.error) });
			else { setPw(''); setHost(''); setName(''); setOpen(false); setMsg(regMsg(r)); onChange(r); }
		} catch (e) {
			console.error('wifi: AP を登録できません', e);
			setMsg({ k: 'ng', t: T('登録できませんでした。ログインし直してください') });
		}
		setBusy(false);
	}

	if (st.error) return html`<section class="card" data-help="ap"><h2>${T('AP との連携')}</h2><p class="muted small">${T('連携の状態を読めません。ログインし直してください')}</p></section>`;
	const form = open || !st.aps.length;
	return html`<section class="card"><h2 data-help="ap">${T('AP との連携')}</h2>
		${st.aps.map(a => html`<${ApRow} key=${a.host} a=${a} onChange=${onChange} />`)}
		${form ? html`
			<div class="f" data-help="aphost"><label class="f-k">${T('アドレス')}</label><div class="f-v"><input type="text" class="in full" spellcheck="false" placeholder="192.168.1.2" value=${host} onInput=${e => setHost(e.target.value)} /></div></div>
			<div class="f" data-help="apname"><label class="f-k">${T('名前')}</label><div class="f-v"><input type="text" class="in full" maxlength="32" placeholder="AP" value=${name} onInput=${e => setName(e.target.value)} /></div></div>
			<div class="f" data-help="appw"><label class="f-k">${T('root パスワード')}</label><div class="f-v"><${PwInput} class="in full" autocomplete="off" value=${pw} onInput=${e => setPw(e.target.value)} /></div></div>
			<div class="rowgap" data-help="apreg"><button class="btn primary" disabled=${busy} onClick=${add}>${T('登録')}</button>${st.aps.length ? html` <button class="btn" disabled=${busy} onClick=${() => { setOpen(false); setMsg(null); }}>${T('やめる')}</button>` : null}</div>`
		: html`<div class="rowgap" data-help="apreg"><button class="btn" onClick=${() => setOpen(true)}>${T('AP を追加')}</button></div>`}
		${msg ? html`<div class=${'alert ' + msg.k}>${msg.t}</div>` : null}
	</section>`;
}

/* 書き込みは 1 帯域ずつ。設定は一時ファイルで渡す (読んだ側が消す) */
async function saveLocal(w) {
	const path = '/tmp/.tachigui-wlan-local';
	await rpc('file', 'write', { path, data: JSON.stringify({ radios: [ w ] }), mode: 384 });
	const r = await execJson(WLAN, [ 'set', path ]);
	return !r ? T('応答を読めませんでした') : r.ok ? null : tr(r.error);
}
const saveAp = host => async w => {
	await rpc('file', 'write', { path: '/tmp/.tachigui-wlan-set', data: JSON.stringify({ radios: [ w ] }), mode: 384 });
	const r = await wifiHelper([ 'wlan', 'set', host ]);
	return r.ok ? null : tr(r.error) || T('変更できませんでした');
};

/* 折りたたんだ欄は、このブラウザに覚えておく (保存できなくても動く) */
const FOLD = 'tachigui.wifi.fold';
function loadFold() { try { return JSON.parse(localStorage.getItem(FOLD) || '[]'); } catch (e) { return []; } }
function saveFold(v) { try { localStorage.setItem(FOLD, JSON.stringify(v)); } catch (e) { /* 保存できなくても動く */ } }

/* 機器ごとの見出し。押すと、その機器のカードを折りたたむ。たたんだ間は、帯域と Wi-Fi 名だけを出す */
function Group({ title, sub, radios, folded, toggle, children }) {
	const brief = (radios || []).map(r => bandName(r.band) + (r.enabled ? ' ' + r.ssid : T(' オフ'))).join(T(' ・ '));
	return html`<div class="wgrp">
		<button type="button" class="wgrp-h clk" aria-expanded=${!folded} onClick=${toggle}><strong>${title}</strong><span class="muted small grow">${sub}${folded && brief ? T(' ・ ') + brief : ''}</span><span class=${'chev' + (folded ? '' : ' open')}></span></button>
		${folded ? null : children}
	</div>`;
}

function WifiPage() {
	const [local, setLocal] = useState(null);     // ルーター本体の帯域の一覧
	const [st, setSt] = useState(null);           // AP の連携の状態 { configured, aps }
	const [ap, setAp] = useState({});             // AP ごとの帯域の一覧 { アドレス: { radios } か { error } }
	const [note, setNote] = useState(null);
	const [fold, setFold] = useState(loadFold);   // 折りたたんだ機器 (アドレス、ルーター本体は local)
	const toggle = id => () => setFold(f => { const n = f.includes(id) ? f.filter(x => x !== id) : [ ...f, id ]; saveFold(n); return n; });

	const readLocal = () => execJson(WLAN, [ 'get' ]).then(r => { if (r && r.ok) setLocal(r.radios); else console.error('wifi: ルーターの無線を読めません', r); })
		.catch(e => console.error('wifi: ルーターの無線を読めません', e));
	/* 読めなかった回は、前の値を残す (カードが消えると、スクロールが一番上に戻るため) */
	const readAp = host => wifiHelper([ 'wlan', 'get', host ]).then(r => {
		if (r.ok) {
			setAp(x => ({ ...x, [host]: { radios: r.radios } }));
			if (r.old) setSt(x => x && x.aps ? { ...x, aps: x.aps.map(a => a.host === host ? { ...a, old: true } : a) } : x);
		} else setAp(x => ({ ...x, [host]: x[host] && x[host].radios ? { ...x[host], error: tr(r.error) } : { error: tr(r.error) || T('読めません') } }));
	}).catch(e => { console.error('wifi: AP の Wi-Fi を読めません', host, e); setAp(x => ({ ...x, [host]: x[host] && x[host].radios ? x[host] : { error: T('読めません') } })); });
	const readAps = s => {
		const on = (s.aps || []).filter(a => a.write);
		/* 外した台の分は消す */
		setAp(x => Object.fromEntries(Object.entries(x).filter(([ k ]) => on.some(a => a.host === k))));
		return Promise.all(on.map(a => readAp(a.host)));
	};
	const takeSt = s => { if (s && Array.isArray(s.aps)) { setSt(s); readAps(s); } };
	useEffect(() => {
		readLocal();
		wifiHelper([ 'status' ]).then(s => { if (s && Array.isArray(s.aps)) takeSt(s); else setSt({ error: true }); })
			.catch(e => { console.error('wifi: AP の状態を読めません', e); setSt({ error: true }); });
	}, []);

	/* 変更のあとは、Wi-Fi が読み直されるのを待ってから読み直す (GL.iNet の画面も 5 秒待つ) */
	const after = (fn, again) => async w => {
		const e = await fn(w);
		if (!e) { setNote(T('読み直しています…')); setTimeout(() => again().finally(() => setNote(null)), 6000); }
		return e;
	};

	const aps = st && st.aps ? st.aps : [];
	return html`<${HelpLayout} help=${HELP}><div class="stack narrowcol">
		${local && local.length ? html`<${Group} title=${T('このルーター')} sub="" radios=${byBand(local)} folded=${fold.includes('local')} toggle=${toggle('local')}>
			${byBand(local).map(r => html`<${RadioCard} key=${'l' + r.device} r=${r} src=${T('このルーター')} save=${after(saveLocal, readLocal)} />`)}
		<//>` : local ? html`<div class="wgrp"><div class="wgrp-h"><strong>${T('このルーター')}</strong><span class="muted small grow">${T('無線がありません')}</span></div></div>` : null}
		${aps.map(a => { const x = ap[a.host]; return x ? html`<${Group} key=${a.host} title=${a.name} sub=${a.host} radios=${x.radios && byBand(x.radios)} folded=${fold.includes(a.host)} toggle=${toggle(a.host)}>
			${x.radios ? byBand(x.radios).map(r => html`<${RadioCard} key=${a.host + r.device} r=${r} src=${a.name} save=${after(saveAp(a.host), () => readAp(a.host))} />`) : null}
			${x.error ? html`<div class="alert ng">${T('{name} の Wi-Fi を読めません: {err}', { name: a.name, err: x.error })}</div>` : null}
		<//>` : null; })}
		${note ? html`<div class="alert">${note}</div>` : null}
		${st ? html`<${ApCard} st=${st} onChange=${takeSt} />` : null}
	</div><//>`;
}

export function mount(root) {
	root.appendChild(Object.assign(document.createElement('div'), { className: 'page-title', innerHTML: '<h1>Wi-Fi</h1>' }));
	const host = document.createElement('div');
	root.appendChild(host);
	render(html`<${WifiPage} />`, host);
	return { stop() { render(null, host); } };
}
