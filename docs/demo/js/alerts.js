/* 重大な問題の監視。見つかったら、ヘッダーに出す (どの画面にいても、気づけるように) */
import { T, tr } from './i18n.js';
import { sys, rpc, execJson } from './api.js';

/* 1 件: { level: 'ng' (重大) | 'warn' (注意), id, title, hint, page } */

const state = { netBad: 0, ifBad: {}, secAt: 0, sec: null };

async function collect() {
	const list = [];
	const add = (level, id, title, hint, page) => list.push({ level, id, title, hint, page });

	const [ ifaces, en, info, hw ] = await Promise.all([
		sys.ifaces().catch(() => null), sys.network().catch(() => null), sys.info().catch(() => null), execJson('/usr/libexec/tachigui-hw').catch(() => null)
	]);

	/* 回線 (ルーターモードのときだけ) */
	if (ifaces) {
		const by = n => ifaces.find(i => i.interface === n);
		const wan6 = by('wan6'), wan = by('wan'), map = by('map0'), ds = by('dslite0');
		const router = !!(wan6 || wan || map || ds);
		if (router) {
			const dev = (wan6 && wan6.device) || (wan && wan.device) || 'eth0';
			const d = en && en.devices ? en.devices.find(x => x.name === dev) : null;
			if (d && !d.carrier)
				add('ng', 'link', T('回線のケーブルが未接続 ({port})', { port: d.label }), T('ONU の電源とケーブルを確かめてください'), 'internet');
			else {
				const base = wan6 || wan;
				if (base && !base.up)
					add('ng', 'wan', T('WAN が停止中'), T('戻らないときはログを見てください'), 'internet');
				const tun = map || ds;
				if (tun && base && base.up && !tun.up)
					add('ng', 'tunnel', T('{name} が停止中', { name: map ? 'MAP-E' : 'DS-Lite' }), T('IPv4 で外に出られません。ログを見てください'), 'internet');
			}
		}
	}

	/* 実際に、外へ出られるか (一時的な失敗で、騒がないよう、2 回続けて、失敗したとき) */
	try {
		const c = await rpc('tachigui.network', 'check');
		state.netBad = c && c.ok ? 0 : state.netBad + 1;
	} catch (e) { /* 取れなかったときは、数えない */ }
	if (state.netBad >= 2)
		add('ng', 'net', T('インターネットに出られません'), T('回線とルーターの状態を確かめてください'), 'internet');

	/* 温度 */
	if (hw && hw.temp != null) {
		const t = hw.temp;
		if (t >= 85) add('ng', 'temp', T('CPU の温度が高すぎます ({temp}°C)', { temp: Math.round(t) }), T('ファンと通風を確かめてください'), 'overview');
		else if (t >= 75) add('warn', 'temp', T('CPU の温度が高め ({temp}°C)', { temp: Math.round(t) }), '', 'overview');
	}

	/* メモリと、ディスク */
	if (info) {
		const m = info.memory;
		if (m && m.total) {
			const free = (m.available != null ? m.available : m.free) / m.total;
			if (free < 0.05) add('ng', 'mem', T('メモリ不足 (空き {pct}%)', { pct: Math.round(free * 100) }), '', 'overview');
		}
		const r = info.root;
		if (r && r.total) {
			const free = r.free / r.total;
			if (free < 0.05) add('ng', 'disk', T('保存領域が残りわずか (空き {pct}%)', { pct: Math.round(free * 100) }), T('不要なファイルを消してください'), 'files');
		}
	}

	/* セキュリティ (5 分に 1 回) */
	if (Date.now() - state.secAt > 300000) {
		state.secAt = Date.now();
		state.sec = await execJson('/usr/libexec/tachigui-security', [ 'status' ]).catch(() => null);
	}
	const sec = state.sec;
	if (sec && sec.ssh) {
		if (!sec.root_pw) add('ng', 'pw', T('root のパスワードが未設定'), T('誰でも管理者として入れます。「管理アクセス」で設定してください'), 'admin');
		if (sec.ssh.interface !== 'lan') add('ng', 'ssh', T('SSH が外から届く設定'), T('「管理アクセス」で LAN だけにしてください'), 'admin');
		if (sec.firewall && sec.firewall.input !== 'REJECT' && sec.firewall.input !== 'DROP') add('warn', 'fw', T('ファイアウォールの入力が許可'), '', 'firewall');
	}

	return list;
}

export function start(onChange) {
	let stopped = false, busy = false;
	async function tick() {
		if (stopped || busy || document.hidden) return;
		busy = true;
		try { onChange(await collect()); } catch (e) { console.error('alerts: 状態を読めません (次の周期で、やり直す)', e); }
		busy = false;
	}
	tick();
	const t = setInterval(tick, 30000);
	return { stop() { stopped = true; clearInterval(t); }, now: tick };
}
