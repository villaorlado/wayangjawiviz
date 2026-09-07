/* Wayang-in-Jawi-Print visualization
 * Plain D3 + Leaflet, no build step. See data/datasets.json for the list
 * of term datasets and data/city_coords.json for the event_city lookup.
 */
(function () {
  "use strict";

  const EXCLUDED_WAYANG_TYPE = new Set(["", "other_or_undetermined"]);
  const EXCLUDED_ARTICLE_GENRE = new Set(["", "other"]);

  // Asia bounding box (generous): lat -11..55, lon 24..150. Anything geocoded
  // outside this box is treated as a data error (wrong city assignment / OCR
  // misread) and excluded from the map, not silently plotted.
  function isInAsia(lat, lon) {
    return lat >= -11 && lat <= 55 && lon >= 24 && lon <= 150;
  }

  const state = {
    rows: [],
    cityCoords: {},
    selectedMonth: null,
    map: null,
    mapLayer: null,
    // Cross-filters shared by the three Distributions views. filterOrder
    // records the click order in which the type/genre/city filters were
    // locked in: a facet's own chart only reflects filters locked in BEFORE
    // it, never ones locked in after (order-dependent crossfilter). The map
    // and the article-list detail are the terminal views and always reflect
    // every active filter regardless of order.
    filters: { wayang_type: null, article_genre: null, event_city: null },
    filterOrder: [],
  };

  const tooltip = d3.select("body")
    .append("div")
    .attr("class", "viz-tooltip");

  function showTooltip(html, event) {
    tooltip
      .html(html)
      .style("opacity", 1)
      .style("left", (event.clientX + 14) + "px")
      .style("top", (event.clientY + 14) + "px");
  }
  function hideTooltip() {
    tooltip.style("opacity", 0);
  }

  // ---------- Parsing ----------

  const PAGE_ID_RE = /^([A-Za-z]+)-(\d{4})-(\d{2})-(\d{2})-(\d+)$/;

  function parsePageId(pageId) {
    const m = PAGE_ID_RE.exec(pageId || "");
    if (!m) return null;
    return {
      source: m[1],
      year: +m[2],
      month: +m[3],
      day: +m[4],
      page: +m[5],
      dateStr: `${m[2]}-${m[3]}-${m[4]}`,
      monthKey: `${m[2]}-${m[3]}`,
    };
  }

  function cleanSnippet(text) {
    if (!text) return "";
    const flat = text.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
    return flat.slice(0, 200);
  }

  function resolveCity(raw, cityCoords) {
    const trimmed = (raw || "").trim();
    if (!trimmed) return { status: "blank" };
    const hit = cityCoords[trimmed.toLowerCase()];
    if (!hit) return { status: "unmapped" };
    if (!isInAsia(hit.lat, hit.lon)) return { status: "out_of_asia" };
    return { status: "ok", canonical: hit.canonical, lat: hit.lat, lon: hit.lon };
  }

  // ---------- Data loading ----------

  async function loadDatasetList() {
    const res = await fetch("data/datasets.json");
    return res.json();
  }

  async function loadCityCoords() {
    const res = await fetch("data/city_coords.json");
    return res.json();
  }

  async function loadDataset(file, cityCoords) {
    const raw = await d3.csv(file);
    return raw.map((r) => {
      const parsed = parsePageId(r.page_id);
      return {
        page_id: r.page_id,
        region_id: r.region_id,
        dateStr: parsed ? parsed.dateStr : null,
        monthKey: parsed ? parsed.monthKey : null,
        page: parsed ? parsed.page : null,
        source: parsed ? parsed.source : null,
        region_text: r.region_text || "",
        wayang_type: (r.wayang_type || "").trim(),
        article_genre: (r.article_genre || "").trim(),
        event_city_raw: (r.event_city || "").trim(),
        city: resolveCity(r.event_city, cityCoords),
      };
    }).filter((r) => r.monthKey !== null);
  }

  // ---------- Generic bar chart ----------

  function renderBarChart(container, data, opts) {
    // data: [{key, value}], opts: {onClick, selectedKey, formatKey, colorForIndex,
    //   tickValues: subset of keys to label (keeps labels horizontal and legible
    //   instead of rotating them when there are many bars)}
    d3.select(container).selectAll("*").remove();
    const width = container.clientWidth || 600;
    const height = opts.height || 280;
    const margin = { top: 16, right: 12, bottom: 32, left: 40 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const svg = d3.select(container).append("svg")
      .attr("width", width)
      .attr("height", height);

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scaleBand()
      .domain(data.map((d) => d.key))
      .range([0, innerW])
      .padding(0.25);

    const maxVal = d3.max(data, (d) => d.value) || 1;
    const y = d3.scaleLinear()
      .domain([0, maxVal]).nice()
      .range([innerH, 0]);

    g.append("g")
      .attr("class", "axis y-axis")
      .call(d3.axisLeft(y).ticks(5).tickSize(-innerW).tickFormat(d3.format("~s")))
      .call((sel) => sel.select(".domain").remove());

    const axisFormat = opts.tickFormat || opts.formatKey;
    const xAxisGen = d3.axisBottom(x).tickFormat((d) => axisFormat ? axisFormat(d) : d);
    if (opts.tickValues) xAxisGen.tickValues(opts.tickValues);

    g.append("g")
      .attr("class", "axis x-axis")
      .attr("transform", `translate(0,${innerH})`)
      .call(xAxisGen);

    const hasSelection = opts.selectedKey != null;

    g.selectAll(".bar")
      .data(data, (d) => d.key)
      .join("rect")
      .attr("class", (d) => {
        let cls = "bar";
        if (opts.selectedKey === d.key) cls += " selected";
        else if (hasSelection) cls += " dimmed";
        return cls;
      })
      .attr("x", (d) => x(d.key))
      .attr("width", x.bandwidth())
      .attr("y", (d) => y(d.value))
      .attr("height", (d) => innerH - y(d.value))
      .style("fill", (d, i) => opts.colorForIndex ? opts.colorForIndex(i) : null)
      .on("mousemove", function (event, d) {
        showTooltip(`<b>${opts.formatKey ? opts.formatKey(d.key) : d.key}</b><br>${d.value.toLocaleString()} mention${d.value === 1 ? "" : "s"}`, event);
      })
      .on("mouseleave", hideTooltip)
      .on("click", function (event, d) {
        if (opts.onClick) opts.onClick(d.key);
      });
  }

  // ---------- Tab 1: over time (month granularity) ----------

  const formatMonthLabel = d3.utcFormat("%b %Y");

  function monthLabel(monthKey) {
    return formatMonthLabel(new Date(`${monthKey}-01T00:00:00Z`));
  }

  // All calendar months from the first to the last month present in the
  // data, inclusive, so months with zero mentions still get a (empty) bar.
  function fullMonthRange(monthKeys) {
    const [minKey, maxKey] = d3.extent(monthKeys);
    const [minY, minM] = minKey.split("-").map(Number);
    const [maxY, maxM] = maxKey.split("-").map(Number);
    const out = [];
    let y = minY, m = minM;
    while (y < maxY || (y === maxY && m <= maxM)) {
      out.push(`${y}-${String(m).padStart(2, "0")}`);
      m++;
      if (m > 12) { m = 1; y++; }
    }
    return out;
  }

  function renderTimeTab() {
    const byMonth = d3.rollup(state.rows, (v) => v.length, (d) => d.monthKey);
    const monthKeys = fullMonthRange(Array.from(byMonth.keys()));
    const counts = monthKeys.map((key) => ({ key, value: byMonth.get(key) || 0 }));
    const monthsWithData = counts.filter((d) => d.value > 0).length;

    document.getElementById("timeTotal").textContent =
      `${state.rows.length.toLocaleString()} mentions across ${monthsWithData} of ${counts.length} months (${monthLabel(counts[0].key)} – ${monthLabel(counts[counts.length - 1].key)})`;

    // Everything stays on one screen, no horizontal scroll: with few months,
    // label each one; with many, label just January of each year (short "1956"
    // labels, evenly spread and horizontal, instead of cramming every month).
    const yearStarts = counts.filter((d) => d.key.endsWith("-01"));
    const sparse = counts.length > 24;
    const tickValues = sparse ? yearStarts.map((d) => d.key) : undefined;
    const tickFormat = sparse ? (key) => key.slice(0, 4) : monthLabel;

    renderBarChart(document.getElementById("timeChart"), counts, {
      height: 300,
      tickValues,
      tickFormat,
      selectedKey: state.selectedMonth,
      formatKey: monthLabel,
      onClick: (monthKey) => {
        state.selectedMonth = state.selectedMonth === monthKey ? null : monthKey;
        renderTimeTab();
        if (state.selectedMonth !== null) renderMonthDetail(state.selectedMonth);
        else document.getElementById("dayDetail").hidden = true;
      },
    });
  }

  function renderMonthDetail(monthKey) {
    const rows = state.rows
      .filter((r) => r.monthKey === monthKey)
      .sort((a, b) => a.dateStr.localeCompare(b.dateStr) || a.page - b.page);

    const panel = document.getElementById("dayDetail");
    const title = document.getElementById("dayDetailTitle");
    const list = document.getElementById("dayDetailList");

    title.textContent = `${monthLabel(monthKey)} — ${rows.length} mention${rows.length === 1 ? "" : "s"}`;
    renderSnippetList(list, rows);
    panel.hidden = false;
  }

  function renderSnippetList(list, rows) {
    list.innerHTML = "";
    rows.forEach((r) => {
      const li = document.createElement("li");
      li.className = "snippet-item";

      const meta = document.createElement("div");
      meta.className = "snippet-meta";
      meta.innerHTML =
        `<span><b>Date:</b> ${r.dateStr || "—"}</span>` +
        `<span><b>Page:</b> ${r.page ?? "—"}</span>` +
        `<span><b>Source:</b> ${r.source || "—"}</span>`;

      const text = document.createElement("div");
      text.className = "snippet-text";
      const snippet = cleanSnippet(r.region_text);
      text.textContent = snippet + (r.region_text && r.region_text.length > 200 ? "…" : "");

      li.appendChild(meta);
      li.appendChild(text);
      list.appendChild(li);
    });
  }

  document.getElementById("closeDetail").addEventListener("click", () => {
    state.selectedMonth = null;
    document.getElementById("dayDetail").hidden = true;
    renderTimeTab();
  });

  // ---------- Tab 2: distributions (cross-filtered) ----------

  const SERIES_VARS = ["--series-1", "--series-2", "--series-3"];

  function colorFor(index) {
    return getComputedStyle(document.documentElement)
      .getPropertyValue(SERIES_VARS[index % SERIES_VARS.length])
      .trim();
  }

  const WAYANG_LABELS = {
    film: "Film",
    puppetry: "Puppetry",
    stage_performance: "Stage performance",
  };
  const GENRE_LABELS = {
    live_event: "Live event",
    media_content: "Media content",
    op_ed: "Op-ed",
  };

  function matchesFilter(r, dim) {
    const val = state.filters[dim];
    if (!val) return true;
    if (dim === "event_city") return r.city.status === "ok" && r.city.canonical === val;
    return r[dim] === val;
  }

  // Order-dependent crossfilter: a facet's own chart reflects only the
  // filters that were locked in BEFORE it (see state.filterOrder), never
  // ones locked in after — even though that other filter is active.
  function rowPasses(r, forDim) {
    const order = state.filterOrder;
    const cutoff = order.includes(forDim) ? order.indexOf(forDim) : order.length;
    for (const dim of ["wayang_type", "article_genre", "event_city"]) {
      if (dim === forDim) continue;
      if (!state.filters[dim]) continue;
      const dimIndex = order.indexOf(dim);
      if (dimIndex < cutoff && !matchesFilter(r, dim)) return false;
    }
    return true;
  }

  // The terminal views (map bubble sizes, and any article-list drill-down)
  // always reflect every active filter, regardless of click order.
  function rowPassesAll(r) {
    return matchesFilter(r, "wayang_type") && matchesFilter(r, "article_genre") && matchesFilter(r, "event_city");
  }

  function anyFilterActive() {
    const f = state.filters;
    return !!(f.wayang_type || f.article_genre || f.event_city);
  }

  // Toggle one facet's filter on/off, maintaining the lock order: newly
  // activated facets are appended to the end of the sequence; changing the
  // selected value within an already-active facet keeps its position;
  // clearing a facet removes it from the sequence entirely.
  function setFilter(dim, key) {
    const wasActive = state.filters[dim] !== null;
    if (state.filters[dim] === key) {
      state.filters[dim] = null;
      state.filterOrder = state.filterOrder.filter((d) => d !== dim);
    } else {
      state.filters[dim] = key;
      if (!wasActive) state.filterOrder.push(dim);
    }
    renderDistTab();
  }

  function clearFilters() {
    state.filters = { wayang_type: null, article_genre: null, event_city: null };
    state.filterOrder = [];
    renderDistTab();
  }

  function renderCategoryChart(container, field, excluded, labelMap, exclude) {
    const filtered = state.rows.filter((r) => !excluded.has(r[field]) && rowPasses(r, exclude));
    const counts = d3.rollups(filtered, (v) => v.length, (d) => d[field])
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => (labelMap[a.key] || a.key).localeCompare(labelMap[b.key] || b.key));

    d3.select(container).selectAll("*").remove();
    const chartDiv = document.createElement("div");
    container.appendChild(chartDiv);

    renderBarChart(chartDiv, counts, {
      height: 260,
      formatKey: (k) => labelMap[k] || k,
      selectedKey: state.filters[field],
      colorForIndex: colorFor,
      onClick: (key) => setFilter(field, key),
    });

    const legend = document.createElement("div");
    legend.className = "legend-row legend-list";
    counts.forEach((d, i) => {
      const item = document.createElement("span");
      item.innerHTML = `<span class="legend-swatch" style="background:${colorFor(i)}"></span>${labelMap[d.key] || d.key} (${d.value})`;
      legend.appendChild(item);
    });
    container.appendChild(legend);
  }

  function renderFilterBar() {
    const bar = document.getElementById("filterBar");
    const active = anyFilterActive();
    bar.hidden = !active;
    if (!active) return;

    const f = state.filters;
    const dimLabel = {
      wayang_type: `Type: ${WAYANG_LABELS[f.wayang_type] || f.wayang_type}`,
      article_genre: `Genre: ${GENRE_LABELS[f.article_genre] || f.article_genre}`,
      event_city: `City: ${f.event_city}`,
    };
    // Shown in click order (1st → 2nd → ...), since that order determines
    // which facets filter which — see rowPasses().
    const parts = state.filterOrder.map((dim, i) => `${i + 1}. ${dimLabel[dim]}`);

    const matching = state.rows.filter((r) => rowPassesAll(r)).length;
    document.getElementById("filterSummary").textContent =
      `Filtered by ${parts.join(" → ")} — ${matching.toLocaleString()} matching mention${matching === 1 ? "" : "s"}`;
  }

  document.getElementById("clearFiltersBtn").addEventListener("click", clearFilters);

  function renderDistTab() {
    renderFilterBar();

    renderCategoryChart(document.getElementById("typeChart"), "wayang_type", EXCLUDED_WAYANG_TYPE, WAYANG_LABELS, "wayang_type");
    renderCategoryChart(document.getElementById("genreChart"), "article_genre", EXCLUDED_ARTICLE_GENRE, GENRE_LABELS, "article_genre");
    renderCityMap();

    if (state.filters.event_city) renderCityDetail(state.filters.event_city);
    else document.getElementById("cityDetail").hidden = true;
  }

  // ---------- City map ----------

  function renderCityMap() {
    const cityAgg = new Map(); // canonical -> {lat, lon, count}
    let unmapped = 0;
    let outOfAsia = 0;

    // The map is a terminal view: its bubbles always reflect the type/genre
    // filters unconditionally, regardless of click order (only the city's
    // own filter is excluded here, so every city still gets a bubble).
    state.rows.forEach((r) => {
      if (!matchesFilter(r, "wayang_type") || !matchesFilter(r, "article_genre")) return;
      if (r.city.status === "blank") return;
      if (r.city.status === "unmapped") { unmapped++; return; }
      if (r.city.status === "out_of_asia") { outOfAsia++; return; }
      const key = r.city.canonical;
      if (!cityAgg.has(key)) cityAgg.set(key, { lat: r.city.lat, lon: r.city.lon, count: 0 });
      cityAgg.get(key).count++;
    });

    const noteParts = [];
    if (unmapped > 0) noteParts.push(`${unmapped} mention${unmapped === 1 ? "" : "s"} with an unrecognized place name not shown`);
    if (outOfAsia > 0) noteParts.push(`${outOfAsia} mention${outOfAsia === 1 ? "" : "s"} geocoded outside Asia, treated as errors and excluded`);
    document.getElementById("cityNote").textContent = noteParts.join(" · ");

    if (!state.map) {
      state.map = L.map("cityMap", { scrollWheelZoom: false });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 18,
      }).addTo(state.map);
      state.mapLayer = L.layerGroup().addTo(state.map);
    }

    state.mapLayer.clearLayers();

    const entries = Array.from(cityAgg.entries());
    if (entries.length === 0) {
      state.map.setView([5, 105], 4);
      return;
    }

    const maxCount = d3.max(entries, ([, v]) => v.count) || 1;
    const radiusScale = d3.scaleSqrt().domain([0, maxCount]).range([4, 28]);
    const seriesColor = colorFor(0);
    const highlightColor = getComputedStyle(document.documentElement).getPropertyValue("--text-primary").trim();
    const selectedCity = state.filters.event_city;

    const bounds = [];
    entries.forEach(([name, v]) => {
      const isSelected = selectedCity === name;
      const dimmed = selectedCity && !isSelected;
      const marker = L.circleMarker([v.lat, v.lon], {
        radius: radiusScale(v.count),
        color: isSelected ? highlightColor : seriesColor,
        weight: isSelected ? 2.5 : 1,
        fillColor: seriesColor,
        fillOpacity: dimmed ? 0.2 : 0.55,
        opacity: dimmed ? 0.35 : 1,
      }).bindTooltip(`<b>${name}</b><br>${v.count} mention${v.count === 1 ? "" : "s"}`);
      marker.on("click", () => setFilter("event_city", name));
      marker.addTo(state.mapLayer);
      bounds.push([v.lat, v.lon]);
    });

    state.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 8 });
  }

  function renderCityDetail(cityName) {
    const rows = state.rows
      .filter((r) => rowPassesAll(r))
      .sort((a, b) => a.dateStr.localeCompare(b.dateStr) || a.page - b.page);

    const panel = document.getElementById("cityDetail");
    const title = document.getElementById("cityDetailTitle");
    const list = document.getElementById("cityDetailList");

    title.textContent = `${cityName} — ${rows.length} mention${rows.length === 1 ? "" : "s"}`;
    renderSnippetList(list, rows);
    panel.hidden = false;
  }

  document.getElementById("closeCityDetail").addEventListener("click", () => {
    setFilter("event_city", state.filters.event_city);
  });

  // ---------- Tabs ----------

  function activateTab(tabName) {
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      const active = btn.dataset.tab === tabName;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    document.getElementById("tab-time").hidden = tabName !== "time";
    document.getElementById("tab-dist").hidden = tabName !== "dist";

    if (tabName === "dist") {
      renderDistTab();
      requestAnimationFrame(() => {
        if (state.map) state.map.invalidateSize();
      });
    } else {
      renderTimeTab();
    }
  }

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => activateTab(btn.dataset.tab));
  });

  // ---------- Dataset switching ----------

  async function selectDataset(entry) {
    state.selectedMonth = null;
    state.filters = { wayang_type: null, article_genre: null, event_city: null };
    state.filterOrder = [];
    document.getElementById("dayDetail").hidden = true;
    document.getElementById("cityDetail").hidden = true;
    state.rows = await loadDataset(entry.file, state.cityCoords);
    document.getElementById("pageTitle").textContent = `${entry.label} in Jawi Print`;
    const activeTab = document.querySelector(".tab-btn.active").dataset.tab;
    activateTab(activeTab);
  }

  async function init() {
    const [datasets, cityCoords] = await Promise.all([loadDatasetList(), loadCityCoords()]);
    state.cityCoords = cityCoords;

    const select = document.getElementById("datasetSelect");
    datasets.forEach((d) => {
      const opt = document.createElement("option");
      opt.value = d.id;
      opt.textContent = d.label;
      select.appendChild(opt);
    });
    select.addEventListener("change", () => {
      const entry = datasets.find((d) => d.id === select.value);
      selectDataset(entry);
    });

    if (datasets.length) await selectDataset(datasets[0]);

    window.addEventListener("resize", () => {
      const activeTab = document.querySelector(".tab-btn.active").dataset.tab;
      activateTab(activeTab);
    });
  }

  init().catch((err) => {
    console.error("wayangjawiviz failed to initialize:", err);
    const main = document.querySelector("main");
    if (main) {
      const div = document.createElement("div");
      div.className = "panel-card";
      div.style.color = "#c0392b";
      div.textContent = "Failed to load: " + err.message + " (see browser console for details)";
      main.prepend(div);
    }
  });
})();
