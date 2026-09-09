// Country support for the avatar / profile country picker.
//
// We deliberately DON'T hardcode country names. The browser's Intl.DisplayNames maps each ISO-3166
// alpha-2 code to a localized name at runtime — accurate, localized, and nothing to maintain. The only
// embedded data is the list of codes (just letter pairs), mirroring the flag SVGs under /flags/<code>.svg
// that were copied from the trevelur project. Flag art is an <img>, so it renders identically on every
// platform (unlike flag emoji, which Windows doesn't render).
(function () {
	// Codes that have a flag SVG in /flags. Kept as a plain code list; names come from Intl at runtime.
	var CODES = ("ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bl bm bn bo " +
		"br bs bt bw by bz ca cc cd cf cg ch ci ck cl cm cn co cr cu cv cw cx cy cz de dj dk dm do dz ec ee " +
		"eg eh er es et fi fj fk fm fo fr ga gb gd ge gf gg gh gi gl gm gn gp gq gr gt gu gw gy hk hn hr ht " +
		"hu id ie il im in io iq ir is it je jm jo jp ke kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls " +
		"lt lu lv ly ma mc md me mg mh mk ml mm mn mo mp mq mr ms mt mu mv mw mx my mz na ne nf ng ni nl no " +
		"np nr nu nz om pa pe pf pg ph pk pl pn pr ps pt pw py qa re ro rs ru rw sa sb sc sd se sg sh si sk " +
		"sl sm sn so sr ss st sv sx sy sz tc td tf tg th tj tk tl tm tn to tr tt tv tw tz ua ug us uy uz va " +
		"vc ve vg vi vn vu ws xk ye yt za zm zw").split(" ");

	var regionNames = null;
	try { regionNames = new Intl.DisplayNames(undefined, { type: "region" }); } catch (e) {}

	// Localized country name for a code, falling back to the upper-cased code if the runtime can't resolve it.
	function countryName(code) {
		if (!code) return "";
		var cc = String(code).toUpperCase();
		if (regionNames) { try { var n = regionNames.of(cc); if (n && n !== cc) return n; } catch (e) {} }
		return cc;
	}

	function countryFlagSrc(code) { return code ? "/flags/" + String(code).toLowerCase() + ".svg" : null; }
	// Square (unmasked) variant — used by the flag-picker grid, where a round flag stretched to fill a
	// square cell looks distorted. Same 282-code set as /flags, just uncropped.
	function countryFlagSrcSquare(code) { return code ? "/flags-square/" + String(code).toLowerCase() + ".svg" : null; }

	// [{ code, name }] sorted by localized name — feeds the picker dropdown.
	function countryList() {
		return CODES.map(function (c) { return { code: c, name: countryName(c) }; })
			.sort(function (a, b) { return a.name.localeCompare(b.name); });
	}

	// Best-effort guess of where the visitor is, used as a fresh GUEST's default flag (they can change
	// it from the home card's flag tile; signed-in accounts are never guessed for). No geo-IP is
	// available on the host, so this is browser-side: (1) an explicit region in the UI language
	// ("sv-SE" → SE); (2) the IANA time zone via a compact city→country table — covers the common
	// "English-UI browser in Stockholm" case, which reports just "en" + Europe/Stockholm; (3) Intl.Locale's
	// likely-subtags for a bare language ("sv" → SE). Returns an uppercase code that has a flag, or null.
	var TZ_COUNTRY = {
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
	function guessCountry() {
		function ok(c) { return (c && CODES.indexOf(String(c).toLowerCase()) !== -1) ? String(c).toUpperCase() : null; }
		try {
			var lang = (navigator.languages && navigator.languages[0]) || navigator.language || "";
			var m = /^[A-Za-z]{2,3}(?:-[A-Za-z]{4})?-([A-Za-z]{2})(?:-|$)/.exec(lang);
			if (m && ok(m[1])) return ok(m[1]);
			var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
			if (tz && TZ_COUNTRY[tz] && ok(TZ_COUNTRY[tz])) return ok(TZ_COUNTRY[tz]);
			if (typeof Intl.Locale === "function" && lang) { var r = new Intl.Locale(lang).maximize().region; if (ok(r)) return ok(r); }
		} catch (e) {}
		return null;
	}

	window.COUNTRY_CODES = CODES;
	window.guessCountry = guessCountry;
	window.countryName = countryName;
	window.countryFlagSrc = countryFlagSrc;
	window.countryFlagSrcSquare = countryFlagSrcSquare;
	window.countryList = countryList;
})();
