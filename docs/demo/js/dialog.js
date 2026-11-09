/* 確認ダイアログ (画面の中、全ページ共通)。素の confirm() / prompt() の代わり。Preact を使わない app.js からも呼べる。
   ask({ title, body, rows, warns, footer, ok, cancel, danger }) → Promise<boolean>
   prompt({ title, body, value, placeholder, ok, cancel }) → Promise<string | null> (キャンセルは null)
   rows: [ [項目, 値] ] または [ [項目, 今, 変更後] ] (3 列なら、変更前と後を並べ、変わる行を目立たせる) */
import { T, tr } from './i18n.js';
import { html, render, useEffect, useRef, useState } from './ui-kit.js';

let host = null;
let pending = null;

function Rows({ rows }) {
	const diff = rows.some(r => r.length > 2);
	if (!diff) return html`<table class="kv">${rows.map(([k, v]) => html`<tr><th>${k}</th><td>${v}</td></tr>`)}</table>`;
	const n = rows.filter(r => r[1] !== r[2]).length;
	return html`<div class="dlg-diff">
		<p class="muted small">${n ? T('変更 {n} 件', { n }) : T('変更なし')}</p>
		<table class="kv diff"><thead><tr><th></th><th>${T('今')}</th><th>${T('変更後')}</th></tr></thead><tbody>
			${rows.map(([k, a, b]) => {
				const ch = a !== b;
				return html`<tr class=${ch ? 'chg' : 'same'}><th>${k}${ch ? html` <span class="chg-tag">${T('変更')}</span>` : null}</th><td class="was">${a || '-'}</td><td>${ch ? b || '-' : '〃'}</td></tr>`;
			})}
		</tbody></table></div>`;
}

/* done(結果): 確認は true / false、入力は 文字列 / null */
function Dialog({ d, done }) {
	const okRef = useRef(null), noRef = useRef(null), inRef = useRef(null);
	const [v, setV] = useState(d.value || '');
	const cancel = () => done(d.input ? null : false);
	const accept = () => done(d.input ? v : true);
	useEffect(() => {
		/* 入力は、入力欄を選んで、全部を選択しておく。危険な操作は、うっかり Enter で決まらないよう、キャンセルを選んでおく */
		if (d.input && inRef.current) { inRef.current.focus(); inRef.current.select(); }
		else { const el = d.danger ? noRef.current : okRef.current; if (el) el.focus(); }
		const key = e => { if (e.key === 'Escape') { e.preventDefault(); cancel(); } };
		document.addEventListener('keydown', key);
		return () => document.removeEventListener('keydown', key);
	}, []);
	const warns = d.warns || [];
	return html`<div class="modal-bg" onClick=${e => { if (e.target === e.currentTarget) cancel(); }}>
		<div class=${'modal' + (d.rows && d.rows.some(r => r.length > 2) ? ' wide' : '')} role="dialog" aria-modal="true" aria-label=${d.title}>
			<h2>${d.title}</h2>
			${d.body ? html`<div class="modal-body">${d.body}</div>` : null}
			${d.input ? html`<input type="text" class="in" style="width:100%" ref=${inRef} value=${v} placeholder=${d.placeholder || ''} spellcheck="false"
				onInput=${e => setV(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); accept(); } }} />` : null}
			${d.rows && d.rows.length ? html`<${Rows} rows=${d.rows} />` : null}
			${warns.map(w => html`<div class=${'alert ' + (w.level || 'warn')}>${w.text}</div>`)}
			${d.footer ? html`<p class="muted small">${d.footer}</p>` : null}
			<div class="modal-act">
				<button class="btn" ref=${noRef} onClick=${cancel}>${d.cancel || T('キャンセル')}</button>
				<button class=${'btn primary' + (d.danger ? ' danger' : '')} ref=${okRef} onClick=${accept}>${d.ok || 'OK'}</button>
			</div>
		</div></div>`;
}

function open(d) {
	if (!host) { host = document.createElement('div'); host.className = 'dlg-host'; document.body.appendChild(host); }
	/* 前のダイアログが、開いたままなら、キャンセル扱いにして、閉じる */
	if (pending) pending(null);
	return new Promise(resolve => {
		const done = v => {
			if (pending !== done) return;
			pending = null;
			try { render(null, host); } catch (e) { console.error('ダイアログを閉じられませんでした', e); }
			resolve(v);
		};
		pending = done;
		try { render(html`<${Dialog} d=${d} done=${done} />`, host); }
		catch (e) {
			/* 描画できない場合は、素の confirm() / prompt() で、聞く */
			console.error('ダイアログを表示できませんでした。素の確認に切り替えます', e);
			pending = null;
			const msg = [ d.title, d.body ].filter(Boolean).join('\n\n');
			resolve(d.input ? window.prompt(msg, d.value || '') : window.confirm(msg));
		}
	});
}

export function ask(d) {
	return open({ ...d, input: false }).then(v => !!v);
}

export function prompt(d) {
	return open({ ...d, input: true }).then(v => typeof v === 'string' ? v : null);
}
