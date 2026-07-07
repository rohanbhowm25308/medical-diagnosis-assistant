#  Medical Diagnosis Assistant

An AI-powered Medical Diagnosis Assistant that predicts possible diseases based on user-selected symptoms. This project combines Machine Learning, FastAPI, and a responsive web interface to provide quick and simple health-related predictions.

 Live Demo: https://deft-chimera-a5944f.netlify.app/

---

##  Features

- User-friendly medical diagnosis interface
- Symptom-based disease prediction
- Machine Learning model trained using Scikit-Learn
- FastAPI backend for prediction processing
- Responsive and modern UI
- Fast and lightweight application
- Easy deployment using Render and Netlify

---

##  Tech Stack

### Frontend
- HTML5
- CSS3
- JavaScript

### Backend
- Python
- FastAPI
- Uvicorn

### Machine Learning
- Scikit-Learn
- Pandas
- NumPy
- Random Forest Classifier

### Deployment
- Netlify (Frontend)
- Render (Backend)

---

##  Installation

### Clone Repository

```bash
git clone https://github.com/rohanbhowm25308/medical-diagnosis-assistant.git
```

### Navigate to Project

```bash
cd medical-diagnosis-assistant
```

### Install Dependencies

```bash
cd backend
pip install -r requirements.txt
```

### Run Backend

```bash
uvicorn app:app --reload
```

### Open Frontend

Open the `frontend/index.html` file in your browser.

---

##  Machine Learning Model

The project uses a Random Forest Classifier trained on symptom-based medical data.

### Workflow

1. Load medical dataset
2. Preprocess data
3. Train Random Forest Model
4. Save trained model (`model.pkl`)
5. Use FastAPI API for predictions
6. Display results on frontend

---

##  Application Workflow

1. Enter patient name
2. Select symptoms
3. Submit diagnosis request
4. ML model analyzes symptoms
5. Predicted disease is displayed instantly

---

##  Future Improvements

- Doctor recommendation system
- Disease severity prediction
- Health report generation (PDF)
- User authentication
- Medical history tracking
- AI chatbot integration

---

##  Learning Outcomes

Through this project, I gained hands-on experience with:

- Machine Learning Model Development
- FastAPI Backend Development
- Frontend-Backend Integration
- API Handling
- Deployment on Netlify and Render
- Real-World Healthcare AI Applications

---

##  Developer

**Rohan Bhowmik**

Aspiring Data Scientist | AI/ML Enthusiast | Web Developer

GitHub: https://github.com/rohanbhowm25308

LinkedIn: https://www.linkedin.com/in/rohan-bhowmik-b014473a1

---

⭐ If you like this project, don't forget to star the repository!
