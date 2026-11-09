/* ツールチップ (全ページ共通)。各ページは title 属性を書くだけでよい。ブラウザ標準の代わりに、画面に合わせた吹き出しを出す。
   マウスを乗せて少し待つか、キーボードで移動すると出る。タッチ操作の端末は、乗せる操作がないので何もしない。 */

const DELAY = 350;
let box = null, timer = null, owner = null;

/* title を data-tip へ移す (標準のツールチップと 2 重に出さない)。文字のないボタンは、読み上げ用の名前も残す */
function textOf(el) {
	const t = el.getAttribute('title');
	if (t) {
		el.setAttribute('data-tip', t);
		el.removeAttribute('title');
		if (!el.textContent.trim() && !el.getAttribute('aria-label')) el.setAttribute('aria-label', t);
	}
	return el.getAttribute('data-tip') || '';
}

function hide() {
	clearTimeout(timer);
	timer = null;
	owner = null;
	if (box) box.classList.remove('show');
}

function place(el) {
	const r = el.getBoundingClientRect(), edge = 8, gap = 6;
	const w = box.offsetWidth, h = box.offsetHeight;
	/* 左メニューは右に出す。ほかは下に出し、入らなければ上に出す */
	if (el.classList.contains('nav')) {
		box.style.left = (r.right + gap) + 'px';
		box.style.top = Math.max(edge, r.top + (r.height - h) / 2) + 'px';
		return;
	}
	const below = r.bottom + gap + h + edge <= innerHeight;
	box.style.top = (below ? r.bottom + gap : Math.max(edge, r.top - gap - h)) + 'px';
	box.style.left = Math.max(edge, Math.min(r.left + (r.width - w) / 2, innerWidth - w - edge)) + 'px';
}

function show(el, wait) {
	const t = textOf(el);
	if (!t || !el.isConnected) return;
	/* 左メニューは、名前が見えているときは出さない (たたんだときだけ) */
	if (el.classList.contains('nav')) { const s = el.querySelector('span:not(.ico)'); if (s && s.offsetWidth > 0) return; }
	/* 見えている文字と同じ内容で、省略もされていないなら、出しても意味がない */
	else if (el.textContent.trim() === t && el.scrollWidth <= el.clientWidth) return;
	clearTimeout(timer);
	owner = el;
	timer = setTimeout(() => {
		if (owner !== el || !el.isConnected) return;
		if (!box) { box = document.createElement('div'); box.className = 'tip'; box.setAttribute('role', 'tooltip'); document.body.appendChild(box); }
		box.textContent = t;
		place(el);
		box.classList.add('show');
	}, wait);
}

const target = e => (e.target instanceof Element ? e.target.closest('[title], [data-tip]') : null);

function onOver(e) {
	const el = target(e);
	if (el === owner) return;
	hide();
	if (el) show(el, DELAY);
}

function onFocus(e) {
	const el = target(e);
	if (el && el.matches(':focus-visible')) show(el, 0);
}

export function install() {
	if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
	document.addEventListener('mouseover', onOver);
	document.addEventListener('focusin', onFocus);
	document.addEventListener('focusout', hide);
	/* 操作を始めたら、すぐ消す */
	window.addEventListener('mousedown', hide, true);
	window.addEventListener('scroll', hide, true);
	window.addEventListener('resize', hide);
	window.addEventListener('blur', hide);
	window.addEventListener('hashchange', hide);
	window.addEventListener('keydown', hide, true);
}
