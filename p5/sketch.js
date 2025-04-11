let originInput, destinationInput, dateInput, timeInput, searchButton, timeButton;
let resultText = "", timeText = "";
let Arrival, departure;
let mqttClient;
let messageReceived;
let randomId = "p5js_client_" + Math.random().toString(36).substr(2, 5);


function setup() {
  createCanvas(400, 400);
  textSize(16);

  let yOffset = 30;

  originInput = createLabelAndInput("Origin ID:", 20, yOffset, "8600626");
  destinationInput = createLabelAndInput("Destination ID:", 20, yOffset + 30, "8600617");
  dateInput = createLabelAndInput("Date:", 20, yOffset + 60, getTodayDate());
  timeInput = createLabelAndInput("Time:", 20, yOffset + 90, getCurrentTime());

  searchButton = createButton("Search Trip");
  searchButton.position(20, yOffset + 120);
  searchButton.mousePressed(fetchTrip);

  timeButton = createButton("Calculate Trip Progress");
  timeButton.position(160, yOffset + 120);
  timeButton.mousePressed(() => {
    calculateTime(`${getTodayDate()}T${Arrival}`, `${getTodayDate()}T${departure}`);
  });
  
  // Setup MQTT connection when the sketch starts
  setupMQTT();
}

function createLabelAndInput(labelText, x, y, defaultValue) {
  let label = createSpan(labelText);
  label.position(x, y);
  let inputVar = createInput(defaultValue);
  inputVar.position(x + 150, y);
  return inputVar;
}

function draw() {
  background(220);
  text(resultText, 20, 190, 360, 100);
  text(timeText, 20, 310, 360, 60);
}

function fetchTrip() {
  let originId = originInput.value();
  let destId = destinationInput.value();
  let date = dateInput.value();
  let time = timeInput.value();

  let url = `https://www.rejseplanen.dk/api/trip?originId=${originId}&destId=${destId}&date=${date}&time=${time}&format=json&accessId=52251f40-43dc-4794-ada3-c60e7e0efed3&lang=en&numB=0&numF=1&rtMode=REALTIME&tariff=0`;

  console.log("API Request URL:", url);
  loadJSON(url, displayTrip, handleError);
}

function displayTrip(data) {
  if (data.Trip && data.Trip.length > 0) {
    let trip = data.Trip[0];
    let origin = trip.LegList.Leg[0].Origin;
    let destination = trip.LegList.Leg[trip.LegList.Leg.length - 1].Destination;
    let start = origin.time;
    let end = destination.time;
    Arrival = start;
    departure = end;
    let platformStart = origin.platform ? origin.platform.text : "N/A";
    let platformEnd = destination.platform ? destination.platform.text : "N/A";
    let notes = trip.LegList.Leg[0].Notes ? trip.LegList.Leg[0].Notes.Note.map(n => n.txtN).join(", ") : "No additional info";
    resultText = `Trip found!\nDeparture: ${start} (Platform ${platformStart})\nArrival: ${end} (Platform ${platformEnd})\nNotes: ${notes}`;

    // Start interval to calculate time every 30s
    if (window.timeInterval) clearInterval(window.timeInterval);
    calculateTime(`${getTodayDate()}T${Arrival}`, `${getTodayDate()}T${departure}`);
    window.timeInterval = setInterval(() => {
      calculateTime(`${getTodayDate()}T${Arrival}`, `${getTodayDate()}T${departure}`);
    }, 30000);
  } else {
    resultText = "No trips found.";
  }
}

function calculateTime(departureTime, arrivalTime) {
  let now = new Date();
  let start = new Date(departureTime);
  let end = new Date(arrivalTime);
  let percentCompleted = 0;

  if (now < start) {
    let timeUntilStart = Math.floor((start - now) / 60000);
    timeText = `Trip has not started. Starts in ${timeUntilStart} minutes.`;
  } else if (now >= start && now <= end) {
    let totalTripDuration = end - start;
    let timeElapsed = now - start;
    let timeLeft = Math.floor((end - now) / 60000);
    percentCompleted = ((timeElapsed / totalTripDuration) * 100).toFixed(1);
    timeText = `Trip in progress.\nTime left: ${timeLeft} minutes.\nProgress: ${percentCompleted}%`;
  } else {
    timeText = "Trip has ended.";
    percentCompleted = 100;
  }
  
  // Send trip progress percentage via MQTT
  sendInfo(percentCompleted);
  console.log(timeText);
}

function handleError() {
  resultText = "Error fetching trip data.";
}

function getTodayDate() {
  let today = new Date();
  let yyyy = today.getFullYear();
  let mm = String(today.getMonth() + 1).padStart(2, '0');
  let dd = String(today.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getCurrentTime() {
  let now = new Date();
  let hh = String(now.getHours()).padStart(2, '0');
  let mm = String(now.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function sendInfo(progress) {
  // Send the progress information via MQTT
  if (mqttClient && mqttClient.connected) {
    const tripInfo = {
      progress: progress,
      origin: originInput.value(),
      destination: destinationInput.value(),
      departureTime: Arrival,
      arrivalTime: departure,
      clientId: randomId
    };
    
    // Publish to the trip progress topic
    mqttClient.publish("ruc-rejseplanen/trip-progress", JSON.stringify(tripInfo));
    console.log("Published trip progress:", progress + "%");
  } else {
    console.warn("MQTT client not connected. Cannot send progress data.");
  }
}

function setupMQTT() {
  let broker = "wss://public.cloud.shiftr.io:443";

  mqttClient = mqtt.connect(broker, {
    clientId: randomId,
    username: "public",
    password: "public",
  });


  mqttClient.on("connect", onConnect);
  mqttClient.on("message", onMessageArrived);
  mqttClient.on("error", onFailure);
  mqttClient.on("close", onConnectionLost);
}

function onConnect() {
  console.log("Successfully connected to MQTT broker at ruc-rejseplanen.cloud.shiftr.io");
  // Subscribe to relevant topics
  mqttClient.subscribe("ruc-rejseplanen/trip-updates");
  mqttClient.subscribe("ruc-rejseplanen/system-messages");
  
  // Send a connection notification
  const connectMessage = {
    type: "connection",
    status: "online",
    clientId: randomId,
    timestamp: new Date().toISOString()
  };
  
  mqttClient.publish("ruc-rejseplanen/connections", JSON.stringify(connectMessage));
}

function onMessageArrived(topic, message) {
  let msg = message.toString();
  
  // Ignore if the message is from myself
  try {
    let parsedMsg = JSON.parse(msg);
    if (parsedMsg.clientId === randomId) {
      return;
    }
  } catch (e) {
    // If not JSON, proceed with processing
  }
  
  console.log(`Message Arrived on topic ${topic}: ${msg}`);
  messageReceived = msg;
  
  // Handle different message types based on topic
  if (topic === "ruc-rejseplanen/trip-updates") {
    // Handle trip updates
    console.log("Received trip update");
  } else if (topic === "ruc-rejseplanen/system-messages") {
    // Handle system messages
    console.log("Received system message");
  }
}

function sendMQTTMessage(topic, payload) {
  if (mqttClient && mqttClient.connected) {
    // Add clientId to payload if it's an object
    if (typeof payload === 'object') {
      payload.clientId = randomId;
      mqttClient.publish(topic, JSON.stringify(payload));
    } else {
      mqttClient.publish(topic, payload);
    }
    console.log(`Published to ${topic}:`, payload);
  } else {
    console.warn("MQTT client not connected. Cannot send message.");
  }
}

function onFailure(error) {
  console.log("Failed to connect to MQTT broker: " + error);
}

function onConnectionLost() {
  console.log("MQTT Connection Lost. Attempting to reconnect...");
  setTimeout(setupMQTT, 5000); // Try to reconnect after 5 seconds
}