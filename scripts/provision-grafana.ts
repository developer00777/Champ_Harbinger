/**
 * Provision (or update) the ChampHarbinger dashboard in a self-hosted Grafana.
 *
 * Reads GRAFANA_URL + GRAFANA_TOKEN from the environment (never hardcode a
 * token). Assumes a Prometheus data source named "Prometheus" exists that
 * scrapes the app's /api/metrics. Idempotent via overwrite:true.
 *
 *   GRAFANA_URL=http://host:3003 GRAFANA_TOKEN=glsa_... pnpm tsx scripts/provision-grafana.ts
 */

const GRAFANA_URL = process.env.GRAFANA_URL?.replace(/\/+$/, "");
const GRAFANA_TOKEN = process.env.GRAFANA_TOKEN;

if (!GRAFANA_URL || !GRAFANA_TOKEN) {
  console.error(
    "GRAFANA_URL and GRAFANA_TOKEN must be set. Aborting (no token is hardcoded).",
  );
  process.exit(1);
}

const DATASOURCE = process.env.GRAFANA_DATASOURCE ?? "Prometheus";

function timeseries(
  title: string,
  expr: string,
  gridPos: { x: number; y: number; w: number; h: number },
  unit = "short",
) {
  return {
    title,
    type: "timeseries",
    datasource: { type: "prometheus", uid: DATASOURCE },
    fieldConfig: { defaults: { unit }, overrides: [] },
    gridPos,
    targets: [{ expr, datasource: { type: "prometheus", uid: DATASOURCE } }],
  };
}

const dashboard = {
  uid: "champharbinger",
  title: "ChampHarbinger",
  tags: ["champharbinger"],
  timezone: "browser",
  schemaVersion: 39,
  refresh: "30s",
  time: { from: "now-6h", to: "now" },
  panels: [
    timeseries(
      "AI calls / sec",
      "sum by (model) (rate(harbinger_ai_calls_total[5m]))",
      { x: 0, y: 0, w: 12, h: 8 },
    ),
    timeseries(
      "AI p95 latency (s)",
      "histogram_quantile(0.95, sum by (le, model) (rate(harbinger_ai_call_duration_seconds_bucket[5m])))",
      { x: 12, y: 0, w: 12, h: 8 },
      "s",
    ),
    timeseries(
      "Spend (USD, trailing 24h) by service",
      "harbinger_spend_usd",
      { x: 0, y: 8, w: 12, h: 8 },
      "currencyUSD",
    ),
    timeseries(
      "Emails sent / signals run (rate)",
      "sum by (status) (rate(harbinger_emails_sent_total[15m])) or sum by (status) (rate(harbinger_signals_run_total[15m]))",
      { x: 12, y: 8, w: 12, h: 8 },
    ),
    timeseries(
      "HTTP requests / sec by route",
      "sum by (route, status) (rate(harbinger_http_requests_total[5m]))",
      { x: 0, y: 16, w: 24, h: 8 },
    ),
  ],
};

async function main() {
  const res = await fetch(`${GRAFANA_URL}/api/dashboards/db`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GRAFANA_TOKEN}`,
    },
    body: JSON.stringify({
      dashboard,
      overwrite: true,
      message: "provisioned by ChampHarbinger",
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`Grafana returned ${res.status}: ${text}`);
    process.exit(1);
  }
  console.log("Dashboard provisioned:", text);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
