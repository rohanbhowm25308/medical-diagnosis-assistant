from fastapi import FastAPI
from pydantic import BaseModel
import pickle
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load trained model
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "model.pkl")

with open(MODEL_PATH, "rb") as file:
    model = pickle.load(file)


# Input schema
class Symptoms(BaseModel):
    fever: int
    cough: int
    headache: int
    fatigue: int
    vomiting: int
    sore_throat: int
    runny_nose: int
    body_pain: int
    shortness_of_breath: int
    chest_pain: int
    nausea: int
    diarrhea: int
    loss_of_taste: int
    loss_of_smell: int
    dizziness: int

# Home route
@app.get("/")
def home():
    return {
        "message": "Medical Diagnosis Assistant API Running"
    }

# Prediction route
@app.post("/predict")
def predict(symptoms: Symptoms):

    data = [[
        symptoms.fever,
        symptoms.cough,
        symptoms.headache,
        symptoms.fatigue,
        symptoms.vomiting,
        symptoms.sore_throat,
        symptoms.runny_nose,
        symptoms.body_pain,
        symptoms.shortness_of_breath,
        symptoms.chest_pain,
        symptoms.nausea,
        symptoms.diarrhea,
        symptoms.loss_of_taste,
        symptoms.loss_of_smell,
        symptoms.dizziness
    ]]

    prediction = model.predict(data)
    probability = model.predict_proba(data)

    confidence = round(max(probability[0]) * 100, 2)
    
    recommendations = {
    "Flu": "Take rest, drink plenty of fluids, and monitor your temperature.",
    
    "Cold": "Stay hydrated and get adequate rest.",
    
    "Dengue": "Seek medical attention and monitor platelet count regularly.",
    
    "COVID-19": "Isolate if necessary and consult a healthcare professional.",

    "Migraine": "Rest in a quiet room and stay hydrated.",

    "Food Poisoning": "Drink oral rehydration fluids and avoid contaminated food.",

    "Bronchitis": "Get adequate rest and drink warm fluids.",

    "Pneumonia": "Seek medical attention promptly.",

    "Sinusitis": "Use steam inhalation and stay hydrated.",

    "Viral Infection": "Rest, hydrate, and monitor symptoms."
}
    
    disease_info = {
    "Flu": {
        "description": "Flu is a viral infection that affects the respiratory system.",
        "symptoms": [
            "Fever",
            "Cough",
            "Headache",
            "Fatigue"
        ],
        "prevention": [
            "Wash hands regularly",
            "Drink plenty of fluids",
            "Get adequate rest"
        ]
    },

    "Cold": {
        "description": "Common cold is a viral infection of the nose and throat.",
        "symptoms": [
            "Runny nose",
            "Sneezing",
            "Cough"
        ],
        "prevention": [
            "Avoid close contact with sick people",
            "Wash hands frequently",
            "Maintain good hygiene"
        ]
    },

    "Dengue": {
        "description": "Dengue is a mosquito-borne viral disease.",
        "symptoms": [
            "High fever",
            "Headache",
            "Joint pain",
            "Vomiting"
        ],
        "prevention": [
            "Avoid mosquito bites",
            "Use mosquito nets",
            "Remove stagnant water"
        ]
    },
    
    "COVID-19": {
       "description": "COVID-19 is a contagious respiratory disease caused by a coronavirus.",
       "symptoms": [
         "Fever",
         "Cough",
         "Loss of Taste",
         "Loss of Smell"
    ],
       "prevention": [
        "Wash hands frequently",
        "Wear a mask when appropriate",
        "Avoid close contact with infected individuals"
    ]
    },

    "Migraine": {
      "description": "Migraine is a neurological condition causing severe headaches.",
      "symptoms": [
        "Headache",
        "Nausea",
        "Dizziness"
    ],
      "prevention": [
        "Manage stress",
        "Stay hydrated",
        "Maintain regular sleep patterns"
    ]
   },

    "Food Poisoning": {
      "description": "Food poisoning occurs after consuming contaminated food.",
      "symptoms": [
        "Vomiting",
        "Diarrhea",
        "Nausea"
    ],
    "prevention": [
        "Eat properly cooked food",
        "Maintain food hygiene",
        "Wash hands before eating"
    ]
    },
}

    disease = str(prediction[0])

    return {
       "predicted_disease": disease,
       "confidence": confidence,
       "recommendation": recommendations.get(
           disease,
          "Please consult a healthcare professional."
        ),
       "info": disease_info.get(disease, {})
    }