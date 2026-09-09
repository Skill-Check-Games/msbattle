// Country codes and flag asset paths. Names are not hardcoded: Intl.DisplayNames resolves them.
export const COUNTRY_CODES = ("ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bl bm bn bo " +
	"br bs bt bw by bz ca cc cd cf cg ch ci ck cl cm cn co cr cu cv cw cx cy cz de dj dk dm do dz ec ee " +
	"eg eh er es et fi fj fk fm fo fr ga gb gd ge gf gg gh gi gl gm gn gp gq gr gt gu gw gy hk hn hr ht " +
	"hu id ie il im in io iq ir is it je jm jo jp ke kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls " +
	"lt lu lv ly ma mc md me mg mh mk ml mm mn mo mp mq mr ms mt mu mv mw mx my mz na ne nf ng ni nl no " +
	"np nr nu nz om pa pe pf pg ph pk pl pn pr ps pt pw py qa re ro rs ru rw sa sb sc sd se sg sh si sk " +
	"sl sm sn so sr ss st sv sx sy sz tc td tf tg th tj tk tl tm tn to tr tt tv tw tz ua ug us uy uz va " +
	"vc ve vg vi vn vu ws xk ye yt za zm zw").split(" ");

let regionNames: Intl.DisplayNames | null = null;
try { regionNames = new Intl.DisplayNames(undefined, { type: "region" }); } catch { /* unsupported */ }

export function countryName(code: string | null | undefined): string {
	if (!code) return "";
	const cc = String(code).toUpperCase();
	if (regionNames) { try { const n = regionNames.of(cc); if (n && n !== cc) return n; } catch { /* bad code */ } }
	return cc;
}
export function countryFlagSrc(code: string | null | undefined): string | null { return code ? "/flags/" + String(code).toLowerCase() + ".svg" : null; }
export function countryFlagSrcSquare(code: string | null | undefined): string | null { return code ? "/flags-square/" + String(code).toLowerCase() + ".svg" : null; }
export function countryList(): Array<{ code: string; name: string }> {
	return COUNTRY_CODES.map(c => ({ code: c, name: countryName(c) })).sort((a, b) => a.name.localeCompare(b.name));
}

const TZ_COUNTRY: Record<string, string> = {
	"Europe/Stockholm": "SE", "Europe/Oslo": "NO", "Europe/Copenhagen": "DK", "Europe/Helsinki": "FI", "Atlantic/Reykjavik": "IS",
	"Europe/London": "GB", "Europe/Dublin": "IE", "Europe/Paris": "FR", "Europe/Berlin": "DE", "Europe/Amsterdam": "NL",
	"Europe/Brussels": "BE", "Europe/Luxembourg": "LU", "Europe/Zurich": "CH", "Europe/Vienna": "AT", "Europe/Prague": "CZ",
	"Europe/Warsaw": "PL", "Europe/Budapest": "HU", "Europe/Bratislava": "SK", "Europe/Ljubljana": "SI", "Europe/Zagreb": "HR",
	"Europe/Belgrade": "RS", "Europe/Sarajevo": "BA", "Europe/Skopje": "MK", "Europe/Sofia": "BG", "Europe/Bucharest": "RO",
	"Europe/Athens": "GR", "Europe/Istanbul": "TR", "Europe/Kiev": "UA", "Europe/Kyiv": "UA", "Europe/Minsk": "BY",
	"Europe/Moscow": "RU", "Europe/Riga": "LV", "Europe/Tallinn": "EE", "Europe/Vilnius": "LT", "Europe/Rome": "IT",
	"Europe/Madrid": "ES", "Europe/Lisbon": "PT", "Europe/Malta": "MT",
	"America/New_York": "US", "America/Chicago": "US", "America/Denver": "US", "America/Los_Angeles": "US", "America/Phoenix": "US",
	"America/Anchorage": "US", "Pacific/Honolulu": "US", "America/Toronto": "CA", "America/Vancouver": "CA", "America/Edmonton": "CA",
	"America/Winnipeg": "CA", "America/Halifax": "CA", "America/Mexico_City": "MX", "America/Sao_Paulo": "BR",
	"America/Argentina/Buenos_Aires": "AR", "America/Santiago": "CL", "America/Bogota": "CO", "America/Lima": "PE",
	"Asia/Tokyo": "JP", "Asia/Seoul": "KR", "Asia/Shanghai": "CN", "Asia/Hong_Kong": "HK", "Asia/Taipei": "TW", "Asia/Singapore": "SG",
	"Asia/Kolkata": "IN", "Asia/Dubai": "AE", "Asia/Jerusalem": "IL", "Asia/Bangkok": "TH", "Asia/Jakarta": "ID", "Asia/Manila": "PH",
	"Asia/Kuala_Lumpur": "MY", "Australia/Sydney": "AU", "Australia/Melbourne": "AU", "Australia/Brisbane": "AU", "Australia/Perth": "AU",
	"Pacific/Auckland": "NZ", "Africa/Johannesburg": "ZA", "Africa/Cairo": "EG", "Africa/Lagos": "NG", "Africa/Nairobi": "KE"
};

// Best guess for a fresh guest's flag: UI-language region, else time zone, else the locale's likely region.
export function guessCountry(): string | null {
	const ok = (c: any) => (c && COUNTRY_CODES.indexOf(String(c).toLowerCase()) !== -1) ? String(c).toUpperCase() : null;
	try {
		const lang = (navigator.languages && navigator.languages[0]) || navigator.language || "";
		const m = /^[A-Za-z]{2,3}(?:-[A-Za-z]{4})?-([A-Za-z]{2})(?:-|$)/.exec(lang);
		if (m && ok(m[1])) return ok(m[1]);
		const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
		if (tz && TZ_COUNTRY[tz] && ok(TZ_COUNTRY[tz])) return ok(TZ_COUNTRY[tz]);
		if (typeof (Intl as any).Locale === "function" && lang) { const r = new (Intl as any).Locale(lang).maximize().region; if (ok(r)) return ok(r); }
	} catch { /* fall through */ }
	return null;
}
