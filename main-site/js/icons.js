// Inline SVG icon set. viewBox "0 0 24 24", stroke="currentColor",
// stroke-width 1.8, round caps and joins, fill="none".
// Icons inherit colour via currentColor, so never hardcode fill or stroke here.
// Plain script, not a module: published on window.UwuIcons.

(function () {
  const A = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

  const icons = {
    // ---- theme ----
    sun: `<svg ${A}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>`,
    moon: `<svg ${A}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`,
    close: `<svg ${A}><path d="M18 6 6 18M6 6l12 12"/></svg>`,
    clock: `<svg ${A}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>`,

    // ---- header ----
    heart: `<svg ${A}><path d="m12 20.3-1.4-1.3C6.1 15 3 12.2 3 8.8 3 6.1 5.1 4 7.8 4c1.5 0 3 .7 4.2 2C13.2 4.7 14.7 4 16.2 4 18.9 4 21 6.1 21 8.8c0 3.4-3.1 6.2-7.6 10.2z"/></svg>`,
    bell: `<svg ${A}><path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15z"/><path d="M10 21a2.2 2.2 0 0 0 4 0"/></svg>`,
    "bell-on": `<svg ${A}><path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15z"/><path d="M10 21a2.2 2.2 0 0 0 4 0"/><path d="M3.2 8.5a9.5 9.5 0 0 1 2.6-4.3M20.8 8.5a9.5 9.5 0 0 0-2.6-4.3"/></svg>`,
    refresh: `<svg ${A}><path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v4.5h-4.5"/></svg>`,

    // ---- views ----
    gauge: `<svg ${A}><path d="M3.5 17a9 9 0 1 1 17 0"/><path d="m12 13 4-4.5"/><circle cx="12" cy="13.5" r="1.2"/></svg>`,
    map: `<svg ${A}><path d="M9 4.5 3.5 6.6v13l5.5-2.1 6 2.1 5.5-2.1v-13L15 6.6z"/><path d="M9 4.5v13M15 6.6v13"/></svg>`,
    trend: `<svg ${A}><path d="M3.5 3.5v17h17"/><path d="m7 15 4-4.5 3 3 5.5-6"/></svg>`,
    flask: `<svg ${A}><path d="M9.5 3h5M10.5 3v6L5 18.6A1.6 1.6 0 0 0 6.4 21h11.2a1.6 1.6 0 0 0 1.4-2.4L13.5 9V3"/><path d="M7.6 14.5h8.8"/></svg>`,
    wind: `<svg ${A}><path d="M3 9h11.5a2.75 2.75 0 1 0-2.75-2.75"/><path d="M3 13.5h15.5a2.75 2.75 0 1 1-2.75 2.75"/><path d="M3 18h6"/></svg>`,

    // ---- misc ----
    chevron: `<svg ${A}><path d="m9 5 7 7-7 7"/></svg>`,
    table: `<svg ${A}><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M3.5 14.5h17M10 9.5v10"/></svg>`,
    location: `<svg ${A}><path d="M12 21.2s7-5.7 7-11.2a7 7 0 1 0-14 0c0 5.5 7 11.2 7 11.2z"/><circle cx="12" cy="10" r="2.5"/></svg>`,
  };

  function icon(name) {
    return icons[name] || "";
  }

  window.UwuIcons = { icons, icon };
})();
