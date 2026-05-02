import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const sources = [
  ["chiba", "Route_chiba.kml", "https://www.kkr.mlit.go.jp/road/pcr/map/ccr9dq0000000e7c-att/Route_chiba.kml"],
  ["kanagawa", "Route_kanagawa.kml", "https://www.kkr.mlit.go.jp/road/pcr/map/ccr9dq0000000e7c-att/Route_kanagawa.kml"],
  ["shizuoka", "Route_shizuoka.kml", "https://www.kkr.mlit.go.jp/road/pcr/map/ccr9dq0000000e7c-att/Route_shizuoka_.kml"],
  ["aichi", "Route_aichi.kml", "https://www.kkr.mlit.go.jp/road/pcr/map/ccr9dq0000000e7c-att/Route_aichi.kml"],
  ["mie", "Route_mie.kml", "https://www.kkr.mlit.go.jp/road/pcr/map/ccr9dq0000000e7c-att/Route_mie.kml"],
  ["wakayama", "Route_wakayama.kml", "https://www.kkr.mlit.go.jp/road/pcr/map/ccr9dq0000000e7c-att/Route_wakayama.kml"]
];

const officialDistanceKm = 1487;
const sourceDir = path.join(root, "data", "sources", "kml");
const outputPath = path.join(root, "data", "route.json");

function haversineKm(a, b) {
  const radiusKm = 6371.0088;
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * radiusKm * Math.asin(Math.sqrt(h));
}

function parseCoordinates(kml) {
  const blocks = [...kml.matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/g)];
  return blocks
    .map((block) =>
      block[1]
        .trim()
        .split(/\s+/)
        .map((raw) => {
          const [lng, lat] = raw.split(",").map(Number);
          return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
        })
        .filter(Boolean)
    )
    .filter((line) => line.length > 1);
}

function appendOrientedLine(points, line) {
  if (points.length === 0) {
    points.push(...line);
    return;
  }

  const previous = points[points.length - 1];
  const firstDistance = haversineKm(previous, line[0]);
  const lastDistance = haversineKm(previous, line[line.length - 1]);
  const oriented = lastDistance < firstDistance ? [...line].reverse() : line;
  const startIndex = haversineKm(previous, oriented[0]) < 0.02 ? 1 : 0;
  points.push(...oriented.slice(startIndex));
}

function withCumulativeDistance(points) {
  let cumulativeKm = 0;
  return points.map((point, index) => {
    if (index > 0) cumulativeKm += haversineKm(points[index - 1], point);
    return { ...point, rawKm: cumulativeKm };
  });
}

function simplify(points, minGapKm = 3) {
  const simplified = [];
  let lastKeptKm = -Infinity;
  for (const point of points) {
    const isEndpoint = point === points[0] || point === points[points.length - 1];
    if (isEndpoint || point.rawKm - lastKeptKm >= minGapKm) {
      simplified.push(point);
      lastKeptKm = point.rawKm;
    }
  }
  return simplified;
}

const merged = [];
const importedSources = [];

for (const [area, filename, sourceUrl] of sources) {
  const filePath = path.join(sourceDir, filename);
  const kml = readFileSync(filePath, "utf8");
  if (!kml.includes("<kml")) {
    throw new Error(`${filename} does not look like a KML file`);
  }

  const before = merged.length;
  for (const line of parseCoordinates(kml)) appendOrientedLine(merged, line);
  importedSources.push({
    area,
    filename,
    sourceUrl,
    pointCount: merged.length - before
  });
}

const cumulative = withCumulativeDistance(merged);
const rawDistanceKm = cumulative[cumulative.length - 1]?.rawKm ?? 0;
const normalized = simplify(cumulative).map((point) => ({
  lat: Number(point.lat.toFixed(6)),
  lng: Number(point.lng.toFixed(6)),
  routeKm: Number(((point.rawKm / rawDistanceKm) * officialDistanceKm).toFixed(1))
}));

const route = {
  meta: {
    routeName: "Pacific Cycling Road",
    direction: "choshi-to-wakayama",
    officialDistanceKm,
    rawKmlDistanceKm: Number(rawDistanceKm.toFixed(1)),
    sourcePageUrl: "https://www.kkr.mlit.go.jp/road/pcr/map/index.html",
    generatedAt: new Date().toISOString(),
    coordinateOrder: "lat-lng",
    note: "routeKm is normalized to the official 1,487 km route length for planning consistency."
  },
  sources: importedSources,
  points: normalized
};

writeFileSync(outputPath, `${JSON.stringify(route, null, 2)}\n`);
console.log(`Wrote ${normalized.length} route points to ${path.relative(root, outputPath)}`);
