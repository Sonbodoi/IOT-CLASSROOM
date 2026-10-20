#include <ESP8266WiFi.h>
#include <PubSubClient.h>
#include <Wire.h>
#include <Adafruit_AHTX0.h>

// =====================================================
// 1. KHAI BAO CHAN
// =====================================================

// AHT20
#define SDA_PIN D2
#define SCL_PIN D1

// TEMT6000
#define LIGHT_PIN A0
// TEMT6000 lux estimate: these depend on your board's A0 divider and the
// sensor module's resistor. Configure/calibrate for your actual hardware.
// Example assumes external A0 0..3.3V (NodeMCU-style), 10k load resistance.
const float LIGHT_ADC_REF_V = 3.3f;
const float LIGHT_LOAD_OHMS = 10000.0f;
const float LIGHT_UA_PER_LUX = 0.5f;  // TEMT6000 typical 50uA at 100 lux.
  // [HOC-CODE] adcToLux(): lấy ADC của TEMT6000 -> đổi điện áp -> dòng quang -> lux ƯỚC TÍNH, phải hiệu chuẩn.
float adcToLux(int adcValue) {
  float v = adcValue * LIGHT_ADC_REF_V / 1023.0f;
  float microamps = (v / LIGHT_LOAD_OHMS) * 1000000.0f;
  return microamps / LIGHT_UA_PER_LUX;
}

// 3 LED
#define LED_TEMP  D5      // LED nhiet do
#define LED_HUM   D6      // LED do am
#define LED_LIGHT D7      // LED anh sang


// =====================================================
// 2. WIFI
// =====================================================

const char* ssid = "SONBODOI 1381";
const char* password = "#0u4886G";


// =====================================================
// 3. MQTT BROKER
// =====================================================

const char* mqtt_server = "192.168.137.1";
const int mqtt_port = 1884;

const char* mqtt_user = "iotuser";
const char* mqtt_password = "123456";


// =====================================================
// 4. MQTT TOPICS
// Moi LED co topic control/status rieng. Wildcard + cho phep
// subscribe 3 topic iot/devices/1-3/control.
// =====================================================
const char* sensor_topic  = "iot/sensors/data";
const char* control_topic = "iot/devices/+/control";

// =====================================================
// 5. OBJECT
// =====================================================

WiFiClient espClient;
PubSubClient client(espClient);

Adafruit_AHTX0 aht;

bool ahtOK = false;


// =====================================================
// 6. DIEU KHIEN DOC LAP 3 LED D5, D6, D7
// 1 -> D5 (nhiet do), 2 -> D6 (do am), 3 -> D7 (anh sang)
// =====================================================
const int ledPins[3] = { LED_TEMP, LED_HUM, LED_LIGHT };

  // [HOC-CODE] publishLEDStatus(): gửi MQTT status ON/OFF của LED về server theo topic riêng.
void publishLEDStatus(int deviceId, bool on) {
  if (!client.connected()) return;
  char topic[40];
  snprintf(topic, sizeof(topic), "iot/devices/%d/status", deviceId);
  // Retained status giup Backend vua reconnect van nhan duoc trang thai gan nhat.
  client.publish(topic, on ? "{\"status\":\"ON\"}" : "{\"status\":\"OFF\"}", true);
}

  // [HOC-CODE] setLED(): kiểm tra ID 1..3 -> digitalWrite() đặt GPIO D5/D6/D7 -> publishLEDStatus().
void setLED(int deviceId, bool on) {
  if (deviceId < 1 || deviceId > 3) return;
  digitalWrite(ledPins[deviceId - 1], on ? HIGH : LOW);
  bool actualOn = digitalRead(ledPins[deviceId - 1]) == HIGH;
  Serial.printf("LED %d: %s\n", deviceId, actualOn ? "ON" : "OFF");
  publishLEDStatus(deviceId, actualOn);
}

// =====================================================
// 8. KET NOI WIFI
// =====================================================

  // [HOC-CODE] setup_wifi(): kết nối Wi-Fi đã cấu hình, thử tối đa 40 lần mỗi 500ms rồi báo IP/lỗi qua Serial.
void setup_wifi() {

  Serial.println();
  Serial.println("============================");
  Serial.println("WIFI");
  Serial.println("============================");

  Serial.print("Connecting to: ");
  Serial.println(ssid);

  WiFi.mode(WIFI_STA);

  WiFi.begin(
    ssid,
    password
  );

  int count = 0;

  while (
    WiFi.status() != WL_CONNECTED &&
    count < 40
  ) {

    delay(500);

    Serial.print(".");

    count++;
  }

  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {

    Serial.println("WIFI CONNECTED");

    Serial.print("ESP IP: ");
    Serial.println(
      WiFi.localIP()
    );

    Serial.print("Gateway: ");
    Serial.println(
      WiFi.gatewayIP()
    );

  } else {

    Serial.println("WIFI FAILED");

    Serial.print("WiFi status: ");
    Serial.println(
      WiFi.status()
    );
  }
}


// =====================================================
// 9. CALLBACK: nhan MQTT /iot/devices/{1,2,3}/control
// =====================================================
  // [HOC-CODE] callback(): nhận MQTT -> tách LED ID từ topic -> nếu ON/OFF gọi setLED(), lệnh khác bỏ qua.
void callback(char* topic, byte* payload, unsigned int length) {
  String message = "";
  for (unsigned int i = 0; i < length; i++) message += (char)payload[i];
  message.trim();
  message.toUpperCase();

  int deviceId = 0;
  if (sscanf(topic, "iot/devices/%d/control", &deviceId) != 1 ||
      deviceId < 1 || deviceId > 3) {
    Serial.println("UNKNOWN TOPIC");
    return;
  }

  Serial.printf("MQTT %s -> %s\n", topic, message.c_str());
  if (message == "ON") setLED(deviceId, true);
  else if (message == "OFF") setLED(deviceId, false);
  else Serial.println("UNKNOWN COMMAND");
}

// =====================================================
// 10. KET NOI MQTT
// =====================================================

  // [HOC-CODE] reconnectMQTT(): chỉ nối MQTT sau khi có Wi-Fi; subscribe iot/devices/+/control để nhận 3 LED.
void reconnectMQTT() {

  if (
    WiFi.status() != WL_CONNECTED
  ) {

    return;
  }

  if (client.connected()) {

    return;
  }

  Serial.println();
  Serial.println("============================");
  Serial.println("MQTT");
  Serial.println("============================");

  Serial.print("Broker: ");
  Serial.print(mqtt_server);
  Serial.print(":");
  Serial.println(mqtt_port);

  Serial.print(
    "Connecting MQTT... "
  );

  String clientId =
    "ESP8266-";

  clientId +=
    String(
      ESP.getChipId(),
      HEX
    );


  // ===================================================
  // KET NOI BROKER
  // ===================================================

  if (
    client.connect(
      clientId.c_str(),
      mqtt_user,
      mqtt_password
    )
  ) {

    Serial.println("CONNECTED");


    // =================================================
    // SUBSCRIBE TOPIC DIEU KHIEN
    //
    // DAY LA LENH DANG KY NHAN DU LIEU
    // =================================================

    bool subscribeOK =
      client.subscribe(
        control_topic
      );

    Serial.print("Subscribe ");
    Serial.print(control_topic);
    Serial.print(" -> ");

    if (subscribeOK) {

      Serial.println("OK");

    } else {

      Serial.println("FAILED");
    }


    // =================================================
    // GUI TRANG THAI ONLINE
    // =================================================

    // Dong bo trang thai hien tai cua tung LED cho Dashboard.
    for (int id = 1; id <= 3; id++) {
      publishLEDStatus(id, digitalRead(ledPins[id - 1]) == HIGH);
    }

  } else {

    Serial.print(
      "FAILED rc="
    );

    Serial.println(
      client.state()
    );
  }
}


// =====================================================
// 11. SETUP
// =====================================================

  // [HOC-CODE] setup(): chỉ chạy khi ESP8266 khởi động; cấu hình GPIO, cảm biến AHT20, Wi-Fi và MQTT.
void setup() {

  Serial.begin(115200);

  delay(1000);

  Serial.println();
  Serial.println("============================");
  Serial.println("ESP8266 IOT SYSTEM");
  Serial.println("============================");


  // ===================================================
  // KHAI BAO 3 LED
  // ===================================================

  pinMode(
    LED_TEMP,
    OUTPUT
  );

  pinMode(
    LED_HUM,
    OUTPUT
  );

  pinMode(
    LED_LIGHT,
    OUTPUT
  );


  // Tat LED luc khoi dong
  digitalWrite(
    LED_TEMP,
    LOW
  );

  digitalWrite(
    LED_HUM,
    LOW
  );

  digitalWrite(
    LED_LIGHT,
    LOW
  );


  Serial.println(
    "D5 -> Temperature LED"
  );

  Serial.println(
    "D6 -> Humidity LED"
  );

  Serial.println(
    "D7 -> Light LED"
  );


  // ===================================================
  // TEST 3 LED KHI BAT ESP
  // ===================================================

  Serial.println();
  Serial.println("Testing LEDs...");


  // Test D5
  digitalWrite(
    LED_TEMP,
    HIGH
  );

  delay(500);

  digitalWrite(
    LED_TEMP,
    LOW
  );


  // Test D6
  digitalWrite(
    LED_HUM,
    HIGH
  );

  delay(500);

  digitalWrite(
    LED_HUM,
    LOW
  );


  // Test D7
  digitalWrite(
    LED_LIGHT,
    HIGH
  );

  delay(500);

  digitalWrite(
    LED_LIGHT,
    LOW
  );


  Serial.println(
    "LED TEST FINISHED"
  );


  // ===================================================
  // I2C
  // ===================================================

  Wire.begin(
    SDA_PIN,
    SCL_PIN
  );


  // ===================================================
  // AHT20
  // ===================================================

  delay(1000);

  Serial.print("AHT20: ");

  if (aht.begin(&Wire)) {

    ahtOK = true;

    Serial.println("OK");

  } else {

    ahtOK = false;

    Serial.println(
      "NOT FOUND"
    );
  }


  // ===================================================
  // TEMT6000
  // ===================================================

  pinMode(
    LIGHT_PIN,
    INPUT
  );

  Serial.println(
    "TEMT6000 -> A0"
  );


  // ===================================================
  // WIFI
  // ===================================================

  setup_wifi();


  // ===================================================
  // MQTT BROKER
  // ===================================================

  client.setServer(
    mqtt_server,
    mqtt_port
  );


  // ===================================================
  // DANG KY HAM NHAN PAYLOAD
  // ===================================================

  client.setCallback(
    callback
  );


  Serial.println();
  Serial.println(
    "SETUP FINISHED"
  );
}


// =====================================================
// 12. LOOP
// =====================================================

  // [HOC-CODE] loop(): chạy liên tục; đảm bảo Wi-Fi/MQTT, client.loop() nhận lệnh và gửi cảm biến mỗi 3 giây.
void loop() {


  // ===================================================
  // WIFI
  // ===================================================

  if (
    WiFi.status() != WL_CONNECTED
  ) {

    Serial.println(
      "WiFi disconnected..."
    );

    setup_wifi();

    delay(1000);

    return;
  }


  // ===================================================
  // MQTT
  // ===================================================

  if (!client.connected()) {

    reconnectMQTT();

    if (!client.connected()) {

      delay(3000);

      return;
    }
  }


  // ===================================================
  // NHAN PAYLOAD MQTT
  // ===================================================

    // [HOC-CODE] PubSubClient xử lý các tin MQTT đến; lệnh điều khiển sẽ gọi callback().
  client.loop();


  // ===================================================
  // GUI SENSOR MOI 3 GIAY
  // ===================================================

  static unsigned long lastSend = 0;

  if (
      // [HOC-CODE] Cứ ít nhất 3000ms mới đọc/gửi một mẫu; không delay liên tục toàn bộ vòng lặp.
    millis() - lastSend >= 3000
  ) {

    lastSend = millis();


    float temperature = 0;
    float humidity = 0;

    int lightRaw = 0;
    float lightLux = 0;


    // =================================================
    // 13. DOC AHT20
    // =================================================

    if (ahtOK) {

      sensors_event_t humidityEvent;
      sensors_event_t temperatureEvent;

        // [HOC-CODE] AHT20 trả sự kiện đo nhiệt độ và độ ẩm.
      aht.getEvent(
        &humidityEvent,
        &temperatureEvent
      );

      temperature =
        temperatureEvent.temperature;

      humidity =
        humidityEvent.relative_humidity;
    }


    // =================================================
    // 14. DOC TEMT6000
    // =================================================

    lightRaw =
        // [HOC-CODE] Đọc ADC từ chân A0 của TEMT6000, tiếp theo adcToLux() tính lux ước tính.
      analogRead(
        LIGHT_PIN
      );
      // [HOC-CODE] Lấy giá trị ánh sáng đơn vị lux từ ADC vừa đo.
    lightLux = adcToLux(lightRaw);


    // =================================================
    // 15. TAO JSON PAYLOAD
    // =================================================

      // [HOC-CODE] Ghép JSON với temperature/humidity/light/lightUnit để Backend parse JSON.
    String payload = "{";

    payload +=
      "\"temperature\":";

    payload +=
      String(
        temperature,
        1
      );

    payload +=
      ",\"humidity\":";

    payload +=
      String(
        humidity,
        1
      );

    payload +=
      ",\"light\":";

    payload +=
      String(
        lightLux, 1
      );
    payload += ",\"lightUnit\":\"lux\"";

    payload += "}";


    // =================================================
    // SERIAL
    // =================================================

    Serial.println();

    Serial.print(
      "Temperature: "
    );

    Serial.print(
      temperature,
      2
    );

    Serial.println(" C");


    Serial.print(
      "Humidity: "
    );

    Serial.print(
      humidity,
      2
    );

    Serial.println(" %");


    Serial.print(
      "TEMT6000 Light: "
    );

    Serial.print(lightLux, 1);
    Serial.print(" lux (ADC: ");
    Serial.print(lightRaw);
    Serial.println(")");


    Serial.print(
      "Publish -> "
    );

    Serial.println(
      payload
    );


    // =================================================
    // 16. PUBLISH SENSOR DATA
    // =================================================

      // [HOC-CODE] Gửi JSON qua MQTT topic iot/sensors/data; publishOK chỉ báo broker chấp nhận gửi.
    bool publishOK =
      client.publish(
        sensor_topic,
        payload.c_str()
      );


    if (publishOK) {

      Serial.println(
        "Publish sensor: OK"
      );

    } else {

      Serial.println(
        "Publish sensor: FAILED"
      );
    }


    Serial.println(
      "----------------------------"
    );
  }
}