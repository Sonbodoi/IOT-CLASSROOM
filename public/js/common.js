// Helpers shared across Dashboard, Sensor Data, LED action history and Profile.
// [HOC-CODE] fmt(): hiển thị thời gian dạng NĂM/THÁNG/NGÀY GIỜ:PHÚT:GIÂY.
// Ví dụ 2026/10/15 09:33:59; đọc múi giờ địa phương của thiết bị như định dạng cũ.
// padStart(2, '0') thêm số 0 phía trước nếu tháng/ngày/giờ/phút/giây chỉ có 1 chữ số.
function fmt(time) {
    if (!time) return '--';
    const date = new Date(time);
    if (Number.isNaN(date.getTime())) return '--';
    const pad = number => String(number).padStart(2, '0');
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1); // Tháng JS bắt đầu từ 0, cần cộng 1.
    const day = pad(date.getDate());
    const hour = pad(date.getHours());
    const minute = pad(date.getMinutes());
    const second = pad(date.getSeconds());
    return `${year}/${month}/${day} ${hour}:${minute}:${second}`;
}
// [HOC-CODE] escapeHtml(): đổi &, <, >, nháy thành entity để dữ liệu không bị hiểu thành HTML.
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}
// [HOC-CODE] localDay(): đổi Date thành chuỗi YYYY-MM-DD theo thời gian máy người xem.
function localDay(time) {
    const date = new Date(time);
    if (!Number.isFinite(date.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
// [HOC-CODE] downloadCsv(): thêm BOM UTF-8, escape dấu nháy, tạo Blob và tải file CSV (tiện ích có sẵn).
function downloadCsv(filename, headers, rows) {
    // Proper CSV quoting and UTF-8 BOM make Vietnamese text readable in Excel.
    const quote = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
    const text = '\uFEFF' + [headers, ...rows].map(row => row.map(quote).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = filename; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// [HOC-CODE] logout(): xóa localStorage iot-user và chuyển về login.html.
function logout() {
    localStorage.removeItem('iot-user');
    window.location.href = 'login.html';
}

// [HOC-CODE] paintStatus(): dựa mode/deviceOnline hiển thị DEMO, LIVE hoặc CHƯA KẾT NỐI.
function paintStatus(data) {
    const label = data.mode === 'DEMO' ? 'DEMO · MÔ PHỎNG' : (data.deviceOnline ? 'LIVE · ESP8266' : 'CHƯA KẾT NỐI ESP');
    const cls = data.mode === 'DEMO' ? 'status-demo' : (data.deviceOnline ? '' : 'status-offline');
    for (const id of ['topStatus', 'chartStatus']) {
        const el = document.getElementById(id);
        if (el) { el.textContent = label; el.className = 'live ' + cls; }
    }
    const side = document.getElementById('sideStatus');
    if (side) side.textContent = label;
}
// [HOC-CODE] refreshSystem(): GET /api/system -> paintStatus(); nếu lỗi thì hiển thị offline.
async function refreshSystem() {
    try {
        const response = await fetch('/api/system', { cache: 'no-store' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        paintStatus(await response.json());
    } catch {
        paintStatus({ mode: 'REAL', deviceOnline: false });
    }
}
refreshSystem();
setInterval(refreshSystem, 5000);


// Number of visible table rows, based on real space between the table header and pager.
// Desktop tables paginate instead of forcing the whole page to scroll.
// [HOC-CODE] renderPageNumbers(): tạo nút số trang gần trang hiện tại; nhấn gọi selectPage(n).
function renderPageNumbers(elementId, totalPages, currentPage, selectPage) {
    const panel = document.getElementById(elementId);
    if (!panel) return;
    panel.textContent = '';
    const begin = Math.max(1, Math.min(currentPage - 1, totalPages - 2));
    const last = Math.min(totalPages, begin + 2);
    for (let n = begin; n <= last; n++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = String(n);
        btn.className = 'page-btn' + (n === currentPage ? ' selected' : '');
        btn.setAttribute('aria-label', 'Trang ' + n);
        if (n === currentPage) btn.setAttribute('aria-current', 'page');
        btn.addEventListener('click', () => selectPage(n));
        panel.appendChild(btn);
    }
}
// [HOC-CODE] pageSizeForScreen(): tính chiều cao bảng trừ header, chia chiều cao mỗi hàng, chọn số hàng vừa màn hình.
function pageSizeForScreen(selectElement, tableBody) {
    const desired = selectElement.value === 'auto' ? Infinity : Number(selectElement.value);
    const desktop = window.matchMedia('(min-width: 900px) and (min-height: 580px)').matches;
    if (!desktop) return Number.isFinite(desired) ? desired : 10;
    const container = tableBody.closest('.table-scroll');
    const header = container.querySelector('thead');
    const available = container.clientHeight - (header?.getBoundingClientRect().height || 36) - 5;
    const visibleRow = tableBody.querySelector('tr');
    const rowHeight = Math.max(48, visibleRow?.getBoundingClientRect().height || 0); // includes badge height and borders
    const capacity = Math.max(1, Math.floor(available / rowHeight));
    return Number.isFinite(desired) ? Math.min(desired, capacity) : capacity;
}

// A single selection pill follows the chosen page, including across HTML navigations.
// [HOC-CODE] initNavigation(): IIFE tự chạy, xác định trang, đổi active và di chuyển vệt xanh sang mục được nhấn.
(function initNavigation() {
    const nav = document.querySelector('.nav');
    if (!nav) return;
    const links = Array.from(nav.querySelectorAll('a[href]'));
    const currentPath = window.location.pathname.split('/').pop() || nav.querySelector('a.active')?.getAttribute('href') || 'index.html';
    const matched = links.findIndex(a => a.getAttribute('href') === currentPath);
    const current = matched >= 0 ? matched : Math.max(0, links.findIndex(a => a.classList.contains('active')));
    let remembered = null;
    try { remembered = sessionStorage.getItem('iot-nav-from'); } catch {}
    const previous = remembered === null ? NaN : Number(remembered);
    const start = Number.isInteger(previous) && previous >= 0 && previous < links.length ? previous : current;
    // [HOC-CODE] Đổi biến CSS --nav-position: vị trí nền xanh của menu.
    nav.style.setProperty('--nav-position', String(start));
    links.forEach((link, i) => {
        link.classList.toggle('active', i === current);
        if (i === current) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
        // [HOC-CODE] Click menu -> hiệu ứng 190ms -> window.location.href chuyển sang trang tương ứng.
        link.addEventListener('click', (event) => {
            if (i === current || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
            event.preventDefault();
            nav.style.setProperty('--nav-position', String(i));
            links.forEach((a, k) => a.classList.toggle('active', k === i));
            try { sessionStorage.setItem('iot-nav-from', String(i)); } catch {}
            window.setTimeout(() => { window.location.href = link.href; }, 190);
        });
    });
    if (remembered !== null) {
        try { sessionStorage.removeItem('iot-nav-from'); } catch {}
        requestAnimationFrame(() => requestAnimationFrame(() => nav.style.setProperty('--nav-position', String(current))));
    }
})();
