let reportData = {};
let predictionHistory = [];

async function predictDisease() {

    const patientName =
    document.getElementById("patientName").value;   
    if(patientName.trim() === ""){
     alert("Please enter patient name");
     return;
    }
    const symptoms = {

     fever: document.getElementById("fever").checked ? 1 : 0,

     cough: document.getElementById("cough").checked ? 1 : 0,

     headache: document.getElementById("headache").checked ? 1 : 0,

     fatigue: document.getElementById("fatigue").checked ? 1 : 0,

     vomiting: document.getElementById("vomiting").checked ? 1 : 0,

     sore_throat:
     document.getElementById("sore_throat").checked ? 1 : 0,

     runny_nose:
     document.getElementById("runny_nose").checked ? 1 : 0,

     body_pain:
     document.getElementById("body_pain").checked ? 1 : 0,

     shortness_of_breath:
     document.getElementById("shortness_of_breath").checked ? 1 : 0,

     chest_pain:
     document.getElementById("chest_pain").checked ? 1 : 0,

     nausea:
     document.getElementById("nausea").checked ? 1 : 0,

     diarrhea:
     document.getElementById("diarrhea").checked ? 1 : 0,

     loss_of_taste:
     document.getElementById("loss_of_taste").checked ? 1 : 0,

     loss_of_smell:
     document.getElementById("loss_of_smell").checked ? 1 : 0,

     dizziness:
     document.getElementById("dizziness").checked ? 1 : 0
    };
    console.log(symptoms);

    const response = await fetch("https://medical-diagnosis-assistant-79xo.onrender.com/predict", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(symptoms)
    });
        
    console.log("Status:", response.status);

    if (!response.ok) {
        const errorText = await response.text();
        console.log(errorText);
        alert("Backend Error. Check Console.");
        return;
    }

    const data = await response.json();
    console.log(data);

    reportData = {
      patientName,
      disease: data.predicted_disease,
      confidence: data.confidence,
      recommendation: data.recommendation
    };
    const now = new Date();

    const date = now.toLocaleDateString();

    const time = now.toLocaleTimeString();

    predictionHistory.push({
     patient: patientName,
     disease: data.predicted_disease,
     confidence: data.confidence,
     date: date,
     time: time
   });

    localStorage.setItem(
     "history",
     JSON.stringify(predictionHistory)
   );

   updateHistoryTable(); 

    document.getElementById("result").innerHTML =
    `
    <h3>Patient: ${patientName}</h3>

    <h3>Predicted Disease:
    ${data.predicted_disease}
    </h3>

    <div class="confidence-bar">
     <div class="confidence-fill"
         style="width:${data.confidence}%">
     </div>
    </div>

    <p>
     <strong>Confidence:</strong>
     ${data.confidence}%
    </p>

    <p>
     <strong>Recommendation:</strong>
     ${data.recommendation}
    </p>

    <div class="disease-card">

     <h3>Disease Information</h3>

     <p>
        <strong>Description:</strong>
        ${data.info?.description || "No information available"}
     </p>

     <p>
        <strong>Symptoms:</strong><br>
        ${data.info?.symptoms?.join("<br>") || "No symptom information available"}
     </p>

     <p>
        <strong>Prevention:</strong><br>
        ${data.info?.prevention?.join("<br>") || "No prevention information available"}
     </p>

    </div>
    `;
}

function downloadPDF() {

    if (!reportData.patientName) {
        alert("Generate a diagnosis first.");
        return;
    }

    const { jsPDF } = window.jspdf;

    const doc = new jsPDF();

    doc.setFontSize(18);
    doc.text("Medical Diagnosis Report", 20, 20);

    doc.setFontSize(12);

    doc.text(
        `Patient Name: ${reportData.patientName}`,
        20,
        40
    );

    doc.text(
        `Predicted Disease: ${reportData.disease}`,
        20,
        55
    );

    doc.text(
        `Confidence: ${reportData.confidence}%`,
        20,
        70
    );

    doc.text(
        `Recommendation: ${reportData.recommendation}`,
        20,
        85
    );
    const now = new Date();

    doc.text(
     `Date: ${now.toLocaleDateString()}`,
     20,
     100
    );

    doc.text(
     `Time: ${now.toLocaleTimeString()}`,
     20,
     115
    );

    doc.save("Medical_Report.pdf");
}
function updateHistoryTable(){

    const historyBody =
    document.getElementById("historyBody");

    historyBody.innerHTML = "";

    predictionHistory.forEach(item => {

        historyBody.innerHTML += `
            <tr>
                <td>${item.patient}</td>
                <td>${item.disease}</td>
                <td>${item.confidence}%</td>
                <td>${item.date}</td>
                <td>${item.time}</td>
            </tr>
        `;
    });

}
function startVoiceInput() {

    const SpeechRecognition =
        window.SpeechRecognition ||
        window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        alert("Speech Recognition is not supported in your browser.");
        return;
    }

    const recognition = new SpeechRecognition();

    recognition.lang = "en-US";

    recognition.start();

    recognition.onresult = function(event) {

        const transcript =
            event.results[0][0].transcript.toLowerCase();

        console.log("Voice Input:", transcript);

        document.getElementById("transcriptText").innerHTML =
          transcript;

        if(transcript.includes("fever")){
            document.getElementById("fever").checked = true;
        }

        if(transcript.includes("sore throat")){
          document.getElementById("sore_throat").checked = true;
        }

        if(transcript.includes("runny nose")){
          document.getElementById("runny_nose").checked = true;
       }

        if(transcript.includes("body pain")){
           document.getElementById("body_pain").checked = true;
       }

        if(transcript.includes("shortness of breath")){
           document.getElementById("shortness_of_breath").checked = true;
        }

        if(transcript.includes("chest pain")){
           document.getElementById("chest_pain").checked = true;
        }

        if(transcript.includes("nausea")){
           document.getElementById("nausea").checked = true;
       }

       if(transcript.includes("diarrhea")){
         document.getElementById("diarrhea").checked = true;
        }

       if(transcript.includes("loss of taste")){
         document.getElementById("loss_of_taste").checked = true;
        }

       if(transcript.includes("loss of smell")){
          document.getElementById("loss_of_smell").checked = true;
       }

       if(transcript.includes("dizziness")){
          document.getElementById("dizziness").checked = true;
        }

        if(transcript.includes("cough")){
            document.getElementById("cough").checked = true;
        }

        if(transcript.includes("headache")){
            document.getElementById("headache").checked = true;
        }

        if(transcript.includes("fatigue")){
            document.getElementById("fatigue").checked = true;
        }

        if(transcript.includes("vomiting")){
            document.getElementById("vomiting").checked = true;
        }

        alert("Symptoms detected successfully!");
    };

    recognition.onerror = function(event){
        alert("Voice recognition error: " + event.error);
    };
}
function toggleChat() {

    const chat =
    document.getElementById("chatContainer");

    if(chat.style.display === "flex"){
        chat.style.display = "none";
    }else{
        chat.style.display = "flex";
    }
}
function sendMessage() {

    const input =
    document.getElementById("chatInput");

    const message =
    input.value.toLowerCase();

    const chatBody =
    document.getElementById("chatBody");

    chatBody.innerHTML += `
        <div class="user-message">
            ${input.value}
        </div>
    `;

    let reply = "Please consult a doctor for accurate diagnosis.";

    if(message.includes("fever")){
        reply =
        "Fever may indicate Flu, Dengue, or infection. Stay hydrated and monitor temperature.";
    }

    else if(message.includes("cough")){
        reply =
        "Cough is commonly associated with cold, flu, or respiratory infection.";
    }

    else if(message.includes("headache")){
        reply =
        "Headache may occur due to stress, flu, dehydration, or migraine.";
    }

    else if(message.includes("dengue")){
        reply =
        "Dengue symptoms include fever, headache, body pain, and fatigue.";
    }

    else if(message.includes("flu")){
        reply =
        "Flu symptoms include fever, cough, headache, and tiredness.";
    }

    else if(message.includes("sore throat")){
     reply = "A sore throat is commonly associated with Common Cold, Flu, and Sinusitis.";
    }

    else if(message.includes("runny nose")){
     reply = "Runny nose is a common symptom of Common Cold and Sinusitis.";
    }

    else if(message.includes("body pain")){
      reply = "Body pain may occur in Dengue, Flu, or Viral Infection.";
   }

    else if(message.includes("shortness of breath")){
     reply = "Shortness of breath may indicate Pneumonia or other respiratory conditions.";
   }

    else if(message.includes("chest pain")){
     reply = "Chest pain may be associated with Bronchitis or other medical conditions.";
   }

    else if(message.includes("nausea")){
     reply = "Nausea is commonly seen in Migraine and Food Poisoning.";
   }

    else if(message.includes("diarrhea")){
     reply = "Diarrhea is a common symptom of Food Poisoning.";
   }

    else if(message.includes("loss of taste")){
     reply = "Loss of taste is commonly associated with COVID-19.";
    }

    else if(message.includes("loss of smell")){
     reply = "Loss of smell is commonly associated with COVID-19.";
   }

    else if(message.includes("dizziness")){
      reply = "Dizziness can occur with Migraine and some viral illnesses.";
   }

    else if(message.includes("covid")){
     reply = "COVID-19 symptoms may include fever, cough, loss of taste, and loss of smell.";
   }

    else if(message.includes("migraine")){
     reply = "Migraine commonly causes headache, nausea, and dizziness.";
   }

    else if(message.includes("pneumonia")){
     reply = "Pneumonia symptoms may include fever, cough, and shortness of breath.";
    }

    chatBody.innerHTML += `
        <div class="bot-message">
            ${reply}
        </div>
    `;

    input.value = "";

    chatBody.scrollTop =
    chatBody.scrollHeight;
}
function startVoiceInput() {

    const SpeechRecognition =
        window.SpeechRecognition ||
        window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        alert("Speech Recognition is not supported in this browser.");
        return;
    }

    const recognition = new SpeechRecognition();

    recognition.lang = "en-US";
    recognition.start();

    recognition.onstart = () => {
        console.log("Listening...");
    };

    recognition.onresult = (event) => {

      const transcript =
         event.results[0][0].transcript;

     document.getElementById("chatInput").value =
        transcript;

     sendMessage();
   };

    recognition.onerror = (event) => {
        console.log(event.error);
    };
}

window.onload = function () {
particlesJS("particles-js", {
    particles: {
        number: {
            value: 80
        },
        color: {
            value: "#00d4ff"
        },
        shape: {
            type: "circle"
        },
        opacity: {
            value: 0.5
        },
        size: {
            value: 3
        },
        line_linked: {
            enable: true,
            distance: 150,
            color: "#00d4ff",
            opacity: 0.4,
            width: 1
        },
        move: {
            enable: true,
            speed: 900
        }
    },
    interactivity: {
        events: {
            onhover: {
                enable: true,
                mode: "grab"
            }
        }
    }
})

};