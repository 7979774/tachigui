/* システムログ (logread) の読み取りと、整形 */
import { sys } from './api.js';

/* 例: "Sun Oct 25 08:07:06 2026 daemon.notice netifd: Interface 'wan6' is now up" */
const LINE = /^\w{3} (\w{3} +\d+ \d\d:\d\d:\d\d) (\d{4}) (\S+?)\.(\S+) ([^:\[]+?)(?:\[\d+\])?: ([\s\S]*)$/;

export function parse(text) {
	return text.split('\n').filter(Boolean).map((raw, i) => {
		const m = LINE.exec(raw);
		return m ? { i, raw, time: m[1], year: m[2], fac: m[3], level: m[4], proc: m[5], msg: m[6] } : { i, raw, time: '', fac: '', level: 'info', proc: '', msg: raw };
	});
}

export async function fetchLogs(n) {
	return parse(await sys.exec('/sbin/logread', [ '-l', String(n || 300) ]));
}

/* ネットワーク接続に関する行 */
export const WAN_RE = /netifd|odhcp6c|dhcpv6|dnsmasq-dhcp|pppd|pppoe|map0|wan6?\b|dslite|eth0|link is|igc/i;

export const LEVELS = { emerg: 0, alert: 0, crit: 0, err: 0, warn: 1, warning: 1, notice: 2, info: 3, debug: 4 };
