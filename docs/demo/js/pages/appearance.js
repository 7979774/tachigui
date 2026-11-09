/* 外観: 言語、テーマ、フォント、背景 */
import { T, tr, lang, choice, setLang } from '../i18n.js';
import { html, render, useState, useEffect, useRef, Icon } from '../ui-kit.js';
import * as theme from '../theme.js';
import { ask } from '../dialog.js';
import { HelpLayout } from '../help.js';

const HELP = {
	lang: { t: T('言語'), body: T('画面の言葉。自動はブラウザの言語に合わせる (日本語以外は英語)') },
	theme: { t: T('テーマ'), items: [ [ 'dark', T('ダーク'), T('暗い画面') ], [ 'light', T('ライト'), T('明るい画面') ], [ 'auto', T('システム'), T('端末の設定に合わせる') ] ] },
	font: { t: T('フォント'), body: T('画面の書体。カスタムはこの端末に入っている書体の名前を指定する。入っていないと標準で出る') },
	size: { t: T('文字の大きさ'), body: T('画面全体の文字の大きさ') },
	bg: { t: T('背景'), body: T('画像は自動で小さくして保存する。ライトテーマでは、用意された背景は明るい色になる') },
	dim: { t: T('暗さ'), body: T('背景に重ねる濃さ。文字が読みにくいときに上げる。ライトテーマでは白さになる') }
};

/* 拡張子を除いたファイル名。全体はツールチップで見られる */
const stem = name => name.replace(/\.[^.]+$/, '');

function Page() {
	const [t, setT] = useState(theme.current());
	const [msg, setMsg] = useState(null);
	const [busy, setBusy] = useState(false);
	const [images, setImages] = useState([]);    // 追加した画像のファイル名
	const fileIn = useRef(null);

	/* 読めないとき: 古いログインは一覧の権限を持たないので、ログインし直せば直る */
	async function loadImages() {
		try { const list = await theme.listImages(); setImages(list); return list; }
		catch (e) { console.error('appearance: 画像の一覧を読めません', e); setMsg({ k: 'ng', t: T('画像の一覧を読めません。ログインし直してください') }); return null; }
	}
	useEffect(() => { loadImages(); }, []);

	/* 履歴は theme.apply が足すので、適用後の内容を画面と保存に使う */
	async function change(next) {
		theme.apply(next);
		const applied = theme.current();
		setT(applied);
		try { await theme.save(applied); setMsg(null); } catch (e) { setMsg({ k: 'ng', t: T('保存できませんでした: ') + e.message }); }
	}
	async function pick(file) {
		if (!file) return;
		setBusy(true);
		/* アップロード中に別の設定を変えても戻さないよう、終わった時点の内容に足す */
		try {
			const names = await loadImages();     // 上書きしないよう、送る直前の一覧で名前を決める
			if (!names) return;
			const { url, note } = await theme.upload(file, names);
			await change({ ...theme.current(), bg: 'custom', image: url });
			await loadImages();
			setMsg({ k: 'ok', t: T('追加しました ({note})', { note }) });
		} catch (e) { setMsg({ k: 'ng', t: e.message }); }
		finally { setBusy(false); }
	}
	async function removeImage(name) {
		const inUse = t.image === theme.imageUrl(name);
		if (!await ask({ title: T('{name} を削除', { name: stem(name) }), body: inUse ? T('今の背景は「標準」に戻ります') : '', ok: T('削除'), danger: true })) return;
		setBusy(true);
		try {
			await theme.removeImage(name);
			if (inUse) await change({ ...theme.current(), bg: t.bg === 'custom' ? theme.DEFAULTS.bg : t.bg, image: '' });
			await loadImages();
		} catch (e) { setMsg({ k: 'ng', t: T('削除できませんでした: ') + e.message }); }
		setBusy(false);
	}

	const chip = (on, label, fn) => html`<button type="button" class=${'chip pick' + (on ? ' on' : '')} onClick=${fn}>${label}</button>`;

	/* 言語の名前は、どの言語の画面でもその言語で書く (選ぶ人が読めるように) */
	const langs = [ [ 'auto', T('自動') ], [ 'ja', '日本語' ], [ 'en', 'English' ] ];     // i18n-ok
	return html`<${HelpLayout} help=${HELP}><div class="stack narrowcol wide-ok">
	<section class="card"><h2>${T('言語')}</h2>
		<div class="chips" data-help="lang">${langs.map(x => chip(choice() === x[0], x[1], () => { if (choice() !== x[0]) setLang(x[0]); }))}</div>
	</section>
	<section class="card"><h2>${T('テーマ')}</h2>
		<div class="chips" data-help="theme" data-help-on=${t.mode}>${[ [ 'dark', T('ダーク') ], [ 'light', T('ライト') ], [ 'auto', T('システム') ] ].map(x => chip(t.mode === x[0], x[1], () => change({ ...t, mode: x[0] })))}</div>
	</section>
	<section class="card"><h2>${T('フォント')}</h2>
		<div class="chips" data-help="font">${Object.keys(theme.FONTS).map(k => chip(t.font === k, theme.FONTS[k].label, () => change({ ...t, font: k }))).concat(chip(t.font === 'custom', T('カスタム'), () => change({ ...t, font: 'custom' })))}</div>
		${t.font === 'custom' ? html`<input type="text" class="in" style="width:100%;margin:.3rem 0" placeholder=${T('この端末に入っている書体の名前 (例: BIZ UDPGothic)')} value=${t.fontName} onChange=${e => change({ ...t, fontName: e.target.value })} />
			${t.fonts.length ? html`<div class="chips">${t.fonts.map(n => html`<button type="button" class=${'chip pick' + (theme.safeFont(t.fontName) === n ? ' on' : '')} style=${'font-family:"' + n + '"'} onClick=${() => change({ ...t, font: 'custom', fontName: n })}>${n}</button>`)}</div>` : null}` : null}
		<div class="chips" data-help="size">${Object.keys(theme.SIZES).map(k => chip(t.size === k, theme.SIZES[k].label, () => change({ ...t, size: k })))}</div>
		<div class="fontsample">${lang === 'ja' ? html`<div>${T('速い茶色の狐が、怠け者の犬を跳び越える。')}</div>` : null}<div>The quick brown fox jumps over the lazy dog. 0123456789</div></div>
	</section>
	<section class="card"><h2>${T('背景')}</h2>
		<div class="bgpick" data-help="bg">${Object.keys(theme.PRESETS).map(k => html`<button class=${'bgchip' + (t.bg === k ? ' on' : '')} style=${'background:' + (t.mode === 'light' || (t.mode === 'auto' && !window.matchMedia('(prefers-color-scheme: dark)').matches) ? theme.LIGHT[k] : theme.PRESETS[k].css) + ' center / cover'} onClick=${() => change({ ...t, bg: k })}><span>${theme.PRESETS[k].label}</span></button>`)}
			${images.map(n => { const u = theme.imageUrl(n); return html`<div class="bgitem">
				<button class=${'bgchip' + (t.bg === 'custom' && t.image === u ? ' on' : '')} style=${'background:url("' + u + '") center / cover'} title=${n} onClick=${() => change({ ...t, bg: 'custom', image: u })}><span>${stem(n)}</span></button>
				<button type="button" class="bgdel" title=${T('削除')} aria-label=${T('{name} を削除', { name: stem(n) })} disabled=${busy} onClick=${() => removeImage(n)}><${Icon} n="trash" s=${14} /></button></div>`; })}
			<button class="bgchip" disabled=${busy} onClick=${() => fileIn.current.click()}><span>${busy ? T('送信中…') : T('画像を追加…')}</span></button></div>
		<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden ref=${fileIn} onChange=${e => { pick(e.target.files[0]); e.target.value = ''; }} />
		<div class="f" data-help="dim"><label class="f-k">${t.mode === 'light' ? T('白さ') : T('暗さ')}</label><div class="f-v"><input type="range" min="0" max="80" value=${t.dim} onInput=${e => setT({ ...t, dim: +e.target.value })} onChange=${e => change({ ...t, dim: +e.target.value })} /> <span class="muted small">${t.dim}%</span></div></div>
		${msg ? html`<div class=${'alert ' + msg.k}>${msg.t}</div>` : null}
	</section></div><//>`;
}

export function mount(root) {
	root.appendChild(Object.assign(document.createElement('div'), { className: 'page-title', innerHTML: '<h1>' + T('外観') + '</h1>' }));
	const host = document.createElement('div');
	root.appendChild(host);
	render(html`<${Page} />`, host);
	return { stop() { render(null, host); } };
}
