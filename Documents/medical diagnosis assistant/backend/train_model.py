import pandas as pd

from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score
import pickle

df = pd.read_csv("dataset.csv")

print(df.head())
X = df.drop("disease", axis=1)

y = df["disease"]
X_train, X_test, y_train, y_test = train_test_split(
    X,
    y,
    test_size=0.2,
    random_state=42
)
model = RandomForestClassifier(
    n_estimators=100,
    random_state=42
)

model.fit(X_train, y_train)
y_pred = model.predict(X_test)

accuracy = accuracy_score(y_test, y_pred)

print("Accuracy:", accuracy)
with open("model.pkl", "wb") as file:
    pickle.dump(model, file)

print("Model Saved Successfully")
import pickle

with open("model.pkl", "rb") as file:
    model = pickle.load(file)

sample = [[
    1,  # fever
    1,  # cough
    1,  # headache
    1,  # fatigue
    0,  # vomiting
    0,  # sore_throat
    0,  # runny_nose
    0,  # body_pain
    0,  # shortness_of_breath
    0,  # chest_pain
    0,  # nausea
    0,  # diarrhea
    0,  # loss_of_taste
    0,  # loss_of_smell
    0   # dizziness
]]

print(model.predict(sample))