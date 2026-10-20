# IoT Classroom Monitoring (giao diện theo 4 ảnh mẫu)

**Không cần XAMPP, PHP hay MySQL**. Dự án dùng Node.js, Express, Socket.IO, MQTT và file JSON (`data/`) để lưu lịch sử lâu dài qua các lần khởi động lại Node.js. Giao diện màu tối được giữ lại, Dashboard bố trí ba ô cảm biến ở trên, biểu đồ bên trái và 3 LED bên phải.

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

- **Dashboard:** ba giá trị cảm biến ở hàng trên, một biểu đồ thời gian thực bên trái và ba LED ở cột bên phải. LED: 1 = D5, 2 = D6, 3 = D7. Ánh sáng hiển thị theo **lux (ước tính)**; ESP8266 quy đổi ADC từ TEMT6000 dựa trên cấu hình điện áp A0, điện trở của module và độ nhạy cảm biến. Cần hiệu chuẩn để đo lux chính xác.
- **Dữ liệu cảm biến:** tìm theo loại và giá trị, đặt lại, chọn số dòng, phân trang, tự làm mới.
- **Lịch sử hoạt động:** lọc LED / ON-OFF / trạng thái / thời gian, chọn số dòng, chia trang, phân biệt `PENDING`, `SUCCESS`, `FAILED`.
- **Hồ sơ:** thông tin cá nhân và 4 mục Báo cáo PDF, Postman, Figma, GitHub. Chỉ Postman có đường dẫn thật; các liên kết chưa được cung cấp không thể nhấn.
- **Đăng nhập:** chỉ là *giao diện đăng nhập minh họa*. Server chưa có cơ chế xác thực; **không triển khai công khai lên Internet** khi chưa thêm xác thực/phân quyền HTTPS.

## Các file chính để thuyết trình

| File | Vị trí code quan trọng |
|---|---|
| `server.js` | `mqtt.connect`, `addReading`, `app.get('/api/sensors')`, `app.post('/api/device/control')` |
| `public/js/dashboard.js` | `drawOfflineChart`, `renderChart`, `displayReading`, `setDevice`, `socket.on` |
| `public/js/data.js` | `filterSensors`, `drawSensorTable` |
| `public/js/actions.js` | `filterActions`, `drawActionTable` |
| `public/js/common.js` | trạng thái thật / DEMO, đánh dấu mục menu đang chọn và nút đăng xuất |
| `public/css/style.css` | màu, dark theme, bố cục, nút điều khiển, thanh chọn trang, bảng |
| `firmware/esp8266_iot.ino` | `callback`, `setLED`, `publishLEDStatus`, `reconnectMQTT` |

## Cảm biến ánh sáng TEMT6000 — lux

- Trang Dashboard, biểu đồ và Dữ liệu cảm biến hiển thị **lux**.
- Firmware mới gửi MQTT JSON dạng `{"temperature":28.5,"humidity":71,"light":350.4,"lightUnit":"lux"}`.
- Backend cũng nhận firmware cũ chỉ có `light` (ADC 0–1023), tự quy đổi sang lux và chuyển lịch sử cũ lúc đọc file JSON. Không cần xóa dữ liệu.
- Quy đổi mặc định chỉ **ước tính**: `lux ≈ (ADC / 1023 × 3.3 / 10000 × 1000000) / 0.5`; dựa trên ví dụ NodeMCU A0 0–3.3 V và module TEMT6000 với tải 10 kΩ. Hãy kiểm tra loại board, mạch chia áp, điện trở thực và hiệu chuẩn với lux kế trước khi dùng số đo chính xác. Khi đổi các hằng số hãy sửa cả `firmware/esp8266_iot.ino` và `server.js` (cho dữ liệu ADC của firmware cũ).

## API và MQTT

- `GET /api/system` — trạng thái kết nối, trạng thái 3 LED, chế độ DEMO/REAL.
- `GET /api/sensors/latest` — số đo mới nhất.
- `GET /api/sensors` — lịch sử cảm biến.
- `GET /api/actions` — lịch sử bật/tắt LED.
- `POST /api/device/control` — body `{"deviceId":1,"command":"ON"}`; `deviceId` từ 1 đến 3.

MQTT ESP gửi `iot/sensors/data` (JSON: `temperature`, `humidity`, `light`, `lightUnit: "lux"`); ESP nhận các topic `iot/devices/1/control`, `/2/control`, `/3/control`; ESP gửi phản hồi `iot/devices/{id}/status`.

## Lưu trữ

- **Chế độ thật**: `data/store.json`; **mô phỏng**: `data/demo-store.json`.
- Giới hạn 5.000 bản ghi số đo và 2.000 bản ghi điều khiển gần nhất, tránh chiếm nhiều dung lượng.
- Không cần MySQL. Nếu cần triển khai nhiều người dùng/lịch sử lớn, có thể chuyển sang hệ quản trị CSDL sau.
- Muốn làm mới dữ liệu demo: tắt server, xóa `data/demo-store.json`, chạy `npm run demo` lại.


## Giao diện vừa màn hình (bản cập nhật)

- Trên màn hình máy tính rộng từ 900 px và cao từ 580 px, Dashboard, Dữ liệu cảm biến, Lịch sử hoạt động và Hồ sơ cá nhân được xếp trong chiều cao cửa sổ, không cần cuộn trang.
- Số dòng bảng tự động vừa với chiều cao màn hình; dùng nút chuyển trang để xem dữ liệu còn lại, không ẩn hay xóa dữ liệu.
- Nếu đặt giới hạn 5/10/20, số dòng thực tế vẫn được giới hạn theo chiều cao màn hình.
- Trên điện thoại hoặc cửa sổ quá nhỏ, giao diện vẫn cho phép cuộn để đảm bảo đủ nút thao tác.
- Xem thêm HUONG_DAN_MAN_HINH.md.
