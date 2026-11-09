/* 基本設定: ルーター名、タイムゾーン */
import { T, tr, lang } from '../i18n.js';
import { html, render, useState, useEffect } from '../ui-kit.js';
import { sys, rpc, getSid } from '../api.js';
import { HelpLayout } from '../help.js';

const HELP = {
	name: { t: T('ホスト名'), body: T('ネットワーク上でのルーターの名前。英数字とハイフンだけ') },
	tz: { t: T('タイムゾーン'), body: T('ログと再起動スケジュールの時刻に使う') },
	ntp: { t: T('同期'), body: T('インターネットの時刻サーバーで時計を合わせる'), items: [ [ 'on', T('オン'), T('自動で合わせる。追加した順に問い合わせる') ], [ 'off', T('オフ'), T('合わせない。だんだんずれる') ] ] },
	backup: { t: T('設定のバックアップ'), body: T('設定をまとめてファイルに保存する。パスワードの情報も入るので人に渡さない。元に戻すのは LuCI から') }
};

const WD = lang === 'en' ? [ 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat' ] : [ '日', '月', '火', '水', '木', '金', '土' ];     // i18n-ok: 曜日 (「日」「月」は単位と同じ字なので、辞書に入れない)
const p2 = n => String(n).padStart(2, '0');
const show = ms => { const d = new Date(ms); return T('{y}年{m}月{d}日({w}) {time}', { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), w: WD[d.getUTCDay()], time: p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()) + ':' + p2(d.getUTCSeconds()) }); };

const NTP_CHOICES = { nict: [ 'ntp.nict.jp', 'jp.pool.ntp.org' ], pool: [ '0.jp.pool.ntp.org', '1.jp.pool.ntp.org', '2.jp.pool.ntp.org', '3.jp.pool.ntp.org' ], google: [ 'time.google.com' ], cf: [ 'time.cloudflare.com' ] };

function NameCard() {
	const [name, setName] = useState('');
	const [cur, setCur] = useState(null);
	const [msg, setMsg] = useState(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => { sys.board().then(b => { setCur(b.hostname || ''); setName(b.hostname || ''); }).catch(e => setMsg({ k: 'ng', t: e.message })); }, []);

	async function save() {
		const n = name.trim();
		if (!/^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(n)) return setMsg({ k: 'ng', t: T('ルーター名は英数字とハイフンだけ (例: OpenWrt)') });
		setBusy(true);
		try {
			const r = await rpc('uci', 'get', { config: 'system', type: 'system' });
			const sec = Object.keys(r.values || {})[0];
			await rpc('uci', 'set', { config: 'system', section: sec, values: { hostname: n } });
			await rpc('uci', 'commit', { config: 'system' });
			await sys.exec('/etc/init.d/system', [ 'reload' ]);
			setCur(n);
			setMsg({ k: 'ok', t: T('ルーター名を変更しました') });
		} catch (e) { setMsg({ k: 'ng', t: T('変更できませんでした: ') + e.message }); }
		setBusy(false);
	}

	return html`<section class="card"><h2>${T('ルーター名')}</h2>
		<div class="f" data-help="name"><label class="f-k">${T('ホスト名')}</label><div class="f-v rowflex"><input type="text" class="in" style="flex:1" value=${name} placeholder="OpenWrt" onInput=${e => setName(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter') save(); }} /><button class="btn primary" disabled=${busy || cur == null || name.trim() === cur} onClick=${save}>${T('変更')}</button></div></div>
		${msg ? html`<div class=${'alert ' + msg.k}>${msg.t}</div>` : null}
	</section>`;
}

function TimeCard() {
	const [zones, setZones] = useState(null);
	const [cur, setCur] = useState({ zonename: '', timezone: '' });
	const [pick, setPick] = useState('');
	const [base, setBase] = useState(null);
	const [, tick] = useState(0);
	const [msg, setMsg] = useState(null);
	const [busy, setBusy] = useState(false);
	const [ntp, setNtp] = useState(null);       // { on, servers: [...] }
	const [nmsg, setNmsg] = useState(null);

	async function loadNtp() {
		const r = await rpc('uci', 'get', { config: 'system', section: 'ntp' }).catch(() => null);
		const v = (r && r.values) || {};
		setNtp({ on: v.enabled !== '0', servers: [].concat(v.server || []) });
	}

	async function saveNtp() {
		const servers = ntp.servers.map(x => x.trim()).filter(Boolean);
		if (ntp.on && !servers.length) return setNmsg({ k: 'ng', t: T('サーバーを入れてください') });
		if (servers.some(x => !/^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(x))) return setNmsg({ k: 'ng', t: T('サーバー名に使えない文字があります') });
		setBusy(true);
		try {
			await rpc('uci', 'set', { config: 'system', section: 'ntp', values: { enabled: ntp.on ? '1' : '0', server: servers } });
			await rpc('uci', 'commit', { config: 'system' });
			await sys.exec('/etc/init.d/sysntpd', [ 'restart' ]);
			setNtp({ ...ntp, servers });
			setNmsg({ k: 'ok', t: ntp.on ? T('保存して時刻を合わせ直しています') : T('時刻の自動合わせを止めました') });
		} catch (e) { setNmsg({ k: 'ng', t: T('保存できませんでした: ') + e.message }); }
		setBusy(false);
	}

	async function load() {
		const [ z, u, i, ut ] = await Promise.all([ rpc('luci', 'getTimezones'), rpc('uci', 'get', { config: 'system', type: 'system' }), sys.info(), rpc('luci', 'getUnixtime') ]);
		const v = Object.values(u.values || {})[0] || {};
		setZones(z); setCur({ zonename: v.zonename || '', timezone: v.timezone || '' }); setPick(v.zonename || '');
		const off = Math.round((i.localtime - ut.result) / 900) * 15;      // 分 (夏時間も含む)
		setBase({ at: Date.now(), ms: i.localtime * 1000, utc: 'UTC' + (off < 0 ? '-' : '+') + p2(Math.floor(Math.abs(off) / 60)) + ':' + p2(Math.abs(off) % 60) });
	}

	useEffect(() => {
		load().catch(e => setMsg({ k: 'ng', t: e.message }));
		loadNtp();
		const t = setInterval(() => tick(x => x + 1), 1000);
		return () => clearInterval(t);
	}, []);

	async function save() {
		const z = zones[pick];
		if (!z) return;
		setBusy(true);
		try {
			const r = await rpc('uci', 'get', { config: 'system', type: 'system' });
			const sec = Object.keys(r.values || {})[0];
			await rpc('uci', 'set', { config: 'system', section: sec, values: { zonename: pick, timezone: z.tzstring } });
			await rpc('uci', 'commit', { config: 'system' });
			await sys.exec('/etc/init.d/system', [ 'reload' ]);
			await load();
			setMsg({ k: 'ok', t: T('タイムゾーンを変更しました') });
		} catch (e) { setMsg({ k: 'ng', t: T('変更できませんでした: ') + e.message }); }
		setBusy(false);
	}

	const names = zones ? Object.keys(zones).sort() : [];
	return html`<section class="card"><h2>${T('時刻設定')}</h2>
		<div class="bigtime mono">${base ? html`${show(base.ms + Date.now() - base.at)} <span class="muted">(${base.utc})</span>` : T('読み込み中…')}</div>
		${zones ? html`<div class="f" data-help="tz" style="margin-top:.8rem"><label class="f-k">${T('タイムゾーン')}</label><div class="f-v rowflex">
			<select class="in" style="flex:1" value=${pick} onChange=${e => setPick(e.target.value)}>${names.map(n => html`<option value=${n} selected=${n === pick}>${n}</option>`)}</select>
			<button class="btn primary" disabled=${busy || !pick || pick === cur.zonename} onClick=${save}>${T('変更')}</button></div></div>` : null}
		${msg ? html`<div class=${'alert ' + msg.k}>${msg.t}</div>` : null}
		${ntp ? html`<div class="subh"></div>
			<div class="f" data-help="ntp" data-help-on=${ntp.on ? 'on' : 'off'}><label class="f-k">${T('同期')}</label><div class="f-v"><input type="checkbox" class="tgl" aria-label=${T('同期')} checked=${ntp.on} onChange=${e => setNtp({ ...ntp, on: e.target.checked })} /></div></div>
			${ntp.on ? html`<div class="dnslist">
				${ntp.servers.map((v, i) => html`<div class="dnsrow"><input type="text" class="in" placeholder=${T('例: ntp.nict.jp')} value=${v} onInput=${e => { const a = ntp.servers.slice(); a[i] = e.target.value; setNtp({ ...ntp, servers: a }); }} /><button class="btn icon" title=${T('削除')} onClick=${() => setNtp({ ...ntp, servers: ntp.servers.filter((_, j) => j !== i) })}>×</button></div>`)}
				<div class="dnsadd"><button class="btn" onClick=${() => setNtp({ ...ntp, servers: ntp.servers.concat('') })}>${T('＋ 追加')}</button>
					<select class="in" value="" onChange=${e => { const c = NTP_CHOICES[e.target.value]; if (c) setNtp({ ...ntp, servers: c.slice() }); e.target.value = ''; }}><option value="">${T('おすすめから選ぶ…')}</option><option value="nict">${T('NICT (日本標準時)')}</option><option value="pool">jp.pool.ntp.org</option><option value="google">Google</option><option value="cf">Cloudflare</option></select></div>
			</div>` : null}
			<div class="rowgap"><button class="btn primary" disabled=${busy} onClick=${saveNtp}>${T('保存して同期')}</button></div>
			${nmsg ? html`<div class=${'alert ' + nmsg.k}>${nmsg.t}</div>` : null}` : null}
	</section>`;
}

/* 設定のバックアップ: sysupgrade -b と同じ内容を cgi-backup から受け取り、ファイルとして保存する */
function BackupCard() {
	const [msg, setMsg] = useState(null);
	const [busy, setBusy] = useState(false);

	async function download() {
		setBusy(true); setMsg(null);
		try {
			const r = await fetch('/cgi-bin/cgi-backup', { method: 'POST', body: new URLSearchParams({ sessionid: getSid() }) });
			if (r.status === 403) throw new Error(T('権限がありません。ログインし直してください'));
			if (!r.ok) throw new Error('HTTP ' + r.status);
			const name = (/filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '') || [])[1] || 'backup.tar.gz';
			const a = document.createElement('a');
			a.href = URL.createObjectURL(await r.blob()); a.download = name; a.click();
			setTimeout(() => URL.revokeObjectURL(a.href), 2000);
			setMsg({ k: 'ok', t: T('{name} を保存しました', { name }) });
		} catch (e) { console.error('settings: バックアップ失敗', e); setMsg({ k: 'ng', t: T('保存できませんでした: ') + e.message }); }
		setBusy(false);
	}

	return html`<section class="card" data-help="backup"><h2>${T('設定のバックアップ')}</h2>
		<div class="rowgap"><button class="btn primary" disabled=${busy} onClick=${download}>${busy ? T('作成中…') : T('ダウンロード')}</button></div>
		${msg ? html`<div class=${'alert ' + msg.k}>${msg.t}</div>` : null}
	</section>`;
}

export function mount(root) {
	root.appendChild(Object.assign(document.createElement('div'), { className: 'page-title', innerHTML: '<h1>' + T('基本設定') + '</h1>' }));
	const host = document.createElement('div');
	root.appendChild(host);
	render(html`<${HelpLayout} help=${HELP}><div class="stack narrowcol"><${NameCard} /><${TimeCard} /><${BackupCard} /></div><//>`, host);
	return { stop() { render(null, host); } };
}
