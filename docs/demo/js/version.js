/* TachiGUI の版。ビルド (build/mkapk2.py) が import に ?v=<版> を付けるので、その値を読む。ビルド前は空 */
const v = new URL(import.meta.url).searchParams.get('v') || '';
/* 画面には改版の番号 (-r1 など) を除いた版を出す (GitHub のリリースと同じ) */
export const VERSION = v.replace(/-r\d+$/, '');
export const BUILD = v;
