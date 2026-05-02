import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  byId,
  classifyDistance,
  getCompletion,
  getPlanDaySummaries,
  getRouteCompletion,
  resolveAssetUrl,
  segmentId
} from "../src/domain.js";

function readDataJson(file) {
  return JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), "utf8"));
}

function loadAppData() {
  const manifest = readDataJson("app-data.json");
  return Object.fromEntries(
    Object.entries(manifest.files).map(([key, file]) => [key, readDataJson(file)])
  );
}

const data = loadAppData();
const route = JSON.parse(readFileSync(new URL("../data/route.json", import.meta.url), "utf8"));

test("app data is split into editable JSON files behind a small manifest", () => {
  const manifest = readDataJson("app-data.json");
  assert.deepEqual(Object.keys(manifest.files), [
    "meta",
    "members",
    "checkpoints",
    "segments",
    "accessOptions",
    "plans",
    "rides"
  ]);
  assert.ok(Array.isArray(data.checkpoints));
  assert.ok(Array.isArray(data.segments));
  assert.ok(Array.isArray(data.plans));
  assert.ok(Array.isArray(data.rides));
});

test("official KML route is ordered from Choshi toward Wakayama with normalized routeKm", () => {
  assert.equal(route.meta.direction, "choshi-to-wakayama");
  assert.equal(route.meta.officialDistanceKm, 1487);
  assert.ok(route.points.length > 100);
  assert.ok(route.points[0].lng > 140.7, "first point should be near Choshi");
  assert.ok(route.points.at(-1).lng < 135.3, "last point should be near Wakayama");

  for (let index = 1; index < route.points.length; index += 1) {
    assert.ok(
      route.points[index].routeKm >= route.points[index - 1].routeKm,
      `routeKm must be monotonic at index ${index}`
    );
  }
  assert.equal(route.points.at(-1).routeKm, 1487);
});

test("first day-trip plan warns for the 80km Choshi to Kazusa-Ichinomiya segment", () => {
  const plan = data.plans.find((item) => item.id === "first-ride");
  const [day] = getPlanDaySummaries(data, plan);
  assert.equal(day.distanceKm, 80);
  assert.equal(day.classification.level, "warning");
});

test("members are exposed by home-base labels, not personal names", () => {
  assert.deepEqual(
    data.members.map((member) => member.displayName),
    ["小田原", "駒込", "戸田公園"]
  );
});

test("completion separates contiguous progress from ahead-of-frontier rides", () => {
  const fixture = structuredClone(data);
  fixture.rides = [
    {
      date: "2026-06-01",
      participants: ["odawara", "komagome", "todakoen"],
      segmentIds: [segmentId("choshi", "kazusa-ichinomiya")],
      completionStatus: "complete",
      actualDistanceKm: 80,
      notes: "",
      evidenceUrl: ""
    },
    {
      date: "2026-07-01",
      participants: ["odawara", "komagome"],
      segmentIds: [segmentId("katsuura", "kamogawa")],
      completionStatus: "complete",
      actualDistanceKm: 33,
      notes: "",
      evidenceUrl: ""
    }
  ];

  const completion = getRouteCompletion(fixture);
  assert.equal(completion.frontierCheckpointId, "kazusa-ichinomiya");
  assert.equal(completion.frontierKm, 80);
  assert.deepEqual(completion.aheadSegments, ["katsuura-kamogawa"]);
});

test("completion follows explicit day segment ids when plan endpoints omit intermediate checkpoints", () => {
  const completion = getCompletion(data, "second-ride");
  assert.deepEqual(completion.orderedSegmentIds, [
    "kazusa-ichinomiya-ohara",
    "ohara-onjuku",
    "onjuku-katsuura",
    "katsuura-kamogawa",
    "kamogawa-chikura",
    "chikura-tateyama",
    "tateyama-tomiura",
    "tomiura-kanaya-port"
  ]);
  assert.equal(completion.frontierCheckpointId, "kazusa-ichinomiya");
});

test("overnight plan days can carry lodging candidates without private reservation data", () => {
  const plan = data.plans.find((item) => item.id === "second-ride");
  const [firstOvernight] = getPlanDaySummaries(data, plan);
  assert.equal(firstOvernight.lodgingBase, "鴨川");
  assert.ok(firstOvernight.lodgingCandidates.includes("安房鴨川駅周辺"));
  assert.match(firstOvernight.lodgingNotes, /詳細情報.*入れない/);
  assert.equal(firstOvernight.distanceKm, 78);
  assert.equal(firstOvernight.estimatedRideHours, 5.7);
});

test("future plans replace the baseline and keep Numazu/Fuji plus known skipped starts", () => {
  assert.equal(data.plans.some((item) => item.name.includes("ベースライン")), false);

  const plans = byId(data.plans);
  assert.deepEqual(plans["third-ride"].checkpointIds, ["miura-coast", "odawara"]);
  assert.deepEqual(plans["fourth-ride"].checkpointIds, ["manazuru", "ito"]);
  assert.deepEqual(plans["eighth-ride"].days[0].segmentIds, ["numazu-fuji", "fuji-shimizu-port"]);

  const segments = byId(data.segments);
  for (const id of ["kurihama-port-miura-coast", "odawara-manazuru"]) {
    assert.ok(segments[id], `${id} should exist for already-ridden skip records`);
  }
  assert.deepEqual(
    data.rides.flatMap((ride) => ride.segmentIds),
    ["kurihama-port-miura-coast", "odawara-manazuru"]
  );
});

test("distance classification uses the agreed planning thresholds", () => {
  assert.equal(classifyDistance(55).level, "good");
  assert.equal(classifyDistance(80).level, "warning");
  assert.equal(classifyDistance(110).level, "danger");
});

test("asset URLs resolve under a GitHub Pages project subpath", () => {
  const url = resolveAssetUrl(
    "data/app-data.json",
    "https://example.github.io/pacific-stagebook/index.html"
  );
  assert.equal(url, "https://example.github.io/pacific-stagebook/data/app-data.json");
});

test("asset URLs can carry a cache-busting page query for JSON edits", () => {
  const url = new URL(
    resolveAssetUrl("data/app-data.json", "https://example.github.io/pacific-stagebook/index.html?v=abc")
  );
  url.search = "?v=abc";
  assert.equal(url.toString(), "https://example.github.io/pacific-stagebook/data/app-data.json?v=abc");
});
