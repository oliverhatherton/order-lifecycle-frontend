// Joins several /metrics/history series (fetched at the same resolution) into
// one row per bucket, for overlaying traffic/latency/lag/cpu on a single
// timeline — the "spike correlation" view.
//
// Two different fill strategies matter here, per the durable-history guide:
//  - Traffic (request count) buckets are omitted when there were zero
//    requests, which is real data, not a gap — zero-fill it.
//  - Gauge buckets (lag, cpu, memory) are omitted only when the server was
//    down for that bucket — leave those as gaps (null) so the chart shows
//    downtime instead of interpolating across it.
//
// The gauge series are the ground truth for "was the server up" (they're
// recorded on a timer regardless of traffic), so the master bucket timeline
// is the union of the gauge series, not the traffic series.

function indexByBucket(points) {
  return new Map((points ?? []).map((p) => [p.bucketStart, p]))
}

/**
 * @param {{ traffic: object[], latency: object[], lagAvg: object[], lagMax: object[], cpu: object[], heap: object[] }} series
 * @returns {Array<{ bucketStart: string, label: string, requests: number, latencyAvg: number|null, latencyMax: number|null, lagAvg: number|null, lagMax: number|null, cpu: number|null, heapBytes: number|null }>}
 */
export function buildCorrelationRows({ traffic, latency, lagAvg, lagMax, cpu, heap }) {
  const gaugeSeries = [lagAvg, lagMax, cpu, heap]
  const bucketSet = new Set()
  for (const series of gaugeSeries) {
    for (const p of series ?? []) bucketSet.add(p.bucketStart)
  }
  const buckets = [...bucketSet].sort()

  const trafficIdx = indexByBucket(traffic)
  const latencyIdx = indexByBucket(latency)
  const lagAvgIdx = indexByBucket(lagAvg)
  const lagMaxIdx = indexByBucket(lagMax)
  const cpuIdx = indexByBucket(cpu)
  const heapIdx = indexByBucket(heap)

  return buckets.map((bucketStart) => {
    const trafficPoint = trafficIdx.get(bucketStart)
    const latencyPoint = latencyIdx.get(bucketStart)
    return {
      bucketStart,
      label: new Date(bucketStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      requests: trafficPoint ? trafficPoint.count : 0,
      // No requests in this bucket means no latency to report — leave as a
      // gap rather than pretending 0ms.
      latencyAvg: latencyPoint ? latencyPoint.avg : null,
      latencyMax: latencyPoint ? latencyPoint.max : null,
      lagAvg: lagAvgIdx.get(bucketStart)?.avg ?? null,
      lagMax: lagMaxIdx.get(bucketStart)?.max ?? null,
      cpu: cpuIdx.get(bucketStart)?.avg ?? null,
      heapBytes: heapIdx.has(bucketStart) ? heapIdx.get(bucketStart).avg : null,
    }
  })
}
