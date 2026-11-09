/* 画面の言語。日本語の文をそのまま鍵にして、英語は i18n/en.js の辞書から引く (訳がなければ日本語のまま出す)
   T('文', { 名前: 値 }) の {名前} は値に置き換える。補助スクリプトが返す日本語の文 (エラーなど) は tr() で訳す */
const KEY = 'tachigui.lang';

/* 選んだ言語 (auto / ja / en)。auto はブラウザの言語が日本語なら日本語、それ以外は英語 */
export function choice() {
	try { const v = localStorage.getItem(KEY); if (v === 'ja' || v === 'en') return v; }
	catch (e) { console.warn('i18n: 言語の設定を読めません', e); }
	return 'auto';
}
const c = choice();
export const lang = c !== 'auto' ? c : (/^ja\b/i.test(navigator.language || '') ? 'ja' : 'en');
document.documentElement.lang = lang;

/* 言語を変えて読み直す (辞書は起動のときに読むため) */
export function setLang(v) {
	try { if (v === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, v); }
	catch (e) { console.error('i18n: 言語の設定を保存できません', e); }
	location.reload();
}

let dict = {}, pats = [];
if (lang === 'en') {
	try { dict = (await import('./i18n/en.js' + new URL(import.meta.url).search)).default || {}; }
	catch (e) { console.error('i18n: 英語の辞書を読めません (日本語で出します)', e); }
	/* {名前} を含む文は、補助スクリプトの文に当てはめられるよう、正規表現にしておく */
	pats = Object.keys(dict).filter(k => /\{\w+\}/.test(k)).map(k => {
		const names = [];
		const src = k.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\w+)\}/g, (m, n) => { names.push(n); return '(.+?)'; });
		return { re: new RegExp('^' + src + '$'), names, k };
	});
}

const fill = (s, v) => v ? s.replace(/\{(\w+)\}/g, (m, n) => n in v ? v[n] : m) : s;

export function T(s, v) {
	if (typeof s !== 'string') return s;
	const out = dict[s];
	return fill(out === undefined ? s : out, v);
}

/* 補助スクリプトなどが返した文を訳す。辞書にそのままあれば使い、なければ {名前} のある文に当てはめる */
export function tr(s) {
	if (typeof s !== 'string' || lang !== 'en') return s;
	if (dict[s] !== undefined) return dict[s];
	for (const p of pats) {
		const m = p.re.exec(s);
		if (m) { const v = {}; p.names.forEach((n, i) => { v[n] = tr(m[i + 1]); }); return fill(dict[p.k], v); }
	}
	return s;
}
