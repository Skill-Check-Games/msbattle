// Flag picker: a trigger button that opens a searchable, alphabetized grid of square flag+name
// cards — a desktop popover anchored to the trigger, or a centered modal sheet on narrow viewports.
// Ported (behavior, not code — the source is a React component) from Mathias's FlagPicker in the
// achtung-royale codebase: apps/client/src/pages/setup/FlagPicker.tsx. Data (codes, localized names,
// square flag SVGs) comes from Countries.js, which already followed the same Intl.DisplayNames
// approach independently.
//
// buildFlagPickerTrigger(currentCode, onChange) returns a <button> that owns its own current-flag
// display and opens the picker on click; onChange(code) fires with the newly picked code (or null
// for "no flag"), and the caller re-renders whatever else depends on it (the trigger repaints itself).

var FLAG_PICKER_PANEL_W = 320;
var FLAG_PICKER_PANEL_H = 420;
var FLAG_PICKER_NARROW_BREAKPOINT = 900;

var flagPickerCloseHandlers = null; // { onKeydown, onScroll, onResize } while a picker is open, else null

function closeFlagPicker() {
	var panel = document.getElementById("flag_picker_panel");
	if (panel) panel.remove();
	var scrim = document.getElementById("flag_picker_scrim");
	if (scrim) scrim.remove();
	if (flagPickerCloseHandlers) {
		document.removeEventListener("keydown", flagPickerCloseHandlers.onKeydown);
		window.removeEventListener("scroll", flagPickerCloseHandlers.onScroll, true);
		window.removeEventListener("resize", flagPickerCloseHandlers.onResize);
		flagPickerCloseHandlers = null;
	}
}

// triggerEl: the button the popover is anchored to (ignored on narrow viewports, where it's a
// centered sheet instead). currentCode: the currently-selected ISO code (or null). onSelect(code):
// called with the chosen code, or null if "No flag" is picked.
function openFlagPicker(triggerEl, currentCode, onSelect) {
	closeFlagPicker(); // only one at a time

	var narrow = window.innerWidth < FLAG_PICKER_NARROW_BREAKPOINT;
	var panel = document.createElement("div");
	panel.id = "flag_picker_panel";
	panel.className = "flag-picker-panel" + (narrow ? " narrow" : "");

	if (narrow) {
		var scrim = document.createElement("div");
		scrim.id = "flag_picker_scrim";
		scrim.className = "flag-picker-scrim";
		scrim.addEventListener("click", closeFlagPicker);
		document.body.appendChild(scrim);
	}

	var head = document.createElement("div"); head.className = "flag-picker-head";
	var title = document.createElement("span"); title.className = "flag-picker-title"; title.textContent = "Choose your flag";
	var closeBtn = document.createElement("button");
	closeBtn.type = "button"; closeBtn.className = "flag-picker-close"; closeBtn.textContent = "×";
	closeBtn.setAttribute("aria-label", "Close");
	closeBtn.addEventListener("click", closeFlagPicker);
	head.appendChild(title); head.appendChild(closeBtn);
	panel.appendChild(head);

	var search = document.createElement("input");
	search.type = "text"; search.className = "flag-picker-search"; search.placeholder = "Search";
	panel.appendChild(search);

	var grid = document.createElement("div"); grid.className = "flag-picker-grid";
	panel.appendChild(grid);

	var items = (typeof countryList === "function") ? countryList() : []; // [{code,name}], already alphabetized

	function selectAndClose(code) {
		onSelect(code);
		closeFlagPicker();
	}

	function buildCell(code, name, imgSrc) {
		var cell = document.createElement("button");
		cell.type = "button";
		cell.className = "flag-cell" + (code === currentCode ? " active" : "");
		var imgWrap = document.createElement("span"); imgWrap.className = "flag-cell-img";
		if (imgSrc) { var img = document.createElement("img"); img.src = imgSrc; img.alt = ""; imgWrap.appendChild(img); }
		var label = document.createElement("span"); label.className = "flag-cell-label"; label.textContent = name;
		cell.appendChild(imgWrap); cell.appendChild(label);
		cell.addEventListener("click", function() { selectAndClose(code); });
		return cell;
	}

	function renderGrid(query) {
		grid.innerHTML = "";
		var q = (query || "").trim().toLowerCase();
		// "No flag" always shows for an empty query, and matches typing "no"/"none" too.
		if (!q || "no flag".indexOf(q) === 0 || "none".indexOf(q) === 0) {
			grid.appendChild(buildCell(null, "No flag", null));
		}
		var filtered = !q ? items : items.filter(function(it) {
			return it.name.toLowerCase().indexOf(q) !== -1 || it.code.toLowerCase().indexOf(q) !== -1;
		});
		filtered.forEach(function(it) {
			grid.appendChild(buildCell(it.code, it.name, typeof countryFlagSrcSquare === "function" ? countryFlagSrcSquare(it.code) : null));
		});
	}
	renderGrid("");
	search.addEventListener("input", function() { renderGrid(search.value); });

	document.body.appendChild(panel);

	if (!narrow) {
		// Anchor below the trigger, flipping above it if there's more room there than below (mirrors
		// FlagPicker.tsx's positioning arithmetic).
		var r = triggerEl.getBoundingClientRect();
		var spaceBelow = window.innerHeight - r.bottom;
		var flipUp = spaceBelow < FLAG_PICKER_PANEL_H + 12 && r.top > spaceBelow;
		var top = Math.round(flipUp ? Math.max(8, r.top - FLAG_PICKER_PANEL_H - 6) : r.bottom + 6);
		var left = Math.round(Math.max(8, Math.min(r.left, window.innerWidth - FLAG_PICKER_PANEL_W - 8)));
		panel.style.top = top + "px";
		panel.style.left = left + "px";
	}

	var onKeydown = function(e) { if (e.key === "Escape") closeFlagPicker(); };
	// Scrolling the page closes the picker, EXCEPT scrolling inside the grid itself (so the list stays
	// usable) — capture phase so this catches any scrollable ancestor, not just window scroll.
	var onScroll = function(e) { if (panel.contains(e.target)) return; closeFlagPicker(); };
	var onResize = closeFlagPicker;
	document.addEventListener("keydown", onKeydown);
	window.addEventListener("scroll", onScroll, true);
	window.addEventListener("resize", onResize);
	flagPickerCloseHandlers = { onKeydown: onKeydown, onScroll: onScroll, onResize: onResize };

	setTimeout(function() { search.focus(); }, 0);
}

// A 52×52 square trigger button showing just the current flag (or a neutral placeholder), matching
// FlagPicker.tsx's trigger. Repaints itself on selection; the caller's onChange still fires so it can
// update whatever else depends on the country (e.g. the avatar preview, which falls back to the flag
// colour when no country is set).
function buildFlagPickerTrigger(currentCode, onChange) {
	var code = currentCode || null;
	var btn = document.createElement("button");
	btn.type = "button";
	btn.className = "flag-picker-trigger";

	function paint() {
		btn.innerHTML = "";
		if (code && typeof countryFlagSrcSquare === "function") {
			var img = document.createElement("img"); img.src = countryFlagSrcSquare(code); img.alt = "";
			btn.appendChild(img);
		} else {
			var ph = document.createElement("span"); ph.className = "flag-picker-trigger-empty"; ph.textContent = "—";
			btn.appendChild(ph);
		}
		var label = "Flag: " + (code && typeof countryName === "function" ? countryName(code) : "None");
		btn.title = label;
		btn.setAttribute("aria-label", label);
	}
	paint();

	btn.addEventListener("click", function() {
		openFlagPicker(btn, code, function(newCode) {
			code = newCode;
			paint();
			onChange(newCode);
		});
	});
	return btn;
}
