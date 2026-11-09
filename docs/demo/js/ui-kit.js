/* 画面部品の、土台: Preact + htm (どちらも、ビルド不要。js/vendor に、置いてある) */
import { T, tr } from './i18n.js';
import { h, render, Fragment } from './vendor/preact.js';
import { useState, useEffect, useRef, useMemo, useCallback } from './vendor/hooks.js';
import htm from './vendor/htm.js';
import { icon } from './util.js';

export const html = htm.bind(h);
export { h, render, Fragment, useState, useEffect, useRef, useMemo, useCallback };

/* アイコン (Preact 用) */
export const Icon = ({ n, s }) => html`<span class="ico" dangerouslySetInnerHTML=${{ __html: icon(n, s).innerHTML }}></span>`;

/* パスワードの入力欄。目のボタンで、入力した文字の表示を切り替える */
export function PwInput(props) {
	const [show, setShow] = useState(false);
	return html`<span class="pwbox"><input ...${props} type=${show ? 'text' : 'password'} spellcheck="false" /><button type="button" class="pweye" title=${show ? T('パスワードを隠す') : T('パスワードを表示')} aria-pressed=${show} onClick=${() => setShow(!show)}><${Icon} n=${show ? 'eyeoff' : 'eye'} s=${16} /></button></span>`;
}
