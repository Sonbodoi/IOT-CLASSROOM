# IoT Classroom Monitoring (giao diện gốc + tính năng bổ sung)

**Không cần XAMPP, PHP hay MySQL**. Dự án dùng Node.js, Express, Socket.IO, MQTT và file JSON (`data/`) để lưu lịch sử lâu dài qua các lần khởi động lại Node.js. Giao diện màu tối và bố cục ban đầu được giữ lại.

## Chạy nhanh trên Windows — KHÔNG CẦN ESP8266

1. Cài Node.js LTS từ https://nodejs.org/.
2. Giải nén ZIP, vào đúng thư mục `iot-classroom` (có `package.json`).
3. Gõ `cmd` trên thanh địa chỉ File Explorer và Enter.
4. Chạy `npm install` (một lần), sau đó **`npm run demo`**.
5. Mở http://localhost:3000/login.html. Đăng nhập demo bằng thông tin không rỗng.

Có thể nhấp đúp `CHAY_DEMO_WINDOWS.bat` để tự cài thư viện (nếu chưa có) và chạy demo; file `CHAY_ESP8266_WINDOWS.bat` dùng khi có thiết bị thật.

**Chế độ DEMO được gắn nhãn “DEMO · MÔ PHỎNG”**: biểu đồ có dữ liệu mẫu và cập nhật mỗi 3 giây, 3 LED mô phỏng đều có thể bật/tắt, lịch sử và trạng thái được lưu vào `data/demo-store.json`. Không điều khiển LED thật.

## Chạy với ESP8266 THẬT

1. Cần Mosquitto MQTT Broker cùng ESP8266, AHT20, TEMT6000, 3 LED như cấu hình firmware. Cấu hình Wi-Fi và MQTT trong `firmware/esp8266_iot.ino` phù hợp hệ thống riêng trước khi nạp.
2. **Nạp lại bản firmware trong ZIP mới này** bằng Arduino IDE. Firmware mới cho phép bật/tắt **riêng** D5, D6, D7. Firmware cũ chỉ hỗ trợ bật/tắt cả nhóm LED qua topic `/1/control` nên không tương thích với 3 điều khiển độc lập.
3. Chạy Broker tại MQTT URL mong muốn (`mqtt://192.168.137.1:1884` theo cấu hình của bài này). Nếu đổi MQTT URL/user/pass, đặt biến môi trường `MQTT_URL`, `MQTT_USER`, `MQTT_PASS` trước khi chạy.
4. Chạy **`npm start`**; mở http://localhost:3000/login.html.
5. Đợi ESP8266 gửi dữ liệu; nút điều khiển chỉ bật khi server vừa nhận dữ liệu thật và MQTT kết nối. Nếu ESP không phản hồi trạng thái sau 8 giây, lịch sử được ghi **FAILED** thay vì khẳng định điều khiển thành công.

## Các màn hình đã có

- **Dashboard:** biểu đồ theo thời gian, ba thẻ cảm biến và ba điều khiển LED độc lập. LED: 1 = D5, 2 = D6, 3 = D7. Ánh sáng hiển thị theo **lux (ước tính)**, không hiển thị giá trị ADC thô. Với mạch thật, cần hiệu chuẩn hằng số điện áp A0 / điện trở TEMT6000.
- **Dữ liệu cảm biến:** tìm theo loại / giá trị / ngày, đặt lại, chia trang 10/20/50 dòng, xuất CSV, tự làm mới.
- **Lịch sử hoạt động:** lọc LED / ON-OFF / trạng thái / ngày, chia trang, xuất CSV, phân biệt `PENDING`, `SUCCESS`, `FAILED`.
- **Hồ sơ:** giữ hồ sơ cũ, thêm liên kết tải hướng dẫn và Postman Collection. URL Báo cáo PDF/Figma/GitHub không được cung cấp nên hiển thị “Chưa cấu hình” thay vì gán đường dẫn giả.
- **Đăng nhập:** chỉ là *giao diện đăng nhập minh họa*. Server chưa có cơ chế xác thực; **không triển khai công khai lên Internet** khi chưa thêm xác thực/phân quyền HTTPS.

## Các file chính để thuyết trình

| File | Vị trí code quan trọng |
|---|---|
| `server.js` | `mqtt.connect`, `addReading`, `app.get('/api/sensors')`, `app.post('/api/device/control')` |
| `public/js/dashboard.js` | `drawOfflineChart`, `renderChart`, `displayReading`, `setDevice`, `socket.on` |
| `public/js/data.js` | `filterSensors`, `drawSensorTable`, `downloadCsv` |
| `public/js/actions.js` | `filterActions`, `drawActionTable` |
| `public/js/common.js` | hiển thị trạng thái thật / DEMO, xuất CSV, nút đăng xuất |
| `public/css/style.css` | màu, dark theme, bố cục, nút điều khiển, bảng |
| `firmware/esp8266_iot.ino` | `callback`, `setLED`, `publishLEDStatus`, `reconnectMQTT` |

## API và MQTT

- `GET /api/system` — trạng thái kết nối, trạng thái 3 LED, chế độ DEMO/REAL.
- `GET /api/sensors/latest` — số đo mới nhất.
- `GET /api/sensors` — lịch sử cảm biến.
- `GET /api/actions` — lịch sử lệnh điều khiển.
- `POST /api/device/control` — body `{"deviceId":1,"command":"ON"}`; `deviceId` từ 1 đến 3.

MQTT ESP gửi `iot/sensors/data` (JSON: `temperature`, `humidity`, `light`, `lightUnit: "lux"`); ESP nhận các topic `iot/devices/1/control`, `/2/control`, `/3/control`; ESP gửi phản hồi `iot/devices/{id}/status`.

## Lưu trữ

- **Chế độ thật**: `data/store.json`; **mô phỏng**: `data/demo-store.json`.
- Giới hạn 5.000 bản ghi số đo và 2.000 bản ghi điều khiển gần nhất, tránh chiếm nhiều dung lượng.
- Không cần MySQL. Nếu cần triển khai nhiều người dùng/lịch sử lớn, có thể chuyển sang hệ quản trị CSDL sau.
- Muốn làm mới dữ liệu demo: tắt server, xóa `data/demo-store.json`, chạy `npm run demo` lại.
