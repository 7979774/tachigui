/* LED: 簡易設定 (分かっている機種は 3 択、ほかは 初期設定 / 消灯) と、詳細設定 (見つかった LED を 1 つずつ) */
import { T, tr } from '../i18n.js';
import { html, render, useState, useEffect } from '../ui-kit.js';
import { sys, rpc } from '../api.js';
import { ask } from '../dialog.js';
import { HelpLayout } from '../help.js';

const PREFIX = 'tachigui_led_';
const secName = led => PREFIX + led.replace(/[^A-Za-z0-9]/g, '_');

/*
 * 分かっている配線 (機種ごとの対応表)。
 * igc3: Intel igc のポートに LED が 3 つずつ。BKHD-1264-SFP で実際に調べた配線: 0 = 左の緑、1 = 左のオレンジ、2 = 右。
 * (x86 のミニ PC は、機種名が「INTEL Default string」などで判別できないため、LED の並びで見分ける)
 */
const PROFILES = [ {
	id: 'igc3',
	title: T('Intel igc のポート (BKHD-1264-SFP で確かめた配線)'),
	match: leds => {
		const igc = leds.filter(l => /^igc-[0-9a-f]{4}-led[0-2]$/.test(l.name));
		const heads = [ ...new Set(igc.map(l => l.name.slice(0, -5))) ];
		return heads.length && heads.every(h => [ 0, 1, 2 ].every(n => igc.some(l => l.name === h + '-led' + n))) ? igc : null;
	},
	part: name => [ T('左 (緑)'), T('左 (橙)'), T('右') ][+name.slice(-1)],
	/* 左は 1 つのランプを 2 本 (緑 led0 / オレンジ led1) で光らせる。2 本が同時に点くと、左は消える (実機で確認) */
	clash: (name, v, conf) => {
		const n = +name.slice(-1);
		if (n > 1) return null;
		const other = conf[name.slice(0, -1) + (1 - n)] || null;
		const both = overlap(lit(v), lit(other));
		return both ? T('緑と橙が同時に点くと左は消えます ({ports})', { ports: both }) : null;
	},
	/* 簡易設定の 3 択: LED の番号ごとの設定 (null は消灯) */
	modes: [
		[ 'normal', T('通常'), T('左: リンク (緑 2.5G / 橙 1G 以下)、右: 通信で点滅'), [ 'link_2500', 'link_10 link_100 link_1000', 'link tx rx' ] ],
		[ 'link', T('リンクのみ'), T('左: リンク (緑 2.5G / 橙 1G 以下)、右: 消灯'), [ 'link_2500', 'link_10 link_100 link_1000', null ] ],
		[ 'off', T('消灯'), T('すべて消灯'), [ null, null, null ] ]
	]
} ];

/* 対応表にない機種の簡易設定 (ポートに付いた LED が対象) */
const GENERIC_MODES = [ [ 'off', T('消灯'), T('すべて消灯') ] ];

const TRIGGER_NAMES = { none: T('消灯'), 'default-on': T('常時点灯'), timer: T('点滅'), heartbeat: T('ハートビート'), netdev: T('ポートに連動') };
const TRIGGER_HINTS = { 'default-on': T('ケーブルなしでも点灯') };
/* ポートに連動: 点灯 (リンク中は点きっぱなし。link = すべての速度、link_* = その速度だけ) と、点滅 (通信のたび) */
const LIGHT = [ [ 'link', T('すべての速度') ] ];
const BLINK = [ [ 'tx', T('送信') ], [ 'rx', T('受信') ] ];

/* 右側の説明欄 (help.js) の中身 */
const HELP = {
	trigger: { t: T('光り方'), items: [
		[ 'none', T('消灯'), T('ずっと消灯') ],
		[ 'default-on', T('常時点灯'), T('ケーブルの有無に関係なく点灯') ],
		[ 'timer', T('点滅'), T('一定の間隔で点滅') ],
		[ 'heartbeat', T('ハートビート'), T('心拍のように 2 回ずつ点滅。負荷が高いほど速い') ],
		[ 'netdev', T('ポートに連動'), T('ポートのリンクや通信に合わせて光る') ],
		[ 'other', T('その他'), T('キーボード連動など。ルーターでは使わない') ]
	] },
	port: { t: T('ポート'), body: T('連動させるポート。ランプが付いたポート以外も選べる') },
	light: { t: T('点灯'), body: T('リンク中は点きっぱなし'), items: [ [ 'link', T('すべての速度'), T('速度を問わず点灯') ], [ 'speed', '10M〜2.5G', T('選んだ速度でリンクしたときだけ点灯') ] ] },
	blink: { t: T('点滅'), body: T('通信のたびに点滅'), items: [ [ 'tx', T('送信'), T('データを送るとき') ], [ 'rx', T('受信'), T('データを受け取るとき') ] ] },
	timer: { t: T('点灯 / 消灯'), body: T('1 回の点灯と消灯の長さ (ミリ秒)') },
	bright: { t: T('明るさ'), body: T('常時点灯のときの明るさ') },
	save: { t: T('保存'), body: T('すぐ反映。再起動後も残る') },
	reset: { t: T('リセット'), body: T('TachiGUI の設定を消す。初期設定に戻るのは再起動後') }
};
const ALL_SPEEDS = [ '10', '100', '1000', '2500', '5000', '10000' ];
const speedText = s => s >= 1000 ? s / 1000 + ' Gbps' : s + ' Mbps';
const modesOf = c => (c && c.mode || '').split(' ').filter(Boolean);

/* 速度の並びを、短く (10・100・1000 は「1 Gbps 以下」。簡易設定の説明と同じ言い方) */
function speedsText(list) {
	const s = list.map(Number).sort((a, b) => a - b);
	if (s.join() === '10,100,1000') return T('1 Gbps 以下');
	return s.map(speedText).join(T('・'));
}

/* UCI の設定 (無ければ null) を、短い句に。例: 「2.5 Gbps リンクで点灯」。own (その LED のポート) 以外を見るときだけ、ポート名を付ける */
function describe(c, label, own) {
	if (!c) return T('初期設定');
	if (c.trigger === 'none') return T('消灯');
	if (c.trigger === 'default-on') return T('常時点灯') + (c.brightness ? ' ' + T('(明るさ {n})', { n: c.brightness }) : '');
	if (c.trigger === 'timer') return T('点滅 ({on} / {off} ms)', { on: c.delayon || 500, off: c.delayoff || 500 });
	if (c.trigger === 'heartbeat') return T('ハートビート');
	if (c.trigger === 'netdev') {
		const m = modesOf(c);
		const speeds = m.filter(x => x.startsWith('link_')).map(x => x.slice(5));
		const tx = m.includes('tx'), rx = m.includes('rx');
		const parts = [];
		if (m.includes('link')) parts.push(T('リンクで点灯'));
		else if (speeds.length) { const t = speedsText(speeds); parts.push(t === T('1 Gbps 以下') ? T('{s}のリンクで点灯', { s: t }) : T('{s} リンクで点灯', { s: t })); }
		if (tx || rx) parts.push(tx && rx ? T('通信で点滅') : tx ? T('送信で点滅') : T('受信で点滅'));
		return (c.dev && c.dev !== own ? label(c.dev) + ': ' : '') + (parts.join(T('・')) || T('条件なし (点灯しない)'));
	}
	return c.trigger;
}

/* その設定で、ランプが点く条件 ('all' = いつも / 速度の集合 + 'traffic' = 通信中) */
function lit(c) {
	if (!c) return null;
	if (c.trigger === 'default-on' || c.trigger === 'timer' || c.trigger === 'heartbeat') return 'all';
	if (c.trigger !== 'netdev') return null;
	const m = modesOf(c);
	const s = new Set(m.includes('link') ? ALL_SPEEDS : m.filter(x => x.startsWith('link_')).map(x => x.slice(5)));
	if (m.includes('tx') || m.includes('rx')) s.add('traffic');
	return s.size ? s : null;
}
/* 2 つの条件が重なる場面を、言葉で (重ならなければ null) */
function overlap(a, b) {
	if (!a || !b) return null;
	if (a === 'all' || b === 'all') return T('常時');
	const both = [ ...a ].filter(x => b.has(x));
	if (!both.length) return null;
	const sp = both.filter(x => x !== 'traffic');
	return [ sp.length ? (speedsText(sp) === T('1 Gbps 以下') ? T('{s}のリンク時', { s: speedsText(sp) }) : T('{s} リンク時', { s: speedsText(sp) })) : null, both.includes('traffic') ? T('通信時') : null ].filter(Boolean).join(T('・'));
}

/* 簡易設定の、どの選択肢に当たるか: 'default' (設定なし) / 選択肢の id / 'custom' (個別の設定) */
function wantOf(profile, m, l) {
	const mode = profile ? m[3][+l.name.slice(-1)] : null;
	return mode ? { trigger: 'netdev', dev: l.port, mode } : { trigger: 'none' };
}
function sameAs(c, w) {
	return !!c && c.trigger === w.trigger && (w.trigger !== 'netdev' || (c.dev === w.dev && modesOf(c).sort().join(' ') === w.mode.split(' ').sort().join(' ')));
}
function simpleState(d) {
	const modes = d.profile ? d.profile.modes : GENERIC_MODES;
	if (d.targets.every(l => !d.conf[l.name])) return 'default';
	const m = modes.find(m => d.targets.every(l => sameAs(d.conf[l.name], wantOf(d.profile, m, l))));
	return m ? m[0] : 'custom';
}

function Page() {
	const [d, setD] = useState(null);           // { leds, conf: { sysfs: { sec, ...values } }, ports: [{ name, label }], profile, targets }
	const [tab, setTab] = useState('simple');
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState(null);

	async function load() {
		const [ r, st, u ] = await Promise.all([ rpc('tachigui.network', 'leds'), sys.network(), rpc('uci', 'get', { config: 'system', type: 'led' }).catch(() => null) ]);
		const leds = (r && r.leds) || [];
		const conf = {};
		for (const [ sec, v ] of Object.entries((u && u.values) || {})) if (v.sysfs) conf[v.sysfs] = { ...v, sec };
		const ports = (st.devices || []).map(x => ({ name: x.name, label: x.label || x.name }));
		let profile = null, targets = null;
		for (const p of PROFILES) { const m = p.match(leds); if (m) { profile = p; targets = m; break; } }
		if (!profile) targets = leds.filter(l => l.port);
		setD({ leds, conf, ports, profile, targets });
	}
	useEffect(() => { load().catch(e => setMsg({ k: 'ng', t: T('読み込めませんでした: ') + e.message })); }, []);

	if (!d) return html`${msg ? html`<div class=${'alert ' + msg.k}>${msg.t}</div>` : html`<p class="muted">${T('読み込み中…')}</p>`}`;
	if (!d.leds.length) return html`<section class="card"><p class="muted">${T('操作できるランプがありません')}</p></section>`;

	const portLabel = n => (d.ports.find(p => p.name === n) || { label: n || '-' }).label;
	/* 対応表にある LED は「ETH0 左 (緑)」、ポートだけ分かる LED は「ETH0」、どちらも無ければ元の名前 */
	const ledLabel = l => (l.port ? portLabel(l.port) + ' ' : '') + (d.profile && d.targets.includes(l) ? d.profile.part(l.name) : (l.port ? '' : l.name));

	/* 同じ LED の、ほかの設定 (LuCI などで作ったもの) も消して、1 つにする */
	async function dropFor(names) {
		const u = await rpc('uci', 'get', { config: 'system', type: 'led' });
		for (const [ sec, v ] of Object.entries((u && u.values) || {}))
			if (names.includes(v.sysfs)) await rpc('uci', 'delete', { config: 'system', section: sec });
	}
	async function finish(okText, restart) {
		await rpc('uci', 'commit', { config: 'system' });
		if (restart) await sys.exec('/etc/init.d/led', [ 'restart' ]);
		await load();
		setMsg({ k: restart ? 'ok' : 'warn', t: okText });
	}
	async function guarded(fn) {
		setBusy(true); setMsg(null);
		try { await fn(); }
		catch (e) {
			console.error('LED の設定に失敗しました', e);
			/* 消しかけの変更を残すと、ほかのページで system を保存したときに、一緒に確定してしまう */
			await rpc('uci', 'revert', { config: 'system' }).catch(e2 => console.warn('LED: 変更を取り消せません', e2));
			setMsg({ k: 'ng', t: T('反映できませんでした: ') + e.message });
		}
		setBusy(false);
	}

	/* 簡易設定の説明は、機種ごとの選択肢から作る */
	const help = { ...HELP, simple: { t: T('簡易設定'), items: (d.profile ? d.profile.modes : GENERIC_MODES).map(m => [ m[0], m[1], m[2] ]) } };
	/* 簡易 / 詳細の切り替えは、説明欄の外に置く (説明欄の上端を、設定の枠にそろえる) */
	return html`<div class="chips">${[ [ 'simple', T('簡易設定') ], [ 'detail', T('詳細設定') ] ].map(([ k, t ]) => html`<button type="button" class=${'chip pick' + (tab === k ? ' on' : '')} onClick=${() => { setTab(k); setMsg(null); }}>${t}</button>`)}</div>
		<${HelpLayout} help=${help}>
		${tab === 'simple'
			? html`<${Simple} d=${d} busy=${busy} portLabel=${portLabel} dropFor=${dropFor} finish=${finish} guarded=${guarded} />`
			: html`<${Detail} d=${d} busy=${busy} portLabel=${portLabel} ledLabel=${ledLabel} dropFor=${dropFor} finish=${finish} guarded=${guarded} />`}
		${msg ? html`<div class=${'alert ' + msg.k}>${msg.t}</div>` : null}
	<//>`;
}

/* ---- 簡易設定 ---- */

function Simple({ d, busy, portLabel, dropFor, finish, guarded }) {
	const { profile, targets } = d;
	const modes = profile ? profile.modes : GENERIC_MODES;
	if (!targets.length) return html`<section class="card narrow"><p class="muted">${T('対象のランプがありません (詳細設定を使ってください)')}</p></section>`;

	/* 今の設定が、どの選択肢に当たるか (どれにも当たらなければ、詳細設定で個別に変えたもの) */
	const current = simpleState(d);

	const apply = m => guarded(async () => {
		if (current === 'custom' && !await ask({ title: T('個別設定を上書き'), body: T('「{name}」で置き換えます', { name: m[1] }), ok: T('上書き') })) return;
		const names = targets.map(l => l.name);
		await dropFor(names);
		for (const l of targets) {
			const w = wantOf(profile, m, l);
			const values = w.trigger === 'netdev' ? { sysfs: l.name, trigger: 'netdev', dev: w.dev, mode: w.mode } : { sysfs: l.name, trigger: 'none', default: '0' };
			await rpc('uci', 'add', { config: 'system', type: 'led', name: secName(l.name), values });
		}
		await finish(T('反映しました'), true);
	});
	const reset = () => guarded(async () => {
		if (!await ask({ title: T('設定をリセット'), body: T('再起動後に初期設定に戻ります'), ok: T('リセット'), danger: true })) return;
		await dropFor(targets.map(l => l.name));
		await finish(T('リセットしました。再起動後に初期設定に戻ります'), false);
	});

	const note = current === 'default' ? T('初期設定')
		: current === 'custom' ? T('詳細設定で個別に設定中')
		: modes.find(m => m[0] === current)[2];
	const ports = [ ...new Set(targets.map(l => l.port).filter(Boolean)) ].map(portLabel);
	return html`<section class="card narrow"><h2>${T('ポートのランプ')}</h2>
		<div class="chips">${modes.map(m => html`<button type="button" class=${'chip pick' + (current === m[0] ? ' on' : '')} data-help="simple" data-help-on=${m[0]} disabled=${busy} onClick=${() => apply(m)}>${m[1]}</button>`)}</div>
		<p class="muted small">${note}</p>
		<p class="muted small">${T('対象:')} ${ports.join(T('・')) || targets.map(l => l.name).join(T('・'))}${profile ? '' : T(' (色・速度は詳細設定で)')}</p>
		<div class="rowgap"><button class="btn" data-help="reset" disabled=${busy || current === 'default'} onClick=${reset}>${T('リセット')}</button></div>
	</section>`;
}

/* ---- 詳細設定 ---- */

function Detail({ d, busy, portLabel, ledLabel, dropFor, finish, guarded }) {
	/* 簡易設定との関係 (同じ設定を、別の言葉で見ているだけ、と分かるように) */
	const st = d.targets.length ? simpleState(d) : null;
	const m = st && (d.profile ? d.profile.modes : GENERIC_MODES).find(x => x[0] === st);
	const rel = !st ? null : st === 'default' ? T('初期設定') : m ? T('簡易設定:「{name}」', { name: m[1] }) : T('個別設定');
	return html`<section class="card narrow"><h2>${T('ランプごとの設定')}</h2>
		${rel ? html`<p class="muted small">${rel}</p>` : null}
		${d.leds.map(l => html`<${LedRow} key=${l.name} l=${l} c=${d.conf[l.name] || null} conf=${d.conf} clash=${d.profile && d.targets.includes(l) && d.profile.clash} ports=${d.ports} busy=${busy} portLabel=${portLabel} label=${ledLabel(l)} dropFor=${dropFor} finish=${finish} guarded=${guarded} />`)}
	</section>`;
}

/* 1 つの LED の編集欄。f は編集中の値 (UCI と同じ名前) */
function initial(l, c) {
	if (c) return { trigger: c.trigger || 'none', dev: c.dev || l.port || '', mode: (c.mode || '').split(' ').filter(Boolean), delayon: +c.delayon || 500, delayoff: +c.delayoff || 500, brightness: +c.brightness || l.max_brightness };
	return { trigger: l.trigger, dev: l.dev || l.port || '', mode: l.modes || [ 'link' ], delayon: l.delay_on || 500, delayoff: l.delay_off || 500, brightness: l.max_brightness };
}

function LedRow({ l, c, conf, clash, ports, busy, portLabel, label, dropFor, finish, guarded }) {
	const [f, setF] = useState(() => initial(l, c));
	useEffect(() => setF(initial(l, c)), [ c ]);
	const up = (k, v) => setF({ ...f, [k]: v });
	const toggle = m => up('mode', f.mode.includes(m) ? f.mode.filter(x => x !== m) : [ ...f.mode, m ]);

	/* 選べる点灯の条件: よく使うものを先に、キーボード連動などは「その他」 */
	const main = Object.keys(TRIGGER_NAMES).filter(t => l.triggers.includes(t));
	const other = l.triggers.filter(t => !TRIGGER_NAMES[t]);
	const speeds = l.speeds && l.speeds.length ? l.speeds : [];

	function values() {
		const v = { sysfs: l.name, trigger: f.trigger };
		if (f.trigger === 'none') v.default = '0';
		if (f.trigger === 'default-on') { v.default = '1'; if (l.max_brightness > 1) v.brightness = String(f.brightness); }
		if (f.trigger === 'netdev') { v.dev = f.dev; v.mode = f.mode.join(' '); }
		if (f.trigger === 'timer') { v.delayon = String(f.delayon); v.delayoff = String(f.delayoff); }
		return v;
	}
	/* 編集中の値で、同時点灯 (左が消える) にならないか */
	const live = clash ? clash(l.name, values(), conf) : null;
	const save = () => guarded(async () => {
		if (f.trigger === 'netdev' && (!f.dev || !f.mode.length)) throw new Error(T('ポートと点灯か点滅を選んでください'));
		if (f.trigger === 'timer' && (f.delayon < 1 || f.delayoff < 1)) throw new Error(T('点滅の時間は 1 ms 以上'));
		const v = values();
		const warn = clash ? clash(l.name, v, conf) : null;
		if (!await ask({ title: label.trim() || l.name, rows: [ [ T('設定'), describe(c, portLabel, l.port), describe(v, portLabel, l.port) ] ], warns: warn ? [ { level: 'warn', text: warn } ] : [], ok: T('保存') })) return;
		await dropFor([ l.name ]);
		await rpc('uci', 'add', { config: 'system', type: 'led', name: secName(l.name), values: v });
		await finish(T('保存しました'), true);
	});
	const clear = () => guarded(async () => {
		if (!await ask({ title: T('設定をリセット'), body: (label.trim() || l.name) + '\n' + T('再起動後に初期設定に戻ります'), ok: T('リセット'), danger: true })) return;
		await dropFor([ l.name ]);
		await finish(T('リセットしました。再起動後に初期設定に戻ります'), false);
	});

	return html`<div class="ledrow">
		<div class="ledrow-h"><strong>${label.trim() || l.name}</strong>${label.trim() && label.trim() !== l.name ? html` <span class="muted small mono">${l.name}</span>` : null}
			<div class="muted small">${describe(c, portLabel, l.port)}</div></div>
		<div class="f" data-help="trigger" data-help-on=${TRIGGER_NAMES[f.trigger] ? f.trigger : 'other'}><label class="f-k">${T('光り方')}</label><div class="f-v">
			<select class="in" value=${f.trigger} disabled=${busy} onChange=${e => up('trigger', e.target.value)}>
				${main.map(t => html`<option value=${t} selected=${f.trigger === t}>${TRIGGER_NAMES[t]}</option>`)}
				${other.length ? html`<optgroup label=${T('その他')}>${other.map(t => html`<option value=${t} selected=${f.trigger === t}>${t}</option>`)}</optgroup>` : null}
			</select></div></div>
		${TRIGGER_HINTS[f.trigger] ? html`<div class="f-d ledrow-hint">${TRIGGER_HINTS[f.trigger]}</div>` : null}
		${f.trigger === 'netdev' ? html`
			<div class="f" data-help="port"><label class="f-k">${T('ポート')}</label><div class="f-v">
				<select class="in" value=${f.dev} disabled=${busy} onChange=${e => up('dev', e.target.value)}>
					${f.dev && !ports.some(p => p.name === f.dev) ? html`<option value=${f.dev} selected>${f.dev}</option>` : null}
					${ports.map(p => html`<option value=${p.name} selected=${f.dev === p.name}>${p.label}</option>`)}
				</select></div></div>
			<div class="f" data-help="light"><label class="f-k">${T('点灯')}</label><div class="f-v">
				${LIGHT.concat(speeds.map(s => [ 'link_' + s, speedText(+s).replace(' Mbps', 'M').replace(' Gbps', 'G') ])).map(([ m, t ]) => html`<label class="chk" data-help="light" data-help-on=${m === 'link' ? 'link' : 'speed'} style="margin-right:.8rem"><input type="checkbox" checked=${f.mode.includes(m)} disabled=${busy} onChange=${() => toggle(m)} /> ${t}</label>`)}
				${speeds.length ? null : html`<div class="f-d">${T('速度は一度保存すると選べます')}</div>`}
			</div></div>
			<div class="f" data-help="blink"><label class="f-k">${T('点滅')}</label><div class="f-v">
				${BLINK.map(([ m, t ]) => html`<label class="chk" data-help="blink" data-help-on=${m} style="margin-right:.8rem"><input type="checkbox" checked=${f.mode.includes(m)} disabled=${busy} onChange=${() => toggle(m)} /> ${t}</label>`)}
			</div></div>` : null}
		${f.trigger === 'timer' ? html`
			<div class="f" data-help="timer"><label class="f-k">${T('点灯 / 消灯 (ms)')}</label><div class="f-v">
				<input type="number" class="in num" min="1" value=${f.delayon} disabled=${busy} onInput=${e => up('delayon', parseInt(e.target.value, 10) || 0)} />
				<span class="muted"> / </span>
				<input type="number" class="in num" min="1" value=${f.delayoff} disabled=${busy} onInput=${e => up('delayoff', parseInt(e.target.value, 10) || 0)} /></div></div>` : null}
		${f.trigger === 'default-on' && l.max_brightness > 1 ? html`
			<div class="f" data-help="bright"><label class="f-k">${T('明るさ')}</label><div class="f-v">
				<input type="range" min="1" max=${l.max_brightness} value=${f.brightness} disabled=${busy} onInput=${e => up('brightness', +e.target.value)} /> ${f.brightness} / ${l.max_brightness}</div></div>` : null}
		${live ? html`<div class="alert warn">${live}</div>` : null}
		<div class="modal-act"><button class="btn" data-help="reset" disabled=${busy || !c} onClick=${clear}>${T('リセット')}</button><button class="btn primary" data-help="save" disabled=${busy} onClick=${save}>${T('保存')}</button></div>
	</div>`;
}

export function mount(root) {
	root.appendChild(Object.assign(document.createElement('div'), { className: 'page-title', innerHTML: '<h1>LED</h1>' }));
	const host = document.createElement('div');
	root.appendChild(host);
	render(html`<${Page} />`, host);
	return { stop() { render(null, host); } };
}
