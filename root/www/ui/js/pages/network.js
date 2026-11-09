/* ネットワーク設定: 接続タイプを選び、WAN / LAN / DHCP / DNS を、まとめて設定する (Preact) */
import { T, tr } from '../i18n.js';
import { html, render, useState, useEffect, useRef, PwInput } from '../ui-kit.js';
import { rpc, sys, execJson } from '../api.js';
import { ip6Compress } from '../util.js';
const wanOf = S => Object.keys(S.roles).find(n => S.roles[n] === 'wan');
import * as uci from '../uci.js';
import { ask } from '../dialog.js';
import { HelpLayout } from '../help.js';
import { TYPES, AFTR, DNS_MODES, DNS_CHOICES, isIPv6, ROLES, CONFIGS, APPLY_TIMEOUT, PD_WAIT, UP_WAIT, isIPv4, isMask, dnsList, initialState, writeConfig, rolesOf, lanPorts, reloadUci, setMap } from '../net/core.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
/* 内部の名前を、利用者の言葉に */
const IFNAME = { lan: 'LAN', wan: 'WAN', wan6: T('IPv6 (回線側)'), map0: 'MAP-E (IPv4)', dslite0: 'DS-Lite (IPv4)' };
const callIp6 = args => execJson('/usr/libexec/tachigui-ipv6', args).catch(() => null);

/* ---- 入力部品 (値は、S の中を、直接、書き換えて、再描画する) ---- */

/* help: 右側の説明欄 (NET_HELP) の鍵。desc は、値から計算する短い補足だけ (説明文は説明欄へ) */
function Field({ label, desc, help, on, children }) {
	return html`<div class="f" data-help=${help} data-help-on=${on}><label class="f-k">${label}</label><div class="f-v">${children}${desc ? html`<div class="f-d">${desc}</div>` : null}</div></div>`;
}

function Text({ o, k, rr, ...rest }) {
	return html`<input type="text" class="in" value=${o[k]} onInput=${e => { o[k] = e.target.value; rr(); }} ...${rest} />`;
}

function Num({ o, k, rr, ...rest }) {
	return html`<input type="number" class="in num" value=${o[k]} onInput=${e => { o[k] = parseInt(e.target.value, 10) || 0; rr(); }} ...${rest} />`;
}

function Check({ o, k, rr, label }) {
	const input = html`<input type="checkbox" class=${label ? null : 'tgl'} checked=${!!o[k]} onChange=${e => { o[k] = e.target.checked; rr(); }} />`;
	return label ? html`<label class="chk">${input} ${label}</label>` : input;      // 項目名だけの設定はトグル
}

function Pick({ o, k, rr, options, onChange }) {
	return html`<select class="in" value=${o[k]} onChange=${e => { o[k] = e.target.value; if (onChange) onChange(e.target.value); rr(); }}>
		${Object.keys(options).map(v => html`<option value=${v} selected=${o[k] === v}>${options[v]}</option>`)}
	</select>`;
}

/* more: ふだんは触らない項目。「詳細」を押したときだけ出す */
function Box({ title, children, note, more }) {
	const [open, setOpen] = useState(false);
	return html`<section class="card"><h2>${title}</h2>${note ? html`<p class="muted small">${note}</p>` : null}${children}
		${more ? html`<button type="button" class=${'more-t' + (open ? ' open' : '')} data-help="more" onClick=${() => setOpen(!open)}>${T('詳細')}</button>${open ? more : null}` : null}</section>`;
}

/* MAP-E の追加ルール: 値を確かめて、求まる結果を見せてから保存する */
function UserRules({ prefix }) {
	const empty = { n: '', p: '', l: '', v4: '', v4l: '', ea: '', off: '', br: '' };
	const [list, setList] = useState(null);
	const [open, setOpen] = useState(false);
	const [f, setF] = useState(empty);
	const [err, setErr] = useState(null);
	const call = args => rpc('tachigui.network', 'user_rules', args);

	useEffect(() => { call({ action: 'list' }).then(r => setList(r.rules || [])).catch(e => { console.error('network: 追加ルールを読めません', e); setErr(T('読めません。ログインし直してください')); }); }, []);

	async function add() {
		setErr(null);
		try {
			const t = await call({ action: 'test', rule: f, prefix: prefix || '' });
			if (!t.ok) return setErr(t.error);
			const r = t.rule, v = t.preview;
			const rows = [ [ T('回線名'), r.n || 'MAP-E' ], [ 'IPv6', r.p + '/' + r.l ], [ 'IPv4', r.v4 + '/' + r.v4l ], [ T('EA / オフセット'), r.ea + ' / ' + r.off ], [ 'BR', r.br ] ];
			if (v) rows.push([ T('求まる IPv4'), v.ipv4 ], [ T('ポート数'), String(v.port_count) ]);
			if (!await ask({ title: T('ルールを追加'), rows, footer: v ? '' : T('今の回線には一致しません'), ok: T('追加') })) return;
			const a = await call({ action: 'add', rule: f });
			if (!a.ok) return setErr(a.error);
			setList(a.rules);
			setF(empty);
			setOpen(false);
		} catch (e) { console.error('network: 追加ルールを保存できません', e); setErr(T('保存できませんでした: ') + e.message); }
	}

	async function del(r) {
		if (!await ask({ title: T('ルールを削除'), rows: [ [ 'IPv6', r.p + '/' + r.l ] ], ok: T('削除'), danger: true })) return;
		try {
			const a = await call({ action: 'del', rule: r });
			if (!a.ok) return setErr(a.error);
			setList(a.rules);
		} catch (e) { console.error('network: 追加ルールを削除できません', e); setErr(T('削除できませんでした: ') + e.message); }
	}

	const inp = (k, ph, label) => html`<${Field} label=${label} help="user_rules"><input type="text" class="in" spellcheck="false" placeholder=${ph} value=${f[k]} onInput=${e => setF({ ...f, [k]: e.target.value })} /><//>`;
	return html`<div class="userrules" data-help="user_rules">
		${(list || []).map(r => html`<div class="f"><div class="f-k">${r.n || 'MAP-E'}</div><div class="f-v rowflex"><span class="grow mono small">${r.p}/${r.l}</span><button class="btn" onClick=${() => del(r)}>${T('削除')}</button></div></div>`)}
		${open ? html`${inp('n', T('省略可'), T('回線名'))}${inp('p', '2001:db8::', T('IPv6 プレフィックス'))}${inp('l', '38', T('IPv6 の長さ'))}${inp('v4', '192.0.2.0', T('IPv4 プレフィックス'))}${inp('v4l', '22', T('IPv4 の長さ'))}${inp('ea', '18', T('EA ビット長'))}${inp('off', '4', T('PSID オフセット'))}${inp('br', '2001:db8::1', 'BR')}
			<div class="rowgap"><button class="btn primary" onClick=${add}>${T('確認')}</button><button class="btn" onClick=${() => { setOpen(false); setErr(null); }}>${T('やめる')}</button></div>`
		: html`<div class="rowgap"><button class="btn" onClick=${() => setOpen(true)}>${T('ルールを追加')}</button></div>`}
		${err ? html`<div class="alert ng">${err}</div>` : null}
	</div>`;
}

/* 右側の説明欄の中身 */
const NET_HELP = {
	type: { t: T('接続タイプ'), items: Object.keys(TYPES).map(k => [ k, TYPES[k].title, TYPES[k].help ]) },
	more: { t: T('詳細'), body: T('ふだんは変えなくてよい項目') },
	mtu: { t: 'MTU', body: T('1 回に送れるパケットの大きさ。MAP-E 1460、PPPoE 1454 が目安') },
	mac: { t: T('WAN の MAC'), body: T('前のルーターの MAC を入れると、NTT 側の記録の更新を待たずにつながる。空ならこのルーターの MAC') },
	relay: { t: T('LAN に IPv6 を中継'), body: T('/64 だけが配られる回線 (ひかり電話なし等) で、LAN の端末に IPv6 を使わせる。外からの新しい接続は遮断される') },
	legacy: { t: 'legacymap', body: T('日本の MAP-E (v6プラス等) では有効のまま') },
	prefix: { t: T('プレフィックス (手動)'), body: T('ONU につなぐ前に試すときだけ。空なら回線から受け取った値で判定') },
	aftr: { t: 'AFTR', body: T('DS-Lite の接続先。契約先 (transix / xpass / v6コネクト) に合わせる') },
	pppoe_v6: { t: T('IPv6 (IPoE) も使う'), body: T('同じ回線で IPoE の IPv6 も契約しているとき') },
	dhcp_v6: { t: T('IPv6 も取得'), body: T('回線から受け取った IPv6 を LAN の端末にも配る') },
	ports: { t: T('ポート'), items: [ [ 'wan', 'WAN', T('ONU・上位ルータにつなぐ') ], [ 'lan', 'LAN', T('端末をつなぐ') ], [ 'none', T('無効'), T('使わない') ] ] },
	user_rules: { t: T('追加ルール'), body: T('表にない MAP-E 回線の値を足す。同じ長さで一致したら同梱の表より優先する。値を誤るとつながらない') },
	detect: { t: T('自動判定'), body: T('回線を調べて接続タイプを選ぶ。適用するまで設定は変わらない。PPPoE は判定できない') },
	auto_wan: { t: T('自動で選ぶ'), body: T('空いているポートのうちリンクのあるものを WAN にする') },
	dns: { t: 'DNS', items: [ [ 'auto', T('自動'), T('回線事業者の DNS') ], [ 'custom', T('手動'), T('指定した DNS。IPv6 のアドレスは LAN の端末にも配る') ] ] },
	lan_ip: { t: T('ローカル IP アドレス'), body: T('このルーターのアドレス。変えると、適用後は新しいアドレスで開き直す') },
	mask: { t: T('サブネットマスク'), body: T('通常は 255.255.255.0') },
	domain: { t: T('ドメイン名'), body: T('LAN 内の名前に付く (例: pc.lan)') },
	gw: { t: T('ゲートウェイ'), body: T('上位ルータのアドレス。ゲートウェイと DNS に使う') },
	ap_v6: { t: 'IPv6', body: T('上位ルータからアドレスと経路をもらう。LAN の端末には影響しない') },
	dhcp: { t: T('DHCP サーバ'), body: T('LAN の端末にアドレスを配る。ブリッジでは通常無効にし、上位ルータが配る (2 台で配るとつながらなくなる)') },
	range: { t: T('配る範囲'), body: T('端末に配るアドレスの範囲') },
	lease: { t: T('リース時間'), body: T('配ったアドレスの有効期間。例: 12h, 1d, 30m') },
	preview: { t: T('変更内容を見る'), body: T('書き込まれる設定を表示するだけ (送信しない)') },
	apply: { t: T('適用'), body: T('つながらなくなったときは、自動で元に戻る (LAN のアドレス変更を除く)') }
};

function Dot({ ok, label }) {
	return html`<span class="dotl"><span class=${'dot ' + (ok ? 'ok' : 'ng')}></span>${label}</span>`;
}

/* ---- 確認ダイアログの、表の行 (変更前と後を、同じ形で作って、並べる) ---- */

const ip2n = s => s.split('.').reduce((a, x) => a * 256 + (parseInt(x, 10) || 0), 0);
const n2ip = n => [ 24, 16, 8, 0 ].map(b => Math.floor(n / 2 ** b) % 256).join('.');

/* DHCP の範囲を、実際のアドレスで (開始と台数は、ネットワークの先頭からの数) */
function dhcpRange(X) {
	if (!isIPv4(X.lan.ip) || !isMask(X.lan.mask)) return X.lan.start + '〜+' + X.lan.limit;
	const net = ip2n(X.lan.ip) - ip2n(X.lan.ip) % (2 ** 32 - ip2n(X.lan.mask));
	return n2ip(net + X.lan.start) + '〜' + n2ip(net + X.lan.start + X.lan.limit - 1);
}

/* X は、S か、読み込んだときの写し。項目の名前を鍵にして、値を返す (該当しない項目は、'-') */
function rowValues(X, st) {
	const t = X.type && TYPES[X.type];
	const router = t ? t.router : false;
	const r = rolesOf(X);
	const lab = n => { const d = st.devices.find(x => x.name === n); return d ? d.label : n; };
	return {
		[T('接続タイプ')]: t ? t.title : '-',
		[T('WAN ポート')]: router && r.wan ? lab(r.wan) : '-',
		[T('LAN ポート')]: r.lan.map(lab).join(', ') || '-',
		'AFTR': X.type === 'dslite' ? (X.dslite.aftr === 'custom' ? X.dslite.custom : AFTR[X.dslite.aftr].host) : '-',
		[T('ユーザー名')]: X.type === 'pppoe' ? X.pppoe.user : '-',
		[T('WAN アドレス')]: X.type === 'static' ? X.static.ip + ' / ' + X.static.mask + ' (GW ' + X.static.gw + ')' : '-',
		[T('このルーターのアドレス')]: X.lan.ip + ' / ' + X.lan.mask,
		[T('上位ルータ')]: router ? '-' : X.ap.gw || '-',
		[T('DHCP サーバ')]: X.lan.dhcp ? (router ? T('有効 ({range})', { range: dhcpRange(X) }) : T('有効 ({range}、配るゲートウェイと DNS は上位ルータ)', { range: dhcpRange(X) })) : T('無効') + (router ? '' : ' ' + T('(上位ルータが配る)')),
		'DNS': X.dns.mode === 'auto' ? T('自動') : dnsList(X).join(', ') || '-'
	};
}

/* 設定の写し (S は、入れ子の、素のオブジェクトだけ) */
const snap = X => JSON.parse(JSON.stringify(X));

const PRIVATE =/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)/;

/* ---- 本体 ---- */

function EasyPage() {
	const [ready, setReady] = useState(false);
	const [loadErr, setLoadErr] = useState(null);
	const [, tick] = useState(0);
	const rr = () => tick(n => n + 1);
	const ref = useRef({ S: null, S0: null, st: null, ip6: null });
	const R = ref.current;
	const [busy, setBusy] = useState(false);
	const [steps, setSteps] = useState([]);
	const [msg, setMsg] = useState(null);
	const [plan, setPlan] = useState(null);
	const [found, setFound] = useState(null);

	async function refresh() {
		const [ st, ip6 ] = await Promise.all([ sys.network(), callIp6([ 'status' ]) ]);
		R.st = st;
		if (ip6) R.ip6 = ip6;
		rr();
		return st;
	}

	useEffect(() => {
		(async () => {
			try {
				await uci.load(CONFIGS);
				await refresh();
				R.S = initialState(R.st);
				R.S0 = snap(R.S);
				setReady(true);
			} catch (e) { setLoadErr(e.message); }
		})();
		const t = setInterval(() => { if (!busy && R.S && !document.hidden) refresh().catch(() => {}); }, 5000);
		return () => clearInterval(t);
	}, []);

	if (loadErr) return html`<p class="warn-box">${T('読み込めませんでした:')} ${loadErr}</p>`;
	if (!ready) return html`<p class="muted">${T('読み込み中…')}</p>`;
	const { S, st, ip6 } = R;
	const type = S.type && TYPES[S.type];
	const router = type ? type.router : false;

	/* ---- 検証 ---- */
	function validate() {
		if (!S.type) return T('接続タイプを選んでください');
		const r = rolesOf(S);
		if (S.type === 'pppoe' && (!S.pppoe.user.trim() || !S.pppoe.pass.trim() && !st.pppoeHasPass)) { if (!S.pppoe.user.trim()) return T('PPPoE のユーザー名を入力してください'); if (!S.pppoe.pass.trim()) return T('PPPoE のパスワードを入力してください'); }
		if (S.type === 'static' && !(isIPv4(S.static.ip) && isMask(S.static.mask) && isIPv4(S.static.gw))) return T('WAN のアドレス・マスク・ゲートウェイを確かめてください');
		if (S.type === 'dslite' && S.dslite.aftr === 'custom' && !S.dslite.custom.trim()) return T('AFTR を入力してください');
		if (!isIPv4(S.lan.ip) || !isMask(S.lan.mask)) return T('ローカル IP アドレスとマスクを確かめてください');
		if (!router && !isIPv4(S.ap.gw)) return T('ゲートウェイ (上位ルータ) を確かめてください');
		if (router && !r.wan) return T('WAN のポートを 1 つ選んでください');
		if (!r.lan.length) return T('LAN のポートを 1 つ以上選んでください');
		if (S.lan.dhcp && (S.lan.start < 1 || S.lan.limit < 1)) return T('DHCP の範囲を確かめてください (終了は開始より後)');
		if (S.lan.dhcp && S.lan.start + S.lan.limit - 1 > 254) return T('DHCP の終了は 254 まで');
		if (S.dns.mode === 'custom') {
			const l = dnsList(S);
			if (!l.length) return T('DNS サーバを入力してください');
			const bad = l.find(x => !isIPv4(x) && !isIPv6(x));
			if (bad) return T('DNS サーバのアドレスが正しくありません: ') + bad;
		}
		return null;
	}

	/* ---- 確認ダイアログの内容 ---- */
	function summary() {
		const r = rolesOf(S);
		/* 今 (読み込んだとき / 前回の適用) と、変更後を、並べる。どちらも '-' の行は、関係ないので、出さない */
		const was = rowValues(R.S0, st), now = rowValues(S, st);
		const rows = Object.keys(now).filter(k => was[k] !== '-' || now[k] !== '-').map(k => [ k, was[k], now[k] ]);

		/* つながらなくなる、設定を、目立たせる */
		const warns = [];
		if (router && !S.lan.dhcp) warns.push({ level: 'ng', text: T('DHCP が無効です。LAN の端末がアドレスをもらえません') });
		if (!router && S.lan.dhcp) warns.push({ level: 'warn', text: T('上位ルータの DHCP は必ず止めてください (2 台あるとつながらなくなります)') });
		const privDns = dnsList(S).filter(x => PRIVATE.test(x));
		if (router && privDns.length) warns.push({ level: 'ng', text: T('DNS に LAN 内のアドレス ({list}) があります。その機器を外すと名前を引けません', { list: privDns.join(', ') }) });
		if (router && r.wan) {
			const wp = st.devices.find(d => d.name === r.wan);
			if (wp && !wp.carrier) warns.push({ level: 'warn', text: T('WAN ポート ({port}) にリンクがありません', { port: wp.label }) });
		}
		const lanNow = lanPorts();
		const dropped = st.devices.filter(d => d.carrier && lanNow.includes(d.name) && !r.lan.includes(d.name));
		if (dropped.length) warns.push({ level: 'ng', text: T('{ports} は今 LAN で使用中です。外すとこの画面に入れなくなることがあります', { ports: dropped.map(d => d.label).join(', ') }) });
		const lanChanged = S.lan.ip !== S.oldLan.ip || S.lan.mask !== S.oldLan.mask;
		if (lanChanged) warns.push({ level: 'warn', text: T('LAN のアドレスが {old} → {ip} に変わります。適用後は新しいアドレスで開き直してください (自動では戻りません)', { old: S.oldLan.ip, ip: S.lan.ip }) });
		return { rows, warns, lanChanged };
	}


	/* ---- 反映 ---- */
	async function applyConfig(rollback) {
		await uci.save();
		const ch = await uci.staged();
		if (!ch.length) return;
		await uci.apply(APPLY_TIMEOUT, rollback);
		if (rollback) {
			const deadline = Date.now() + APPLY_TIMEOUT * 1000;
			await sleep(1000);
			for (;;) {
				try { await uci.confirm(); break; }
				catch (e) {
					if (Date.now() >= deadline) throw new Error(T('適用を確認できず、元に戻しました'));
					await sleep(500);
				}
			}
		}
		await reloadUci();
	}

	const setStep = (i, s, t) => setSteps(list => list.map((x, k) => k === i ? { ...x, s, t: t || '' } : x));

	async function waitFor(i, label, limit, test) {
		const t0 = Date.now();
		let s = await refresh();
		while (!test(s)) {
			const sec = Math.round((Date.now() - t0) / 1000);
			if (sec >= limit) return null;
			setStep(i, 'run', label + ' ' + T('{n} 秒', { n: sec }));
			await sleep(3000);
			s = await refresh().catch(() => s);
		}
		return s;
	}

	const STEPS = {
		v6plus: [ T('設定の適用'), T('IPv6 プレフィックスの取得待ち'), T('MAP-E のルール判定'), T('MAP-E の設定'), T('接続確認') ],
		dslite: [ T('設定の適用'), T('IPv6 プレフィックスの取得待ち'), T('DS-Lite の接続待ち'), T('接続確認') ],
		pppoe: [ T('設定の適用'), T('PPPoE の接続待ち'), T('接続確認') ],
		dhcp: [ T('設定の適用'), T('アドレス取得待ち'), T('接続確認') ],
		static: [ T('設定の適用'), T('接続確認') ],
		ap: [ T('設定の適用'), T('接続確認') ]
	};

	/* 変更内容を、見るだけ (何も、送らない) */
	async function preview() {
		const err = validate();
		if (err) return setMsg({ k: 'ng', t: err });
		try {
			uci.discard();
			writeConfig(S, null);
			setPlan(uci.pending());
			uci.discard();
			await reloadUci();
		} catch (e) { setMsg({ k: 'ng', t: e.message }); }
	}

	async function runApply() {
		if (busy) return;
		const err = validate();
		if (err) return setMsg({ k: 'ng', t: err });
		const need = type.pkgs.filter(p => !st.packages[p]);

		const sm = summary();
		const okd = await ask({ title: T('設定を適用'), rows: sm.rows, warns: sm.warns, footer: (need.length ? T('先に {pkgs} を回線の IPv6 で取得します。', { pkgs: need.join(', ') }) : '') + T('つながらないときは約 {n} 秒で元に戻ります', { n: APPLY_TIMEOUT }), ok: T('適用') });
		if (!okd) return;

		setBusy(true);
		setMsg(null);
		/* MAP-E と DS-Lite のパッケージは、IPv4 がつながる前に、回線の IPv6 で取得する */
		if (need.length) {
			setMsg({ k: '', t: T('パッケージを取得しています…') });
			try {
				await fetchPkgs(need);
				await refresh();
				setMsg(null);
			} catch (e) {
				console.error('network: パッケージを取得できません', e);
				setMsg({ k: 'ng', t: e.message });
				setBusy(false);
				return;
			}
		}
		const t = S.type;
		setSteps(STEPS[t].map(name => ({ name, s: 'wait', t: '' })));
		let cur = 0;
		try {
			let map = null;
			if (t === 'v6plus' && S.v6plus.prefix.trim()) {
				const res = await rpc('tachigui.network', 'lookup', { prefix: S.v6plus.prefix.trim() });
				if (!res || res.error) throw new Error((res && tr(res.error)) || T('ルールの判定に失敗しました'));
				map = res.map;
			}

			setStep(cur, 'run');
			uci.discard();
			writeConfig(S, map);
			await applyConfig(!sm.lanChanged);
			await callIp6([ 'apply' ]);
			if (sm.lanChanged) {
				setStep(cur, 'ok', T('適用しました'));
				setMsg({ k: 'ok', t: T('適用しました。https://{ip}/ui/ で開き直してください', { ip: S.lan.ip }) });
				setBusy(false);
				return;
			}
			setStep(cur, 'ok');
			S.oldLan = { ip: S.lan.ip, mask: S.lan.mask };
			/* 適用できたので、次の確認ダイアログの「今」は、この内容 */
			R.S0 = snap(S);

			let s;
			if (t === 'v6plus') {
				cur = 1; setStep(cur, 'run');
				s = await waitFor(cur, T('待っています…'), 35, x => !!x.wan6.pd);
				let pd;
				if (s) pd = s.wan6.pd;
				else {
					/* プレフィックスが出ない回線 (ひかり電話なし等): 回線から RA で配られる /64 を、受け取って、固定で設定する */
					setStep(cur, 'run', T('プレフィックスが出ないので RA から取得しています…'));
					const ra = await rpc('tachigui.network', 'ra_probe', { dev: wanOf(S) });
					if (!ra || !ra.ok) throw new Error((ra && tr(ra.error)) || T('IPv6 のプレフィックスを取得できません。ONU の接続と、IPv6 接続の契約を確かめてください'));
					const head = ra.addr.slice(0, 16);
					pd = ip6Compress(head + '0000000000000000') + '/' + ra.plen;
					S.v6plus.ra = { addr: ip6Compress(ra.addr) + '/' + ra.plen, prefix: pd, gw: ip6Compress(ra.gw) };
					S.v6plus.is64 = true;
					uci.discard();
					writeConfig(S, null);
					await applyConfig(true);
				}
				S.v6plus.is64 = /\/64$/.test(pd);
				setStep(cur, 'ok', pd);

				cur = 2; setStep(cur, 'run');
				const res = await rpc('tachigui.network', 'lookup', { prefix: pd });
				if (!res || res.error) throw new Error((res && tr(res.error)) || T('ルールの判定に失敗しました'));
				setStep(cur, 'ok', (res.rule_name ? res.rule_name + ': ' : '') + res.ipv4 + ' / PSID ' + res.psid);

				cur = 3; setStep(cur, 'run');
				uci.discard();
				writeConfig(S, res.map);
				await applyConfig(true);
				await rpc('tachigui.network', 'ifup', { name: 'map0' }).catch(() => {});
				setStep(cur, 'ok');

				cur = 4; setStep(cur, 'run');
				s = await waitFor(cur, T('待っています…'), UP_WAIT, x => x.map.up && !!x.map.ipv4);
				if (!s) throw new Error(T('MAP-E が立ち上がりませんでした'));
			}
			else if (t === 'dslite') {
				cur = 1; setStep(cur, 'run');
				s = await waitFor(cur, T('待っています…'), PD_WAIT, x => !!x.wan6.pd);
				if (!s) throw new Error(T('IPv6 のプレフィックスを取得できません。ONU の接続と契約を確かめてください'));
				setStep(cur, 'ok', s.wan6.pd);
				cur = 2; setStep(cur, 'run');
				s = await waitFor(cur, T('待っています…'), UP_WAIT, x => x.ifaces.some(i => i.name === 'dslite0' && i.up));
				if (!s) throw new Error(T('DS-Lite がつながりません。AFTR を確かめてください'));
				setStep(cur, 'ok'); cur = 3;
			}
			else if (t === 'pppoe') {
				cur = 1; setStep(cur, 'run');
				s = await waitFor(cur, T('待っています…'), UP_WAIT, x => x.ifaces.some(i => i.name === 'wan' && i.up));
				if (!s) throw new Error(T('PPPoE がつながりません。ユーザー名・パスワード・回線を確かめてください'));
				setStep(cur, 'ok'); cur = 2;
			}
			else if (t === 'dhcp') {
				cur = 1; setStep(cur, 'run');
				s = await waitFor(cur, T('待っています…'), UP_WAIT, x => x.ifaces.some(i => i.name === 'wan' && i.up && i.ipv4));
				if (!s) throw new Error(T('IPv4 アドレスを取得できません。上位機器との接続を確かめてください'));
				setStep(cur, 'ok'); cur = 2;
			}
			else cur = 1;

			setStep(cur, 'run');
			let c = await rpc('tachigui.network', 'check');
			if (t === 'v6plus' && !(c && c.ok)) {
				/* NTT 側の記録 (前の機器の MAC) が、更新されるまで、数分かかることがある。待ちながら、確かめ直す */
				const t0 = Date.now();
				while (Date.now() - t0 < 210000 && !(c && c.ok)) {
					setStep(cur, 'run', T('NTT 側の更新を待っています… {n} 秒 (最大 3 分半)', { n: Math.round((Date.now() - t0) / 1000) }));
					await sleep(10000);
					c = await rpc('tachigui.network', 'check');
				}
			}
			await refresh();
			setStep(cur, c && c.ok ? 'ok' : 'ng', c && c.ok ? T('IPv4 で通信できます') : T('IPv4 の疎通を確認できませんでした'));
			setMsg(c && c.ok ? { k: 'ok', t: T('設定が完了しました') } : { k: 'warn', t: T('適用しましたが、インターネットに届きません。少し待ってから確かめてください') });
		} catch (e) {
			setStep(cur, 'ng');
			setMsg({ k: 'ng', t: e.message });
		} finally {
			setBusy(false);
		}
	}

	/* 導入は裏で動くので、終わるまで同じ呼び出しを繰り返す */
	async function fetchPkgs(need) {
		for (const p of need) {
			const t0 = Date.now();
			let r = await rpc('tachigui.network', 'install', { pkg: p, dev: wanOf(S) || '' });
			while (r && r.running) {
				if (Date.now() - t0 > 300000) throw new Error(T('{pkg} の取得に時間がかかりすぎています', { pkg: p }));
				await sleep(3000);
				r = await rpc('tachigui.network', 'install', { pkg: p, dev: wanOf(S) || '' });
			}
			if (!r || !r.ok) throw new Error((r && tr(r.error)) || T('{pkg} を取得できません', { pkg: p }));
			if (r.restarting) await sleep(8000);
		}
	}

	/* ---- 描画 ---- */
	const r = rolesOf(S);
	const aftrOpts = Object.keys(AFTR).reduce((o, k) => { o[k] = AFTR[k].label; return o; }, {});
	const needPkgs = type ? type.pkgs.filter(p => !st.packages[p]) : [];

	/* 接続タイプごとの項目。[ ふだん使う項目, 詳細 (たたむ) ] */
	function connFields() {
		const t = S.type;
		if (t === 'v6plus') return [ null, html`<${Field} label="MTU" help="mtu"><${Num} o=${S.v6plus} k="mtu" rr=${rr} min="1280" max="1500" /><//>
			<${Field} label=${T('WAN の MAC')} help="mac"><${Text} o=${S.v6plus} k="mac" rr=${rr} placeholder="aa:bb:cc:dd:ee:ff" /><//>
			<${Field} label=${T('LAN に IPv6 を中継')} help="relay"><${Check} o=${S.v6plus} k="relay" rr=${rr} /><//>
			<${Field} label="legacymap" help="legacy"><${Check} o=${S.v6plus} k="legacy" rr=${rr} /><//>
			<${Field} label=${T('プレフィックス (手動)')} help="prefix"><${Text} o=${S.v6plus} k="prefix" rr=${rr} placeholder=${T('例: 2404:7a80:1234:5600::/56')} /><//>
			<${UserRules} prefix=${S.v6plus.prefix.trim() || st.wan6.pd || ''} />` ];
		if (t === 'dslite') return [ html`<${Field} label="AFTR" help="aftr"><${Pick} o=${S.dslite} k="aftr" rr=${rr} options=${aftrOpts} /><//>
			${S.dslite.aftr === 'custom' ? html`<${Field} label=${T('AFTR (手動)')} help="aftr"><${Text} o=${S.dslite} k="custom" rr=${rr} placeholder="aftr.example.jp" /><//>` : null}`,
			html`<${Field} label="MTU" help="mtu"><${Num} o=${S.dslite} k="mtu" rr=${rr} min="1280" max="1500" /><//>` ];
		if (t === 'pppoe') return [ html`<${Field} label=${T('ユーザー名')}><${Text} o=${S.pppoe} k="user" rr=${rr} /><//>
			<${Field} label=${T('パスワード')}><${PwInput} class="in" autocomplete="off" value=${S.pppoe.pass} onInput=${e => { S.pppoe.pass = e.target.value; rr(); }} /><//>`,
			html`<${Field} label="MTU" help="mtu"><${Num} o=${S.pppoe} k="mtu" rr=${rr} min="1280" max="1500" /><//>
			<${Field} label=${T('IPv6 (IPoE) も使う')} help="pppoe_v6"><${Check} o=${S.pppoe} k="ipv6" rr=${rr} /><//>` ];
		if (t === 'dhcp') return [ html`<${Field} label=${T('IPv6 も取得')} help="dhcp_v6"><${Check} o=${S.dhcp} k="ipv6" rr=${rr} /><//>`, null ];
		if (t === 'static') return [ html`<${Field} label=${T('WAN の IP アドレス')}><${Text} o=${S.static} k="ip" rr=${rr} placeholder="203.0.113.2" /><//>
			<${Field} label=${T('サブネットマスク')} help="mask"><${Text} o=${S.static} k="mask" rr=${rr} /><//>
			<${Field} label=${T('ゲートウェイ')}><${Text} o=${S.static} k="gw" rr=${rr} /><//>`, null ];
		return [ null, null ];
	}

	function pickRole(name, v) {
		if (v === 'wan') Object.keys(S.roles).forEach(n => { if (S.roles[n] === 'wan') S.roles[n] = 'lan'; });
		S.roles[name] = v;
		rr();
	}

	/* 回線を調べて、接続タイプを選ぶ。適用はしない */
	async function detectLine() {
		let dev = wanOf(S);
		if (!dev || !st.devices.some(d => d.name === dev && d.carrier)) {
			const cand = st.devices.filter(d => d.carrier && S.roles[d.name] !== 'lan');
			if (cand.length !== 1) return setFound({ k: 'warn', t: cand.length ? T('リンクのあるポートが複数あります。WAN のポートを選んでください') : T('WAN にリンクがありません。ONU をつないでください') });
			pickRole(cand[0].name, 'wan');
			dev = cand[0].name;
		}
		setBusy(true);
		setFound({ k: '', t: T('回線を調べています…') });
		try {
			const r = await rpc('tachigui.network', 'detect', { dev });
			if (!r || !r.ok) setFound({ k: 'ng', t: (r && tr(r.error)) || T('判定できませんでした') });
			else if (!r.kind) setFound({ k: 'warn', t: T('判定できません') + (r.prefix ? ' (IPv6: ' + r.prefix + ')' : '') + T('。PPPoE か、表にない MAP-E の可能性があります') });
			else {
				S.type = r.kind;
				if (r.kind === 'dslite') S.dslite.aftr = r.aftr;
				const label = r.kind === 'v6plus' ? (r.name ? r.name + ' (MAP-E)' : 'MAP-E') : (r.kind === 'dslite' ? 'DS-Lite (' + ((AFTR[r.aftr] || {}).label || r.aftr).replace(/ \(.*$/, '') + ')' : 'DHCP');
				setFound({ k: 'ok', t: T('判定: {label}。確かめて適用してください', { label }) });
			}
		} catch (e) {
			console.error('network: 回線を判定できません', e);
			setFound({ k: 'ng', t: T('判定できませんでした: ') + e.message });
		}
		setBusy(false);
		rr();
	}

	function autoWan() {
		const cand = st.devices.filter(d => d.carrier && S.roles[d.name] !== 'lan');
		if (cand.length !== 1) return setMsg({ k: 'warn', t: cand.length ? T('リンクのあるポートが複数あります。手で選んでください') : T('空いているポートにリンクがありません。ONU をつないでから押してください') });
		Object.keys(S.roles).forEach(n => { if (S.roles[n] === 'wan') S.roles[n] = 'lan'; });
		S.roles[cand[0].name] = 'wan';
		rr();
	}

	const glob = ip6 && ip6.addrs ? ip6.addrs.find(a => a.scope === 'global') : null;
	const route6 = ip6 && ip6.routes ? ip6.routes[0] : null;
	const portOpts = router ? ROLES : { lan: ROLES.lan, none: ROLES.none };
	const ipBase = S.lan.ip.replace(/\.\d+$/, '.');

	const [ connMain, connMore ] = type ? connFields() : [ null, null ];

	return html`<${HelpLayout} help=${NET_HELP}><div class="netpage">
		<${Box} title=${T('WAN 接続タイプ')} more=${connMore}>
			<${Field} label=${T('接続タイプ')} help="type" on=${S.type || ''}>
				<select class="in" value=${S.type || ''} onChange=${e => { S.type = e.target.value || null; setFound(null); rr(); }}>
					<option value="">${T('— 選択してください —')}</option>
					${Object.keys(TYPES).map(k => html`<option value=${k} selected=${S.type === k}>${TYPES[k].title}</option>`)}
				</select>
			<//>
			<div class="rowgap"><button class="btn" data-help="detect" disabled=${busy} onClick=${detectLine}>${T('自動判定')}</button></div>
			${found ? html`<div class=${'alert ' + found.k}>${found.t}</div>` : null}
			${needPkgs.length ? html`<p class="muted small">${T('適用するときに')} ${needPkgs.join(', ')} ${T('を取得します')}</p>` : null}
			${connMain}
		<//>

		${type ? html`
		<${Box} title=${T('ポート割り当て')}>
			<div class="ports">${st.devices.map(d => html`<div class=${'port' + (S.roles[d.name] === 'wan' ? ' wan' : '') + (S.roles[d.name] === 'none' ? ' off' : '')} data-help="ports" data-help-on=${S.roles[d.name]}>
				<div class="port-h"><strong>${d.label}</strong><small>${d.name}</small></div>
				<${Dot} ok=${d.carrier} label=${d.carrier ? T('リンクあり') + (d.speed > 0 ? ' ' + d.speed + 'M' : '') : T('リンクなし')} />
				<select class="in" value=${S.roles[d.name]} onChange=${e => pickRole(d.name, e.target.value)}>
					${Object.keys(portOpts).map(k => html`<option value=${k} selected=${S.roles[d.name] === k}>${portOpts[k]}</option>`)}
				</select></div>`)}</div>
			${router ? html`<div class="rowgap"><button class="btn" data-help="auto_wan" onClick=${autoWan}>${T('ONU のポートを自動で選ぶ')}</button></div>` : html`<p class="muted small">${T('ブリッジでは全ポートが LAN')}</p>`}
		<//>

		<${Box} title=${T('DNS 設定')}>
			<div class="radios">${Object.keys(DNS_MODES).map(k => html`<label class="chk" data-help="dns" data-help-on=${k}><input type="radio" name="dnsmode" checked=${S.dns.mode === k} onChange=${() => { S.dns.mode = k; if (k === 'custom' && !S.dns.list.length) S.dns.list = [ '' ]; rr(); }} /> ${DNS_MODES[k]}</label>`)}</div>
			${S.dns.mode === 'custom' ? html`<div class="dnslist" data-help="dns" data-help-on="custom">
				${S.dns.list.map((v, i) => html`<div class="dnsrow"><input type="text" class="in" placeholder=${T('例: 1.1.1.1')} value=${v} onInput=${e => { S.dns.list[i] = e.target.value; rr(); }} /><button class="btn icon" title=${T('削除')} onClick=${() => { S.dns.list.splice(i, 1); if (!S.dns.list.length) S.dns.list = [ '' ]; rr(); }}>×</button></div>`)}
				<div class="dnsadd"><button class="btn" onClick=${() => { S.dns.list.push(''); rr(); }}>${T('＋ 追加')}</button>
					<select class="in" value="" onChange=${e => { const c = DNS_CHOICES[e.target.value]; if (c) { const have = S.dns.list.filter(x => x.trim()); c.list.forEach(a => { if (!have.includes(a)) have.push(a); }); S.dns.list = have; rr(); } e.target.value = ''; }}><option value="">${T('公開 DNS を追加…')}</option>${Object.keys(DNS_CHOICES).map(k => html`<option value=${k}>${DNS_CHOICES[k].label}</option>`)}</select></div>
			</div>` : null}
		<//>

		<${Box} title=${router ? T('ルーター IP') : T('IP アドレス設定')} more=${html`<${Field} label=${T('ドメイン名')} help="domain"><${Text} o=${S.sys} k="domain" rr=${rr} placeholder="lan" /><//>`}>
			<${Field} label=${T('ローカル IP アドレス')} help="lan_ip"><${Text} o=${S.lan} k="ip" rr=${rr} /><//>
			<${Field} label=${T('サブネットマスク')} help="mask"><${Text} o=${S.lan} k="mask" rr=${rr} /><//>
			${router ? null : html`<${Field} label=${T('ゲートウェイ')} help="gw"><${Text} o=${S.ap} k="gw" rr=${rr} placeholder="192.168.1.1" /><//>
			<${Field} label="IPv6" help="ap_v6"><${Check} o=${S.ap} k="ipv6" rr=${rr} label=${T('上位ルータから受け取る')} /><//>`}
		<//>

		<${Box} title=${T('DHCP サーバ設定')} note=${router ? null : T('ブリッジでは通常無効 (上位ルータが配る)')} more=${html`<${Field} label=${T('リース時間')} help="lease"><${Text} o=${S.lan} k="lease" rr=${rr} style="width:8em" /><//>`}>
			<${Field} label=${T('DHCP サーバ')} help="dhcp"><${Check} o=${S.lan} k="dhcp" rr=${rr} /><//>
			<${Field} label=${T('開始 IP アドレス')} help="range"><span class="mono">${ipBase}</span><${Num} o=${S.lan} k="start" rr=${rr} min="1" max="254" style="width:6em" /><//>
			<${Field} label=${T('終了 IP アドレス')} help="range" desc=${ipBase + S.lan.start + '〜' + ipBase + (S.lan.start + S.lan.limit - 1) + ' (' + T('{n} 台', { n: S.lan.limit }) + ')'}><span class="mono">${ipBase}</span><input type="number" class="in num" min="1" max="254" style="width:6em" value=${S.lan.start + S.lan.limit - 1} onInput=${e => { const end = parseInt(e.target.value, 10); S.lan.limit = Math.max(1, (end || 0) - S.lan.start + 1); rr(); }} /><//>
		<//>

		${steps.length ? html`<section class="card"><h2>${T('進み具合')}</h2><ul class="steps">${steps.map((x, i) => html`<li class=${'step ' + x.s}><span class="step-i">${{ wait: '○', run: '⏳', ok: '✅', ng: '❌' }[x.s]}</span><strong>${i + 1}. ${x.name}</strong>${x.t ? html`<span class="muted"> ${x.t}</span>` : null}</li>`)}</ul></section>` : null}
		${msg ? html`<div class=${'alert ' + msg.k}>${msg.t}</div>` : null}
		${plan ? html`<section class="card"><h2>${T('変更内容 (未送信)')}<button class="btn icon" title=${T('閉じる')} onClick=${() => setPlan(null)}>×</button></h2>${plan.length ? html`<pre class="plan">${plan.join('\n')}</pre>` : html`<p class="muted">${T('変更なし')}</p>`}</section>` : null}

		<div class="actions">
			<button class="btn" disabled=${busy} data-help="preview" onClick=${preview}>${T('変更内容を見る')}</button>
			<button class="btn primary" disabled=${busy} data-help="apply" onClick=${runApply}>${T('適用')}</button>
		</div>` : null}
	</div><//>`;
}

export function mount(root) {
	const host = document.createElement('div');
	root.appendChild(Object.assign(document.createElement('div'), { className: 'page-title', innerHTML: '<h1>' + T('ネットワーク設定') + '</h1>' }));
	root.appendChild(host);
	render(html`<${EasyPage} />`, host);
	return { stop() { render(null, host); } };
}
