from flask import Flask, render_template, request, jsonify
from transformers import pipeline

app = Flask(__name__)

# Load the AI model only once
classifier = pipeline("sentiment-analysis",model="distilbert-base-uncased-finetuned-sst-2-english")


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/predict", methods=["POST"])
def predict():

    data = request.get_json()

    text = data.get("text", "").strip()

    if not text:
        return jsonify({
            "sentiment": "NEUTRAL",
            "confidence": 0.0
        })

    result = classifier(text)
    
    print(result)
    
    label = result[0]["label"]
    score = result[0]["score"]

    # Optional: Treat low-confidence predictions as Neutral
    if score < 0.85:
        label = "NEUTRAL"

    return jsonify({
        "sentiment": label,
        "confidence": score
    })


if __name__ == "__main__":
    app.run(debug=True)