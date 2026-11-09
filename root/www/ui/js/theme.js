/* 背景の設定。選んだ内容は /www/ui/theme.json に保存する (ログイン前の画面でも、読めるようにするため) */
import { T, tr } from './i18n.js';
import { rpc, sys, getSid } from './api.js';

export const PRESETS = {
	ocean: { label: T('標準'), css: 'linear-gradient(160deg, #04293a 0%, #064663 50%, #0b132b 100%)' },
	mountain: { label: T('山'), css: 'url(/ui/bg/mountain.svg)' }
};
/* ライトモードの背景 (山の絵は暗い色なので、ライトでは明るいものに替える) */
export const LIGHT = {
	ocean: 'linear-gradient(160deg, #e6f4fb 0%, #c5e3f3 100%)',
	mountain: 'linear-gradient(160deg, #f4f7fc 0%, #e3eaf6 100%)'
};
/* 書体: 入っている書体だけを使う (インターネットから、取りに行かない) */
export const FONTS = {
	system: { label: T('標準'), css: '"Segoe UI", "Hiragino Sans", "Yu Gothic UI", "Noto Sans JP", system-ui, sans-serif' },
	gothic: { label: T('ゴシック'), css: '"Noto Sans JP", "Yu Gothic", "YuGothic", "Hiragino Kaku Gothic ProN", "Meiryo", sans-serif' },
	mincho: { label: T('明朝'), css: '"Noto Serif JP", "Yu Mincho", "YuMincho", "Hiragino Mincho ProN", "MS PMincho", serif' },
	mono: { label: T('等幅'), css: 'ui-monospace, "Cascadia Mono", Menlo, Consolas, "BIZ UDGothic", monospace' }
};
export const SIZES = { s: { label: T('小'), px: 14.5 }, m: { label: T('標準'), px: 16 }, l: { label: T('大'), px: 17.5 } };
export const DEFAULTS = { bg: 'ocean', dim: 0, image: '', mode: 'dark', font: 'system', fontName: '', fonts: [], size: 'm' };
const KEY = 'tachigui.theme';
const KEEP = 5;      // 書体の履歴に残す数
const USER_DIR = '/www/ui/bg/user';     // 追加した背景画像の置き場所。一覧はこのフォルダから作る
const IMAGE = /\.(png|jpe?g|webp|gif)$/i;
let cur = { ...DEFAULTS };

export function current() { return { ...cur }; }

/* 新しいものを履歴の先頭に足す。選び直しでは並びを変えない (押した場所がずれないように) */
const remember = (list, v) => !v || list.includes(v) ? list : [ v, ...list ].slice(0, KEEP);
/* 書体の名前を、CSS に入れられる文字だけにする */
export const safeFont = name => (name || '').replace(/[^\w .\-À-￿]/g, '').trim();

const dark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
if (dark && dark.addEventListener) dark.addEventListener('change', () => apply(cur));

export function apply(t) {
	cur = { ...DEFAULTS, ...(t || {}) };
	if (cur.bg !== 'custom' && !PRESETS[cur.bg]) cur.bg = DEFAULTS.bg;      // なくなった背景の名前が保存されていたとき
	cur.fonts = remember(cur.fonts || [], safeFont(cur.fontName));
	const light = cur.mode === 'light' || (cur.mode === 'auto' && dark && !dark.matches);
	const root = document.documentElement;
	root.dataset.mode = light ? 'light' : 'dark';

	let layer;
	if (cur.bg === 'custom' && cur.image) layer = 'url("' + cur.image + '")';
	else layer = light ? LIGHT[cur.bg] : PRESETS[cur.bg].css;
	const d = Math.max(0, Math.min(80, +cur.dim || 0)) / 100;
	const veil = light ? '255,255,255' : '0,0,0';
	const dim = d > 0 ? 'linear-gradient(rgba(' + veil + ',' + d + '), rgba(' + veil + ',' + d + ')), ' : '';
	document.body.style.background = dim + layer + ' center / cover fixed no-repeat, ' + (light ? '#eef1f7' : '#12121e');

	/* 書体と大きさ */
	const name = cur.font === 'custom' ? safeFont(cur.fontName) : '';
	const fam = name ? '"' + name + '", ' + FONTS.system.css : (FONTS[cur.font] || FONTS.system).css;
	root.style.setProperty('--font', fam);
	root.style.setProperty('--root-fs', (SIZES[cur.size] || SIZES.m).px + 'px');
}

/* 起動時: 前回の内容ですぐ描き、サーバーの内容で更新する */
export async function load() {
	try { const c = localStorage.getItem(KEY); if (c) apply(JSON.parse(c)); } catch (e) { /* 無視 */ }
	try {
		const r = await fetch('/ui/theme.json?_=' + Date.now(), { cache: 'no-store' });
		if (r.ok) { const t = await r.json(); apply(t); try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch (e) { /* 無視 */ } }
	} catch (e) { /* ファイルがなければ、標準 */ }
}

/* 保存する (ログイン中だけ) */
export async function save(t) {
	apply(t);
	try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch (e) { /* 無視 */ }
	await rpc('file', 'write', { path: '/www/ui/theme.json', data: JSON.stringify(cur), mode: 420 });
	await fixPerm();
}

/* 新しいファイルは 600 で作られ、そのままでは読めない (403)。ここが失敗しても保存はできているので、ログだけ残す */
const fixPerm = () => sys.exec('/usr/libexec/tachigui-theme-perm').catch(e => console.error('theme: 権限を変更できません', e));

/* 追加した画像の URL (日本語のファイル名も使えるように符号化する) */
export const imageUrl = name => '/ui/bg/user/' + encodeURIComponent(name);

/* 追加した画像の、ファイル名の一覧 */
export async function listImages() {
	const r = await rpc('file', 'list', { path: USER_DIR });
	return (r.entries || []).filter(e => e.type === 'file' && IMAGE.test(e.name)).map(e => e.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/* 保存するファイル名: 使えない文字は _ にする。同じ名前があれば、番号を付ける (上書きしない) */
function freeName(original, names) {
	const clean = original.replace(/[^\w .()\-぀-ヿ㐀-鿿＀-￯]/g, '_').replace(/^\.+/, '');     // i18n-ok: ファイル名に使える文字 (画面には出さない)
	const m = /^(.*?)(\.[^.]+)$/.exec(clean), base = m[1].slice(0, 80) || 'image', ext = m[2].toLowerCase();
	let name = base + ext;
	for (let i = 2; names.includes(name); i++) name = base + '-' + i + ext;
	return name;
}

/* ブラウザの中で WebP に変換して小さくする (背景は長辺 2560 あれば足りる)。GIF は動きが消えるのでそのまま。
   変換できない・小さくならないときは、元のファイルを使う */
async function compress(file) {
	if (/\.gif$/i.test(file.name)) return file;
	try {
		const img = await createImageBitmap(file);
		const k = Math.min(1, 2560 / Math.max(img.width, img.height));
		const c = document.createElement('canvas');
		c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
		c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
		img.close();
		const blob = await new Promise(r => c.toBlob(r, 'image/webp', .8));
		/* WebP に変換できないブラウザは PNG を返すので、形式も確かめる */
		if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) return file;
		return new File([ blob ], file.name.replace(/\.[^.]+$/, '.webp'), { type: 'image/webp' });
	} catch (e) { console.warn('theme: 画像を圧縮できません。元のまま送ります', e); return file; }
}

const sizeText = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

/* 好きな画像を、ルーターにアップロードする。保存した画像の URL と、大きさの変化を返す */
export async function upload(original, names) {
	if (!IMAGE.test(original.name)) throw new Error(T('png / jpg / webp / gif の画像を選んでください'));
	const file = await compress(original);
	if (file.size > 8 * 1048576) throw new Error(T('画像は 8MB までです'));
	const name = freeName(file.name, names);
	await send(file, name);
	/* 背景に使う前に読めるようにする。403 のまま表示すると、ブラウザが失敗を覚えて再読み込みまで無地になる */
	await fixPerm();
	return { url: imageUrl(name), note: file === original ? sizeText(file.size) : sizeText(original.size) + ' → ' + sizeText(file.size) };
}

function send(file, name) {
	return new Promise((resolve, reject) => {
		const fd = new FormData();
		fd.append('sessionid', getSid()); fd.append('filename', USER_DIR + '/' + name); fd.append('filedata', file);
		const xhr = new XMLHttpRequest();
		xhr.open('POST', '/cgi-bin/cgi-upload');
		xhr.onload = () => { let r = null; try { r = JSON.parse(xhr.responseText); } catch (e) { /* 無視 */ } xhr.status === 200 && !(r && r.failure) ? resolve() : reject(new Error((r && r.message) || T('アップロードに失敗しました'))); };
		xhr.onerror = () => reject(new Error(T('通信に失敗しました')));
		xhr.send(fd);
	});
}

/* 追加した画像を消す */
export const removeImage = name => rpc('file', 'remove', { path: USER_DIR + '/' + name });
