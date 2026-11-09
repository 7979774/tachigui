/* スケジュール: 決まった時刻に、ルーターを再起動する (cron に 1 行だけ入れる) */
import { T, tr, lang } from '../i18n.js';
import { html, render, useState, useEffect } from '../ui-kit.js';
import { sys, rpc } from '../api.js';
import { HelpLayout } from '../help.js';

const HELP = {
	on: { t: T('スケジュール'), items: [ [ 'on', T('オン'), T('決めた時刻にルーターを再起動する。数分つながらなくなる') ], [ 'off', T('オフ'), T('自動で再起動しない') ] ] },
	time: { t: T('時刻'), body: T('ルーターのタイムゾーンの時刻。その時刻に電源が切れていると実行されない') },
	days: { t: T('曜日'), body: T('選んだ曜日にだけ再起動する') }
};

const TAB = '/etc/crontabs/root';
const MARK = '# tachigui-reboot';
const WD = lang === 'en' ? [ 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat' ] : [ '日', '月', '火', '水', '木', '金', '土' ];     // i18n-ok: 曜日 (「日」「月」は単位と同じ字なので、辞書に入れない)

function parse(text) {
	const line = (text || '').split('\n').find(l => l.includes(MARK));
	if (!line) return { on: false, time: '04:00', days: [ 0, 1, 2, 3, 4, 5, 6 ] };
	const f = line.trim().split(/\s+/);
	const days = f[4] === '*' ? [ 0, 1, 2, 3, 4, 5, 6 ] : f[4].split(',').map(x => +x % 7);
	return { on: true, time: String(f[1]).padStart(2, '0') + ':' + String(f[0]).padStart(2, '0'), days };
}

function Page() {
	const [s, setS] = useState(null);
	const [msg, setMsg] = useState(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => { sys.read(TAB).catch(() => '').then(t => setS(parse(t))); }, []);

	async function save() {
		if (s.on && !s.days.length) return setMsg({ k: 'ng', t: T('曜日を選んでください') });
		const m = s.time.match(/^(\d{1,2}):(\d{2})$/);
		if (s.on && !m) return setMsg({ k: 'ng', t: T('時刻を確かめてください') });
		setBusy(true);
		try {
			/* 読めないまま書くと、ほかの行 (MAP-E の自動修復など) が消える。空として扱うのは、ファイルがないとき (4 = NOT_FOUND) だけ */
			const old = await sys.read(TAB).catch(e => { if (/\(4\)$/.test(e.message)) return ''; throw e; });
			const keep = old.split('\n').filter(l => l.trim() && !l.includes(MARK));
			if (s.on) keep.push(+m[2] + ' ' + +m[1] + ' * * ' + (s.days.length === 7 ? '*' : s.days.slice().sort().join(',')) + ' /sbin/reboot ' + MARK);
			await rpc('file', 'write', { path: TAB, data: keep.join('\n') + '\n', mode: 384 });
			await sys.exec('/etc/init.d/cron', [ 'restart' ]);
			setMsg({ k: 'ok', t: s.on ? T('保存しました') : T('再起動のスケジュールを止めました') });
		} catch (e) { setMsg({ k: 'ng', t: T('保存できませんでした: ') + e.message }); }
		setBusy(false);
	}

	if (!s) return html`<p class="muted">${T('読み込み中…')}</p>`;
	const toggle = d => setS({ ...s, days: s.days.includes(d) ? s.days.filter(x => x !== d) : s.days.concat(d) });
	return html`<${HelpLayout} help=${HELP}><section class="card narrow"><h2>${T('再起動スケジュール')}</h2>
		<div class="f" data-help="on" data-help-on=${s.on ? 'on' : 'off'}><label class="f-k">${T('スケジュールを有効にする')}</label><div class="f-v"><input type="checkbox" class="tgl" aria-label=${T('スケジュールを有効にする')} checked=${s.on} onChange=${e => setS({ ...s, on: e.target.checked })} /></div></div>
		${s.on ? html`<div class="f" data-help="time"><label class="f-k">${T('時刻')}</label><div class="f-v"><input type="time" class="in" value=${s.time} onInput=${e => setS({ ...s, time: e.target.value })} /></div></div>
		<div class="f" data-help="days"><label class="f-k">${T('曜日')}</label><div class="f-v wdays">${WD.map((n, d) => html`<button type="button" class=${'typeopt wd' + (s.days.includes(d) ? ' on' : '')} onClick=${() => toggle(d)}>${n}</button>`)}</div></div>` : null}
		<div class="rowgap"><button class="btn primary" disabled=${busy} onClick=${save}>${T('保存')}</button></div>
		${msg ? html`<div class=${'alert ' + msg.k}>${msg.t}</div>` : null}
	</section><//>`;
}

export function mount(root) {
	root.appendChild(Object.assign(document.createElement('div'), { className: 'page-title', innerHTML: '<h1>' + T('スケジュール') + '</h1>' }));
	const host = document.createElement('div');
	root.appendChild(host);
	render(html`<${Page} />`, host);
	return { stop() { render(null, host); } };
}
