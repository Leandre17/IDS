#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <FastLED.h>
#include <HTTPClient.h> 

// NeoPixel strip data
#define DATA_PIN 4
#define NUM_LEDS 10
#define LED_TYPE WS2812B
CRGB leds[NUM_LEDS];

const char* ssid = "RUC-IOT";
const char* password = "GiHa2638La";

const char* mqttServer = "public.cloud.shiftr.io";
const int mqttPort = 1883;
const char* mqttUser = "public";
const char* mqttPassword = "public";
const char* mqttTopic = "ruc-rejseplanen/trip-progress";

WiFiClient espClient;
PubSubClient client(espClient);

// Function to confirm that internet is available.
bool checkInternetConnectivity() {
  HTTPClient http;
  http.begin("https://www.google.com");
  int httpCode = http.GET();
  if (httpCode > 0) {
    if (httpCode == HTTP_CODE_OK) {
      http.end();
      return true;
    }
  }
  http.end();
  return false;
}

void setup_wifi() {
  Serial.print("Connecting to WiFi...");
  WiFi.begin(ssid, password);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi connected");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\nWiFi connection failed!");
    delay(10000); // Add a longer delay before retrying reconnecting
    ESP.restart(); // Restart the ESP board
  }
}

void callback(char* topic, byte* payload, unsigned int length) {
  payload[length] = '\0';  // Null-terminate payload
  String message = String((char*)payload);
  Serial.print("MQTT Message received: ");
  Serial.println(message);

  DynamicJsonDocument doc(1024); // Adjust size as needed, based on the expected data to receive from MQTT
  DeserializationError error = deserializeJson(doc, message);

  if (error) {
    Serial.print("deserializeJson() failed: ");
    Serial.println(error.c_str());
    return;
  }

  if (doc.containsKey("progress")) {
    double progress = doc["progress"].as<double>(); // Assuming progress is a number between 0 and 100
    Serial.print("Progress: ");
    Serial.println(progress);

    // Calculate the number of LEDs to light up
    int numLedsToLight = (int)(progress / NUM_LEDS);  // Progress divided by 10 gives the number of LEDs to light up

    // Reset the LED strip
    for (int i = 0; i < NUM_LEDS; i++) {
      leds[i] = CRGB::Black;  // Turn off all LEDs initially
    }

    // Light up the corresponding number of LEDs
    for (int i = 0; i < numLedsToLight; i++) {
      leds[i] = CRGB::Green;  // You can change the color as needed
    }

    FastLED.show();  // Update the LED strip
  } else {
    Serial.println("Invalid JSON format (missing progress key)");
  }
}


void reconnect() {
  // Create unique client ID
  String clientIdString = "ESP32Client-" + WiFi.macAddress();
  char *clientId = new char[clientIdString.length() + 1];
  clientIdString.toCharArray(clientId, clientIdString.length() + 1);

  while (!client.connected()) {
    Serial.print("Attempting MQTT connection...");
    if (client.connect(clientId, mqttUser, mqttPassword)) {
      Serial.println("connected");
      client.subscribe(mqttTopic);
    } else {
      Serial.print("failed, rc=");
      Serial.print(client.state());
      Serial.println(" retrying in 5 seconds...");
      delay(5000);
    }
  }

  delete[] clientId;
}

void setup() {
  delay(1000);
  Serial.begin(115200);
  delay(1000);
  Serial.println("Starting ESP32...");
  setup_wifi();
  client.setServer(mqttServer, mqttPort);
  client.setCallback(callback);

  // Initialise FastLED
  FastLED.addLeds<LED_TYPE, DATA_PIN, GRB>(leds, NUM_LEDS);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi disconnected. Reconnecting...");
    setup_wifi();
    return;
  }

  if (!checkInternetConnectivity()){
    Serial.println("WiFi is available but no internet. Reconnecting WiFi.");
    setup_wifi();
    return;
  }

  if (!client.connected()) {
    reconnect();
  }
  client.loop();
}
