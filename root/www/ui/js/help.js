/* 右側の説明欄 (全ページ共通)。中の要素に data-help="鍵" を付けると、マウスを乗せた (またはフォーカスした) とき、help[鍵] を右に出す。
   help[鍵] = { t: 見出し, body: 本文, items: [ [ 値, 名前, 説明 ] ] }。data-help-on="値" があれば、その行を目立たせる (選択中の値など) */
import { T, tr } from './i18n.js';
import { html, useState } from './ui-kit.js';

const IDLE = { t: T('説明'), body: T('項目にマウスを乗せると、ここに説明が出ます') };

export function HelpLayout({ help, children }) {
	const [cur, setCur] = useState(null);     // { k, on }
	const pick = e => {
		const el = e.target && e.target.closest ? e.target.closest('[data-help]') : null;
		if (el && help[el.dataset.help]) setCur({ k: el.dataset.help, on: el.dataset.helpOn || null });
	};
	/* 選択を変えたときは、描き直しの後の data-help-on を読む */
	const changed = e => { const t = e.target; setTimeout(() => pick({ target: t }), 0); };
	const h = (cur && help[cur.k]) || IDLE;
	return html`<div class="help-wrap" onMouseOver=${pick} onFocusIn=${pick} onChange=${changed}>
		<div class="help-main">${children}</div>
		<aside class="help-panel" aria-live="polite">
			<h3>${h.t}</h3>
			${h.body ? html`<p>${h.body}</p>` : null}
			${h.items ? html`<dl>${h.items.map(([ v, name, desc ]) => html`<div class=${cur && cur.on === v ? 'on' : ''}><dt>${name}</dt><dd>${desc}</dd></div>`)}</dl>` : null}
		</aside>
	</div>`;
}
