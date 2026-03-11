/**
 * setup-grafana.js
 * Run once to provision Prometheus datasource + SenseBridge dashboard in Grafana.
 * Usage: node setup-grafana.js
 *
 * Requires Grafana running at http://localhost:3000 (admin / admin by default)
 */

const http = require('http');

const GRAFANA = 'http://localhost:3000';
const USER    = 'admin';
const PASS    = 'admin';          // Change if you've set a custom password
const AUTH    = Buffer.from(`${USER}:${PASS}`).toString('base64');

// ── Helpers ────────────────────────────────────────────────────────────────────
const request = (method, path, body) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
        hostname: 'localhost',
        port: 3000,
        path,
        method,
        headers: {
            'Authorization': `Basic ${AUTH}`,
            'Content-Type': 'application/json',
            ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        },
    };
    const req = http.request(opts, (res) => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => {
            try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
            catch { resolve({ status: res.statusCode, body: raw }); }
        });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
});

// ── 1. Create / update Prometheus datasource ───────────────────────────────────
async function provisionDatasource() {
    console.log('→ Checking Prometheus datasource...');
    const existing = await request('GET', '/api/datasources/name/Prometheus');
    if (existing.status === 200) {
        console.log('  ✅ Datasource "Prometheus" already exists (id:', existing.body.id, ')');
        return existing.body.uid || existing.body.id;
    }

    const res = await request('POST', '/api/datasources', {
        name:      'Prometheus',
        type:      'prometheus',
        url:       'http://localhost:9090',
        access:    'proxy',
        isDefault: true,
        jsonData:  { timeInterval: '10s', httpMethod: 'POST' },
    });

    if (res.status === 200 || res.status === 201) {
        console.log('  ✅ Created Prometheus datasource (uid:', res.body.datasource?.uid, ')');
        return res.body.datasource?.uid;
    }
    throw new Error('Failed to create datasource: ' + JSON.stringify(res.body));
}

// ── 2. Create / replace SenseBridge dashboard ─────────────────────────────────
async function provisionDashboard(dsUid) {
    console.log('→ Provisioning SenseBridge dashboard...');

    const dashboard = {
        uid:         'sensebridge-api',
        title:       'SenseBridge API Monitoring',
        tags:        ['sensebridge'],
        timezone:    'browser',
        refresh:     '10s',
        schemaVersion: 38,
        time: { from: 'now-1h', to: 'now' },
        panels: [
            makeTimeseries(1, '📡 HTTP Request Rate (req/s)',        0,  0, 12, 8, 'reqps',
                [{ expr: 'sum(rate(http_requests_total[1m])) by (status_code)', legend: 'Status {{status_code}}' }], dsUid),
            makeTimeseries(2, '⏱ Response Latency (p50 / p95 / p99)', 12, 0, 12, 8, 's',
                [
                    { expr: 'histogram_quantile(0.50, sum(rate(http_request_duration_seconds_bucket[2m])) by (le))', legend: 'p50' },
                    { expr: 'histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[2m])) by (le))', legend: 'p95' },
                    { expr: 'histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[2m])) by (le))', legend: 'p99' },
                ], dsUid),
            makeTimeseries(3, '🔴 Error Rate (4xx / 5xx)',            0,  8, 12, 8, 'reqps',
                [
                    { expr: 'sum(rate(http_requests_total{status_code=~"4.."}[1m]))', legend: '4xx' },
                    { expr: 'sum(rate(http_requests_total{status_code=~"5.."}[1m]))', legend: '5xx' },
                ], dsUid),
            makeTimeseries(4, '🔄 Active Connections',                12, 8, 12, 8, 'short',
                [{ expr: 'http_active_requests', legend: 'Active Requests' }], dsUid),
            makeGauge(5, '👥 Registered Users', 0,  16, 8, 4, 'sensebridge_registered_users', dsUid),
            makeGauge(6, '✅ Active Users',      8,  16, 8, 4, 'sensebridge_active_users',     dsUid),
            makeGauge(7, '🚨 SOS Events',        16, 16, 8, 4, 'sensebridge_sos_total',        dsUid),
            makeTimeseries(8, '💾 Process Memory',                    0,  20, 12, 6, 'bytes',
                [{ expr: 'sensebridge_node_process_resident_memory_bytes', legend: 'RSS Memory' }], dsUid),
            makeTable(9, '🔝 Top Routes by Traffic (last 5m)',        0,  26, 24, 8, dsUid),
        ],
    };

    const res = await request('POST', '/api/dashboards/db', {
        dashboard,
        overwrite: true,
        folderId:  0,
    });

    if (res.status === 200) {
        console.log('  ✅ Dashboard created! URL:', `http://localhost:3000${res.body.url}`);
        console.log('  UID:', res.body.uid);
        return res.body.uid;
    }
    throw new Error('Failed to create dashboard: ' + JSON.stringify(res.body));
}

// ── Panel builder helpers ──────────────────────────────────────────────────────
function makeTimeseries(id, title, x, y, w, h, unit, targets, dsUid) {
    return {
        id, type: 'timeseries', title,
        gridPos: { x, y, w, h },
        datasource: { type: 'prometheus', uid: dsUid },
        fieldConfig: { defaults: { unit, custom: { lineWidth: 2, fillOpacity: 12 } }, overrides: [] },
        options: { legend: { displayMode: 'table', placement: 'bottom', calcs: ['mean', 'max'] }, tooltip: { mode: 'multi' } },
        targets: targets.map((t, i) => ({
            datasource: { type: 'prometheus', uid: dsUid },
            expr: t.expr,
            legendFormat: t.legend,
            refId: String.fromCharCode(65 + i),
        })),
    };
}

function makeGauge(id, title, x, y, w, h, expr, dsUid) {
    return {
        id, type: 'gauge', title,
        gridPos: { x, y, w, h },
        datasource: { type: 'prometheus', uid: dsUid },
        fieldConfig: {
            defaults: { unit: 'short', thresholds: { mode: 'absolute', steps: [{ color: 'green', value: null }, { color: 'yellow', value: 50 }, { color: 'red', value: 100 }] } },
            overrides: [],
        },
        options: { reduceOptions: { calcs: ['lastNotNull'] }, showThresholdLabels: false, showThresholdMarkers: true },
        targets: [{ datasource: { type: 'prometheus', uid: dsUid }, expr, legendFormat: title, refId: 'A' }],
    };
}

function makeTable(id, title, x, y, w, h, dsUid) {
    return {
        id, type: 'table', title,
        gridPos: { x, y, w, h },
        datasource: { type: 'prometheus', uid: dsUid },
        fieldConfig: { defaults: { unit: 'reqps' }, overrides: [] },
        options: { footer: { show: false }, showHeader: true },
        targets: [{
            datasource: { type: 'prometheus', uid: dsUid },
            expr: 'sort_desc(sum(rate(http_requests_total[5m])) by (route, method))',
            instant: true,
            legendFormat: '{{method}} {{route}}',
            refId: 'A',
        }],
        transformations: [{ id: 'labelsToFields', options: {} }, { id: 'merge', options: {} }],
    };
}

// ── Main ───────────────────────────────────────────────────────────────────────
(async () => {
    console.log('\n🚀 SenseBridge Grafana Setup\n');
    try {
        // Check Grafana is up
        const health = await request('GET', '/api/health');
        if (health.status !== 200) throw new Error('Grafana not reachable at localhost:3000');
        console.log('  ✅ Grafana is up (version:', health.body.version, ')\n');

        const dsUid = await provisionDatasource();
        console.log();
        await provisionDashboard(dsUid);

        console.log('\n✅ All done! Open the Admin Panel → Monitoring tab.\n');
        console.log('   Or go direct: http://localhost:3000/d/sensebridge-api\n');
    } catch (err) {
        console.error('\n❌ Setup failed:', err.message);
        console.error('   Make sure Grafana is running at http://localhost:3000\n');
        process.exit(1);
    }
})();
