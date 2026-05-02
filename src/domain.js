export const DISTANCE_RULES = {
  idealMinKm: 50,
  recommendedMaxKm: 70,
  hardMaxKm: 90
};

export function byId(items) {
  return Object.fromEntries(items.map((item) => [item.id, item]));
}

export function segmentId(fromCheckpointId, toCheckpointId) {
  return `${fromCheckpointId}-${toCheckpointId}`;
}

export function classifyDistance(distanceKm) {
  if (distanceKm > DISTANCE_RULES.hardMaxKm) {
    return {
      level: "danger",
      label: "強い警告",
      message: "90km超。宿泊・短縮・離脱手段を先に固める距離です。"
    };
  }
  if (distanceKm > DISTANCE_RULES.recommendedMaxKm) {
    return {
      level: "warning",
      label: "注意",
      message: "70km超。疲労と帰宅時間の余裕を確認する距離です。"
    };
  }
  if (distanceKm >= DISTANCE_RULES.idealMinKm) {
    return {
      level: "good",
      label: "標準",
      message: "50-70kmの標準レンジです。"
    };
  }
  return {
    level: "easy",
    label: "短め",
    message: "短め。移動負担や観光を加味して選びやすい距離です。"
  };
}

export function formatMinutes(minutes) {
  if (!Number.isFinite(minutes)) return "未入力";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}分`;
  if (mins === 0) return `${hours}時間`;
  return `${hours}時間${mins}分`;
}

export function getPlanSegments(data, plan) {
  const segmentsById = byId(data.segments);
  const idsFromCheckpoints = plan.checkpointIds
    .slice(0, -1)
    .map((checkpointId, index) => segmentId(checkpointId, plan.checkpointIds[index + 1]));
  const explicitIds = plan.days?.flatMap((day) => day.segmentIds ?? []) ?? [];
  const segmentIds = explicitIds.length > 0 ? explicitIds : idsFromCheckpoints;
  return segmentIds.map((id) => segmentsById[id]).filter(Boolean);
}

export function getPlanDaySummaries(data, plan) {
  const segmentsById = byId(data.segments);
  return (plan.days ?? []).map((day, index) => {
    const segments = (day.segmentIds ?? []).map((id) => segmentsById[id]).filter(Boolean);
    const distanceKm = Number(
      segments.reduce((sum, segment) => sum + segment.distanceKm, 0).toFixed(1)
    );
    const estimatedRideHours = Number(
      segments.reduce((sum, segment) => sum + (Number(segment.estimatedRideHours) || 0), 0).toFixed(1)
    );
    return {
      ...day,
      label: day.label ?? `Day ${index + 1}`,
      segments,
      distanceKm,
      estimatedRideHours,
      classification: classifyDistance(distanceKm)
    };
  });
}

export function getAccessOption(data, checkpointId, memberId, direction) {
  return data.accessOptions.find(
    (option) =>
      option.checkpointId === checkpointId &&
      option.memberId === memberId &&
      option.direction === direction
  );
}

function getRouteCheckpointIds(data) {
  return [...data.checkpoints].sort((a, b) => a.routeKm - b.routeKm).map((checkpoint) => checkpoint.id);
}

function buildCompletion(data, orderedSegments, startCheckpointId) {
  const checkpointsById = byId(data.checkpoints);
  const orderedSegmentIds = orderedSegments.map((segment) => segment.id);
  const completed = new Set(
    data.rides
      .filter((ride) => ride.completionStatus === "complete")
      .flatMap((ride) => ride.segmentIds)
  );
  const partial = new Set(
    data.rides
      .filter((ride) => ride.completionStatus === "partial")
      .flatMap((ride) => ride.segmentIds)
  );

  let contiguousSegments = 0;
  for (const id of orderedSegmentIds) {
    if (!completed.has(id)) break;
    contiguousSegments += 1;
  }

  const frontierCheckpointId =
    contiguousSegments === 0
      ? startCheckpointId
      : orderedSegments[contiguousSegments - 1]?.toCheckpointId ?? startCheckpointId;
  const frontierCheckpoint = checkpointsById[frontierCheckpointId];
  const aheadSegments = orderedSegmentIds
    .slice(contiguousSegments)
    .filter((id) => completed.has(id));

  return {
    orderedSegmentIds,
    completedSegmentIds: [...completed],
    partialSegmentIds: [...partial],
    contiguousSegments,
    frontierCheckpointId,
    frontierKm: frontierCheckpoint?.routeKm ?? 0,
    aheadSegments
  };
}

export function getAccessBurden(data, fromCheckpointId, toCheckpointId) {
  return data.members.map((member) => {
    const inbound = getAccessOption(data, fromCheckpointId, member.id, "morning");
    const outbound = getAccessOption(data, toCheckpointId, member.id, "eveningReturn");
    const totalMin =
      Number.isFinite(inbound?.durationMin) && Number.isFinite(outbound?.durationMin)
        ? inbound.durationMin + outbound.durationMin
        : null;
    return { member, inbound, outbound, totalMin };
  });
}

export function getSegmentAccessStats(data, segment) {
  const burdens = getAccessBurden(data, segment.fromCheckpointId, segment.toCheckpointId);
  const totals = burdens.map((burden) => burden.totalMin).filter(Number.isFinite);
  const fares = burdens
    .map((burden) =>
      Number.isFinite(burden.inbound?.fareYen) && Number.isFinite(burden.outbound?.fareYen)
        ? burden.inbound.fareYen + burden.outbound.fareYen
        : null
    )
    .filter(Number.isFinite);
  if (totals.length === 0) {
    return { averageMin: null, averageFareYen: null, maxMin: null, missingCount: burdens.length };
  }
  return {
    averageMin: Math.round(totals.reduce((sum, value) => sum + value, 0) / totals.length),
    averageFareYen:
      fares.length > 0
        ? Math.round(fares.reduce((sum, value) => sum + value, 0) / fares.length)
        : null,
    maxMin: Math.max(...totals),
    missingCount: burdens.length - totals.length
  };
}

export function scoreSegment(data, segment) {
  const access = getSegmentAccessStats(data, segment);
  const distance = classifyDistance(segment.distanceKm);
  let score = 100;

  if (distance.level === "easy") score -= 8;
  if (distance.level === "warning") score -= 18;
  if (distance.level === "danger") score -= 38;
  if (segment.tripBias === "overnight") score -= 8;
  if (segment.bailoutPoints?.length) score += Math.min(segment.bailoutPoints.length * 4, 12);
  if (segment.sights?.length) score += Math.min(segment.sights.length * 2, 8);
  if (Number.isFinite(access.averageMin)) score -= Math.max(0, Math.round((access.averageMin - 240) / 20));
  score -= access.missingCount * 6;

  return {
    score: Math.max(0, Math.min(100, score)),
    distance,
    access
  };
}

export function getCompletion(data, planId) {
  const plan = data.plans.find((item) => item.id === planId) ?? data.plans[0];
  const orderedSegments = getPlanSegments(data, plan);
  const startCheckpointId = orderedSegments[0]?.fromCheckpointId ?? plan.checkpointIds[0];

  return {
    plan,
    ...buildCompletion(data, orderedSegments, startCheckpointId)
  };
}

export function getRouteCompletion(data) {
  const segmentsById = byId(data.segments);
  const checkpointIds = getRouteCheckpointIds(data);
  const orderedSegments = checkpointIds
    .slice(0, -1)
    .map((checkpointId, index) => segmentsById[segmentId(checkpointId, checkpointIds[index + 1])])
    .filter(Boolean);
  return {
    routeCheckpointIds: checkpointIds,
    ...buildCompletion(data, orderedSegments, checkpointIds[0])
  };
}

export function rankNextCandidates(data) {
  const completion = getRouteCompletion(data);
  return data.segments
    .filter((segment) => segment.fromCheckpointId === completion.frontierCheckpointId)
    .map((segment) => ({ segment, ...scoreSegment(data, segment) }))
    .sort((a, b) => b.score - a.score);
}

export function resolveAssetUrl(assetPath, baseUri) {
  return new URL(assetPath, baseUri).toString();
}
