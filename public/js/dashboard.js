// Dashboard: show temperature, humidity and illuminance TOGETHER on one chart.
// [HOC-CODE] SOCKET: mở kết nối thời gian thực với server; không cần nhấn F5 để nhận mẫu mới.
const socket = io();
// [HOC-CODE] MẢNG: giữ thời gian và ba dãy số đo cùng chỉ số i để các điểm cùng thời điểm.
const labels = [], temps = [], hums = [], lights = [];
// [HOC-CODE] BIỂU ĐỒ: khai báo 3 đường, màu và trục (nhiệt/ẩm trái, lux phải).
const SERIES = [
    { label: 'Nhiệt độ', unit: '°C', color: '#ff6673', values: temps, axis: 'left' },
    { label: 'Độ ẩm', unit: '%', color: '#5d9cff', values: hums, axis: 'left' },
    { label: 'Ánh sáng', unit: 'lux', color: '#ffd45c', values: lights, axis: 'right' }
];
const canvas = document.getElementById('chart');
let currentSystem = { mode: 'REAL', deviceOnline: false, devices: {} };
let isSending = false;

// Left axis (°C / %) and right axis (lux) share the same time axis.
// The right axis is independent so lux values are never mistaken for °C or %.
// [HOC-CODE] niceStep(raw): chọn bước chia dễ đọc 1/2/2.5/5/10×10^n cho trục lux.
function niceStep(raw) {
    if (!Number.isFinite(raw) || raw <= 0) return 1;
    // [HOC-CODE] Math.log10() tìm bậc 10; Math.floor() lấy xuống, làm cơ sở làm tròn bước.
    const magnitude = 10 ** Math.floor(Math.log10(raw));
    // [HOC-CODE] fraction đo raw lớn gấp bao nhiêu lần bậc 10, từ đó chọn bước.
    const fraction = raw / magnitude;
    return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10) * magnitude;
}
// [HOC-CODE] lightAxisMax(): tìm mốc cao nhất trục lux, đủ chứa giá trị ánh sáng đang vẽ.
function lightAxisMax() {
    // [HOC-CODE] filter() bỏ NaN và số âm; không cho số lỗi làm sai thang đo.
    const values = lights.filter(Number.isFinite).filter(value => value >= 0);
    const high = values.length ? Math.max(...values) : 500;
    // [HOC-CODE] Dự tính bước bằng giá trị lớn nhất / 5 khoảng, rồi làm tròn dễ đọc.
    const step = niceStep(Math.max(1, high) / 5);
    return Math.max(step * 5, Math.ceil(high / step) * step);
}
// [HOC-CODE] renderChart(): XÓA Canvas cũ -> tính 2 trục -> vẽ vạch/mốc -> nối ba đường -> viết thời gian.
function renderChart() {
    if (!canvas) return;
    // [HOC-CODE] Đọc kích thước vùng vẽ; biểu đồ thích ứng khi cửa sổ thay đổi.
    const bounds = canvas.getBoundingClientRect();
    const width = Math.max(260, bounds.width), height = Math.max(180, bounds.height);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    // [HOC-CODE] Lấy công cụ Canvas 2D để vẽ bằng các lệnh ctx.*.
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    // [HOC-CODE] Xóa bản vẽ cũ trước khi vẽ mẫu mới, tránh đè các đường lên nhau.
    ctx.clearRect(0, 0, width, height);

    const left = 45, right = width - 45, top = 35, bottom = height - 29;
    const plotWidth = right - left, plotHeight = bottom - top;
    // [HOC-CODE] maxLeft: trục trái °C/% tối thiểu 100, làm tròn bội 20 nếu dữ liệu vượt ngưỡng.
    const maxLeft = Math.max(100, Math.ceil(Math.max(0, ...temps.filter(Number.isFinite), ...hums.filter(Number.isFinite)) / 20) * 20);
    // [HOC-CODE] maxRight: trục phải dùng riêng đơn vị lux; KHÔNG lấy số của trục trái để đọc ánh sáng.
    const maxRight = lightAxisMax();
    // [HOC-CODE] ticks=5 nghĩa là 5 khoảng chia và 6 mốc (0,1,2,3,4,5).
    const ticks = 5;

    ctx.font = '11px Arial';
    ctx.textAlign = 'left'; ctx.fillStyle = '#a0b8cf';
    ctx.fillText('°C / %', left, 17);
    ctx.textAlign = 'right'; ctx.fillStyle = '#ffd45c';
    ctx.fillText('lux', right, 17);

    // Grid and values for both scales. The right scale is labelled in yellow.
    ctx.font = '10px Arial';
    // [HOC-CODE] VÒNG FOR: mỗi lượt vẽ 1 đường lưới ngang và 2 nhãn ở cùng độ cao.
    for (let i = 0; i <= ticks; i++) {
        // [HOC-CODE] fraction = i/5, biến từ 0 đến 1; dùng để tính mốc từng trục.
        const fraction = i / ticks;
        // [HOC-CODE] Canvas có Y tăng từ trên xuống, nên trừ khỏi bottom để giá trị càng lớn nằm càng cao.
        const y = bottom - fraction * plotHeight;
        ctx.strokeStyle = 'rgba(70, 94, 120, .28)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
        ctx.textAlign = 'right'; ctx.fillStyle = '#8ca5bf';
        // [HOC-CODE] Ghi số trục TRÁI bằng maxLeft*fraction (°C/%).
        ctx.fillText(String(Math.round(maxLeft * fraction)), left - 9, y + 4);
        ctx.textAlign = 'left'; ctx.fillStyle = '#e7bf4e';
        // [HOC-CODE] Ghi số trục PHẢI bằng maxRight*fraction (lux).
        ctx.fillText(Number((maxRight * fraction).toFixed(2)).toLocaleString('vi-VN'), right + 9, y + 4);
    }

    let plottedAny = false;
    // Draw each series on the same canvas; both axes are visible simultaneously.
    // [HOC-CODE] Duyệt ba đường; mỗi đường có mảng values, màu color và trục axis.
    SERIES.forEach(({ color, values, axis }) => {
        // [HOC-CODE] Nếu là ánh sáng ('right') chia theo maxRight; nhiệt/ẩm chia theo maxLeft.
        const axisMax = axis === 'right' ? maxRight : maxLeft;
        let begun = false;
        let lastPoint = null;
        ctx.beginPath();
        // [HOC-CODE] Duyệt từng số đo thứ i để tìm điểm (x,y); bỏ qua số không hợp lệ.
        values.forEach((value, i) => {
            if (!Number.isFinite(value)) { begun = false; return; }
            // [HOC-CODE] Tọa độ X: chia ngang theo thứ tự mẫu, dùng cùng nhãn thời gian labels[i].
            const x = left + plotWidth * i / Math.max(1, labels.length - 1);
            // [HOC-CODE] Tọa độ Y: tỷ lệ số đo / giới hạn ĐÚNG TRỤC; kẹp vào [0,1] rồi đổi sang tọa độ Canvas.
            const y = bottom - Math.max(0, Math.min(1, value / axisMax)) * plotHeight;
            // [HOC-CODE] moveTo() đặt điểm đầu; lineTo() nối với điểm trước để tạo đường liên tục.
            if (begun) ctx.lineTo(x, y); else ctx.moveTo(x, y);
            begun = true;
            plottedAny = true;
            lastPoint = { x, y };
        });
        ctx.lineWidth = 2.7;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        // [HOC-CODE] Gán màu riêng cho đường; ctx.stroke() mới thực sự hiển thị đường đó.
        ctx.strokeStyle = color;
        ctx.stroke();
        // [HOC-CODE] lastPoint: vẽ dấu chấm tại mẫu hợp lệ cuối cùng, không liên quan chọn trục trái/phải.
        if (lastPoint) {
            ctx.beginPath(); ctx.arc(lastPoint.x, lastPoint.y, 3, 0, Math.PI * 2);
            ctx.fillStyle = color; ctx.fill();
        }
    });

    if (!plottedAny) {
        ctx.fillStyle = '#8299b0'; ctx.textAlign = 'center'; ctx.font = '11px Arial';
        ctx.fillText('Chưa có dữ liệu', (left + right) / 2, (top + bottom) / 2);
    }
    ctx.font = '10px Arial'; ctx.fillStyle = '#8299b0'; ctx.textAlign = 'center';
    const labelStride = Math.max(1, Math.ceil(labels.length / Math.max(2, Math.floor(plotWidth / 112))));
    labels.forEach((text, i) => {
        if (i % labelStride !== 0 && i !== labels.length - 1) return;
        const x = left + plotWidth * i / Math.max(1, labels.length - 1);
        ctx.fillText(text, x, height - 8);
    });
}
window.addEventListener('resize', renderChart);
// [HOC-CODE] pct(): đổi giá trị thành tỷ lệ % chiều dài thanh tiến độ (nếu HTML có thanh đó).
function pct(selector, value, max) {
    const progress = document.querySelector(selector);
    if (!progress) return;
    progress.style.width = value == null ? '0%' :
        Math.max(2, Math.min(100, Number(value) / max * 100)) + '%';
}
// [HOC-CODE] displayReading(): đưa số đo mới vào 3 ô thông số và cập nhật giờ mới nhất.
function displayReading(data) {
    for (const [id, key] of [['temp', 'temperature'], ['hum', 'humidity'], ['light', 'light']]) {
        document.getElementById(id).textContent = data[key] ?? '--';
    }
    pct('#tempBar', data.temperature, 50);
    pct('#humBar', data.humidity, 100);
    pct('#lightBar', data.light, 1000);
    document.getElementById('updatedTime').textContent = data.time ? 'Cập nhật: ' + fmt(data.time) : 'Chưa có dữ liệu';
}
// [HOC-CODE] plotReading(): thêm mẫu mới vào labels/temps/hums/lights rồi gọi renderChart().
function plotReading(data) {
    if ([data.temperature, data.humidity, data.light].every(value => value == null)) return;
    // [HOC-CODE] push() bổ sung một mốc giờ; 3 dãy số đo tiếp theo dùng cùng vị trí mẫu.
    labels.push(new Date(data.time).toLocaleTimeString('vi-VN', { hour:'2-digit', minute:'2-digit', second:'2-digit' }));
    temps.push(data.temperature == null ? NaN : Number(data.temperature));
    hums.push(data.humidity == null ? NaN : Number(data.humidity));
    lights.push(data.light == null ? NaN : Number(data.light));
    // [HOC-CODE] Giữ tối đa 35 mốc: shift() bỏ phần tử đầu tiên (cũ nhất) của cả 4 mảng.
    if (labels.length > 35) [labels, temps, hums, lights].forEach(list => list.shift());
    renderChart();
}
// [HOC-CODE] setDeviceState(): nhãn mô tả TRẠNG THÁI HIỆN TẠI; nút nổi màu là LỆNH CÓ THỂ BẤM TIẾP.
// Ví dụ: LED đang TẮT => tô nút BẬT (xanh), KHÔNG tô nút TẮT; LED đang BẬT => tô nút TẮT (đỏ).
function setDeviceState(id, state) {
    const label = document.getElementById('deviceState' + id);
    if (!label) return;
    label.textContent = state === 'ON' ? 'Đang bật' : state === 'OFF' ? 'Đang tắt' : 'Chưa xác nhận';
    label.classList.toggle('is-on', state === 'ON');
    label.classList.toggle('is-off', state === 'OFF');
    // [HOC-CODE] Chỉ khi biết trạng thái hiện tại mới làm nổi bật thao tác NGƯỢC LẠI.
    // Chưa xác nhận trạng thái thì cả hai nút giữ màu trung tính, tránh hiểu nhầm.
    const nextCommand = state === 'ON' ? 'OFF' : state === 'OFF' ? 'ON' : null;
    document.querySelectorAll(`[data-device="${id}"]`).forEach(button => {
        const isNextAction = button.dataset.command === nextCommand;
        button.classList.toggle('active-on', isNextAction && nextCommand === 'ON');
        button.classList.toggle('active-off', isNextAction && nextCommand === 'OFF');
    });
}
// [HOC-CODE] showMessage(): ghi thông báo điều khiển vào trang, thêm lớp màu cho thành công/lỗi.
function showMessage(text, type = '') {
    const el = document.getElementById('commandMessage');
    el.textContent = text;
    el.className = 'inline-message ' + type;
}
// [HOC-CODE] setSystemStatus(): đọc deviceOnline, cập nhật trạng thái LED và khóa nút lúc offline/đang gửi.
function setSystemStatus(status) {
    currentSystem = status;
    paintStatus(status);
    const online = Boolean(status.deviceOnline);
    [1, 2, 3].forEach(id => {
        if (status.devices) setDeviceState(id, status.devices[id]);
        document.querySelectorAll(`[data-device="${id}"]`).forEach(button => button.disabled = !online || isSending);
    });
}
// [HOC-CODE] setDevice(): do nút HTML gọi, nhận LED 1-3 và ON/OFF, gửi API để điều khiển.
async function setDevice(deviceId, command) {
    // [HOC-CODE] Nếu đang gửi lệnh khác HOẶC chưa online thì return: dừng ngay, tránh gửi trùng/lỗi.
    if (isSending || !currentSystem.deviceOnline) return;
    // [HOC-CODE] Chỉ nút vừa nhấn hiển thị vòng xoay; các nút còn lại tạm khóa để tránh gửi trùng.
    // data-device chỉ LED số mấy; data-command phân biệt nút ON hay OFF.
    const sendingButton = document.querySelector(`[data-device="${deviceId}"][data-command="${command}"]`);
    const loadingStartedAt = Date.now();
    isSending = true;
    setSystemStatus(currentSystem);
    if (sendingButton) {
        sendingButton.classList.add('is-loading');
        sendingButton.setAttribute('aria-busy', 'true');
    }
    showMessage(`Đang gửi lệnh ${command === 'ON' ? 'bật' : 'tắt'} LED ${deviceId}...`);
    try {
        // [HOC-CODE] fetch POST gửi JSON {deviceId, command} đến API Backend; await chờ HTTP phản hồi.
        const response = await fetch('/api/device/control', {
            method:'POST', headers: { 'Content-Type':'application/json' },
            body: JSON.stringify({ deviceId, command })
        });
        // [HOC-CODE] Chuyển phản hồi từ server thành object JS; response.ok=false thì ném lỗi sang catch.
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Lỗi điều khiển LED');
        showMessage(result.simulated ? `Đã ${command === 'ON' ? 'bật' : 'tắt'} LED ${deviceId} (mô phỏng).` :
            `Đã gửi lệnh cho LED ${deviceId}. Chờ ESP8266 xác nhận.`, result.simulated ? 'good' : '');
    // [HOC-CODE] catch: lỗi mạng/API; finally: tắt vòng xoay cả khi thành công lẫn thất bại.
    } catch (err) { showMessage('Không thể điều khiển LED: ' + err.message, 'error'); }
    finally {
        // [HOC-CODE] Hiện loading ít nhất 600ms để người dùng nhìn thấy; nếu API chậm thì không kéo dài thêm.
        const remainingMs = Math.max(0, 600 - (Date.now() - loadingStartedAt));
        if (remainingMs > 0) await new Promise(resolve => setTimeout(resolve, remainingMs));
        if (sendingButton) {
            sendingButton.classList.remove('is-loading');
            sendingButton.removeAttribute('aria-busy');
        }
        isSending = false;
        setSystemStatus(currentSystem);
    }
}

// [HOC-CODE] Socket.IO: nhận bản ghi mới -> displayReading() và plotReading(), không reload trang.
socket.on('sensor:update', data => { displayReading(data); plotReading(data); });
// [HOC-CODE] Nhận phản hồi trạng thái LED để đổi nhãn/màu nút.
socket.on('device:status', update => {
    setDeviceState(update.deviceId, update.status);
});
// [HOC-CODE] Nhận kết quả lịch sử SUCCESS/FAILED rồi thông báo cho người dùng.
socket.on('action:update', action => {
    if (action.status === 'SUCCESS') showMessage('ESP8266 xác nhận lệnh cho ' + action.device + ' thành công.', 'good');
    if (action.status === 'FAILED') showMessage(`Không có xác nhận cho LED ${action.deviceId}; lệnh thất bại.`, 'error');
});
// [HOC-CODE] Nhận thông tin kết nối mới và cập nhật trạng thái thiết bị.
socket.on('system:update', setSystemStatus);
// [HOC-CODE] Tải đồng thời dữ liệu lịch sử và trạng thái hệ thống khi vừa mở Dashboard.
Promise.all([
    fetch('/api/sensors').then(r => r.json()),
    fetch('/api/system').then(r => r.json())
]).then(([rows, status]) => {
    [labels, temps, hums, lights].forEach(list => list.length = 0);
    // [HOC-CODE] Lấy 35 mẫu mới nhất, đảo thành cũ->mới để vẽ theo chiều thời gian.
    rows.slice(0, 35).reverse().forEach(plotReading);
    if (rows.length) displayReading(rows[0]);
    setSystemStatus(status);
}).catch(err => showMessage('Không tải được dữ liệu từ server: ' + err.message, 'error'));
// [HOC-CODE] Định kỳ lấy trạng thái /api/system để nút không hiển thị trạng thái kết nối cũ.
setInterval(async () => {
    try { setSystemStatus(await (await fetch('/api/system')).json()); }
    catch { /* common.js already displays disconnected status */ }
}, 5000);
