// Search, filter, paginate and refresh LED action records.
const actionUI = {
    rows: document.getElementById('actionRows'),
    device: document.getElementById('actionDevice'),
    command: document.getElementById('actionCommand'),
    status: document.getElementById('actionStatus'),
    date: document.getElementById('actionDate'),
    size: document.getElementById('actionPageSize')
};
let actionRecords = [];
let actionFiltered = [];
let actionPage = 1;
let actionCriteria = { device: 'all', command: 'all', status: 'all', date: '' };
// [HOC-CODE] ledNumber(): đọc deviceId; nếu bản ghi cũ ghi Device/Thiết bị thì tách số LED từ tên.
function ledNumber(action) {
    const id = Number(action.deviceId);
    if ([1, 2, 3].includes(id)) return id;
    const oldName = String(action.device || '').match(/(?:LED|Device|Thiết bị)\s*([123])$/i);
    return oldName ? Number(oldName[1]) : null;
}
// [HOC-CODE] ledLabel(): hiển thị nhất quán LED 1/2/3 ở bảng lịch sử.
function ledLabel(action) {
    const id = ledNumber(action);
    return id ? `LED ${id}` : '—';
}
// [HOC-CODE] Đổi SUCCESS/FAILED/PENDING thành nhãn tiếng Việt trên bảng.
const statusNames = { SUCCESS: 'THÀNH CÔNG', FAILED: 'THẤT BẠI', PENDING: 'ĐANG XỬ LÝ' };
// [HOC-CODE] filterActions(): áp đồng thời LED + ON/OFF + trạng thái + thời gian -> sort mới nhất -> vẽ bảng.
function filterActions() {
    const f = actionCriteria;
    // [HOC-CODE] Mỗi điều kiện `all` là bỏ lọc loại đó; các điều kiện nối && phải cùng thỏa.
    actionFiltered = actionRecords.filter(r =>
        (f.device === 'all' || ledNumber(r) === Number(f.device)) &&
        (f.command === 'all' || r.command === f.command) &&
        (f.status === 'all' || r.status === f.status) &&
        (f.date === '' || fmt(r.time).toLowerCase().includes(f.date.toLowerCase()) || String(r.time).toLowerCase().includes(f.date.toLowerCase()))
    ).sort((a, b) => new Date(b.time) - new Date(a.time));
    drawActionTable();
}
// [HOC-CODE] drawActionTable(): tính số trang -> slice() -> map() hàng -> tạo nút phân trang.
function drawActionTable() {
    const pageSize = pageSizeForScreen(actionUI.size, actionUI.rows);
    const totalPages = Math.max(1, Math.ceil(actionFiltered.length / pageSize));
    actionPage = Math.min(actionPage, totalPages);
    const start = (actionPage - 1) * pageSize;
    const view = actionFiltered.slice(start, start + pageSize);
    actionUI.rows.innerHTML = view.length ? view.map(row => `
        <tr><td>${escapeHtml(row.id)}</td><td>${escapeHtml(ledLabel(row))}</td>
        <td><b>${escapeHtml(row.action)}</b></td>
        <td><span class="status-pill status-${escapeHtml(row.status)}">${escapeHtml(statusNames[row.status] || row.status)}</span></td>
        <td>${escapeHtml(fmt(row.time))}</td><td>${escapeHtml(row.user)}</td></tr>
    `).join('') : '<tr><td colspan="6" class="empty">Chưa có lịch sử LED phù hợp.</td></tr>';
    document.getElementById('actionSummary').textContent = actionFiltered.length ?
        `Hiển thị ${start + 1}–${Math.min(start + pageSize, actionFiltered.length)} trong ${actionFiltered.length} dòng` : '0 dòng dữ liệu';
    renderPageNumbers('actionPageNumbers', totalPages, actionPage, n => { actionPage = n; drawActionTable(); });
    document.getElementById('actionPrev').disabled = actionPage <= 1;
    document.getElementById('actionNext').disabled = actionPage >= totalPages;
}
// [HOC-CODE] loadActions(): GET /api/actions -> response.json() -> lọc/hiển thị; lỗi thì thông báo.
async function loadActions() {
    try {
        const response = await fetch('/api/actions', { cache: 'no-store' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        actionRecords = await response.json();
        filterActions();
    } catch { actionUI.rows.innerHTML = '<tr><td colspan="6" class="empty">Không thể tải nhật ký. Kiểm tra Node.js server.</td></tr>'; }
}
// [HOC-CODE] TÌM KIẾM LỊCH SỬ: đọc 4 tiêu chí từ form và gọi filterActions().
document.getElementById('actionFilter').addEventListener('submit', event => {
    event.preventDefault(); actionPage = 1;
    actionCriteria = {
        device: actionUI.device.value, command: actionUI.command.value,
        status: actionUI.status.value, date: actionUI.date.value
    };
    filterActions();
});
// [HOC-CODE] ĐẶT LẠI: reset() về toàn bộ LED, trạng thái và ngày, trở về trang 1.
document.getElementById('resetActions').addEventListener('click', () => {
    document.getElementById('actionFilter').reset(); actionPage = 1;
    actionCriteria = { device: 'all', command: 'all', status: 'all', date: '' };
    filterActions();
});
// [HOC-CODE] Đổi số dòng -> vẽ lại trang đầu.
actionUI.size.onchange = () => { actionPage = 1; drawActionTable(); };
document.getElementById('actionPrev').onclick = () => { actionPage--; drawActionTable(); };
document.getElementById('actionNext').onclick = () => { actionPage++; drawActionTable(); };
loadActions();
// [HOC-CODE] Tải mới lịch sử LED mỗi 4 giây, không cần F5.
setInterval(loadActions, 4000);

// Reflow the currently visible page if the user resizes the desktop window.
let resizePending = false;
// [HOC-CODE] Đổi kích thước cửa sổ -> tính lại số hàng vừa màn hình.
window.addEventListener('resize', () => {
    if (resizePending) return;
    resizePending = true;
    requestAnimationFrame(() => {
        resizePending = false;
        drawActionTable();
    });
});
