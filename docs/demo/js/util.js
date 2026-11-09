import { T, tr } from './i18n.js';
/* 小さな道具: 要素の作成、整形、アイコン */

export function h(tag, attrs, ...kids) {
	const el = document.createElement(tag);
	if (attrs) for (const k of Object.keys(attrs)) {
		const v = attrs[k];
		if (v == null || v === false) continue;
		if (k === 'class') el.className = v;
		else if (k.startsWith('on')) { el.addEventListener(k.slice(2), v); (el._on = el._on || []).push([ k.slice(2), v ]); }
		else if (k === 'html') el.innerHTML = v;
		else el.setAttribute(k, v === true ? '' : v);
	}
	for (const c of kids.flat(2)) {
		if (c == null || c === false) continue;
		el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
	}
	return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

/* 中身を新しい内容に合わせる。同じ種類の要素は作り直さず、変わった所だけ書き換える (カーソルの状態、文字の選択、スクロール、動きが保たれる) */
export function morph(el, kids) {
	syncKids(el, kids.flat(Infinity).filter(c => c != null && c !== false).map(c => c instanceof Node ? c : document.createTextNode(String(c))));
}

function syncKids(el, next) {
	let cur = el.firstChild;
	for (const n of next) {
		if (!cur) { el.appendChild(n); continue; }
		const after = cur.nextSibling;
		if (cur.nodeType === n.nodeType && cur.nodeName === n.nodeName && cur.namespaceURI === n.namespaceURI) syncNode(cur, n);
		else el.replaceChild(n, cur);
		cur = after;
	}
	while (cur) { const after = cur.nextSibling; el.removeChild(cur); cur = after; }
}

function syncNode(a, b) {
	if (a.nodeType !== 1) { if (a.data !== b.data) a.data = b.data; return; }
	const hasTitle = b.hasAttribute('title');
	/* title は tooltip.js が data-tip へ移す。同じ内容なら、戻さない */
	for (const { name, value } of Array.from(b.attributes)) {
		if (name === 'title' && a.getAttribute('data-tip') === value) continue;
		if (a.getAttribute(name) !== value) a.setAttribute(name, value);
	}
	for (const { name } of Array.from(a.attributes))
		if (!b.hasAttribute(name) && !(hasTitle && (name === 'data-tip' || name === 'aria-label'))) a.removeAttribute(name);
	(a._on || []).forEach(([ t, f ]) => a.removeEventListener(t, f));
	(b._on || []).forEach(([ t, f ]) => a.addEventListener(t, f));
	a._on = b._on;
	syncKids(a, Array.from(b.childNodes));
}

export const fmt = {
	pct: v => v == null ? '-' : Math.round(v) + '%',
	mbps: v => v == null ? '-' : (v >= 100 ? v.toFixed(0) : (v >= 10 ? v.toFixed(1) : v.toFixed(2))),
	bytes: v => {
		if (v == null) return '-';
		const u = [ 'B', 'KB', 'MB', 'GB', 'TB' ];
		let i = 0;
		while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
		return (v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)) + ' ' + u[i];
	},
	uptime: sec => {
		const d = Math.floor(sec / 86400), hh = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
		return d ? T('{d}日 {h}時間', { d, h: hh }) : (hh ? T('{h}時間 {m}分', { h: hh, m }) : T('{m}分', { m }));
	}
};

/* 線画のアイコン (Lucide 風)。viewBox 24 */
const ICONS = {
	dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
	network: '<rect x="9" y="2" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="16" y="16" width="6" height="6" rx="1"/><path d="M12 8v4M5 16v-4h14v4"/>',
	gauge: '<path d="M12 14l4-4"/><path d="M3.3 17a10 10 0 1 1 17.4 0"/>',
	shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
	cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
	folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
	file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
	panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
	t_smart: '<rect x="5" y="2.5" width="14" height="19" rx="2"/><circle cx="12" cy="14" r="3.5"/><path d="M8.500 6h1.500M13 6h2.500"/>',
	t_gateway: '<rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 16.500h.01M11 16.500h.01M7.500 13V7M16.500 13V7"/>',
	t_router: '<rect x="3" y="14.500" width="18" height="6.500" rx="1.500"/><path d="M7 17.750h.01M11 17.750h.01M12 11.500h.01M9 8.800a4.200 4.200 0 0 1 6 0M6 5.800a8.500 8.500 0 0 1 12 0"/>',
	t_nas: '<rect x="4" y="2.500" width="16" height="19" rx="2"/><rect x="7" y="5.500" width="4.300" height="13" rx=".7"/><rect x="12.700" y="5.500" width="4.300" height="13" rx=".7"/><path d="M9.150 15.500h.01M14.850 15.500h.01"/>',
	t_server: '<rect x="4" y="3" width="16" height="7" rx="1.5"/><rect x="4" y="14" width="16" height="7" rx="1.5"/><path d="M8 6.500h.01M8 17.500h.01"/>',
	t_switch: '<rect x="3" y="7" width="18" height="10" rx="1.5"/><path d="M7 11v2M10.500 11v2M14 11v2M17.500 11v2"/>',
	t_desktop: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/>',
	t_laptop: '<rect x="5" y="5" width="14" height="10" rx="1.5"/><path d="M2.5 19h19l-2-4h-15z"/>',
	t_charger: '<rect x="6" y="7.5" width="12" height="14" rx="2.5"/><path d="M9.5 7.5V3M14.5 7.5V3M12.8 10.8l-2.3 3.6h3l-2.3 3.6"/>',
	t_phone: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>',
	t_tablet: '<rect x="5" y="2.5" width="14" height="19" rx="2"/><path d="M11 18.5h2"/>',
	t_camera: '<circle cx="12" cy="11" r="8"/><circle cx="12" cy="11" r="3"/><path d="M9 21h6M12 19v2"/>',
	t_watch: '<rect x="7" y="7" width="10" height="10" rx="2.5"/><path d="M9 7l.7-4h4.6l.7 4M9 17l.7 4h4.6l.7-4"/>',
	t_printer: '<path d="M7 9V3h10v6M7 17H4.5a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 4.5 9h15a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H17"/><rect x="7" y="14" width="10" height="7"/>',
	t_speaker: '<rect x="5.5" y="2.5" width="13" height="19" rx="2"/><circle cx="12" cy="14.5" r="3"/><circle cx="12" cy="7" r="1"/>',
	t_tv: '<rect x="2.5" y="5" width="19" height="12" rx="1.5"/><path d="M8 21h8M9 5l3-2.5L15 5"/>',
	t_game: '<path d="M6 8h12a4 4 0 0 1 4 4.2l-.6 3.8a2.5 2.5 0 0 1-4.3 1.3L15 15H9l-2.1 2.3A2.5 2.5 0 0 1 2.6 16L2 12.200A4 4 0 0 1 6 8zM7.5 10.500v3M6 12h3M16 11.500h.01M18 13.500h.01"/>',
	wifi: '<path d="M2.5 9a14 14 0 0 1 19 0M5.500 12.500a9.500 9.500 0 0 1 13 0M8.500 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.500" r="1" fill="currentColor"/>',
	edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
	eye: '<path d="M2 12s3.600-7 10-7 10 7 10 7-3.600 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
	eyeoff: '<path d="M2 12s3.600-7 10-7 10 7 10 7-3.600 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/><path d="M4 4l16 16"/>',
	trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12"/><path d="M9 7V4h6v3"/>',
	info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
	pc: '<rect x="3" y="4" width="14" height="10" rx="1.5"/><path d="M7 18h6M10 14v4"/><rect x="18" y="8" width="3.5" height="9" rx="1"/>',
	phone: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>',
	dots: '<circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="19" cy="12" r="1.4" fill="currentColor"/>',
	log: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
	alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
	wand: '<path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M17.8 6.2 19 5M12.2 6.2 11 5M3 21l9-9"/>',
	globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
	cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
	temp: '<path d="M14 14.8V4.5a2.5 2.5 0 0 0-5 0v10.3a4.5 4.5 0 1 0 5 0z"/>',
	clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
	mem: '<rect x="3" y="8" width="18" height="8" rx="1"/><path d="M7 8v8M11 8v8M15 8v8M6 16v3M18 16v3"/>',
	users: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5c1.8.7 3 2.5 3 5.5"/>',
	devices: '<rect x="2" y="5" width="14" height="10" rx="1.5"/><path d="M6 19h6M9 15v4"/><rect x="16" y="9" width="6" height="11" rx="1.5"/>',
	power: '<path d="M12 3v9M6.300 6.300a8 8 0 1 0 11.400 0"/>',
	screen: '<rect x="3" y="8" width="18" height="8" rx="1.500"/><path d="M6 12h5M15 12h3"/>',
	sliders: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6"/>',
	bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.500 10.900c.6.5 1 1.200 1 2.100h5c0-.9.4-1.600 1-2.100A6 6 0 0 0 12 3z"/>',
	wall: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 9.300h18M3 14.700h18M9 4v5.300M15 9.300v5.400M9 14.700V20"/>',
	key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M14 9l2 2"/>',
	clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
	calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
	palette: '<path d="M12 3a9 9 0 1 0 0 18c1.200 0 1.800-.9 1.500-1.800-.4-1 .3-2.200 1.500-2.200H17a4 4 0 0 0 4-4C21 6.500 17 3 12 3z"/><circle cx="7.500" cy="11" r="1"/><circle cx="11" cy="7.500" r="1"/><circle cx="16" cy="8.500" r="1"/>',
	lan: '<path d="M6 3h12v10h-2v3H8v-3H6zM9.5 6.5v3.5M12 6.5v3.5M14.5 6.5v3.5M12 16v5"/>',
	plug: '<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4"/>',
	fan: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1.4"/><path d="M12 10.6C10.200 8.500 10 5.800 11.300 4.700c1.600-1.300 4.700-.3 4.700 2 0 1.900-2.500 2.100-4 3.900z"/><path transform="rotate(120 12 12)" d="M12 10.6C10.200 8.500 10 5.800 11.300 4.700c1.600-1.300 4.700-.3 4.700 2 0 1.900-2.500 2.100-4 3.900z"/><path transform="rotate(240 12 12)" d="M12 10.6C10.200 8.500 10 5.800 11.300 4.700c1.600-1.300 4.700-.3 4.700 2 0 1.900-2.500 2.100-4 3.900z"/>',
	arrows: '<path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"/>',
	out: '<path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5M16 8l4 4-4 4M20 12H9"/>',
	swap: '<path d="M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4"/>',
	menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
	bowl: '<path d="M3 11h18a9 9 0 0 1-18 0z"/><path d="M9 21h6M8 3c0 1.6 1.6 1.6 1.6 3.2M13 3c0 1.6 1.6 1.6 1.6 3.2"/>'
};

export function icon(name, size) {
	const s = size || 18;
	return h('span', { class: 'ico', html: '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>' });
}

/* IPv6 アドレスを、短い形にする */
export function ip6Compress(hex) {
	const g = [];
	for (let i = 0; i < 8; i++) g.push(hex.substr(i * 4, 4).replace(/^0+(?=.)/, ''));
	let best = -1, bestLen = 0;
	for (let i = 0; i < 8; i++) {
		let j = i;
		while (j < 8 && g[j] === '0') j++;
		if (j - i > bestLen) { best = i; bestLen = j - i; }
	}
	if (bestLen < 2) return g.join(':');
	return g.slice(0, best).join(':') + '::' + g.slice(best + bestLen).join(':');
}

/* 折れ線 (スパークライン) */
/* グラフの一番上の値 (Mbps)。1, 2, 5 の段にするので、同じ段の間は形を変えずに左へ流れる */
export function rateScale(top) {
	for (let b = 0.1; ; b *= 10) for (const m of [ 1, 2, 5 ]) if (top <= b * m) return b * m;
}

/* 速度の折れ線 (Mbps)。右端が最新で、幅いっぱいが total 回分。たまるまでは右から伸びる */
export function spark(series, colors, width, height, total) {
	const NS = 'http://www.w3.org/2000/svg';
	const svg = document.createElementNS(NS, 'svg');
	svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
	svg.setAttribute('preserveAspectRatio', 'none');
	svg.setAttribute('class', 'spark');
	const max = rateScale(Math.max(0, ...series.flat()));
	const step = width / (total - 1);
	series.forEach((s, k) => {
		const pl = document.createElementNS(NS, 'polyline');
		pl.setAttribute('points', s.map((v, i) => (width - (s.length - 1 - i) * step).toFixed(1) + ',' + (height - 2 - v / max * (height - 4)).toFixed(1)).join(' '));
		pl.setAttribute('fill', 'none');
		pl.setAttribute('stroke', colors[k]);
		pl.setAttribute('stroke-width', '1.6');
		pl.setAttribute('stroke-linejoin', 'round');
		pl.setAttribute('vector-effect', 'non-scaling-stroke');
		svg.appendChild(pl);
	});
	return svg;
}

/* クライアントとして数える機器 (IP アドレスを持つもの)。どの画面でも、同じ数になるよう、ここで決める */
export function isClient(r) {
	return !!(r && (r.ipv4 || (r.ipaddrs && r.ipaddrs[0]) || (r.ip6addrs || []).some(a => /^[23]/.test(a))));
}
