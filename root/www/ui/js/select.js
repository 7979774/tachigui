/* ドロップダウンの一覧 (全ページ共通)。素の <select> はそのまま使い、開く一覧だけを画面に合わせた見た目に置き換える。
   選ぶと select の値を変えて change を送るので、各ページの onChange は、そのまま動く。
   タッチ操作の端末は、OS 標準の選択画面のほうが使いやすいので、置き換えない。 */

let cur = null;     // { sel, pop, items: [{ el, value }], at }

const usable = el => el instanceof HTMLSelectElement && !el.multiple && el.size <= 1 && !el.disabled;

function close() {
	if (!cur) return;
	cur.pop.remove();
	cur = null;
}

function mark(i) {
	if (!cur || !cur.items.length) return;
	cur.at = (i + cur.items.length) % cur.items.length;
	cur.items.forEach((x, k) => x.el.classList.toggle('at', k === cur.at));
	cur.items[cur.at].el.scrollIntoView({ block: 'nearest' });
}

function choose(value) {
	const sel = cur.sel;
	const changed = sel.value !== value;
	close();
	sel.focus();
	if (!changed) return;
	sel.value = value;
	sel.dispatchEvent(new Event('change', { bubbles: true }));
}

function row(o, items) {
	const el = document.createElement('div');
	el.className = 'selpop-o' + (o.selected ? ' on' : '') + (o.disabled ? ' off' : '');
	el.setAttribute('role', 'option');
	el.setAttribute('aria-selected', String(o.selected));
	el.textContent = o.textContent;
	if (!o.disabled) {
		const i = items.length;
		items.push({ el, value: o.value });
		el.addEventListener('mouseenter', () => mark(i));
		el.addEventListener('click', () => choose(o.value));
	}
	return el;
}

function place(sel, pop) {
	const r = sel.getBoundingClientRect(), gap = 4, edge = 8;
	pop.style.minWidth = r.width + 'px';
	pop.style.maxWidth = (innerWidth - edge * 2) + 'px';
	const below = innerHeight - r.bottom - gap - edge, above = r.top - gap - edge;
	/* 下に入らず、上のほうが広いときは、上に開く */
	const up = pop.offsetHeight > below && above > below;
	pop.style.maxHeight = Math.max(up ? above : below, 80) + 'px';
	pop.style.top = (up ? r.top - gap - pop.offsetHeight : r.bottom + gap) + 'px';
	pop.style.left = Math.max(edge, Math.min(r.left, innerWidth - pop.offsetWidth - edge)) + 'px';
}

function open(sel) {
	close();
	const pop = document.createElement('div');
	pop.className = 'selpop';
	pop.setAttribute('role', 'listbox');
	const items = [];
	for (const n of sel.children) {
		if (n instanceof HTMLOptGroupElement) {
			const g = document.createElement('div');
			g.className = 'selpop-g';
			g.textContent = n.label;
			pop.appendChild(g);
			for (const o of n.children) pop.appendChild(row(o, items));
		}
		else if (n instanceof HTMLOptionElement) pop.appendChild(row(n, items));
	}
	document.body.appendChild(pop);
	cur = { sel, pop, items, at: 0 };
	place(sel, pop);
	const on = items.findIndex(x => x.value === sel.value);
	mark(on < 0 ? 0 : on);
	/* 上に開いたとき、スクロールで位置がずれないよう、最後にもう一度そろえる */
	place(sel, pop);
}

function onMouseDown(e) {
	if (cur && cur.pop.contains(e.target)) return;
	const sel = e.target;
	if (e.button === 0 && usable(sel)) {
		e.preventDefault();     // 標準の一覧を出さない
		const again = cur && cur.sel === sel;
		close();
		sel.focus();
		if (!again) open(sel);
		return;
	}
	close();
}

function onKey(e) {
	if (!cur) {
		const sel = e.target;
		if (usable(sel) && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); e.stopPropagation(); open(sel); }
		return;
	}
	const stop = () => { e.preventDefault(); e.stopPropagation(); };
	if (e.key === 'Escape') { stop(); close(); }
	else if (e.key === 'ArrowDown') { stop(); mark(cur.at + 1); }
	else if (e.key === 'ArrowUp') { stop(); mark(cur.at - 1); }
	else if (e.key === 'Home') { stop(); mark(0); }
	else if (e.key === 'End') { stop(); mark(cur.items.length - 1); }
	else if (e.key === 'Enter' || e.key === ' ') { stop(); if (cur.items.length) choose(cur.items[cur.at].value); }
	else if (e.key === 'Tab') close();
	else if (e.key.length === 1) {
		/* 打った文字で始まる項目へ移る */
		stop();
		const c = e.key.toLowerCase();
		const n = cur.items.length;
		for (let k = 1; k <= n; k++) {
			const i = (cur.at + k) % n;
			if (cur.items[i].el.textContent.trim().toLowerCase().startsWith(c)) { mark(i); break; }
		}
	}
}

export function install() {
	if (!matchMedia('(pointer: fine)').matches) return;
	/* ページやダイアログのキー操作より先に受ける (Esc で、ダイアログまで閉じないように) */
	window.addEventListener('mousedown', onMouseDown, true);
	window.addEventListener('keydown', onKey, true);
	window.addEventListener('resize', close);
	/* 一覧の外がスクロールしたら閉じる (一覧の中のスクロールでは閉じない) */
	window.addEventListener('scroll', e => { if (cur && !cur.pop.contains(e.target)) close(); }, true);
	window.addEventListener('blur', close);
	window.addEventListener('hashchange', close);
}
