// Search, filter, paginate, export and refresh sensor readings.
const sensorUI = {
    rows: document.getElementById('sensorRows'),
    type: document.getElementById('sensorType'),
    value: document.getElementById('sensorValue'),
    size: document.getElementById('sensorPageSize')
};
let sensorReadings = [];
let sensorFiltered = [];
let sensorPage = 1;
let sensorCriteria = { type: 'all', value: '' };
// [HOC-CODE] Khai báo 3 loại cảm biến và đơn vị °C, %, lux để dựng bảng.
const sensorTypes = [
    { id: 'temperature', label: 'Nhiệt độ', unit: '°C', css: 'red' },
    { id: 'humidity', label: 'Độ ẩm', unit: '%', css: 'blue' },
    { id: 'light', label: 'Ánh sáng', unit: 'lux', css: 'yellow' }
];
// [HOC-CODE] makeSensorRows(): một lần đo chứa 3 số -> flatMap/map tách thành 3 dòng bảng.
function makeSensorRows() {
    return sensorReadings.flatMap(record => sensorTypes.map(type => ({
        // [HOC-CODE] Tính ID hiển thị: idGoc*3 - 2 + vị trí (0,1,2); đây KHÔNG phải ID MySQL.
        id: (Number(record.id || 0) * 3 - 2 + sensorTypes.indexOf(type)),
        type: type.id, label: type.label, unit: type.unit, css: type.css,
        value: record[type.id], time: record.time,
        source: record.source || 'ESP8266'
    })));
}
// [HOC-CODE] matchesSensorNumber(): tìm ĐÚNG phần số, không tìm nhầm "24" trong "124".
// Nhập 24: tìm nhóm 24.0–24.999... (như chế độ DEMO trước).
// Nhập 24.5 hoặc 24,5: khớp số chính xác 24.5, không khớp 24.55.
function matchesSensorNumber(value, rawQuery) {
    const query = rawQuery.trim().replace(',', '.').replace(/\s*(?:°c|lux|%)\s*$/i, '').trim();
    if (query === '') return true;
    if (!/^-?\d+(?:\.\d+)?$/.test(query)) return false;
    const actual = Number(value);
    if (!Number.isFinite(actual)) return false;
    const target = Number(query);
    return query.includes('.')
        ? Math.abs(actual - target) < 1e-9
        : (actual >= target && actual < target + 1);
}

// [HOC-CODE] matchesSensorTime(): lấy giờ/ngày từ cùng timestamp đang hiển thị trên bảng.
// Hỗ trợ: 22:23, 22:23:10, 14/10/2026, 2026-10-14, 2026/10/14, 2026/10/14 22:23.
// Dùng startsWith(), không lẫn các ngày/giờ có chuỗi nằm ở giữa.
function matchesSensorTime(time, rawQuery) {
    const query = rawQuery.trim().toLowerCase().replace(/\s+/g, ' ');
    if (query === '') return true;
    const date = new Date(time);
    if (Number.isNaN(date.getTime())) return false;
    const pad = number => String(number).padStart(2, '0');
    const day = pad(date.getDate());
    const month = pad(date.getMonth() + 1);
    const year = date.getFullYear();
    const hour = pad(date.getHours());
    const minute = pad(date.getMinutes());
    const second = pad(date.getSeconds());
    const dateVN = `${day}/${month}/${year}`;
    const dateISO = `${year}-${month}-${day}`;
    const dateYMD = `${year}/${month}/${day}`; // [HOC-CODE] Trùng định dạng YYYY/MM/DD đang hiển thị.
    const clock = `${hour}:${minute}:${second}`;
    return [clock, dateVN, dateISO, dateYMD,
        `${dateVN} ${clock}`, `${clock} ${dateVN}`,
        `${dateISO} ${clock}`, `${dateISO}t${clock}`,
        `${dateYMD} ${clock}`, `${clock} ${dateYMD}`,
        fmt(time).toLowerCase()
    ].some(candidate => candidate.toLowerCase().startsWith(query));
}

// [HOC-CODE] isSensorTimeQuery(): phân biệt NGÀY/GIỜ với GIÁ TRỊ SỐ ở chế độ "Tất cả cảm biến".
// Có dấu / (2026/10/15), dấu : (09:33) hoặc ngày ISO (2026-10-15) => tìm theo thời gian.
// Số như 29,1; 70; 24°C không chứa ký hiệu thời gian => tìm theo giá trị cảm biến.
// Không OR trực tiếp số và thời gian để tránh nhập "20" lại khớp ngày/năm ngoài ý muốn.
function isSensorTimeQuery(rawQuery) {
    const query = rawQuery.trim();
    return query.includes('/') || query.includes(':') || /^\d{4}-\d{1,2}(?:-\d{1,2})?$/.test(query);
}

// [HOC-CODE] filterSensors(): "Tất cả cảm biến" tự chọn cách tìm theo kiểu dữ liệu nhập.
// Các chế độ Thời gian / Giá trị / Nhiệt độ / Độ ẩm / Ánh sáng vẫn giữ cách lọc riêng.
// Chỉ khi bấm Tìm kiếm (submit) mới lấy chữ đang nhập vào sensorCriteria.
function filterSensors() {
    const { type, value } = sensorCriteria;
    sensorFiltered = makeSensorRows().filter(row => {
        if (type === 'time') return matchesSensorTime(row.time, value);
        if (type === 'all') {
            // Chuỗi rỗng hiện tất cả; ngày/giờ kiểm tra timestamp, số kiểm tra giá trị cảm biến.
            if (value === '') return true;
            return isSensorTimeQuery(value)
                ? matchesSensorTime(row.time, value)
                : matchesSensorNumber(row.value, value);
        }
        if (type === 'value') return matchesSensorNumber(row.value, value);
        // Lọc theo loại cảm biến + giá trị: phải đồng thời đúng cả hai điều kiện.
        return row.type === type && matchesSensorNumber(row.value, value);
    }).sort((a, b) => new Date(b.time) - new Date(a.time));
    drawSensorTable();
}
// [HOC-CODE] updateSensorSearchHint(): không hiển thị ví dụ trong ô nhập;
// chỉ đặt tên hỗ trợ truy cập (aria-label) theo tiêu chí tìm kiếm đang chọn.
function updateSensorSearchHint() {
    const mode = sensorUI.type.value;
    sensorUI.value.placeholder = '';
    sensorUI.value.setAttribute('aria-label',
        mode === 'time' ? 'Nhập thời gian cần tìm'
            : mode === 'all' ? 'Nhập giá trị cảm biến hoặc ngày giờ cần tìm'
                : 'Nhập giá trị cảm biến cần tìm');
}
// [HOC-CODE] formatSensorValue(): ghép số với row.unit; thiếu dữ liệu thì hiển thị --.
function formatSensorValue(row) {
    return row.value == null || row.value === ''
        ? '--'
        : `${row.value} ${row.unit}`;
}
// [HOC-CODE] drawSensorTable(): tính số dòng/trang -> slice() -> map() HTML -> innerHTML -> vẽ phân trang.
function drawSensorTable() {
    const pageSize = pageSizeForScreen(sensorUI.size, sensorUI.rows);
    const totalPages = Math.max(1, Math.ceil(sensorFiltered.length / pageSize));
    sensorPage = Math.min(sensorPage, totalPages);
    const start = (sensorPage - 1) * pageSize;
    // [HOC-CODE] slice() chỉ lấy các dòng thuộc trang hiện tại, không xóa dữ liệu gốc.
    const view = sensorFiltered.slice(start, start + pageSize);
    // [HOC-CODE] map() biến từng row thành <tr>; join() nối chuỗi HTML rồi innerHTML hiển thị.
    sensorUI.rows.innerHTML = view.length ? view.map(row => `
        <tr><td>${escapeHtml(row.id)}</td><td>${escapeHtml(row.label)}</td>
        <td class="${row.css}"><b>${escapeHtml(formatSensorValue(row))}</b></td>
        <td>${escapeHtml(fmt(row.time))}</td></tr>
    `).join('') : '<tr><td colspan="4" class="empty">Không có dữ liệu khớp điều kiện tìm kiếm.</td></tr>';
    const end = Math.min(start + pageSize, sensorFiltered.length);
    document.getElementById('sensorSummary').textContent = sensorFiltered.length ?
        `Hiển thị ${start + 1}–${end} trong ${sensorFiltered.length} dòng` : '0 dòng dữ liệu';
    renderPageNumbers('sensorPageNumbers', totalPages, sensorPage, n => { sensorPage = n; drawSensorTable(); });
    document.getElementById('sensorPrev').disabled = sensorPage <= 1;
    document.getElementById('sensorNext').disabled = sensorPage >= totalPages;
}
// [HOC-CODE] loadSensors(): GET /api/sensors -> đọc response.json() -> gọi filterSensors(); lỗi thì báo.
async function loadSensors() {
    try {
        const response = await fetch('/api/sensors', { cache: 'no-store' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        sensorReadings = await response.json();
        filterSensors();
    } catch { sensorUI.rows.innerHTML = '<tr><td colspan="4" class="empty">Không thể tải dữ liệu. Kiểm tra Node.js server.</td></tr>'; }
}
// [HOC-CODE] NÚT TÌM KIẾM: chặn reload form, lấy type/value, đặt trang=1 rồi lọc.
document.getElementById('sensorFilter').addEventListener('submit', event => {
    event.preventDefault(); sensorPage = 1;
    sensorCriteria = { type: sensorUI.type.value, value: sensorUI.value.value.trim() };
    filterSensors();
});
// [HOC-CODE] Đổi lựa chọn chỉ thay gợi ý ô tìm; KHÔNG chạy lọc, KHÔNG đổi sensorCriteria.
// Bộ lọc cũ vẫn áp dụng khi API cập nhật 4 giây/lần, cho đến lúc nhấn "Tìm kiếm" hoặc "Đặt lại".
sensorUI.type.addEventListener('change', () => {
    updateSensorSearchHint();
});
// [HOC-CODE] NÚT ĐẶT LẠI: reset() form -> xóa tiêu chí -> trang=1 -> vẽ tất cả.
document.getElementById('resetSensors').addEventListener('click', () => {
    document.getElementById('sensorFilter').reset(); sensorPage = 1;
    sensorCriteria = { type: 'all', value: '' };
    updateSensorSearchHint();
    filterSensors();
});
// [HOC-CODE] Khi đổi số dòng hiển thị, trở lại trang đầu rồi vẽ lại.
sensorUI.size.addEventListener('change', () => { sensorPage = 1; drawSensorTable(); });
// [HOC-CODE] Nút trang trước giảm sensorPage; Next tăng sensorPage rồi drawSensorTable().
document.getElementById('sensorPrev').onclick = () => { sensorPage--; drawSensorTable(); };
document.getElementById('sensorNext').onclick = () => { sensorPage++; drawSensorTable(); };
updateSensorSearchHint();
loadSensors();
// [HOC-CODE] Trang Sensor Data tự gọi API lại mỗi 4 giây; không tự tạo số đo khi tìm kiếm.
setInterval(loadSensors, 4000);

// Reflow the currently visible page if the user resizes the desktop window.
let resizePending = false;
// [HOC-CODE] Khi đổi kích thước cửa sổ, requestAnimationFrame() tính lại số dòng vừa màn hình.
window.addEventListener('resize', () => {
    if (resizePending) return;
    resizePending = true;
    requestAnimationFrame(() => {
        resizePending = false;
        drawSensorTable();
    });
});
