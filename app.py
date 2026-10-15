"""Optional Flask server. The site is fully static; Flask is only for local/Python hosting.
Run:  pip install -r requirements.txt && python app.py   ->  http://127.0.0.1:5000
"""
import os
from flask import Flask, send_from_directory

BASE = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__, static_folder=os.path.join(BASE, "static"), static_url_path="/static")

@app.route("/")
def index():
    return send_from_directory(BASE, "index.html")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
