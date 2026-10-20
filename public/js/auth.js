// Xử lý form đăng nhập trong phiên bản demo.
// [HOC-CODE] login(): ĐĂNG NHẬP MINH HỌA; preventDefault -> localStorage.setItem -> sang Dashboard, KHÔNG xác thực mật khẩu ở server.
function login(e) {
    e.preventDefault();
    localStorage.setItem('iot-user', 'Lê Hồng Sơn');
    location = 'index.html';
}
