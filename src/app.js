import {
  byId,
  formatMinutes,
  getAccessOption,
  getPlanDaySummaries,
  getPlanSegments,
  getRouteCompletion,
  resolveAssetUrl,
  segmentId
} from "./domain.js";

const state = {
  data: null,
  route: null,
  planId: null,
  map: null,
  mapLayer: null
};

const $ = (selector) => document.querySelector(selector);

const TRIP_MODE_LABELS = {
  dayTrip: "日帰り",
  overnight: "宿泊"
};

const STATUS_LABELS = {
  planned: "予定",
  draft: "下書き",
  done: "完了"
};

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fmtKm(value) {
  return `${Number(value).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}km`;
}

function fmtHours(value) {
  return Number.isFinite(value)
    ? `${Number(value).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}h`
    : "未入力";
}

function checkpointName(id) {
  return byId(state.data.checkpoints)[id]?.name ?? id;
}

function planCheckpointIds(plan) {
  const segments = getPlanSegments(state.data, plan);
  if (segments.length === 0) return plan.checkpointIds;
  return segments.reduce((ids, segment, index) => {
    if (index === 0) ids.push(segment.fromCheckpointId);
    if (ids.at(-1) !== segment.toCheckpointId) ids.push(segment.toCheckpointId);
    return ids;
  }, []);
}

async function loadJson(path) {
  const url = new URL(resolveAssetUrl(path, document.baseURI));
  if (window.location.search) url.search = window.location.search;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load ${path}: ${response.status}`);
  return response.json();
}

async function loadAppData() {
  const manifest = await loadJson("data/app-data.json");
  if (!manifest.files) return manifest;

  const entries = await Promise.all(
    Object.entries(manifest.files).map(async ([key, file]) => [key, await loadJson(`data/${file}`)])
  );
  return Object.fromEntries(entries);
}

function currentPlan() {
  return state.data.plans.find((plan) => plan.id === state.planId) ?? state.data.plans[0];
}

function renderPlanSelect() {
  const select = $("#planSelect");
  select.innerHTML = state.data.plans
    .map((plan) => `<option value="${esc(plan.id)}">${esc(plan.name)}</option>`)
    .join("");
  select.value = currentPlan().id;
  select.addEventListener("change", () => {
    state.planId = select.value;
    render();
  });
}

function renderActualSummary() {
  const completion = getRouteCompletion(state.data);
  const totalKm = state.data.meta.officialDistanceKm;
  const percent = totalKm > 0 ? (completion.frontierKm / totalKm) * 100 : 0;
  const percentText = `${Number(percent.toFixed(1)).toLocaleString("ja-JP")}%`;
  const aheadCount = completion.aheadSegments.length;
  const partialCount = completion.partialSegmentIds.length;
  const notes = [`連続走破地点: ${checkpointName(completion.frontierCheckpointId)}`];
  if (aheadCount > 0) notes.push(`先行走破 ${aheadCount}区間`);
  if (partialCount > 0) notes.push(`部分走破 ${partialCount}区間`);

  $("#actualStats").innerHTML = `
    <div class="stat-card">
      <div class="stat-label">走破距離</div>
      <div class="stat-value">${fmtKm(completion.frontierKm)} / ${fmtKm(totalKm)} (${percentText})</div>
      <div class="stat-sub">${esc(notes.join(" / "))}</div>
    </div>
  `;
}

function renderPlanSummary() {
  const plan = currentPlan();
  const segments = getPlanSegments(state.data, plan);
  const checkpointIds = planCheckpointIds(plan);
  const planDistance = segments.reduce((sum, segment) => sum + segment.distanceKm, 0);
  const statusLabel = STATUS_LABELS[plan.status] ?? plan.status;
  const tripModeLabel = TRIP_MODE_LABELS[plan.tripMode] ?? plan.tripMode;
  const start = checkpointIds[0];
  const end = checkpointIds.at(-1);

  $("#planStats").innerHTML = [
    ["計画走行距離", fmtKm(planDistance), `${segments.length}区間合計`],
    ["計画区間", `${checkpointName(start)} -> ${checkpointName(end)}`, `${statusLabel} / ${tripModeLabel}`]
  ]
    .map(
      ([label, value, sub]) => `
        <div class="stat-card">
          <div class="stat-label">${esc(label)}</div>
          <div class="stat-value">${esc(value)}</div>
          <div class="stat-sub">${esc(sub)}</div>
        </div>
      `
    )
    .join("");
}

function renderProgress() {
  const completion = getRouteCompletion(state.data);
  const checkpoints = byId(state.data.checkpoints);
  const segmentsById = byId(state.data.segments);
  const segments = completion.orderedSegmentIds.map((id) => segmentsById[id]).filter(Boolean);
  const total = Math.max(
    1,
    checkpoints[completion.routeCheckpointIds.at(-1)].routeKm -
      checkpoints[completion.routeCheckpointIds[0]].routeKm
  );

  $("#progressSummary").textContent =
    completion.aheadSegments.length > 0
      ? `${fmtKm(completion.frontierKm)} / ${fmtKm(state.data.meta.officialDistanceKm)}。先行走破済み ${completion.aheadSegments.length}区間。`
      : `${fmtKm(completion.frontierKm)} / ${fmtKm(state.data.meta.officialDistanceKm)}。`;

  $("#progressBar").innerHTML = segments
    .map((segment) => {
      const from = checkpoints[segment.fromCheckpointId];
      const to = checkpoints[segment.toCheckpointId];
      const width = Math.max(1, ((to.routeKm - from.routeKm) / total) * 100);
      const id = segment.id;
      const status = completion.completedSegmentIds.includes(id)
        ? completion.aheadSegments.includes(id)
          ? "ahead"
          : "complete"
        : completion.partialSegmentIds.includes(id)
          ? "partial"
          : "";
      return `<span class="progress-piece ${status}" style="width:${width}%" title="${esc(from.name)} -> ${esc(to.name)}"></span>`;
    })
    .join("");
}

function accessTimeLabel(option) {
  if (!option) return "未入力";
  const range =
    option.departAt && option.arriveAt ? `${option.departAt} -> ${option.arriveAt}` : "時刻未入力";
  return Number.isFinite(option.durationMin) ? `${range} (${formatMinutes(option.durationMin)})` : range;
}

function shortAccessSummary(checkpointId, member) {
  const morning = getAccessOption(state.data, checkpointId, member.id, "morning");
  const evening = getAccessOption(state.data, checkpointId, member.id, "eveningReturn");
  const morningText = morning ? accessTimeLabel(morning) : "--";
  const eveningText = evening ? accessTimeLabel(evening) : "--";
  return `${member.displayName}: 往 ${morningText} / 復 ${eveningText}`;
}

function accessSummaryItem(checkpointId, member, direction) {
  const option = getAccessOption(state.data, checkpointId, member.id, direction);
  if (!option) {
    return `
      <li>
        <strong>${esc(member.displayName)}</strong>
        <span>未入力</span>
      </li>
    `;
  }
  return `
    <li>
      <strong>${esc(member.displayName)}</strong>
      <span>${esc(accessTimeLabel(option))}</span>
      <span class="muted">${esc(option.routeSummary ?? option.summary ?? "")}</span>
      <span class="muted">乗換${esc(option.transfers ?? "--")}</span>
    </li>
  `;
}

function routeDistanceScore(a, b) {
  const midLat = (((a.lat + b.lat) / 2) * Math.PI) / 180;
  const lat = a.lat - b.lat;
  const lng = (a.lng - b.lng) * Math.cos(midLat);
  return lat * lat + lng * lng;
}

function nearestRouteIndex(location) {
  let bestIndex = 0;
  let bestScore = Infinity;
  state.route.points.forEach((point, index) => {
    const score = routeDistanceScore(location, point);
    if (score < bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function segmentRoutePoints(segment) {
  const checkpoints = byId(state.data.checkpoints);
  const from = checkpoints[segment.fromCheckpointId];
  const to = checkpoints[segment.toCheckpointId];
  const fromIndex = nearestRouteIndex(from);
  const toIndex = nearestRouteIndex(to);
  const start = Math.min(fromIndex, toIndex);
  const end = Math.max(fromIndex, toIndex);
  const points = state.route.points.slice(start, end + 1).map((point) => [point.lat, point.lng]);
  if (fromIndex > toIndex) points.reverse();
  return [[from.lat, from.lng], ...points, [to.lat, to.lng]];
}

function checkpointPopupHtml(checkpoint) {
  const access = state.data.members.map((member) => shortAccessSummary(checkpoint.id, member));
  return `
    <strong>${esc(checkpoint.name)}</strong>
    <div>${fmtKm(checkpoint.routeKm)} / ${esc(checkpoint.nearestTransit.name)}</div>
    <div class="muted">${esc(checkpoint.notes)}</div>
    <hr>
    ${access.map((line) => `<div>${esc(line)}</div>`).join("")}
  `;
}

function segmentPopupHtml(segment) {
  return `
    <strong>${esc(checkpointName(segment.fromCheckpointId))} -> ${esc(checkpointName(segment.toCheckpointId))}</strong>
    <div>${fmtKm(segment.distanceKm)}</div>
    <div class="muted">${esc(segment.lodgingNotes)}</div>
  `;
}

function renderMap() {
  const L = window.L;
  const mapEl = $("#routeMap");
  if (!L) {
    mapEl.innerHTML = `
      <div class="map-fallback">
        地図ライブラリを読み込めませんでした。
        <a href="${esc(state.data.meta.sourceUrls.routeMap)}" target="_blank" rel="noreferrer">公式地図を開く</a>
      </div>
    `;
    $("#routeMeta").textContent = `公式KML ${state.route.sources.length}件`;
    return;
  }

  const plan = currentPlan();
  const completion = getRouteCompletion(state.data);
  const checkpoints = byId(state.data.checkpoints);
  const selectedCheckpointIds = planCheckpointIds(plan);
  const planCheckpointIdSet = new Set(selectedCheckpointIds);
  const completedIds = new Set(completion.completedSegmentIds);
  const partialIds = new Set(completion.partialSegmentIds);

  if (!state.map) {
    state.map = L.map(mapEl, {
      preferCanvas: true,
      scrollWheelZoom: false
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(state.map);
  }

  if (state.mapLayer) state.mapLayer.remove();
  state.mapLayer = L.layerGroup().addTo(state.map);

  L.polyline(
    state.route.points.map((point) => [point.lat, point.lng]),
    { color: "#4d6571", weight: 3, opacity: 0.75, dashArray: "7 7" }
  ).addTo(state.mapLayer);

  const planBounds = [];
  getPlanSegments(state.data, plan).forEach((segment) => {
    const color = partialIds.has(segment.id) ? "#b66a00" : "#005fcc";
    const dashArray = partialIds.has(segment.id) ? "8 5" : undefined;
    const latLngs = segmentRoutePoints(segment);
    planBounds.push(...latLngs);
    L.polyline(latLngs, { color: "#ffffff", weight: 9, opacity: 0.9 }).addTo(state.mapLayer);
    L.polyline(latLngs, { color, weight: 5, opacity: 0.95, dashArray, lineCap: "round" })
      .bindPopup(segmentPopupHtml(segment))
      .addTo(state.mapLayer);
  });

  state.data.segments
    .filter((segment) => completedIds.has(segment.id))
    .forEach((segment) => {
      const latLngs = segmentRoutePoints(segment);
      L.polyline(latLngs, { color: "#ffffff", weight: 12, opacity: 0.95 }).addTo(state.mapLayer);
      L.polyline(latLngs, {
        color: "#c2185b",
        weight: 6,
        opacity: 1,
        dashArray: "12 7",
        lineCap: "butt",
        lineJoin: "round"
      })
        .bindPopup(`${segmentPopupHtml(segment)}<div><strong>走破済み</strong></div>`)
        .addTo(state.mapLayer);
    });

  state.data.checkpoints.forEach((checkpoint) => {
    const planIndex = selectedCheckpointIds.indexOf(checkpoint.id);
    const markerState =
      checkpoint.id === completion.frontierCheckpointId
        ? "frontier"
        : planCheckpointIdSet.has(checkpoint.id)
          ? "planned"
          : "";
    const html = `<span class="stage-marker ${markerState}">${planIndex >= 0 ? planIndex + 1 : ""}</span>`;
    L.marker([checkpoint.lat, checkpoint.lng], {
      title: checkpoint.name,
      icon: L.divIcon({
        className: "",
        html,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        popupAnchor: [0, -12]
      })
    })
      .bindPopup(checkpointPopupHtml(checkpoint))
      .addTo(state.mapLayer);
  });

  const bounds = planBounds.length
    ? L.latLngBounds(planBounds)
    : L.latLngBounds(state.route.points.map((point) => [point.lat, point.lng]));
  setTimeout(() => {
    state.map.invalidateSize();
    state.map.fitBounds(bounds.pad(0.12), { maxZoom: 11 });
  }, 0);
  $("#routeMeta").textContent = `OpenStreetMap + 公式KML ${state.route.sources.length}件`;
}

function renderPlanHeader() {
  const plan = currentPlan();
  const statusLabel = STATUS_LABELS[plan.status] ?? plan.status;
  const tripModeLabel = TRIP_MODE_LABELS[plan.tripMode] ?? plan.tripMode;
  $("#planTitle").textContent = plan.name;
  $("#planNote").textContent = `${statusLabel}、${tripModeLabel}。${plan.notes}`;
}

function renderPlanLogistics() {
  const plan = currentPlan();
  const checkpointIds = planCheckpointIds(plan);
  const startId = checkpointIds[0];
  const endId = checkpointIds.at(-1);
  const startName = checkpointName(startId);
  const endName = checkpointName(endId);
  const lodgingDays = getPlanDaySummaries(state.data, plan).filter(
    (day) => day.lodgingBase || day.lodgingCandidates?.length
  );
  const lodgingHtml =
    plan.tripMode === "overnight"
      ? lodgingDays.length > 0
        ? lodgingDays
            .map((day) => {
              const candidates = day.lodgingCandidates?.length
                ? ` / ${day.lodgingCandidates.join(" / ")}`
                : "";
              return `
                <li>
                  <strong>${esc(day.label)}</strong>
                  <span>${esc(day.lodgingBase ?? "宿泊地未入力")}${esc(candidates)}</span>
                </li>
              `;
            })
            .join("")
        : "<li><span>宿泊候補未入力</span></li>"
      : "<li><span>日帰り計画のため宿泊なし</span></li>";

  $("#planLogistics").innerHTML = `
    <div class="logistics-card">
      <div class="logistics-title">往路 <span>${esc(startName)}</span></div>
      <ul>${state.data.members.map((member) => accessSummaryItem(startId, member, "morning")).join("")}</ul>
    </div>
    <div class="logistics-card">
      <div class="logistics-title">復路 <span>${esc(endName)}</span></div>
      <ul>${state.data.members.map((member) => accessSummaryItem(endId, member, "eveningReturn")).join("")}</ul>
    </div>
    <div class="logistics-card">
      <div class="logistics-title">宿泊地</div>
      <ul>${lodgingHtml}</ul>
    </div>
  `;
}

function renderSegments() {
  const plan = currentPlan();
  $("#segmentBody").innerHTML = getPlanDaySummaries(state.data, plan)
    .map((day) => {
      const rowCount = Math.max(day.segments.length, 1);
      const dayCell = `
        <td class="day-cell" rowspan="${rowCount}">
          <strong>${esc(day.label)}</strong>
          <span class="badge ${day.classification.level}">${esc(day.classification.label)}</span>
          <div class="day-total">${fmtKm(day.distanceKm)} / ${fmtHours(day.estimatedRideHours)}</div>
          <div class="muted">${esc(day.classification.message)}</div>
          ${
            day.lodgingBase
              ? `<div class="day-lodging">宿泊候補: ${esc(day.lodgingBase)}</div>`
              : ""
          }
        </td>
      `;

      if (day.segments.length === 0) {
        return `
          <tr class="day-start">
            ${dayCell}
            <td colspan="4"><span class="muted">区間未設定</span></td>
          </tr>
        `;
      }

      return day.segments
        .map(
          (segment, index) => `
            <tr class="${index === 0 ? "day-start" : ""}">
              ${index === 0 ? dayCell : ""}
              <td><strong>${esc(checkpointName(segment.fromCheckpointId))} -> ${esc(checkpointName(segment.toCheckpointId))}</strong></td>
              <td class="nowrap">${fmtKm(segment.distanceKm)}</td>
              <td>${esc(segment.lodgingNotes)}<br><span class="muted">${esc((segment.lunchSpots ?? []).slice(0, 2).join(" / "))}</span></td>
              <td>${esc((segment.bailoutPoints ?? []).slice(0, 3).join(" / "))}</td>
            </tr>
          `
        )
        .join("");
    })
    .join("");
}

function renderCheckpoints() {
  const planIds = new Set(planCheckpointIds(currentPlan()));
  const segmentsById = byId(state.data.segments);
  const checkpoints = [...state.data.checkpoints].sort((a, b) => a.routeKm - b.routeKm);
  $("#checkpointBody").innerHTML = checkpoints
    .map(
      (checkpoint, index) => {
        const previous = checkpoints[index - 1];
        const segmentDelta = previous ? segmentsById[segmentId(previous.id, checkpoint.id)]?.distanceKm : null;
        const deltaKm = previous ? fmtKm(segmentDelta ?? checkpoint.routeKm - previous.routeKm) : "起点";
        const accessLines = state.data.members
          .map((member) => `<div>${esc(shortAccessSummary(checkpoint.id, member))}</div>`)
          .join("");
        return `
          <tr>
            <td class="nowrap">${fmtKm(checkpoint.routeKm)}</td>
            <td class="nowrap">${esc(deltaKm)}</td>
            <td><strong>${esc(checkpoint.name)}</strong>${planIds.has(checkpoint.id) ? ` <span class="badge good plan-pass-badge">この計画で通過</span>` : ""}<br><span class="muted">${esc(checkpoint.notes)}</span></td>
            <td>${esc(checkpoint.nearestTransit.name)}<br><span class="muted">${esc(checkpoint.nearestTransit.type)}</span></td>
            <td class="checkpoint-access">${accessLines}</td>
          </tr>
        `;
      }
    )
    .join("");
}

function renderBuilder() {
  const plan = currentPlan();
  const checkpoints = byId(state.data.checkpoints);
  const checkpointIds = planCheckpointIds(plan);
  $("#builderList").innerHTML = checkpointIds
    .map((checkpointId, index) => {
      const checkpoint = checkpoints[checkpointId];
      const previous = checkpoints[checkpointIds[index - 1]];
      const delta = previous ? checkpoint.routeKm - previous.routeKm : 0;
      return `
        <div class="plan-step">
          <span class="step-index">${index + 1}</span>
          <div class="step-body">
            <strong>${esc(checkpoint.name)}</strong>
            <div class="muted">${esc(checkpoint.nearestTransit.name)} / ${esc(checkpoint.nodeType)}</div>
          </div>
          <span class="step-km">${fmtKm(checkpoint.routeKm)}${index > 0 ? ` / +${fmtKm(delta)}` : ""}</span>
        </div>
      `;
    })
    .join("");
}

function render() {
  renderActualSummary();
  renderPlanSummary();
  renderPlanLogistics();
  renderProgress();
  renderMap();
  renderPlanHeader();
  renderSegments();
  renderCheckpoints();
  renderBuilder();
  $("#lastUpdated").textContent = state.data.meta.lastUpdated;
}

async function init() {
  const [data, route] = await Promise.all([loadAppData(), loadJson("data/route.json")]);
  state.data = data;
  state.route = route;
  state.planId = data.plans[0].id;
  renderPlanSelect();
  render();
}

init().catch((error) => {
  document.body.innerHTML = `<main class="container data-panel" style="margin-top:24px"><h1>Load error</h1><pre>${esc(error.stack ?? error.message)}</pre></main>`;
});
