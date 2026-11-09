/*
 * UCI の、小さな、窓口 (LuCI の uci.js の、使う部分だけを、まねた形)。
 *  - load: 設定を、読み込む。
 *  - get / set / unset / add / remove / sections: 手元 (メモリ) で、書き換える。
 *  - save: 手元の、変更を、ルーターに、送る (まだ、確定しない)。
 *  - apply: 変更を、適用する。rollback が、真なら、つながらなくなったとき、自動で、元に戻る。
 * 「ネットワーク設定」の、設定を書く処理 (core.js) は、この窓口に、頼っている。
 */
import { T, tr } from './i18n.js';
import { rpc } from './api.js';

const data = {};     // 設定名 → { セクション名 → { '.type', '.name', オプション… } }
const order = {};    // 設定名 → [ セクション名… ] (見つけた順)
let ops = [];        // 送る、変更の、列

const clone = v => JSON.parse(JSON.stringify(v));

export async function load(configs) {
	await Promise.all(configs.map(async conf => {
		const r = await rpc('uci', 'get', { config: conf });
		const vals = r.values || {};
		data[conf] = {};
		order[conf] = Object.keys(vals).sort((a, b) => (vals[a]['.index'] || 0) - (vals[b]['.index'] || 0));
		order[conf].forEach(sid => {
			const s = clone(vals[sid]);
			s['.name'] = sid;
			data[conf][sid] = s;
		});
	}));
	ops = [];
}

export function unload(conf) { delete data[conf]; delete order[conf]; }

export function get(conf, sid, opt) {
	const s = (data[conf] || {})[sid];
	if (opt == null)
		return s;
	return s ? s[opt] : undefined;
}

export function sections(conf, type, cb) {
	const out = (order[conf] || []).map(sid => data[conf][sid]).filter(s => s && (type == null || s['.type'] === type));
	if (cb) out.forEach(cb);
	return out;
}

export function set(conf, sid, opt, val) {
	const s = (data[conf] || (data[conf] = {}))[sid];
	if (!s) throw new Error(T('{name} がありません', { name: conf + '.' + sid }));
	s[opt] = val;
	ops.push({ op: 'set', conf: conf, sid: sid, opt: opt, val: val });
}

export function unset(conf, sid, opt) {
	const s = (data[conf] || {})[sid];
	if (!s || !(opt in s)) return;
	delete s[opt];
	ops.push({ op: 'unset', conf: conf, sid: sid, opt: opt });
}

let anon = 0;

export function add(conf, type, name) {
	data[conf] = data[conf] || {};
	order[conf] = order[conf] || [];
	const anonymous = !name;
	if (anonymous) name = '__new' + (++anon);
	data[conf][name] = { '.type': type, '.name': name };
	order[conf].push(name);
	ops.push({ op: 'add', conf: conf, type: type, name: name, anonymous: anonymous });
	return name;
}

export function remove(conf, sid) {
	if (!(data[conf] || {})[sid]) return;
	delete data[conf][sid];
	order[conf] = order[conf].filter(x => x !== sid);
	ops.push({ op: 'remove', conf: conf, sid: sid });
}

/* 手元の、未送信の、変更 (表示用) */
export function pending() {
	return ops.map(o => {
		if (o.op === 'set') return o.conf + '.' + o.sid + '.' + o.opt + '=' + JSON.stringify(o.val);
		if (o.op === 'unset') return '-' + o.conf + '.' + o.sid + '.' + o.opt;
		if (o.op === 'add') return '+' + o.conf + '.' + o.name + ' (' + o.type + ')';
		return '-' + o.conf + '.' + o.sid;
	});
}

export function discard() { ops = []; }

/* 変更を、ルーターに、送る。まだ、確定は、しない */
export async function save() {
	const list = ops;
	ops = [];
	const real = {};   /* 名前のない、セクション: 仮の名前 → 実際の名前 */
	const sid = (conf, s) => real[conf + ':' + s] || s;
	for (const o of list) {
		if (o.op === 'add') {
			const r = o.anonymous ? await rpc('uci', 'add', { config: o.conf, type: o.type }) : await rpc('uci', 'add', { config: o.conf, type: o.type, name: o.name });
			if (o.anonymous && r.section) real[o.conf + ':' + o.name] = r.section;
		}
		else if (o.op === 'set') {
			/* 空の配列と、空の値は、削除と、同じ */
			if (o.val == null || o.val === '' || (Array.isArray(o.val) && !o.val.length))
				await rpc('uci', 'delete', { config: o.conf, section: sid(o.conf, o.sid), options: [ o.opt ] }).catch(() => {});
			else
				await rpc('uci', 'set', { config: o.conf, section: sid(o.conf, o.sid), values: { [o.opt]: o.val } });
		}
		else if (o.op === 'unset')
			await rpc('uci', 'delete', { config: o.conf, section: sid(o.conf, o.sid), options: [ o.opt ] }).catch(() => {});
		else if (o.op === 'remove')
			await rpc('uci', 'delete', { config: o.conf, section: sid(o.conf, o.sid) });
	}
	return list.length;
}

/* 送った、変更が、残って、いるか */
export async function staged() {
	const r = await rpc('uci', 'changes', {});
	/* { 設定名: [ 変更… ] } の形で返る。設定名の一覧にする */
	return Object.keys(r.changes || {});
}

export async function revert(configs) {
	for (const c of configs) await rpc('uci', 'revert', { config: c }).catch(() => {});
}

/* 適用: rollback が、真なら、timeout 秒以内に、confirm しないと、自動で、元に戻る */
export async function apply(timeout, rollback) {
	await rpc('uci', 'apply', { timeout: timeout, rollback: !!rollback });
}

export async function confirm() {
	await rpc('uci', 'confirm', {});
}
