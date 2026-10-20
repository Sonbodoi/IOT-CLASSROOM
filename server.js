/**
 * IoT Classroom — Express REST API, MQTT, Socket.IO and JSON file storage.
 * npm start      : real ESP8266 / MQTT mode
 * npm run demo   : explicit simulated data mode (no physical device required)
 */
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');
const mqtt = require('mqtt');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// [HOC-CODE] DEMO_MODE chỉ bật khi chạy npm run demo; npm start dùng luồng MQTT thật.
const DEMO_MODE = process.env.DEMO_MODE === '1';
const PORT = Number(process.env.PORT) || 3000;
const MQTT_URL = process.env.MQTT_URL || 'mqtt://192.168.137.1:1884';
// [HOC-CODE] Hai file lưu riêng: data/demo-store.json cho DEMO, data/store.json cho mạch thật.
const STORE_FILE = path.join(__dirname, 'data', DEMO_MODE ? 'demo-store.json' : 'store.json');
const MAX_SENSORS = 5000;
const MAX_ACTIONS = 2000;
// Versioned, explicitly simulated history for realistic DEMO filtering.
const DEMO_SAMPLE_VERSION = 1;
const DEVICE_NAMES = { 1: 'LED 1', 2: 'LED 2', 3: 'LED 3' };

// TEMT6000 conversion for legacy ADC data (estimated lux, not a calibrated meter).
// Assumes a 3.3 V ADC input range (NodeMCU-style A0), 10 kOhm sensor module load,
// and ~0.5 microamp of photocurrent per lux (typical TEMT6000 datasheet).
// Match these constants to the physical hardware before treating lux as precise.
const LIGHT_ADC_MAX = 1023;
const LIGHT_ADC_VOLTAGE = 3.3;
const LIGHT_LOAD_OHMS = 10000;
const LIGHT_UA_PER_LUX = 0.5;
// [HOC-CODE] normalizeLux(): nếu đơn vị lux thì giữ số đã chuẩn hóa, nếu ADC 0..1023 thì đổi sang lux ƯỚC TÍNH.
function normalizeLux(value, unit = 'adc') {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    const kind = String(unit || 'adc').trim().toLowerCase();
    if (!Number.isFinite(n) || n < 0) return null;
    if (kind === 'lux') return n <= 200000 ? Math.round(n * 10) / 10 : null;
    if (kind !== 'adc' || n > LIGHT_ADC_MAX) return null;
    // [HOC-CODE] Đổi ADC sang điện áp, từ đó tính dòng quang và lux; cần hiệu chuẩn cảm biến thật.
    const volts = n * LIGHT_ADC_VOLTAGE / LIGHT_ADC_MAX;
    const lux = volts * 1_000_000 / (LIGHT_LOAD_OHMS * LIGHT_UA_PER_LUX);
    return Math.round(lux * 10) / 10;
}
// [HOC-CODE] normalizeStoredReading(): hỗ trợ lịch sử cũ chưa lưu đơn vị ánh sáng.
function normalizeStoredReading(row) {
    if (!row || typeof row !== 'object') return null;
    // Earlier versions stored raw ADC readings without a lightUnit field.
    return { ...row, light: normalizeLux(row.light, row.lightUnit), lightUnit: 'lux' };
}

// [HOC-CODE] loadStore(): readFileSync đọc JSON, kiểm tra cấu trúc, giới hạn số dòng, đồng nhất tên LED; lỗi thì tạo kho trống.
function loadStore() {
    try {
        const saved = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
        return {
            sensors: Array.isArray(saved.sensors) ? saved.sensors.slice(0, MAX_SENSORS).map(normalizeStoredReading).filter(Boolean) : [],
            actions: Array.isArray(saved.actions) ? saved.actions.slice(0, MAX_ACTIONS).map(action => {
                // Legacy data could contain "Device 1" / "Thiết bị 1" instead of "LED 1".
                const oldName = String(action.device || '');
                const oldId = oldName.match(/(?:LED|Device|Thiết bị)\s*([123])$/i);
                const id = [1, 2, 3].includes(Number(action.deviceId))
                    ? Number(action.deviceId) : (oldId ? Number(oldId[1]) : null);
                return id ? { ...action, deviceId: id, device: DEVICE_NAMES[id] } : action;
            }) : [],
            nextSensorId: Number(saved.nextSensorId) || 1,
            nextActionId: Number(saved.nextActionId) || 1,
            demoSampleVersion: Number(saved.demoSampleVersion) || 0
        };
    } catch (err) {
        if (err.code !== 'ENOENT') console.warn('Could not read store:', err.message);
        return { sensors: [], actions: [], nextSensorId: 1, nextActionId: 1, demoSampleVersion: 0 };
    }
}

const store = loadStore();
let latest = store.sensors[0] || { temperature: null, humidity: null, light: null, time: null };
let lastSensorAt = 0; // Only live readings count: restored historical readings do not imply online.
let mqttConnected = false;
const devices = { 1: null, 2: null, 3: null };
const pending = new Map();
let mc = null;

// [HOC-CODE] saveStore(): ghi JSON vào file .tmp -> renameSync thay file chính, không dùng MySQL.
function saveStore() {
    try {
        fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
        const tempFile = STORE_FILE + '.tmp';
        fs.writeFileSync(tempFile, JSON.stringify(store, null, 2), 'utf8');
        fs.renameSync(tempFile, STORE_FILE);
    } catch (err) {
        console.error('Could not save data:', err.message);
    }
}

// [HOC-CODE] addReading(): kiểm tra đầu vào -> chuẩn hóa lux -> tạo ID/thời gian -> lưu JSON -> io.emit sensor:update.
function addReading(reading) {
    const temperature = Number(reading.temperature);
    const humidity = Number(reading.humidity);
    // The new firmware publishes lux. Older firmware sends ADC without lightUnit.
    const lightLux = normalizeLux(reading.light, reading.lightUnit);
    // [HOC-CODE] Từ chối số sai hoặc vượt khoảng: nhiệt độ -50..120, độ ẩm 0..100; ánh sáng phải hợp lệ.
    if (![temperature, humidity].every(Number.isFinite) || lightLux === null ||
        temperature < -50 || temperature > 120 || humidity < 0 || humidity > 100) return false;
    latest = {
        // [HOC-CODE] nextSensorId++ lấy ID hiện tại rồi tăng; unshift() thêm mẫu mới lên đầu danh sách.
        id: store.nextSensorId++, temperature: Math.round(temperature * 10) / 10,
        humidity: Math.round(humidity * 10) / 10, light: lightLux, lightUnit: 'lux',
        time: new Date().toISOString(), source: DEMO_MODE ? 'DEMO' : 'ESP8266'
    };
    lastSensorAt = Date.now();
    store.sensors.unshift(latest);
    store.sensors.length = Math.min(store.sensors.length, MAX_SENSORS);
    saveStore();
    // [HOC-CODE] io.emit gửi mẫu mới tới mọi trang Dashboard đang kết nối Socket.IO.
    io.emit('sensor:update', latest);
    io.emit('system:update', systemStatus());
    return true;
}

// [HOC-CODE] deviceOnline(): DEMO luôn khả dụng; chế độ thật cần MQTT và mẫu đo mới trong 20 giây.
function deviceOnline() {
    return DEMO_MODE || (mqttConnected && lastSensorAt > 0 && Date.now() - lastSensorAt < 20000);
}
// [HOC-CODE] systemStatus(): gói mode, MQTT, trạng thái 3 LED, thời điểm mẫu gần nhất cho API.
function systemStatus() {
    return {
        mode: DEMO_MODE ? 'DEMO' : 'REAL', mqttConnected,
        deviceOnline: deviceOnline(), lastSensorTime: lastSensorAt ? new Date(lastSensorAt).toISOString() : null,
        devices: Object.fromEntries(Object.entries(devices).map(([id, state]) => [id, state]))
    };
}
// [HOC-CODE] setActionStatus(): đổi PENDING thành SUCCESS/FAILED, lưu JSON rồi báo Web.
function setActionStatus(action, status) {
    action.status = status;
    saveStore();
    io.emit('action:update', action);
}
// [HOC-CODE] recordAction(): tạo ID/lệnh/LED/trạng thái/thời gian cho nhật ký -> unshift() -> saveStore().
function recordAction(deviceId, command, status) {
    const action = {
        id: store.nextActionId++, deviceId, device: DEVICE_NAMES[deviceId],
        command, action: command === 'ON' ? 'BẬT' : 'TẮT',
        status, user: 'Lê Hồng Sơn', time: new Date().toISOString(),
        mode: DEMO_MODE ? 'DEMO' : 'REAL'
    };
    store.actions.unshift(action);
    store.actions.length = Math.min(store.actions.length, MAX_ACTIONS);
    saveStore();
    io.emit('action:new', action);
    return action;
}
// [HOC-CODE] acknowledge(): xác nhận phản hồi ON/OFF -> cập nhật LED -> hủy timer và đánh dấu SUCCESS nếu trùng lệnh chờ.
function acknowledge(deviceId, status) {
    if (status !== 'ON' && status !== 'OFF') return;
    devices[deviceId] = status;
    const task = pending.get(deviceId);
    if (task && task.command === status) {
        clearTimeout(task.timer);
        pending.delete(deviceId);
        setActionStatus(task.action, 'SUCCESS');
    }
    io.emit('device:status', { deviceId, status, time: new Date().toISOString() });
    io.emit('system:update', systemStatus());
}

// Add a set of fixed example measurements in DEMO mode, not on each search.
// Includes colder readings (e.g. 24 °C), varied humidity, and daylight lux.
// Existing simulated readings are retained; this one-time migration reorders
// their DEMO-only display IDs chronologically to keep newest IDs at the top.
// [HOC-CODE] ensureDemoSampleHistory(): một lần thêm 72 mẫu DEMO trong 3 ngày; giữ mẫu cũ; không tạo bản ghi do thao tác tìm kiếm.
function ensureDemoSampleHistory() {
    // [HOC-CODE] Chặn tạo lại bộ dữ liệu mẫu sau mỗi lần khởi động để không nhân đôi.
    if (store.demoSampleVersion >= DEMO_SAMPLE_VERSION) return;
    const HOURS = 72; // Three illustrative days of hourly measurements.
    const existing = store.sensors.slice(0, MAX_SENSORS - HOURS);
    const dates = existing.map(row => Date.parse(row.time)).filter(Number.isFinite);
    const earliest = dates.length ? Math.min(...dates) : Date.now();
    const lastSampleTime = Math.min(Date.now() - 60 * 60000, earliest - 60 * 60000);
    const samples = [];
    for (let i = 0; i < HOURS; i++) {
        const time = new Date(lastSampleTime - (HOURS - 1 - i) * 3600000);
        const hour = time.getHours();
        const warmth = Math.sin((hour - 9) * Math.PI / 12);
        samples.push({
            temperature: +(26.1 + 2.4 * warmth).toFixed(1),
            humidity: +(68 - 9 * warmth).toFixed(1),
            light: +(100 + 650 * Math.max(0, Math.sin((hour - 6) * Math.PI / 12))).toFixed(1),
            lightUnit: 'lux', time: time.toISOString(), source: 'DEMO'
        });
    }
    const chronological = [...existing, ...samples]
        .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    const previousMaxId = Math.max(0, ...existing.map(r => Number(r.id) || 0));
    const firstId = Math.max(1, previousMaxId - existing.length + 1);
    chronological.forEach((record, i) => { record.id = firstId + i; });
    store.sensors = chronological.reverse();
    store.nextSensorId = Math.max(store.nextSensorId, firstId + chronological.length);
    store.demoSampleVersion = DEMO_SAMPLE_VERSION;
    saveStore();
    latest = store.sensors[0] || latest;
}

// [HOC-CODE] NHÁNH CHẠY: thật thì kết nối MQTT, giả thì tạo dữ liệu mô phỏng.
if (!DEMO_MODE) {
    mc = mqtt.connect(MQTT_URL, {
        username: process.env.MQTT_USER || 'iotuser',
        password: process.env.MQTT_PASS || '123456', reconnectPeriod: 2000
    });
    // [HOC-CODE] Khi nối MQTT -> subscribe topic dữ liệu cảm biến và phản hồi LED.
    mc.on('connect', () => {
        mqttConnected = true;
        console.log('MQTT connected:', MQTT_URL);
        mc.subscribe(['iot/sensors/data', 'iot/devices/+/status']);
        io.emit('system:update', systemStatus());
    });
    mc.on('offline', () => {
        mqttConnected = false;
        io.emit('system:update', systemStatus());
    });
    mc.on('close', () => {
        mqttConnected = false;
        io.emit('system:update', systemStatus());
    });
    mc.on('error', err => console.warn('MQTT:', err.message));
    // [HOC-CODE] MQTT gửi topic/payload; iot/sensors/data -> addReading(); status LED -> acknowledge().
    mc.on('message', (topic, bytes) => {
        const message = bytes.toString();
        if (topic === 'iot/sensors/data') {
            try {
                if (!addReading(JSON.parse(message))) console.warn('Invalid sensor data');
            } catch { console.warn('Invalid MQTT sensor JSON'); }
            return;
        }
        const match = /^iot\/devices\/([123])\/status$/.exec(topic);
        if (!match) return;
        let status = message;
        try { status = JSON.parse(message).status || message; } catch { /* plain string */ }
        acknowledge(Number(match[1]), String(status).toUpperCase());
    });
// [HOC-CODE] Chạy DEMO: tạo lịch sử và dữ liệu theo sin/cos (chỉ trong DEMO).
} else {
    // Seed a realistic-looking, clearly labelled demonstration history only in DEMO mode.
    if (store.sensors.length === 0) {
        const now = Date.now();
        for (let i = 31; i >= 0; i--) {
            const n = 31 - i;
            const entry = {
                id: store.nextSensorId++, temperature: +(27 + Math.sin(n / 3) * 1.5).toFixed(1),
                humidity: +(69 + Math.cos(n / 4) * 6).toFixed(1),
                light: normalizeLux(Math.round(500 + Math.sin(n / 5) * 130)), lightUnit: 'lux',
                time: new Date(now - i * 60000).toISOString(), source: 'DEMO'
            };
            store.sensors.unshift(entry);
        }
        saveStore();
        latest = store.sensors[0];
    }
    // [HOC-CODE] Gọi sinh bộ lịch sử DEMO đã định sẵn, phục vụ tìm kiếm 24.x, độ ẩm và ánh sáng.
    ensureDemoSampleHistory();
    // Illustrative history for the filters (only in DEMO mode, clearly marked).
    if (store.actions.length === 0) {
        const now = Date.now();
        for (let i = 9; i >= 0; i--) {
            const deviceId = i % 3 + 1;
            const command = i % 2 === 0 ? 'ON' : 'OFF';
            const status = i === 4 ? 'FAILED' : i === 0 ? 'PENDING' : 'SUCCESS';
            store.actions.unshift({
                id: store.nextActionId++, deviceId, device: DEVICE_NAMES[deviceId],
                command, action: command === 'ON' ? 'BẬT' : 'TẮT', status,
                user: 'Lê Hồng Sơn', time: new Date(now - i * 5 * 60000).toISOString(),
                mode: 'DEMO'
            });
        }
        saveStore();
    }
    lastSensorAt = Date.now();
    devices[1] = 'OFF'; devices[2] = 'OFF'; devices[3] = 'OFF';
    // [HOC-CODE] DEMO sinh dữ liệu mô phỏng mới mỗi 3000ms; addReading lưu JSON và phát socket.
    setInterval(() => {
        const t = Date.now() / 10000;
        addReading({
            temperature: 28 + Math.sin(t / 4) * 1.3 + (Math.random() - .5) * .2,
            humidity: 70 + Math.cos(t / 5) * 5 + (Math.random() - .5) * .6,
            light: 560 + Math.sin(t / 3) * 115 + (Math.random() - .5) * 20,
            lightUnit: 'adc'
        });
    }, 3000);
    console.log('DEMO mode: simulated readings and LED controls (NO real MQTT/hardware).');
}

// [HOC-CODE] GET /api/system trả trạng thái để khóa/mở nút LED và hiển thị LIVE/DEMO.
app.get('/api/system', (req, res) => res.json(systemStatus()));
// [HOC-CODE] GET /api/sensors/latest trả mẫu cảm biến mới nhất.
app.get('/api/sensors/latest', (req, res) => res.json(latest));
// [HOC-CODE] GET /api/sensors trả lịch sử cho bảng và đồ thị.
app.get('/api/sensors', (req, res) => res.json(store.sensors));
// [HOC-CODE] GET /api/actions trả nhật ký LED.
app.get('/api/actions', (req, res) => res.json(store.actions));

// [HOC-CODE] API POST: nhận LED+ON/OFF -> kiểm tra -> ghi lịch sử -> DEMO mô phỏng / thật gửi MQTT.
app.post('/api/device/control', (req, res) => {
    const deviceId = Number(req.body?.deviceId ?? 1);
    const command = String(req.body?.command ?? '').toUpperCase();
    // [HOC-CODE] Sai LED hoặc command thì trả HTTP 400 và dừng route bằng return.
    if (!Object.hasOwn(DEVICE_NAMES, deviceId) || !['ON', 'OFF'].includes(command)) {
        return res.status(400).json({ error: 'LED phải là 1, 2 hoặc 3; lệnh phải là ON hoặc OFF.' });
    }
    // [HOC-CODE] Không có kết nối mạch/MQTT thì HTTP 503, không nhận lệnh giả là thật.
    if (!deviceOnline()) return res.status(503).json({ error: 'ESP8266 is offline or MQTT is disconnected.' });
    // [HOC-CODE] Nếu LED đang chờ phản hồi lệnh trước thì HTTP 409, tránh lệnh chồng nhau.
    if (pending.has(deviceId)) return res.status(409).json({ error: `LED ${deviceId} đang chờ xác nhận lệnh trước.` });
    const action = recordAction(deviceId, command, DEMO_MODE ? 'SUCCESS' : 'PENDING');
    // [HOC-CODE] Trong DEMO: acknowledge cập nhật LED giả và trả simulated:true, không gửi MQTT.
    if (DEMO_MODE) {
        acknowledge(deviceId, command);
        return res.json({ ok: true, simulated: true, action });
    }
    // [HOC-CODE] Lệnh thật được chờ tối đa 8 giây; quá hạn thì đánh dấu FAILED.
    const timer = setTimeout(() => {
        const waiting = pending.get(deviceId);
        if (waiting && waiting.action.id === action.id) {
            pending.delete(deviceId);
            setActionStatus(action, 'FAILED');
            io.emit('system:update', systemStatus());
        }
    }, 8000);
    // [HOC-CODE] Map pending ghi nhớ lệnh đang chờ để so phản hồi LED và hủy timeout đúng lệnh.
    pending.set(deviceId, { action, command, timer });
    // [HOC-CODE] Gửi lệnh ON/OFF tới topic của LED qua broker MQTT; callback xử lý lỗi publish.
    mc.publish(`iot/devices/${deviceId}/control`, command, { qos: 0 }, err => {
        if (!err) return;
        const waiting = pending.get(deviceId);
        if (waiting && waiting.action.id === action.id) {
            clearTimeout(waiting.timer);
            pending.delete(deviceId);
            setActionStatus(action, 'FAILED');
        }
    });
    // [HOC-CODE] API trả đã gửi lệnh; SUCCESS chỉ sau khi thiết bị phản hồi xác nhận.
    res.json({ ok: true, simulated: false, action });
});

// [HOC-CODE] Mở Web Server; mặc định http://localhost:3000.
server.listen(PORT, '0.0.0.0', () => console.log(`Web: http://localhost:${PORT}`));
